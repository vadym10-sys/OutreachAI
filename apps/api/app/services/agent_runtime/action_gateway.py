from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import ActionPolicyEnforcement, Workspace
from app.services.agent_runtime.errors import (
    AgentRuntimeError,
    ApprovalStateError,
    IdempotencyConflictError,
    PermissionDeniedError,
    ToolExecutionBlockedError,
    UnknownToolError,
)
from app.services.agent_runtime.approval_policy import AgentApprovalPolicy
from app.services.agent_runtime.permissions import (
    AgentRuntimePermissionResolver,
    WorkspaceRolePermissionResolver,
)
from app.services.agent_runtime.registry import ToolRegistry
from app.services.agent_runtime.tracing import error_category, sanitize_for_trace

ActorType = Literal["human", "ai", "worker", "system"]
ActionType = Literal["read_only", "internal_write", "external_side_effect"]

BODY_FIELDS = {
    "body",
    "email_body",
    "full_email",
    "draft_body",
    "reply_body",
    "message_body",
}


@dataclass(frozen=True)
class ActionDefinition:
    name: str
    action_type: ActionType
    required_permissions: tuple[str, ...] = ()
    tool_schema_name: str = ""
    requires_approval: bool = False
    requires_manual_draft_approval: bool = False
    requires_final_send_confirmation: bool = False
    provider_side_effect: bool = False
    idempotency_required: bool = False
    human_only: bool = False


@dataclass(frozen=True)
class ActionApprovalContext:
    approved: bool = False
    approved_by_actor_type: ActorType | str = ""
    approved_by_user_id: str = ""
    manual_draft_approval: bool = False
    final_send_confirmation: bool = False
    fingerprint: str = ""


@dataclass(frozen=True)
class ActionPolicyDecision:
    allowed: bool
    reason: str
    action_name: str
    action_type: ActionType
    request_fingerprint: str
    replay: bool = False
    provider_side_effect_allowed: bool = False
    enforcement: ActionPolicyEnforcement | None = None


ACTION_DEFINITIONS: dict[str, ActionDefinition] = {
    "crm.write": ActionDefinition(
        name="crm.write",
        action_type="internal_write",
        required_permissions=("crm:write",),
        tool_schema_name="save_to_crm",
        requires_approval=True,
    ),
    "email.draft.create": ActionDefinition(
        name="email.draft.create",
        action_type="internal_write",
        required_permissions=("email:draft",),
        tool_schema_name="generate_email_draft",
    ),
    "email.draft.update": ActionDefinition(
        name="email.draft.update",
        action_type="internal_write",
        required_permissions=("email:draft",),
        tool_schema_name="generate_email_draft",
    ),
    "email.draft.approve": ActionDefinition(
        name="email.draft.approve",
        action_type="internal_write",
        required_permissions=("email:draft",),
        human_only=True,
    ),
    "email.send": ActionDefinition(
        name="email.send",
        action_type="external_side_effect",
        required_permissions=("email:send",),
        tool_schema_name="send_email",
        requires_approval=True,
        requires_manual_draft_approval=True,
        requires_final_send_confirmation=True,
        provider_side_effect=True,
        idempotency_required=True,
        human_only=True,
    ),
    "gmail.replies.sync": ActionDefinition(
        name="gmail.replies.sync",
        action_type="external_side_effect",
        required_permissions=("gmail:read", "crm:write"),
        tool_schema_name="sync_replies",
        requires_approval=True,
    ),
    "email.state.sync": ActionDefinition(
        name="email.state.sync",
        action_type="internal_write",
        required_permissions=("email:draft", "crm:write"),
    ),
    "autonomous.email.send": ActionDefinition(
        name="autonomous.email.send",
        action_type="external_side_effect",
        required_permissions=("email:send",),
        tool_schema_name="send_email",
        requires_approval=True,
        requires_manual_draft_approval=True,
        requires_final_send_confirmation=True,
        provider_side_effect=True,
        idempotency_required=True,
        human_only=True,
    ),
}


class ActionPolicyGateway:
    def __init__(
        self,
        *,
        permission_resolver: AgentRuntimePermissionResolver | None = None,
        registry: ToolRegistry | None = None,
        approval_policy: AgentApprovalPolicy | None = None,
    ) -> None:
        self.permission_resolver = permission_resolver or WorkspaceRolePermissionResolver()
        self.registry = registry
        self.approval_policy = approval_policy or AgentApprovalPolicy()

    def enforce(
        self,
        db: Session,
        *,
        workspace: Workspace,
        actor_type: ActorType,
        actor_id: str,
        action_name: str,
        input_payload: dict[str, Any],
        required_permissions: tuple[str, ...] | None = None,
        dry_run: bool = False,
        approval: ActionApprovalContext | None = None,
        idempotency_key: str = "",
        resource_workspace_id: UUID | None = None,
        resource_id: UUID | str | None = None,
        required_approval_fingerprint: str = "",
    ) -> ActionPolicyDecision:
        definition = self._definition(action_name)
        self._validate_registered_tool_schema(definition)
        clean_actor_id = str(actor_id or "").strip()
        if not clean_actor_id:
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=required_permissions
                or definition.required_permissions,
                dry_run=dry_run,
                request_fingerprint="",
                reason="missing_actor_identity",
                exc=PermissionDeniedError("Missing actor identity."),
            )
            raise PermissionDeniedError("Missing actor identity.")
        if actor_type not in {"human", "ai", "worker", "system"}:
            raise PermissionDeniedError("Unsupported actor type.")
        if definition.human_only and actor_type != "human":
            request_fingerprint = request_fingerprint_for_action(
                action_name=action_name, input_payload=input_payload
            )
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=required_permissions
                or definition.required_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="action_requires_human_actor",
                exc=ApprovalStateError("This action requires a human actor."),
            )
            raise ApprovalStateError("This action requires a human actor.")
        if resource_workspace_id is not None and resource_workspace_id != workspace.id:
            request_fingerprint = request_fingerprint_for_action(
                action_name=action_name, input_payload=input_payload
            )
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=required_permissions
                or definition.required_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="workspace_mismatch",
                exc=PermissionDeniedError("Action workspace mismatch."),
            )
            raise PermissionDeniedError("Action workspace mismatch.")
        request_fingerprint = request_fingerprint_for_action(
            action_name=action_name, input_payload=input_payload
        )
        effective_permissions = required_permissions or definition.required_permissions
        try:
            self._require_permissions(
                db,
                workspace=workspace,
                actor_id=clean_actor_id,
                required_permissions=effective_permissions,
            )
        except PermissionDeniedError as exc:
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=effective_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="permission_denied",
                exc=exc,
            )
            raise
        if dry_run and definition.action_type == "external_side_effect":
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=effective_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="dry_run_blocks_provider_action",
                exc=ToolExecutionBlockedError(
                    "Dry-run blocks provider side effects."
                ),
            )
            raise ToolExecutionBlockedError("Dry-run blocks provider side effects.")
        try:
            self._require_approval(
                definition,
                actor_type=actor_type,
                approval=approval,
                required_approval_fingerprint=required_approval_fingerprint,
            )
        except ApprovalStateError as exc:
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=effective_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="approval_state_blocked",
                exc=exc,
            )
            raise
        try:
            enforcement = self._start_enforcement(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=effective_permissions,
                dry_run=dry_run,
                approval=approval,
                idempotency_key=idempotency_key,
                request_fingerprint=request_fingerprint,
                idempotency_required=definition.idempotency_required
                or actor_type in {"ai", "worker"},
            )
        except (IdempotencyConflictError, ToolExecutionBlockedError) as exc:
            self._record_blocked(
                db,
                workspace=workspace,
                actor_type=actor_type,
                actor_id=clean_actor_id,
                action_name=action_name,
                action_type=definition.action_type,
                resource_id=resource_id,
                required_permissions=effective_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="idempotency_state_blocked",
                exc=exc,
            )
            raise
        return ActionPolicyDecision(
            allowed=True,
            reason="policy_allowed",
            action_name=action_name,
            action_type=definition.action_type,
            request_fingerprint=request_fingerprint,
            replay=bool(enforcement and enforcement.status == "succeeded"),
            provider_side_effect_allowed=definition.provider_side_effect,
            enforcement=enforcement,
        )

    def record_success(
        self,
        db: Session,
        decision: ActionPolicyDecision | None,
        *,
        result: dict[str, Any] | None = None,
    ) -> None:
        if not decision or not decision.enforcement or decision.replay:
            return
        enforcement = decision.enforcement
        enforcement.status = "succeeded"
        enforcement.result_json = _policy_safe_payload(result or {})
        enforcement.error_category = ""
        enforcement.error_message = ""
        enforcement.completed_at = datetime.utcnow()
        enforcement.updated_at = datetime.utcnow()
        db.add(enforcement)
        db.flush()

    def record_failure(
        self,
        db: Session,
        decision: ActionPolicyDecision | None,
        exc: Exception | str,
    ) -> None:
        if not decision or not decision.enforcement or decision.replay:
            return
        enforcement = decision.enforcement
        enforcement.status = "failed"
        enforcement.error_category = (
            error_category(exc) if isinstance(exc, Exception) else str(exc)
        )
        enforcement.error_message = str(exc)[:1000]
        enforcement.completed_at = datetime.utcnow()
        enforcement.updated_at = datetime.utcnow()
        db.add(enforcement)
        db.flush()

    def _definition(self, action_name: str) -> ActionDefinition:
        definition = ACTION_DEFINITIONS.get(action_name)
        if definition is None:
            raise UnknownToolError("Unknown action policy definition.")
        return definition

    def _validate_registered_tool_schema(self, definition: ActionDefinition) -> None:
        if not definition.tool_schema_name:
            return
        registry = self.registry
        if registry is None:
            from app.services.agent_runtime.adapters import default_tool_registry

            registry = default_tool_registry()
            self.registry = registry
        tool = registry.get(definition.tool_schema_name)
        if tool.action_type != definition.action_type:
            raise UnknownToolError("Action policy schema action type mismatch.")
        tool_policy = self.approval_policy.decision_for_tool(tool)
        if tool_policy.requires_approval and not definition.requires_approval:
            raise UnknownToolError("Action policy approval requirement mismatch.")

    def _require_permissions(
        self,
        db: Session,
        *,
        workspace: Workspace,
        actor_id: str,
        required_permissions: tuple[str, ...],
    ) -> None:
        if not required_permissions:
            return
        allowed = self.permission_resolver.allowed_permissions(
            db, workspace=workspace, user_id=actor_id
        )
        if set(required_permissions).issubset(allowed):
            return
        raise PermissionDeniedError("Action permission denied.")

    def _require_approval(
        self,
        definition: ActionDefinition,
        *,
        actor_type: ActorType,
        approval: ActionApprovalContext | None,
        required_approval_fingerprint: str,
    ) -> None:
        approval_required = definition.requires_approval
        if actor_type == "human" and not definition.provider_side_effect:
            approval_required = False
        if not approval_required:
            return
        if approval is None or not approval.approved:
            raise ApprovalStateError("Missing approval state blocks this action.")
        if approval.approved_by_actor_type != "human":
            raise ApprovalStateError("AI and workers cannot approve their own action.")
        if not str(approval.approved_by_user_id or "").strip():
            raise ApprovalStateError("Approval must be tied to a human user.")
        if definition.requires_manual_draft_approval and not approval.manual_draft_approval:
            raise ApprovalStateError("Manual draft approval is required before sending.")
        if (
            definition.requires_final_send_confirmation
            and not approval.final_send_confirmation
        ):
            raise ApprovalStateError(
                "Separate final Send confirmation is required before sending."
            )
        if required_approval_fingerprint and (
            not approval.fingerprint
            or approval.fingerprint != required_approval_fingerprint
        ):
            raise ApprovalStateError(
                "Approval fingerprint does not match this action payload."
            )

    def _start_enforcement(
        self,
        db: Session,
        *,
        workspace: Workspace,
        actor_type: ActorType,
        actor_id: str,
        action_name: str,
        action_type: ActionType,
        resource_id: UUID | str | None,
        required_permissions: tuple[str, ...],
        dry_run: bool,
        approval: ActionApprovalContext | None,
        idempotency_key: str,
        request_fingerprint: str,
        idempotency_required: bool,
    ) -> ActionPolicyEnforcement | None:
        key = str(idempotency_key or "").strip()
        if idempotency_required and not key:
            raise IdempotencyConflictError("Missing idempotency key blocks action.")
        if key:
            existing = db.scalar(
                select(ActionPolicyEnforcement).where(
                    ActionPolicyEnforcement.workspace_id == workspace.id,
                    ActionPolicyEnforcement.idempotency_key == key,
                )
            )
            if existing:
                if existing.request_fingerprint != request_fingerprint:
                    raise IdempotencyConflictError(
                        "Idempotency request already exists with a different payload."
                    )
                if existing.status == "succeeded":
                    return existing
                if existing.status == "started":
                    raise ToolExecutionBlockedError(
                        "Action idempotency key is already in progress."
                    )
                existing.status = "started"
                existing.error_category = ""
                existing.error_message = ""
                existing.completed_at = None
                existing.updated_at = datetime.utcnow()
                db.flush()
                return existing
        enforcement = ActionPolicyEnforcement(
            workspace_id=workspace.id,
            actor_type=actor_type,
            actor_id=actor_id,
            user_id=actor_id,
            action_name=action_name,
            action_type=action_type,
            resource_id=str(resource_id or ""),
            required_permissions_json=list(required_permissions),
            approval_state="approved" if approval and approval.approved else "none",
            approval_fingerprint=approval.fingerprint if approval else "",
            request_fingerprint=request_fingerprint,
            idempotency_key=key,
            dry_run=dry_run,
            status="started",
        )
        db.add(enforcement)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            existing = db.scalar(
                select(ActionPolicyEnforcement).where(
                    ActionPolicyEnforcement.workspace_id == workspace.id,
                    ActionPolicyEnforcement.idempotency_key == key,
                )
            )
            if existing and existing.request_fingerprint == request_fingerprint:
                return existing
            raise IdempotencyConflictError(
                "Idempotency request already exists with a different payload."
            ) from exc
        return enforcement

    def _record_blocked(
        self,
        db: Session,
        *,
        workspace: Workspace,
        actor_type: str,
        actor_id: str,
        action_name: str,
        action_type: ActionType,
        resource_id: UUID | str | None,
        required_permissions: tuple[str, ...],
        dry_run: bool,
        request_fingerprint: str,
        reason: str,
        exc: Exception,
    ) -> None:
        db.add(
            ActionPolicyEnforcement(
                workspace_id=workspace.id,
                actor_type=actor_type,
                actor_id=actor_id,
                user_id=actor_id,
                action_name=action_name,
                action_type=action_type,
                resource_id=str(resource_id or ""),
                required_permissions_json=list(required_permissions),
                approval_state="blocked",
                request_fingerprint=request_fingerprint,
                dry_run=dry_run,
                status="blocked",
                error_category=error_category(exc),
                error_message=reason,
                completed_at=datetime.utcnow(),
            )
        )
        db.flush()


def policy_http_exception(exc: AgentRuntimeError) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Action permission denied.",
        )
    if isinstance(exc, IdempotencyConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotency request already exists with a different payload.",
        )
    if isinstance(exc, (ApprovalStateError, ToolExecutionBlockedError)):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, UnknownToolError):
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Action policy is not configured for this route.",
        )
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def request_fingerprint_for_action(
    *, action_name: str, input_payload: dict[str, Any]
) -> str:
    raw = json.dumps(
        {
            "version": "action-policy-v1",
            "action_name": action_name,
            "input": _policy_fingerprint_payload(input_payload),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def email_send_confirmation_snapshot(
    *,
    sender_email: str,
    recipient_email: str,
    subject: str,
    body: str,
    approval_version: int,
) -> dict[str, Any]:
    canonical = {
        "sender_email": _normalized_email(sender_email),
        "recipient_email": _normalized_email(recipient_email),
        "subject": str(subject or ""),
        "body": str(body or ""),
        "approval_version": int(approval_version),
    }
    fingerprint_source = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return {
        "sender_email": canonical["sender_email"],
        "recipient_email": canonical["recipient_email"],
        "subject": canonical["subject"],
        "body_sha256": hashlib.sha256(canonical["body"].encode("utf-8")).hexdigest(),
        "body_length": len(canonical["body"]),
        "approval_version": canonical["approval_version"],
        "fingerprint": hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest(),
    }


def email_draft_approval_fingerprint(
    *,
    recipient_email: str,
    subject: str,
    body: str,
    approval_version: int,
) -> str:
    return request_fingerprint_for_action(
        action_name="email.draft.approve",
        input_payload={
            "recipient_email": _normalized_email(recipient_email),
            "subject": str(subject or ""),
            "body": str(body or ""),
            "approval_version": int(approval_version),
        },
    )


def _policy_fingerprint_payload(value: Any, *, key_name: str = "") -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        if key_name.lower() in BODY_FIELDS:
            return {
                "sha256": hashlib.sha256(value.encode("utf-8")).hexdigest(),
                "length": len(value),
            }
        return value
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            output[key_text] = _policy_fingerprint_payload(item, key_name=key_text)
        return output
    if isinstance(value, (list, tuple, set)):
        return [_policy_fingerprint_payload(item, key_name=key_name) for item in value]
    return str(value)


def _policy_safe_payload(value: dict[str, Any]) -> dict[str, Any]:
    return sanitize_for_trace(
        _policy_fingerprint_payload(value),
        max_string_length=1000,
    )


def _normalized_email(value: Any) -> str:
    return str(value or "").strip().lower()


def require_provider_policy(decision: ActionPolicyDecision | None) -> None:
    if decision is None:
        raise ToolExecutionBlockedError(
            "Email provider send blocked by missing server-side policy enforcement."
        )
    if not decision.allowed or not decision.provider_side_effect_allowed or decision.replay:
        raise ToolExecutionBlockedError(
            "Email provider send blocked by server-side policy state."
        )
