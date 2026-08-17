from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal, Optional, Union
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import (
    ActionPolicyEnforcement,
    Campaign,
    CampaignStatus,
    Company,
    EmailMessage,
    EnrichmentJob,
    Lead,
    Workspace,
)
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
from app.services.agent_runtime.tracing import sanitize_for_trace

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
ACTION_POLICY_CLAIM_TTL_SECONDS = 900
POLICY_ERROR_SECRET_RE = re.compile(
    r"(?i)\b(smtp[_-]?password|smtp[_-]?username|smtp[_-]?pass)\b\s*[:=]\s*['\"]?[^'\"\s,;]+"
)
POLICY_ERROR_BODY_RE = re.compile(
    r"(?is)\b(body|email_body|message_body|draft_body|reply_body)\b\s*[:=]\s*.+"
)
POLICY_ERROR_CATEGORY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,79}$")
POLICY_ERROR_CATEGORY_SENSITIVE_RE = re.compile(
    r"(?i)(authorization|bearer|cookie|api[_-]?key|apikey|access[_-]?token|"
    r"refresh[_-]?token|oauth|password|secret|client[_-]?secret|"
    r"private[_-]?key|smtp[_-]?password|smtp[_-]?username|"
    r"body=|email_body|message_body|draft_body|reply_body)"
)
ENRICHMENT_JOB_ACTION_SCOPES: dict[str, frozenset[tuple[str, str]]] = {
    "company_enrichment": frozenset(
        {
            ("crm.write", "worker.company_enrichment"),
            ("email.draft.create", "worker.company_enrichment.draft"),
            ("crm.write", "worker.enrichment_failure"),
        }
    ),
    "deep_contact_search": frozenset(
        {
            ("crm.write", "worker.deep_contact_search"),
            ("crm.write", "worker.enrichment_failure"),
        }
    ),
    "autopilot_email_send": frozenset(
        {
            ("crm.write", "worker.autopilot_email_send_failure"),
        }
    ),
}
ENRICHMENT_JOB_FAILURE_ROUTES = frozenset(
    {"worker.enrichment_failure", "worker.autopilot_email_send_failure"}
)


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
class ActionDelegationContext:
    delegated_by_user_id: str
    delegation_type: str
    evidence_id: str
    fingerprint: str
    workspace_id: UUID | str | None = None
    action_name: str = ""
    resource_id: UUID | str | None = None


@dataclass(frozen=True)
class ResolvedDelegationEvidence:
    delegated_by_user_id: str
    delegation_type: str
    evidence_id: str
    fingerprint: str


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
    execution_claim_token: str = ""


class _PolicyPayloadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route: str = Field(default="", max_length=200)
    metadata: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)

    @field_validator("metadata", "context")
    @classmethod
    def _safe_metadata(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _policy_safe_payload(value)


class _PolicyCrmWriteInput(_PolicyPayloadModel):
    action: str = Field(default="", max_length=120)
    source: str = Field(default="", max_length=120)
    status: str = Field(default="", max_length=120)
    status_before: str = Field(default="", max_length=120)
    status_after: str = Field(default="", max_length=120)
    status_transition: str = Field(default="", max_length=120)
    stage: str = Field(default="", max_length=120)
    job_type: str = Field(default="", max_length=120)
    request_id: str = Field(default="", max_length=160)
    company: str = Field(default="", max_length=300)
    company_name: str = Field(default="", max_length=300)
    website: str = Field(default="", max_length=500)
    domain: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=4000)
    email: str = Field(default="", max_length=320)
    contact_email: str = Field(default="", max_length=320)
    recipient_email: str = Field(default="", max_length=320)
    body: str = Field(default="", max_length=10000)
    tier: str = Field(default="", max_length=80)
    date: str = Field(default="", max_length=40)
    change_fingerprint: str = Field(default="", max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)
    filters: Optional[Union[dict[str, Any], list[Any]]] = None
    fields: list[str] = Field(default_factory=list)
    updates: dict[str, Any] = Field(default_factory=dict)
    found: Optional[bool] = None
    force: Optional[bool] = None
    watchlisted: Optional[bool] = None
    confirmed_not_delivered: Optional[bool] = None
    has_email: Optional[bool] = None
    has_phone: Optional[bool] = None
    has_linkedin: Optional[bool] = None
    dry_run: Optional[bool] = None
    count: Optional[int] = None
    candidate_count: Optional[int] = None
    draft_count: Optional[int] = None
    lead_count: Optional[int] = None
    company_count: Optional[int] = None
    score: Optional[Union[int, float]] = None
    icp_score: Optional[int] = None
    company_id: Optional[Union[UUID, str]] = None
    lead_id: Optional[Union[UUID, str]] = None
    email_id: Optional[Union[UUID, str]] = None
    campaign_id: Optional[Union[UUID, str]] = None
    employee_id: Optional[Union[UUID, str]] = None
    job_id: Optional[Union[UUID, str]] = None
    result_id: Optional[Union[UUID, str]] = None
    contact_id: Optional[Union[UUID, str]] = None
    note_id: Optional[Union[UUID, str]] = None
    plan_id: Optional[Union[UUID, str]] = None
    smoke_test_id: Optional[Union[UUID, str]] = None

    @field_validator(
        "company_id",
        "lead_id",
        "email_id",
        "campaign_id",
        "employee_id",
        "job_id",
        "result_id",
        "contact_id",
        "note_id",
        "plan_id",
        "smoke_test_id",
        mode="before",
    )
    @classmethod
    def _uuid_or_empty(cls, value: Any) -> Any:
        if value in (None, ""):
            return value
        return str(UUID(str(value)))


class _PolicyEmailDraftInput(_PolicyPayloadModel):
    email_id: Optional[Union[UUID, str]] = None
    lead_id: Optional[Union[UUID, str]] = None
    company_id: Optional[Union[UUID, str]] = None
    campaign_id: Optional[Union[UUID, str]] = None
    employee_id: Optional[Union[UUID, str]] = None
    job_id: Optional[Union[UUID, str]] = None
    parent_email_id: Optional[Union[UUID, str]] = None
    plan_id: Optional[Union[UUID, str]] = None
    smoke_test_id: Optional[Union[UUID, str]] = None
    result_id: Optional[Union[UUID, str]] = None
    mode: str = Field(default="", max_length=80)
    subject: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=10000)
    recipient_email: str = Field(default="", max_length=320)
    sender_email: str = Field(default="", max_length=320)
    command: str = Field(default="", max_length=4000)
    delivery_status: str = Field(default="", max_length=80)
    status_before: str = Field(default="", max_length=80)
    status_after: str = Field(default="", max_length=80)
    status_transition: str = Field(default="", max_length=80)
    approval_fingerprint: str = Field(default="", max_length=128)
    confirmation_fingerprint: str = Field(default="", max_length=128)
    approval_version: Optional[int] = None
    sequence_step: Optional[int] = None
    confirmed_exact_draft: Optional[bool] = None
    confirmed_not_delivered: Optional[bool] = None
    dry_run: Optional[bool] = None
    fields: list[str] = Field(default_factory=list)
    updates: dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "email_id",
        "lead_id",
        "company_id",
        "campaign_id",
        "employee_id",
        "job_id",
        "parent_email_id",
        "plan_id",
        "smoke_test_id",
        "result_id",
        mode="before",
    )
    @classmethod
    def _uuid_or_empty(cls, value: Any) -> Any:
        if value in (None, ""):
            return value
        return str(UUID(str(value)))


class _PolicyEmailSendInput(_PolicyPayloadModel):
    email_id: UUID
    lead_id: Optional[UUID] = None
    recipient_email: str = Field(default="", max_length=320)
    sender_email: str = Field(default="", max_length=320)
    subject: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=10000)
    approval_version: Optional[int] = None
    confirmation_fingerprint: str = Field(default="", max_length=128)
    confirmed_draft_approval: Optional[bool] = None
    confirmed_final_send: Optional[bool] = None
    campaign_id: Optional[UUID] = None
    job_id: Optional[UUID] = None


class _PolicyReplySyncInput(_PolicyPayloadModel):
    since_hours: Optional[int] = Field(default=None, ge=1, le=720)
    candidate_count: Optional[int] = Field(default=None, ge=0, le=1000)
    dry_run: Optional[bool] = None


class _PolicyEmailStateSyncInput(_PolicyPayloadModel):
    event_id: str = Field(default="", max_length=256)
    event_type: str = Field(default="", max_length=160)
    message_id: UUID
    provider_message_id: str = Field(default="", max_length=256)


POLICY_INPUT_SCHEMAS: dict[str, type[_PolicyPayloadModel]] = {
    "crm.write": _PolicyCrmWriteInput,
    "email.draft.create": _PolicyEmailDraftInput,
    "email.draft.update": _PolicyEmailDraftInput,
    "email.draft.approve": _PolicyEmailDraftInput,
    "email.send": _PolicyEmailSendInput,
    "autonomous.email.send": _PolicyEmailSendInput,
    "gmail.replies.sync": _PolicyReplySyncInput,
    "email.state.sync": _PolicyEmailStateSyncInput,
}


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


class DelegationEvidenceResolver:
    def resolve(
        self,
        db: Session,
        *,
        workspace: Workspace,
        delegation: ActionDelegationContext | None,
        action_name: str,
        resource_id: UUID | str | None,
        request_fingerprint: str,
        input_payload: dict[str, Any],
    ) -> ResolvedDelegationEvidence:
        if delegation is None:
            raise ApprovalStateError("Missing durable delegation blocks worker action.")
        delegated_by = str(delegation.delegated_by_user_id or "").strip()
        delegation_type = str(delegation.delegation_type or "").strip()
        evidence_id = str(delegation.evidence_id or "").strip()
        if not delegated_by:
            raise ApprovalStateError("Delegation must be tied to a human user.")
        if not delegation_type:
            raise ApprovalStateError("Delegation type is required.")
        if not evidence_id:
            raise ApprovalStateError("Delegation evidence is required.")
        if not delegation.workspace_id or str(delegation.workspace_id) != str(workspace.id):
            raise PermissionDeniedError("Delegation workspace mismatch.")
        if not delegation.action_name or delegation.action_name != action_name:
            raise ApprovalStateError("Delegation action mismatch.")
        if delegation.resource_id and resource_id and str(delegation.resource_id) != str(resource_id):
            raise PermissionDeniedError("Delegation resource mismatch.")
        if not delegation.fingerprint or delegation.fingerprint != request_fingerprint:
            raise ApprovalStateError("Delegation fingerprint mismatch.")

        if delegation_type == "job_created_by_user":
            return self._resolve_enrichment_job(
                db,
                workspace=workspace,
                delegated_by=delegated_by,
                evidence_id=evidence_id,
                action_name=action_name,
                resource_id=resource_id,
                input_payload=input_payload,
                request_fingerprint=request_fingerprint,
            )
        if delegation_type == "campaign_automation_authorization":
            return self._resolve_campaign(
                db,
                workspace=workspace,
                delegated_by=delegated_by,
                evidence_id=evidence_id,
                action_name=action_name,
                resource_id=resource_id,
                input_payload=input_payload,
                request_fingerprint=request_fingerprint,
            )
        if delegation_type == "company_nightly_prioritization":
            return self._resolve_company_prioritization(
                db,
                workspace=workspace,
                delegated_by=delegated_by,
                evidence_id=evidence_id,
                action_name=action_name,
                resource_id=resource_id,
                input_payload=input_payload,
                request_fingerprint=request_fingerprint,
            )
        if delegation_type == "provider_message_state_sync":
            return self._resolve_provider_message_sync(
                db,
                workspace=workspace,
                delegated_by=delegated_by,
                evidence_id=evidence_id,
                action_name=action_name,
                resource_id=resource_id,
                input_payload=input_payload,
                request_fingerprint=request_fingerprint,
            )
        raise ApprovalStateError("Delegation evidence type is not supported.")

    def _resolve_enrichment_job(
        self,
        db: Session,
        *,
        workspace: Workspace,
        delegated_by: str,
        evidence_id: str,
        action_name: str,
        resource_id: UUID | str | None,
        input_payload: dict[str, Any],
        request_fingerprint: str,
    ) -> ResolvedDelegationEvidence:
        job = db.get(EnrichmentJob, _uuid_for_evidence(evidence_id))
        if job is None:
            raise ApprovalStateError("Delegation evidence was not found.")
        if job.workspace_id != workspace.id:
            raise PermissionDeniedError("Delegation evidence workspace mismatch.")
        if str(job.user_id or "").strip() != delegated_by:
            raise PermissionDeniedError("Delegation user mismatch.")
        route = str(input_payload.get("route") or "")
        if str(input_payload.get("job_id") or "") != str(job.id):
            raise ApprovalStateError("Delegation job mismatch.")
        if str(input_payload.get("lead_id") or "") != str(job.lead_id):
            raise PermissionDeniedError("Delegation job lead mismatch.")
        job_type = str(job.job_type or "").strip()
        allowed_scopes = ENRICHMENT_JOB_ACTION_SCOPES.get(job_type)
        if not allowed_scopes:
            raise ApprovalStateError("Delegation job type is not supported.")
        if (action_name, route) not in allowed_scopes:
            raise ApprovalStateError(
                "Delegation job type does not allow this action scope."
            )
        if route in ENRICHMENT_JOB_FAILURE_ROUTES and str(
            input_payload.get("job_type") or ""
        ) != job_type:
            raise ApprovalStateError("Delegation failure job type mismatch.")
        if route == "worker.deep_contact_search":
            expected_company_id = str((job.payload_json or {}).get("company_id") or "")
            if expected_company_id and str(input_payload.get("company_id") or "") != expected_company_id:
                raise PermissionDeniedError("Delegation job company mismatch.")
        if resource_id and str(resource_id) not in {
            str(job.lead_id),
            str(input_payload.get("company_id") or ""),
        }:
            raise PermissionDeniedError("Delegation resource mismatch.")
        active_statuses = {"pending", "running", "retrying"}
        if route in ENRICHMENT_JOB_FAILURE_ROUTES:
            active_statuses = {"pending", "running", "retrying", "failed"}
        if job.cancel_requested or job.status not in active_statuses:
            raise ApprovalStateError("Delegation job is not active.")
        return ResolvedDelegationEvidence(
            delegated_by_user_id=delegated_by,
            delegation_type="job_created_by_user",
            evidence_id=str(job.id),
            fingerprint=request_fingerprint,
        )

    def _resolve_campaign(
        self,
        db: Session,
        *,
        workspace: Workspace,
        delegated_by: str,
        evidence_id: str,
        action_name: str,
        resource_id: UUID | str | None,
        input_payload: dict[str, Any],
        request_fingerprint: str,
    ) -> ResolvedDelegationEvidence:
        campaign = db.get(Campaign, _uuid_for_evidence(evidence_id))
        if campaign is None:
            raise ApprovalStateError("Delegation evidence was not found.")
        if campaign.workspace_id != workspace.id:
            raise PermissionDeniedError("Delegation evidence workspace mismatch.")
        if str(campaign.user_id or "").strip() != delegated_by:
            raise PermissionDeniedError("Delegation user mismatch.")
        if str(input_payload.get("campaign_id") or "") != str(campaign.id):
            raise ApprovalStateError("Delegation campaign mismatch.")
        route = str(input_payload.get("route") or "")
        allowed_routes = {
            ("crm.write", "automation.lead_import"),
            ("crm.write", "automation.lead_qualification"),
            ("email.draft.create", "automation.email_generation"),
            ("email.draft.create", "automation.follow_up_draft"),
        }
        if (action_name, route) not in allowed_routes:
            raise ApprovalStateError("Delegation action scope mismatch.")
        if campaign.status not in {CampaignStatus.running, CampaignStatus.scheduled}:
            raise ApprovalStateError("Delegation campaign is not active.")
        lead_id = str(input_payload.get("lead_id") or "")
        if lead_id:
            lead = db.get(Lead, _uuid_for_evidence(lead_id))
            if lead is None or lead.workspace_id != workspace.id:
                raise PermissionDeniedError("Delegation lead workspace mismatch.")
            if lead.campaign_id and lead.campaign_id != campaign.id:
                raise PermissionDeniedError("Delegation lead campaign mismatch.")
        if resource_id and lead_id and str(resource_id) != lead_id:
            raise PermissionDeniedError("Delegation resource mismatch.")
        return ResolvedDelegationEvidence(
            delegated_by_user_id=delegated_by,
            delegation_type="campaign_automation_authorization",
            evidence_id=str(campaign.id),
            fingerprint=request_fingerprint,
        )

    def _resolve_company_prioritization(
        self,
        db: Session,
        *,
        workspace: Workspace,
        delegated_by: str,
        evidence_id: str,
        action_name: str,
        resource_id: UUID | str | None,
        input_payload: dict[str, Any],
        request_fingerprint: str,
    ) -> ResolvedDelegationEvidence:
        company = db.get(Company, _uuid_for_evidence(evidence_id))
        if company is None:
            raise ApprovalStateError("Delegation evidence was not found.")
        if company.workspace_id != workspace.id:
            raise PermissionDeniedError("Delegation evidence workspace mismatch.")
        if str(company.user_id or "").strip() != delegated_by:
            raise PermissionDeniedError("Delegation user mismatch.")
        if action_name != "crm.write" or input_payload.get("route") != "worker.nightly_lead_prioritization":
            raise ApprovalStateError("Delegation action scope mismatch.")
        if str(input_payload.get("company_id") or "") != str(company.id):
            raise ApprovalStateError("Delegation company mismatch.")
        if resource_id and str(resource_id) != str(company.id):
            raise PermissionDeniedError("Delegation resource mismatch.")
        if input_payload.get("lead_id") and company.lead_id and str(input_payload["lead_id"]) != str(company.lead_id):
            raise PermissionDeniedError("Delegation company lead mismatch.")
        return ResolvedDelegationEvidence(
            delegated_by_user_id=delegated_by,
            delegation_type="company_nightly_prioritization",
            evidence_id=str(company.id),
            fingerprint=request_fingerprint,
        )

    def _resolve_provider_message_sync(
        self,
        db: Session,
        *,
        workspace: Workspace,
        delegated_by: str,
        evidence_id: str,
        action_name: str,
        resource_id: UUID | str | None,
        input_payload: dict[str, Any],
        request_fingerprint: str,
    ) -> ResolvedDelegationEvidence:
        message = db.get(EmailMessage, _uuid_for_evidence(evidence_id))
        if message is None:
            raise ApprovalStateError("Delegation evidence was not found.")
        if message.workspace_id != workspace.id:
            raise PermissionDeniedError("Delegation evidence workspace mismatch.")
        if str(message.user_id or "").strip() != delegated_by:
            raise PermissionDeniedError("Delegation user mismatch.")
        if action_name != "email.state.sync" or input_payload.get("route") != "webhooks.resend":
            raise ApprovalStateError("Delegation action scope mismatch.")
        if str(input_payload.get("message_id") or "") != str(message.id):
            raise ApprovalStateError("Delegation email message mismatch.")
        if resource_id and str(resource_id) != str(message.id):
            raise PermissionDeniedError("Delegation resource mismatch.")
        if not message.provider_message_id or str(input_payload.get("provider_message_id") or "") != str(message.provider_message_id):
            raise PermissionDeniedError("Delegation provider message mismatch.")
        return ResolvedDelegationEvidence(
            delegated_by_user_id=delegated_by,
            delegation_type="provider_message_state_sync",
            evidence_id=str(message.id),
            fingerprint=request_fingerprint,
        )


class ActionPolicyGateway:
    def __init__(
        self,
        *,
        permission_resolver: AgentRuntimePermissionResolver | None = None,
        registry: ToolRegistry | None = None,
        approval_policy: AgentApprovalPolicy | None = None,
        delegation_resolver: DelegationEvidenceResolver | None = None,
    ) -> None:
        self.permission_resolver = permission_resolver or WorkspaceRolePermissionResolver()
        self.registry = registry
        self.approval_policy = approval_policy or AgentApprovalPolicy()
        self.delegation_resolver = delegation_resolver or DelegationEvidenceResolver()

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
        delegation: ActionDelegationContext | None = None,
        idempotency_key: str = "",
        resource_workspace_id: UUID | None = None,
        resource_id: UUID | str | None = None,
        required_approval_fingerprint: str = "",
    ) -> ActionPolicyDecision:
        definition = self._definition(action_name)
        self._validate_registered_tool_schema(definition)
        validated_payload = self._validate_policy_input(definition, input_payload)
        effective_permissions = _merge_required_permissions(
            definition.required_permissions,
            required_permissions or (),
        )
        request_fingerprint = request_fingerprint_for_action(
            action_name=action_name, input_payload=validated_payload
        )
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
                required_permissions=effective_permissions,
                dry_run=dry_run,
                request_fingerprint=request_fingerprint,
                reason="missing_actor_identity",
                exc=PermissionDeniedError("Missing actor identity."),
            )
            raise PermissionDeniedError("Missing actor identity.")
        if actor_type not in {"human", "ai", "worker", "system"}:
            raise PermissionDeniedError("Unsupported actor type.")
        if definition.human_only and actor_type != "human":
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
                reason="action_requires_human_actor",
                exc=ApprovalStateError("This action requires a human actor."),
            )
            raise ApprovalStateError("This action requires a human actor.")
        if resource_workspace_id is not None and resource_workspace_id != workspace.id:
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
                reason="workspace_mismatch",
                exc=PermissionDeniedError("Action workspace mismatch."),
            )
            raise PermissionDeniedError("Action workspace mismatch.")
        try:
            resolved_delegation = self._resolve_delegation(
                db,
                workspace=workspace,
                actor_type=actor_type,
                action_name=action_name,
                input_payload=validated_payload,
                resource_id=resource_id,
                delegation=delegation,
                request_fingerprint=request_fingerprint,
                required_permissions=effective_permissions,
            )
            permission_actor_id = (
                resolved_delegation.delegated_by_user_id
                if resolved_delegation
                else ""
            )
        except (ApprovalStateError, PermissionDeniedError) as exc:
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
                reason="delegation_state_blocked",
                exc=exc,
            )
            raise
        try:
            self._require_permissions(
                db,
                workspace=workspace,
                actor_id=permission_actor_id or clean_actor_id,
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
                delegation_satisfied=bool(
                    actor_type in {"worker", "system"} and permission_actor_id
                ),
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
                delegated_by_user_id=(
                    resolved_delegation.delegated_by_user_id
                    if resolved_delegation
                    else ""
                ),
                delegation_type=(
                    resolved_delegation.delegation_type if resolved_delegation else ""
                ),
                delegation_evidence_id=(
                    resolved_delegation.evidence_id if resolved_delegation else ""
                ),
                delegation_fingerprint=(
                    resolved_delegation.fingerprint if resolved_delegation else ""
                ),
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
        enforcement_row, execution_claim_token = enforcement
        replay = bool(enforcement_row and enforcement_row.status == "succeeded")
        return ActionPolicyDecision(
            allowed=True,
            reason="policy_allowed",
            action_name=action_name,
            action_type=definition.action_type,
            request_fingerprint=request_fingerprint,
            replay=replay,
            provider_side_effect_allowed=bool(
                definition.provider_side_effect
                and enforcement_row
                and execution_claim_token
                and not replay
            ),
            enforcement=enforcement_row,
            execution_claim_token=execution_claim_token,
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
        now = datetime.utcnow()
        updated = db.execute(
            update(ActionPolicyEnforcement)
            .where(*_active_claim_predicates(decision, now))
            .values(
                status="succeeded",
                result_json=_policy_safe_payload(result or {}),
                error_category="",
                error_message="",
                execution_claim_token="",
                claim_expires_at=None,
                completed_at=now,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if updated.rowcount != 1:
            raise ToolExecutionBlockedError(
                "Action policy execution claim is no longer active."
            )
        db.flush()
        db.expire(decision.enforcement)

    def record_failure(
        self,
        db: Session,
        decision: ActionPolicyDecision | None,
        exc: Exception | str,
    ) -> None:
        if not decision or not decision.enforcement or decision.replay:
            return
        now = datetime.utcnow()
        updated = db.execute(
            update(ActionPolicyEnforcement)
            .where(*_active_claim_predicates(decision, now))
            .values(
                status="failed",
                error_category=_policy_safe_error_category(exc),
                error_message=_policy_safe_error_message(exc),
                execution_claim_token="",
                claim_expires_at=None,
                completed_at=now,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if updated.rowcount != 1:
            raise ToolExecutionBlockedError(
                "Action policy execution claim is no longer active."
            )
        db.flush()
        db.expire(decision.enforcement)

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

    def _validate_policy_input(
        self, definition: ActionDefinition, input_payload: dict[str, Any]
    ) -> dict[str, Any]:
        schema = POLICY_INPUT_SCHEMAS.get(definition.name)
        if schema is None:
            raise UnknownToolError("Action policy input schema is missing.")
        try:
            model = schema.model_validate(input_payload)
        except ValidationError as exc:
            raise ToolExecutionBlockedError("Invalid action policy payload.") from exc
        return model.model_dump(mode="json", exclude_none=True, exclude_defaults=True)

    def _resolve_delegation(
        self,
        db: Session,
        *,
        workspace: Workspace,
        actor_type: ActorType,
        action_name: str,
        input_payload: dict[str, Any],
        resource_id: UUID | str | None,
        delegation: ActionDelegationContext | None,
        request_fingerprint: str,
        required_permissions: tuple[str, ...],
    ) -> ResolvedDelegationEvidence | None:
        if actor_type not in {"worker", "system"}:
            return None
        if not required_permissions:
            return None
        return self.delegation_resolver.resolve(
            db,
            workspace=workspace,
            delegation=delegation,
            action_name=action_name,
            resource_id=resource_id,
            request_fingerprint=request_fingerprint,
            input_payload=input_payload,
        )

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
        delegation_satisfied: bool,
        required_approval_fingerprint: str,
    ) -> None:
        approval_required = definition.requires_approval
        if actor_type == "human" and not definition.provider_side_effect:
            approval_required = False
        if (
            actor_type in {"worker", "system"}
            and not definition.provider_side_effect
            and delegation_satisfied
        ):
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
        delegated_by_user_id: str,
        delegation_type: str,
        delegation_evidence_id: str,
        delegation_fingerprint: str,
        action_name: str,
        action_type: ActionType,
        resource_id: UUID | str | None,
        required_permissions: tuple[str, ...],
        dry_run: bool,
        approval: ActionApprovalContext | None,
        idempotency_key: str,
        request_fingerprint: str,
        idempotency_required: bool,
    ) -> tuple[ActionPolicyEnforcement | None, str]:
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
                return self._claim_existing_enforcement(
                    db,
                    existing=existing,
                    request_fingerprint=request_fingerprint,
                )
        execution_claim_token = _new_execution_claim_token()
        now = datetime.utcnow()
        enforcement = ActionPolicyEnforcement(
            workspace_id=workspace.id,
            actor_type=actor_type,
            actor_id=actor_id,
            user_id=delegated_by_user_id or actor_id,
            delegated_by_user_id=delegated_by_user_id,
            delegation_type=delegation_type,
            delegation_evidence_id=delegation_evidence_id,
            delegation_fingerprint=delegation_fingerprint,
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
            execution_claim_token=execution_claim_token,
            claim_expires_at=now + timedelta(seconds=ACTION_POLICY_CLAIM_TTL_SECONDS),
        )
        try:
            with db.begin_nested():
                db.add(enforcement)
                db.flush()
        except IntegrityError as exc:
            existing = db.scalar(
                select(ActionPolicyEnforcement).where(
                    ActionPolicyEnforcement.workspace_id == workspace.id,
                    ActionPolicyEnforcement.idempotency_key == key,
                )
            )
            if existing:
                return self._claim_existing_enforcement(
                    db,
                    existing=existing,
                    request_fingerprint=request_fingerprint,
                )
            raise IdempotencyConflictError(
                "Idempotency request already exists with a different payload."
            ) from exc
        return enforcement, execution_claim_token

    def _claim_existing_enforcement(
        self,
        db: Session,
        *,
        existing: ActionPolicyEnforcement,
        request_fingerprint: str,
    ) -> tuple[ActionPolicyEnforcement, str]:
        if existing.request_fingerprint != request_fingerprint:
            raise IdempotencyConflictError(
                "Idempotency request already exists with a different payload."
            )
        if existing.status == "succeeded":
            return existing, ""
        if existing.status == "started":
            raise ToolExecutionBlockedError(
                "Action idempotency key is already in progress."
            )
        if existing.status != "failed":
            raise ToolExecutionBlockedError("Action idempotency state is not retryable.")
        claim_token = _new_execution_claim_token()
        now = datetime.utcnow()
        result = db.execute(
            update(ActionPolicyEnforcement)
            .where(
                ActionPolicyEnforcement.id == existing.id,
                ActionPolicyEnforcement.status == "failed",
                ActionPolicyEnforcement.request_fingerprint == request_fingerprint,
            )
            .values(
                status="started",
                execution_claim_token=claim_token,
                claim_expires_at=now + timedelta(seconds=ACTION_POLICY_CLAIM_TTL_SECONDS),
                error_category="",
                error_message="",
                completed_at=None,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            db.refresh(existing)
            if existing.status == "succeeded":
                return existing, ""
            raise ToolExecutionBlockedError(
                "Action idempotency key is already in progress."
            )
        db.flush()
        db.refresh(existing)
        return existing, claim_token

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
                error_category=_policy_safe_error_category(exc),
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


def _merge_required_permissions(
    definition_permissions: tuple[str, ...],
    additional_permissions: tuple[str, ...],
) -> tuple[str, ...]:
    merged: list[str] = []
    for permission in (*definition_permissions, *additional_permissions):
        clean = str(permission or "").strip()
        if clean and clean not in merged:
            merged.append(clean)
    return tuple(merged)


def _new_execution_claim_token() -> str:
    return uuid4().hex


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


def _policy_safe_error_message(exc: Exception | str) -> str:
    text = str(exc)
    text = POLICY_ERROR_SECRET_RE.sub("[REDACTED_SECRET]", text)
    text = POLICY_ERROR_BODY_RE.sub(r"\1=[REDACTED_EMAIL_BODY]", text)
    redacted = sanitize_for_trace({"error": text}, max_string_length=1000)
    safe = str(redacted.get("error") or "") if isinstance(redacted, dict) else ""
    return safe[:1000]


def _policy_normalized_error_category(value: Any, *, fallback: str) -> str:
    text = str(value or "").strip()
    if (
        not text
        or len(text) > 80
        or not POLICY_ERROR_CATEGORY_RE.fullmatch(text)
        or POLICY_ERROR_CATEGORY_SENSITIVE_RE.search(text)
    ):
        return fallback
    return text


def _policy_safe_error_category(exc: Exception | str) -> str:
    if isinstance(exc, str):
        return "external_error"
    raw_category = getattr(exc, "category", "")
    category = _policy_normalized_error_category(raw_category, fallback="")
    if category:
        return category
    return _policy_normalized_error_category(
        exc.__class__.__name__,
        fallback="external_error",
    )


def _normalized_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _uuid_for_evidence(value: str) -> UUID:
    try:
        return UUID(str(value))
    except Exception as exc:
        raise ApprovalStateError("Delegation evidence was not found.") from exc


def _active_claim_predicates(
    decision: ActionPolicyDecision, now: datetime
) -> tuple[Any, ...]:
    enforcement = decision.enforcement
    if enforcement is None:
        raise ToolExecutionBlockedError("Action policy claim is missing.")
    if decision.replay:
        raise ToolExecutionBlockedError("Replay cannot own an execution claim.")
    if not decision.execution_claim_token:
        raise ToolExecutionBlockedError("Action policy execution claim is missing.")
    return (
        ActionPolicyEnforcement.id == enforcement.id,
        ActionPolicyEnforcement.workspace_id == enforcement.workspace_id,
        ActionPolicyEnforcement.action_name == decision.action_name,
        ActionPolicyEnforcement.request_fingerprint == decision.request_fingerprint,
        ActionPolicyEnforcement.status == "started",
        ActionPolicyEnforcement.execution_claim_token
        == decision.execution_claim_token,
        or_(
            ActionPolicyEnforcement.claim_expires_at.is_(None),
            ActionPolicyEnforcement.claim_expires_at >= now,
        ),
    )


def require_provider_policy(db: Session, decision: ActionPolicyDecision | None) -> None:
    if decision is None:
        raise ToolExecutionBlockedError(
            "Email provider send blocked by missing server-side policy enforcement."
        )
    if not decision.allowed or not decision.provider_side_effect_allowed or decision.replay:
        raise ToolExecutionBlockedError(
            "Email provider send blocked by server-side policy state."
        )
    now = datetime.utcnow()
    active_claim_id = db.scalar(
        select(ActionPolicyEnforcement.id).where(
            *_active_claim_predicates(decision, now),
            ActionPolicyEnforcement.action_type == "external_side_effect",
        )
    )
    if active_claim_id is None:
        raise ToolExecutionBlockedError(
            "Email provider send blocked by inactive action policy claim."
        )
