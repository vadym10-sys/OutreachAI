from __future__ import annotations

import base64
import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime
from collections.abc import Callable
from typing import Any, Protocol
from uuid import UUID

from openai import OpenAI, OpenAIError
from pydantic import ValidationError
from sqlalchemy import String, and_, cast, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import (
    AgentApprovalRequest,
    AgentRun,
    AgentRunJob,
    AgentStep,
    AgentTraceEvent,
    AgentToolCall,
    Workspace,
)
from app.services.agent_runtime.adapters import ToolExecutionContext, default_tool_registry
from app.services.agent_runtime.action_gateway import (
    ActionApprovalContext,
    ActionPolicyDecision,
    ActionPolicyGateway,
)
from app.services.agent_runtime.approval_policy import AgentApprovalPolicy
from app.services.agent_runtime.errors import (
    AgentRunStateError,
    ApprovalStateError,
    FeatureDisabledError,
    IdempotencyConflictError,
    PaginationCursorError,
    PermissionDeniedError,
    StructuredPlanValidationError,
    ToolArgumentValidationError,
    ToolOutputValidationError,
    ToolExecutionBlockedError,
    AgentRunJobClaimLost,
    UnknownToolError,
)
from app.services.agent_runtime.jobs import (
    assert_agent_run_job_claim_current,
    cancel_active_agent_run_jobs,
    enqueue_agent_run_job,
)
from app.services.agent_runtime.model_usage import (
    estimated_cost_for_usage,
    merge_token_usage,
    usage_from_openai_response,
)
from app.services.agent_runtime.permissions import (
    AgentRuntimePermissionResolver,
    WorkspaceRolePermissionResolver,
)
from app.services.agent_runtime.registry import ToolDefinition, ToolRegistry
from app.services.agent_runtime.schemas import (
    AgentApprovalDecisionIn,
    AgentApprovalRequestOut,
    AgentPlan,
    AgentApprovalRequestPageOut,
    AgentRunCreateIn,
    AgentRunDetailOut,
    AgentRunOut,
    AgentRunPageOut,
    AgentRuntimeStatusOut,
    AgentRunTraceOut,
    AgentStepOut,
    AgentTraceEventOut,
    ModelUsage,
    ToolRegistryItemOut,
)
from app.services.agent_runtime.state_machine import (
    RUN_TERMINAL_STATUSES,
    transition_run,
    transition_step,
)
from app.services.agent_runtime.tracing import (
    error_category,
    record_trace,
    safe_trace_message,
    sanitize_for_trace,
)
from app.services.ai import ProviderConfigurationError, ProviderRequestError, _trust_payload, _trust_system_prompt

PROMPT_VERSION = "agent-runtime-plan-v1"
GATEWAY_ACTION_BY_TOOL = {
    "save_to_crm": "crm.write",
    "generate_email_draft": "email.draft.create",
    "send_email": "email.send",
    "sync_replies": "gmail.replies.sync",
}


def _encode_page_cursor(created_at: datetime, item_id: UUID) -> str:
    payload = {
        "created_at": created_at.isoformat(timespec="microseconds"),
        "id": str(item_id),
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_page_cursor(cursor: str) -> tuple[datetime, str]:
    clean = cursor.strip()
    if not clean:
        raise PaginationCursorError("Missing pagination cursor.")
    try:
        padded = clean + "=" * (-len(clean) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        created_at = datetime.fromisoformat(str(payload["created_at"]))
        item_id = str(UUID(str(payload["id"])))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PaginationCursorError("Invalid pagination cursor.") from exc
    return created_at, item_id


@dataclass(frozen=True)
class PlanResult:
    plan: AgentPlan
    model: str = ""
    prompt_version: str = PROMPT_VERSION
    token_usage: ModelUsage = field(default_factory=ModelUsage)
    estimated_cost: float | None = None
    latency_ms: int = 0


class AgentPlanner(Protocol):
    def plan(
        self,
        *,
        objective: str,
        workspace: Workspace,
        tools: list[ToolDefinition],
    ) -> PlanResult:
        ...


class OpenAIAgentPlanner:
    def plan(
        self,
        *,
        objective: str,
        workspace: Workspace,
        tools: list[ToolDefinition],
    ) -> PlanResult:
        settings = get_settings()
        if not settings.openai_api_key:
            raise ProviderConfigurationError("OPENAI_API_KEY is required for AI Control Plane planning.")
        tool_summary = [
            {
                "name": tool.name,
                "action_type": tool.action_type,
                "requires_approval": tool.requires_approval,
                "description": tool.description,
                "input_schema": tool.input_model.model_json_schema(),
                "dry_run_supported": tool.dry_run_supported,
                "required_permissions": list(tool.required_permissions),
                "approval_requirements": {
                    "fail_closed": True,
                    "manual_user_approval_required": tool.requires_approval,
                    "separate_final_send_confirmation_required": tool.name
                    == "send_email",
                    "draft_modification_resets_approval": tool.name
                    in {"generate_email_draft", "send_email"},
                },
            }
            for tool in tools
        ]
        system = (
            "You are OutreachAI's AI Sales Agent planner. Return only JSON matching this shape: "
            "{\"objective\": string, \"steps\": [{\"id\": string, \"title\": string, "
            "\"tool_name\": string, \"arguments\": object, \"reason\": string}]}. "
            "Use only the provided tools by exact name. Plan read-only steps first. "
            "Do not claim external actions happened. Do not include secrets. "
            "Never plan email sending without a separate manual draft approval and final Send confirmation."
        )
        payload = {
            "objective": objective,
            "workspace": {
                "company": workspace.company,
                "industry": workspace.industry,
                "target_country": workspace.target_country,
                "target_customer": workspace.target_customer,
                "offer": workspace.offer,
                "cta": workspace.cta,
                "tone": workspace.tone,
                "language": workspace.language,
            },
            "tools": tool_summary,
        }
        started = time.perf_counter()
        client = OpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.openai_timeout_seconds,
            max_retries=settings.openai_max_retries,
        )
        try:
            response = client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {"role": "system", "content": _trust_system_prompt(system)},
                    {
                        "role": "user",
                        "content": json.dumps(
                            _trust_payload(payload, task="agent_runtime_plan"),
                            ensure_ascii=False,
                        ),
                    },
                ],
                response_format={"type": "json_object"},
            )
        except OpenAIError as exc:
            raise ProviderRequestError(str(exc)) from exc
        usage = usage_from_openai_response(response)
        raw = response.choices[0].message.content or "{}"
        try:
            data = json.loads(raw)
            plan = AgentPlan.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as exc:
            raise StructuredPlanValidationError("AI returned an invalid structured plan.") from exc
        return PlanResult(
            plan=plan,
            model=settings.openai_model,
            prompt_version=PROMPT_VERSION,
            token_usage=usage,
            estimated_cost=estimated_cost_for_usage(model=settings.openai_model, usage=usage),
            latency_ms=round((time.perf_counter() - started) * 1000),
        )


class AgentRuntimeOrchestrator:
    def __init__(
        self,
        *,
        registry: ToolRegistry | None = None,
        policy: AgentApprovalPolicy | None = None,
        planner: AgentPlanner | None = None,
        permission_resolver: AgentRuntimePermissionResolver | None = None,
        feature_enabled: bool | None = None,
        force_dry_run: bool | None = None,
    ) -> None:
        self.registry = registry or default_tool_registry()
        self.policy = policy or AgentApprovalPolicy()
        self.planner = planner or OpenAIAgentPlanner()
        self.permission_resolver = permission_resolver or WorkspaceRolePermissionResolver()
        self.action_gateway = ActionPolicyGateway(
            permission_resolver=self.permission_resolver,
            registry=self.registry,
        )
        self._feature_enabled = feature_enabled
        self._force_dry_run = force_dry_run

    @property
    def feature_enabled(self) -> bool:
        if self._feature_enabled is not None:
            return self._feature_enabled
        return bool(get_settings().ai_control_plane_enabled)

    @property
    def force_dry_run(self) -> bool:
        if self._force_dry_run is not None:
            return self._force_dry_run
        return bool(get_settings().ai_control_plane_force_dry_run)

    def list_tools(self) -> list[ToolRegistryItemOut]:
        return [tool.public_metadata() for tool in self.registry.all()]

    def runtime_status(self) -> AgentRuntimeStatusOut:
        enabled = self.feature_enabled
        return AgentRuntimeStatusOut(
            enabled=enabled,
            can_create_runs=enabled,
            force_dry_run=self.force_dry_run,
            registered_tools_count=len(self.registry.all()),
        )

    def list_runs(
        self,
        db: Session,
        *,
        workspace_id: UUID,
        status_filter: str | None = None,
        cursor: str = "",
        limit: int = 20,
    ) -> AgentRunPageOut:
        page_limit = max(1, min(int(limit or 20), 50))
        query = select(AgentRun).where(AgentRun.workspace_id == workspace_id)
        if status_filter:
            query = query.where(AgentRun.status == status_filter)
        if cursor:
            cursor_created_at, cursor_id = _decode_page_cursor(cursor)
            query = query.where(
                or_(
                    AgentRun.created_at < cursor_created_at,
                    and_(
                        AgentRun.created_at == cursor_created_at,
                        cast(AgentRun.id, String) < cursor_id,
                    ),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(
                    AgentRun.created_at.desc(),
                    cast(AgentRun.id, String).desc(),
                ).limit(page_limit + 1)
            ).all()
        )
        has_more = len(rows) > page_limit
        page_rows = rows[:page_limit]
        next_cursor = (
            _encode_page_cursor(page_rows[-1].created_at, page_rows[-1].id)
            if has_more and page_rows
            else ""
        )
        return AgentRunPageOut(
            runs=[run_out(item) for item in page_rows],
            next_cursor=next_cursor,
            has_more=has_more,
            limit=page_limit,
        )

    def list_approvals(
        self,
        db: Session,
        *,
        workspace_id: UUID,
        approval_state: str = "pending",
        cursor: str = "",
        limit: int = 20,
    ) -> AgentApprovalRequestPageOut:
        page_limit = max(1, min(int(limit or 20), 50))
        query = select(AgentApprovalRequest).where(
            AgentApprovalRequest.workspace_id == workspace_id,
            AgentApprovalRequest.approval_state == approval_state,
        )
        if cursor:
            cursor_requested_at, cursor_id = _decode_page_cursor(cursor)
            query = query.where(
                or_(
                    AgentApprovalRequest.requested_at < cursor_requested_at,
                    and_(
                        AgentApprovalRequest.requested_at == cursor_requested_at,
                        cast(AgentApprovalRequest.id, String) < cursor_id,
                    ),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(
                    AgentApprovalRequest.requested_at.desc(),
                    cast(AgentApprovalRequest.id, String).desc(),
                ).limit(page_limit + 1)
            ).all()
        )
        has_more = len(rows) > page_limit
        page_rows = rows[:page_limit]
        next_cursor = (
            _encode_page_cursor(page_rows[-1].requested_at, page_rows[-1].id)
            if has_more and page_rows
            else ""
        )
        return AgentApprovalRequestPageOut(
            approvals=[approval_out(item) for item in page_rows],
            next_cursor=next_cursor,
            has_more=has_more,
            limit=page_limit,
        )

    def create_run(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
        payload: AgentRunCreateIn,
        request_id: str = "",
    ) -> AgentRun:
        self._require_enabled()
        effective_dry_run = self._effective_dry_run(payload.dry_run)
        request_fingerprint = self._request_fingerprint(
            payload, effective_dry_run=effective_dry_run
        )
        existing = self._existing_run_for_key(
            db, workspace_id=workspace.id, key=payload.idempotency_key
        )
        if existing is not None:
            if existing.request_fingerprint != request_fingerprint:
                raise IdempotencyConflictError(
                    "Idempotency request already exists with a different payload."
                )
            if existing.status not in RUN_TERMINAL_STATUSES and existing.status != "waiting_approval":
                enqueue_agent_run_job(
                    db,
                    run=existing,
                    operation="start",
                    request_id=request_id,
                )
            return existing
        run = AgentRun(
            workspace_id=workspace.id,
            user_id=user_id,
            status="queued",
            objective=payload.objective,
            dry_run=effective_dry_run,
            input_json=sanitize_for_trace(
                {
                    "objective": {
                        "sha256": hashlib.sha256(
                            payload.objective.encode("utf-8")
                        ).hexdigest(),
                        "length": len(payload.objective),
                    },
                    "dry_run": effective_dry_run,
                }
            ),
            idempotency_key=payload.idempotency_key.strip(),
            request_fingerprint=request_fingerprint,
        )
        db.add(run)
        db.flush()
        enqueue_agent_run_job(db, run=run, operation="start", request_id=request_id)
        record_trace(
            db,
            run_id=run.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="run.created",
            status=run.status,
            data={"request_id": request_id},
        )
        run.updated_at = datetime.utcnow()
        db.flush()
        return run

    def execute_claimed_job(
        self,
        db: Session,
        *,
        job: AgentRunJob,
        claim_token: str,
    ) -> AgentRun:
        self._require_enabled()
        assert_agent_run_job_claim_current(db, job_id=job.id, claim_token=claim_token)
        run = db.scalar(select(AgentRun).where(AgentRun.id == job.run_id))
        if run is None:
            raise AgentRunStateError("Agent run not found.")
        workspace = db.get(Workspace, run.workspace_id)
        if workspace is None:
            raise AgentRunStateError("Agent run workspace not found.")
        if job.workspace_id != run.workspace_id:
            raise AgentRunStateError("Agent run job workspace mismatch.")
        if run.status in RUN_TERMINAL_STATUSES:
            return run
        try:
            self._require_workspace_access(db, workspace=workspace, user_id=run.user_id)
        except PermissionDeniedError as exc:
            transition_run(run, "failed", error_category=error_category(exc))
            record_trace(
                db,
                run_id=run.id,
                workspace_id=workspace.id,
                user_id=run.user_id,
                event_type="run.permission_denied",
                status="failed",
                error=exc,
            )
            db.flush()
            return run

        def claim_guard() -> None:
            assert_agent_run_job_claim_current(
                db,
                job_id=job.id,
                claim_token=claim_token,
            )

        if job.operation == "start":
            return self._execute_start_job(
                db,
                run=run,
                workspace=workspace,
                request_id=job.request_id,
                claim_guard=claim_guard,
            )
        if job.operation == "resume":
            return self._execute_resume_job(
                db,
                run=run,
                workspace=workspace,
                request_id=job.request_id,
                claim_guard=claim_guard,
            )
        raise AgentRunStateError("Unsupported agent run job operation.")

    def _execute_start_job(
        self,
        db: Session,
        *,
        run: AgentRun,
        workspace: Workspace,
        request_id: str,
        claim_guard: Callable[[], None] | None = None,
    ) -> AgentRun:
        started = time.perf_counter()
        try:
            if run.status == "waiting_approval":
                return run
            if not self._run_has_steps(db, run=run):
                self._guard_job_and_run(run, claim_guard)
                transition_run(run, "planning")
                plan_result = self.planner.plan(
                    objective=run.objective,
                    workspace=workspace,
                    tools=self.registry.all(),
                )
                self._guard_job_and_run(run, claim_guard)
                validated_plan = self._validate_plan(run=run, plan=plan_result.plan)
                safe_plan = sanitize_for_trace(validated_plan.model_dump())
                if isinstance(safe_plan, dict):
                    safe_plan["objective"] = "[REDACTED_CONTENT]"
                run.model = plan_result.model
                run.prompt_version = plan_result.prompt_version
                run.token_usage_json = merge_token_usage(
                    run.token_usage_json, plan_result.token_usage
                )
                run.estimated_cost = plan_result.estimated_cost
                run.latency_ms = plan_result.latency_ms
                run.plan_json = safe_plan
                record_trace(
                    db,
                    run_id=run.id,
                    workspace_id=workspace.id,
                    user_id=run.user_id,
                    event_type="model.plan",
                    status="succeeded",
                    model=run.model,
                    latency_ms=plan_result.latency_ms,
                    token_usage=plan_result.token_usage.model_dump(),
                    estimated_cost=plan_result.estimated_cost,
                    data=safe_plan,
                    untrusted_input=True,
                )
                self._create_steps(db, run=run, plan=validated_plan)
            self._guard_job_and_run(run, claim_guard)
            if run.status not in {"running", "waiting_approval"}:
                transition_run(run, "running")
            self._execute_available_steps(
                db,
                run=run,
                workspace=workspace,
                user_id=run.user_id,
                request_id=request_id,
                claim_guard=claim_guard,
            )
        except AgentRunJobClaimLost:
            raise
        except Exception as exc:
            transition_run(run, "failed", error_category=error_category(exc))
            run.latency_ms = run.latency_ms or round((time.perf_counter() - started) * 1000)
            record_trace(
                db,
                run_id=run.id,
                workspace_id=workspace.id,
                user_id=run.user_id,
                event_type="run.failed",
                status="failed",
                error=exc,
                untrusted_input=True,
            )
        run.updated_at = datetime.utcnow()
        db.flush()
        return run

    def _execute_resume_job(
        self,
        db: Session,
        *,
        run: AgentRun,
        workspace: Workspace,
        request_id: str,
        claim_guard: Callable[[], None] | None = None,
    ) -> AgentRun:
        if run.status in RUN_TERMINAL_STATUSES:
            return run
        if self._has_pending_approvals(db, run=run):
            raise AgentRunStateError("Agent run still has pending approvals.")
        self._guard_job_and_run(run, claim_guard)
        if run.status in {"queued", "waiting_approval"}:
            transition_run(run, "running")
        self._execute_available_steps(
            db,
            run=run,
            workspace=workspace,
            user_id=run.user_id,
            request_id=request_id,
            claim_guard=claim_guard,
        )
        db.flush()
        return run

    def get_run_detail(
        self, db: Session, *, workspace_id: UUID, run_id: UUID
    ) -> AgentRunDetailOut:
        run = self._scoped_run(db, workspace_id=workspace_id, run_id=run_id)
        steps = list(
            db.scalars(
                select(AgentStep)
                .where(AgentStep.run_id == run.id, AgentStep.workspace_id == workspace_id)
                .order_by(AgentStep.step_index.asc())
            ).all()
        )
        approvals = list(
            db.scalars(
                select(AgentApprovalRequest)
                .where(AgentApprovalRequest.run_id == run.id, AgentApprovalRequest.workspace_id == workspace_id)
                .order_by(AgentApprovalRequest.requested_at.asc())
            ).all()
        )
        return AgentRunDetailOut(
            run=run_out(run),
            steps=[step_out(item) for item in steps],
            approvals=[approval_out(item) for item in approvals],
        )

    def get_run_trace(
        self, db: Session, *, workspace_id: UUID, run_id: UUID
    ) -> AgentRunTraceOut:
        run = self._scoped_run(db, workspace_id=workspace_id, run_id=run_id)
        events = list(
            db.scalars(
                select(AgentTraceEvent)
                .where(
                    AgentTraceEvent.run_id == run.id,
                    AgentTraceEvent.workspace_id == workspace_id,
                )
                .order_by(AgentTraceEvent.created_at.asc())
            ).all()
        )
        return AgentRunTraceOut(run=run_out(run), trace=[trace_out(item) for item in events])

    def approve(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
        run_id: UUID,
        payload: AgentApprovalDecisionIn,
    ) -> AgentRun:
        self._require_enabled()
        run = self._scoped_run(db, workspace_id=workspace.id, run_id=run_id)
        if run.status in RUN_TERMINAL_STATUSES:
            return run
        approval = self._scoped_approval(
            db,
            workspace_id=workspace.id,
            run_id=run.id,
            approval_id=payload.approval_request_id,
        )
        if approval.approval_state == "approved":
            return run
        if approval.approval_state == "rejected":
            raise ApprovalStateError("Rejected approval cannot be approved later.")
        if payload.actor_type != "user":
            raise ApprovalStateError("AI cannot approve its own action.")
        tool = self.registry.get(approval.tool_name)
        if tool.name == "send_email" and (
            not payload.manual_draft_approval or not payload.final_send_confirmation
        ):
            raise ApprovalStateError(
                "send_email requires manual draft approval and a separate final Send confirmation."
            )
        approval.approval_state = "approved"
        approval.decision_json = {
            "actor_type": payload.actor_type,
            "manual_draft_approval": payload.manual_draft_approval,
            "final_send_confirmation": payload.final_send_confirmation,
            "reason": payload.reason,
            "idempotency_key": payload.idempotency_key,
        }
        approval.decided_by_user_id = user_id
        approval.decided_at = datetime.utcnow()
        approval.idempotency_key = payload.idempotency_key or approval.idempotency_key
        step = db.get(AgentStep, approval.step_id) if approval.step_id else None
        if step and step.workspace_id == workspace.id:
            step.approval_state = "approved"
        record_trace(
            db,
            run_id=run.id,
            step_id=approval.step_id,
            tool_call_id=approval.tool_call_id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="approval.approved",
            status="approved",
            tool_name=tool.name,
            approval_decision="approved",
            data=approval.decision_json,
        )
        db.flush()
        return run

    def reject(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
        run_id: UUID,
        approval_request_id: UUID,
        reason: str = "",
    ) -> AgentRun:
        self._require_enabled()
        run = self._scoped_run(db, workspace_id=workspace.id, run_id=run_id)
        if run.status in RUN_TERMINAL_STATUSES:
            return run
        approval = self._scoped_approval(
            db,
            workspace_id=workspace.id,
            run_id=run.id,
            approval_id=approval_request_id,
        )
        if approval.approval_state == "approved":
            raise ApprovalStateError("Approved action cannot be rejected later.")
        approval.approval_state = "rejected"
        approval.decision_json = {"actor_type": "user", "reason": reason}
        approval.decided_by_user_id = user_id
        approval.decided_at = datetime.utcnow()
        step = db.get(AgentStep, approval.step_id) if approval.step_id else None
        if step and step.workspace_id == workspace.id:
            step.approval_state = "rejected"
            transition_step(step, "skipped")
        transition_run(run, "cancelled")
        record_trace(
            db,
            run_id=run.id,
            step_id=approval.step_id,
            tool_call_id=approval.tool_call_id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="approval.rejected",
            status="rejected",
            tool_name=approval.tool_name,
            approval_decision="rejected",
            data=approval.decision_json,
        )
        db.flush()
        return run

    def resume(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
        run_id: UUID,
        request_id: str = "",
    ) -> AgentRun:
        self._require_enabled()
        run = self._scoped_run(db, workspace_id=workspace.id, run_id=run_id)
        if run.status in RUN_TERMINAL_STATUSES:
            return run
        if run.status != "waiting_approval":
            raise AgentRunStateError("Only runs waiting for approval can be resumed.")
        if self._has_pending_approvals(db, run=run):
            raise AgentRunStateError("Agent run still has pending approvals.")
        transition_run(run, "queued")
        enqueue_agent_run_job(
            db,
            run=run,
            operation="resume",
            request_id=request_id,
        )
        record_trace(
            db,
            run_id=run.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="run.resume_queued",
            status=run.status,
            data={"request_id": request_id},
        )
        db.flush()
        return run

    def cancel(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
        run_id: UUID,
        reason: str = "",
    ) -> AgentRun:
        self._require_enabled()
        run = self._scoped_run(db, workspace_id=workspace.id, run_id=run_id)
        if run.status in RUN_TERMINAL_STATUSES:
            return run
        transition_run(run, "cancelled")
        cancel_active_agent_run_jobs(
            db,
            workspace_id=workspace.id,
            run_id=run.id,
            reason=reason,
        )
        record_trace(
            db,
            run_id=run.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="run.cancelled",
            status="cancelled",
            data={"reason": reason},
        )
        db.flush()
        return run

    def _run_has_steps(self, db: Session, *, run: AgentRun) -> bool:
        return bool(
            db.scalar(
                select(AgentStep.id)
                .where(
                    AgentStep.workspace_id == run.workspace_id,
                    AgentStep.run_id == run.id,
                )
                .limit(1)
            )
        )

    def _has_pending_approvals(self, db: Session, *, run: AgentRun) -> bool:
        return bool(
            db.scalar(
                select(AgentApprovalRequest.id)
                .where(
                    AgentApprovalRequest.workspace_id == run.workspace_id,
                    AgentApprovalRequest.run_id == run.id,
                    AgentApprovalRequest.approval_state == "pending",
                )
                .limit(1)
            )
        )

    def _require_workspace_access(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
    ) -> None:
        allowed = self.permission_resolver.allowed_permissions(
            db,
            workspace=workspace,
            user_id=user_id,
        )
        if "workspace:read" not in allowed:
            raise PermissionDeniedError("Workspace access was revoked.")

    def _guard_job_and_run(
        self,
        run: AgentRun,
        claim_guard: Callable[[], None] | None = None,
    ) -> None:
        if claim_guard is not None:
            claim_guard()
        if run.status == "cancelled":
            raise AgentRunStateError("Agent run was cancelled.")

    def _execute_available_steps(
        self,
        db: Session,
        *,
        run: AgentRun,
        workspace: Workspace,
        user_id: str,
        request_id: str,
        claim_guard: Callable[[], None] | None = None,
    ) -> None:
        self._guard_job_and_run(run, claim_guard)
        has_failed_tool = False
        failed_error_category = ""
        steps = list(
            db.scalars(
                select(AgentStep)
                .where(AgentStep.run_id == run.id, AgentStep.workspace_id == workspace.id)
                .order_by(AgentStep.step_index.asc())
            ).all()
        )
        for step in steps:
            self._guard_job_and_run(run, claim_guard)
            if step.status in {"completed", "skipped"}:
                continue
            if step.status == "failed":
                has_failed_tool = True
                continue
            run.current_step_index = step.step_index
            run.current_step_name = step.title
            try:
                blocked = self._execute_step(
                    db,
                    run=run,
                    step=step,
                    workspace=workspace,
                    user_id=user_id,
                    request_id=request_id,
                    claim_guard=claim_guard,
                )
            except (UnknownToolError, ToolArgumentValidationError, ToolOutputValidationError) as exc:
                transition_step(step, "failed", error_category=error_category(exc))
                transition_run(run, "failed", error_category=error_category(exc))
                record_trace(
                    db,
                    run_id=run.id,
                    step_id=step.id,
                    workspace_id=workspace.id,
                    user_id=user_id,
                    event_type="step.validation_failed",
                    status="failed",
                    tool_name=step.tool_name,
                    error=exc,
                    data={"step_index": step.step_index},
                    untrusted_input=True,
                )
                return
            except Exception as exc:
                has_failed_tool = True
                failed_error_category = failed_error_category or error_category(exc)
                transition_step(step, "failed", error_category=error_category(exc))
                record_trace(
                    db,
                    run_id=run.id,
                    step_id=step.id,
                    workspace_id=workspace.id,
                    user_id=user_id,
                    event_type="step.failed",
                    status="failed",
                    tool_name=step.tool_name,
                    error=exc,
                    data={"step_index": step.step_index},
                    untrusted_input=True,
                )
                continue
            if blocked:
                return
        self._guard_job_and_run(run, claim_guard)
        if has_failed_tool:
            transition_run(
                run, "failed", error_category=failed_error_category or "tool_failed"
            )
            return
        transition_run(run, "completed")
        record_trace(
            db,
            run_id=run.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="run.completed",
            status="completed",
        )

    def _execute_step(
        self,
        db: Session,
        *,
        run: AgentRun,
        step: AgentStep,
        workspace: Workspace,
        user_id: str,
        request_id: str,
        claim_guard: Callable[[], None] | None = None,
    ) -> bool:
        self._guard_job_and_run(run, claim_guard)
        tool = self.registry.get(step.tool_name)
        arguments = self._validate_and_prepare_arguments(
            run=run,
            tool=tool,
            arguments=step.input_json or {},
        )
        execution_arguments = arguments.model_dump(mode="json")
        step.input_json = execution_arguments
        decision = self.policy.decision_for_tool(tool)
        idempotency_key = self._tool_call_idempotency_key(
            run, step, tool, execution_arguments
        )
        tool_call = self._tool_call_for_step(
            db,
            run=run,
            step=step,
            tool=tool,
            idempotency_key=idempotency_key,
            user_id=user_id,
        )
        self._require_tool_permissions(
            db,
            run=run,
            step=step,
            tool_call=tool_call,
            tool=tool,
            workspace=workspace,
            user_id=user_id,
        )
        approval: AgentApprovalRequest | None = None
        if decision.requires_approval:
            approval = self._approval_for_step(
                db, run=run, step=step, tool_call=tool_call, tool=tool
            )
            if approval.approval_state != "approved":
                tool_call.status = "waiting_approval"
                tool_call.approval_state = approval.approval_state
                step.approval_state = approval.approval_state
                transition_step(step, "waiting_approval")
                transition_run(run, "waiting_approval")
                record_trace(
                    db,
                    run_id=run.id,
                    step_id=step.id,
                    tool_call_id=tool_call.id,
                    workspace_id=workspace.id,
                    user_id=user_id,
                    event_type="approval.required",
                    status="waiting_approval",
                    tool_name=tool.name,
                    data={
                        "policy": self.policy.approval_request_metadata(tool),
                        "tool_arguments": sanitize_for_trace(execution_arguments),
                    },
                    untrusted_input=True,
                )
                return True
            self.policy.validate_approval_decision(tool=tool, approval=approval)
            tool_call.approval_state = "approved"
            step.approval_state = "approved"
        if tool_call.status == "succeeded":
            step.output_json = tool_call.result_json or {}
            transition_step(step, "completed")
            return False
        if tool_call.status in {"running", "failed"}:
            raise AgentRunStateError(
                f"Tool call is not retryable in state {tool_call.status}."
            )
        self._guard_job_and_run(run, claim_guard)
        transition_step(step, "running")
        tool_call.status = "running"
        tool_call.started_at = datetime.utcnow()
        context = ToolExecutionContext(db=db, workspace=workspace, user_id=user_id, request_id=request_id)
        gateway_decision: ActionPolicyDecision | None = None
        started = time.perf_counter()
        try:
            gateway_decision = self._enforce_action_gateway(
                db,
                run=run,
                tool=tool,
                arguments=execution_arguments,
                workspace=workspace,
                user_id=user_id,
                approval=approval,
                idempotency_key=idempotency_key,
            )
            self._guard_job_and_run(run, claim_guard)
            raw_output = tool.handler(context, arguments)
            output = tool.validate_output(raw_output)
        except Exception as exc:
            self.action_gateway.record_failure(db, gateway_decision, exc)
            latency_ms = round((time.perf_counter() - started) * 1000)
            tool_call.status = "failed"
            tool_call.error_category = error_category(exc)
            tool_call.latency_ms = latency_ms
            tool_call.completed_at = datetime.utcnow()
            record_trace(
                db,
                run_id=run.id,
                step_id=step.id,
                tool_call_id=tool_call.id,
                workspace_id=workspace.id,
                user_id=user_id,
                event_type="tool.failed",
                status="failed",
                tool_name=tool.name,
                latency_ms=latency_ms,
                error=exc,
                data={"tool_arguments": sanitize_for_trace(execution_arguments)},
                untrusted_input=True,
            )
            raise
        latency_ms = round((time.perf_counter() - started) * 1000)
        result_json = sanitize_for_trace(output.model_dump(mode="json"))
        self.action_gateway.record_success(db, gateway_decision, result=result_json)
        tool_call.status = "succeeded"
        tool_call.result_json = result_json
        tool_call.latency_ms = latency_ms
        tool_call.completed_at = datetime.utcnow()
        step.output_json = result_json
        step.latency_ms = latency_ms
        transition_step(step, "completed")
        record_trace(
            db,
            run_id=run.id,
            step_id=step.id,
            tool_call_id=tool_call.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="tool.succeeded",
            status="succeeded",
            tool_name=tool.name,
            latency_ms=latency_ms,
            data={"tool_result": result_json},
            untrusted_input=bool(result_json.get("untrusted_input")),
        )
        return False

    def _enforce_action_gateway(
        self,
        db: Session,
        *,
        run: AgentRun,
        tool: ToolDefinition,
        arguments: dict[str, Any],
        workspace: Workspace,
        user_id: str,
        approval: AgentApprovalRequest | None,
        idempotency_key: str,
    ) -> ActionPolicyDecision | None:
        action_name = GATEWAY_ACTION_BY_TOOL.get(tool.name)
        if not action_name:
            return None
        approval_context = None
        if approval is not None:
            decision = (
                approval.decision_json
                if isinstance(approval.decision_json, dict)
                else {}
            )
            approval_context = ActionApprovalContext(
                approved=approval.approval_state == "approved",
                approved_by_actor_type="human"
                if approval.decided_by_user_id
                else "",
                approved_by_user_id=approval.decided_by_user_id or "",
                manual_draft_approval=bool(
                    decision.get("manual_draft_approval")
                    or approval.approval_state == "approved"
                ),
                final_send_confirmation=bool(
                    decision.get("final_send_confirmation")
                ),
                fingerprint=str(
                    decision.get("fingerprint")
                    or decision.get("approval_fingerprint")
                    or ""
                ),
            )
        return self.action_gateway.enforce(
            db,
            workspace=workspace,
            actor_type="ai",
            actor_id=user_id,
            action_name=action_name,
            input_payload={
                **arguments,
                "context": {"run_id": str(run.id), "tool_name": tool.name},
            },
            required_permissions=tool.required_permissions,
            dry_run=bool(run.dry_run or arguments.get("dry_run")),
            approval=approval_context,
            idempotency_key=idempotency_key,
            resource_workspace_id=run.workspace_id,
            resource_id=run.id,
        )

    def _validate_plan(self, *, run: AgentRun, plan: AgentPlan) -> AgentPlan:
        normalized_steps = []
        for item in plan.steps:
            tool = self.registry.get(item.tool_name)
            arguments = self._validate_and_prepare_arguments(
                run=run,
                tool=tool,
                arguments=item.arguments,
            )
            normalized_steps.append(
                {
                    "id": item.id,
                    "title": item.title,
                    "tool_name": item.tool_name,
                    "arguments": arguments.model_dump(mode="json"),
                    "reason": item.reason,
                }
            )
        return AgentPlan.model_validate(
            {
                "objective": plan.objective,
                "steps": normalized_steps,
            }
        )

    def _validate_and_prepare_arguments(
        self,
        *,
        run: AgentRun,
        tool: ToolDefinition,
        arguments: dict[str, Any],
    ):
        prepared = dict(arguments or {})
        dry_run_field_present = "dry_run" in tool.input_model.model_fields
        if run.dry_run and tool.action_type in {
            "internal_write",
            "external_side_effect",
        }:
            if not tool.dry_run_supported or not dry_run_field_present:
                raise ToolExecutionBlockedError("Tool cannot run safely in dry-run mode.")
        if run.dry_run and tool.dry_run_supported and dry_run_field_present:
            prepared["dry_run"] = True
        return tool.validate_arguments(prepared)

    def _require_tool_permissions(
        self,
        db: Session,
        *,
        run: AgentRun,
        step: AgentStep,
        tool_call: AgentToolCall,
        tool: ToolDefinition,
        workspace: Workspace,
        user_id: str,
    ) -> None:
        if not tool.required_permissions:
            return
        allowed = self.permission_resolver.allowed_permissions(
            db,
            workspace=workspace,
            user_id=user_id,
        )
        if set(tool.required_permissions).issubset(allowed):
            return
        tool_call.status = "blocked"
        tool_call.error_category = PermissionDeniedError.category
        tool_call.completed_at = datetime.utcnow()
        record_trace(
            db,
            run_id=run.id,
            step_id=step.id,
            tool_call_id=tool_call.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="tool.permission_denied",
            status="blocked",
            tool_name=tool.name,
            error=PermissionDeniedError("Tool permission denied."),
            data={
                "action_type": tool.action_type,
                "required_permission_count": len(tool.required_permissions),
            },
        )
        raise PermissionDeniedError("Tool permission denied.")

    def _create_steps(self, db: Session, *, run: AgentRun, plan: AgentPlan) -> None:
        existing_indexes = set(
            db.scalars(
                select(AgentStep.step_index).where(
                    AgentStep.workspace_id == run.workspace_id,
                    AgentStep.run_id == run.id,
                )
            ).all()
        )
        for index, item in enumerate(plan.steps):
            if index in existing_indexes:
                continue
            db.add(
                AgentStep(
                    run_id=run.id,
                    workspace_id=run.workspace_id,
                    user_id=run.user_id,
                    step_index=index,
                    status="queued",
                    title=item.title,
                    tool_name=item.tool_name,
                    input_json=item.arguments,
                )
            )
        db.flush()

    def _tool_call_for_step(
        self,
        db: Session,
        *,
        run: AgentRun,
        step: AgentStep,
        tool: ToolDefinition,
        idempotency_key: str,
        user_id: str,
    ) -> AgentToolCall:
        existing = db.scalar(
            select(AgentToolCall).where(
                AgentToolCall.workspace_id == run.workspace_id,
                AgentToolCall.run_id == run.id,
                AgentToolCall.step_id == step.id,
                AgentToolCall.idempotency_key == idempotency_key,
            )
        )
        if existing is not None:
            return existing
        tool_call = AgentToolCall(
            run_id=run.id,
            step_id=step.id,
            workspace_id=run.workspace_id,
            user_id=user_id,
            tool_name=tool.name,
            action_type=tool.action_type,
            status="pending",
            approval_state="pending" if tool.requires_approval else "none",
            arguments_json=step.input_json or {},
            idempotency_key=idempotency_key,
        )
        db.add(tool_call)
        db.flush()
        return tool_call

    def _approval_for_step(
        self,
        db: Session,
        *,
        run: AgentRun,
        step: AgentStep,
        tool_call: AgentToolCall,
        tool: ToolDefinition,
    ) -> AgentApprovalRequest:
        existing = db.scalar(
            select(AgentApprovalRequest)
            .where(
                AgentApprovalRequest.workspace_id == run.workspace_id,
                AgentApprovalRequest.run_id == run.id,
                AgentApprovalRequest.step_id == step.id,
                AgentApprovalRequest.tool_call_id == tool_call.id,
            )
            .order_by(AgentApprovalRequest.requested_at.desc())
        )
        if existing is not None:
            return existing
        approval = AgentApprovalRequest(
            run_id=run.id,
            step_id=step.id,
            tool_call_id=tool_call.id,
            workspace_id=run.workspace_id,
            user_id=run.user_id,
            tool_name=tool.name,
            action_type=tool.action_type,
            approval_state="pending",
            tool_arguments_json=sanitize_for_trace(step.input_json or {}),
            decision_json=self.policy.approval_request_metadata(tool),
            idempotency_key=tool_call.idempotency_key,
        )
        db.add(approval)
        db.flush()
        return approval

    def _tool_call_idempotency_key(
        self,
        run: AgentRun,
        step: AgentStep,
        tool: ToolDefinition,
        arguments: dict[str, Any],
    ) -> str:
        raw = json.dumps(
            {
                "arguments": sanitize_for_trace(arguments),
                "effective_dry_run": bool(run.dry_run),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
        return f"agent-tool:{run.workspace_id}:{run.id}:{step.step_index}:{tool.name}:{digest}"

    def _require_enabled(self) -> None:
        if not self.feature_enabled:
            raise FeatureDisabledError("AI Control Plane is disabled.")

    def _effective_dry_run(self, requested_dry_run: bool) -> bool:
        return bool(requested_dry_run or self.force_dry_run)

    def _request_fingerprint(
        self, payload: AgentRunCreateIn, *, effective_dry_run: bool
    ) -> str:
        raw = json.dumps(
            {
                "version": "agent-run-create-v1",
                "objective": payload.objective,
                "dry_run": effective_dry_run,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _existing_run_for_key(
        self, db: Session, *, workspace_id: UUID, key: str
    ) -> AgentRun | None:
        clean_key = key.strip()
        if not clean_key:
            return None
        return db.scalar(
            select(AgentRun).where(
                AgentRun.workspace_id == workspace_id,
                AgentRun.idempotency_key == clean_key,
            )
        )

    def _scoped_run(self, db: Session, *, workspace_id: UUID, run_id: UUID) -> AgentRun:
        run = db.scalar(select(AgentRun).where(AgentRun.id == run_id, AgentRun.workspace_id == workspace_id))
        if run is None:
            raise AgentRunStateError("Agent run not found.")
        return run

    def _scoped_approval(
        self,
        db: Session,
        *,
        workspace_id: UUID,
        run_id: UUID,
        approval_id: UUID,
    ) -> AgentApprovalRequest:
        approval = db.scalar(
            select(AgentApprovalRequest).where(
                AgentApprovalRequest.id == approval_id,
                AgentApprovalRequest.run_id == run_id,
                AgentApprovalRequest.workspace_id == workspace_id,
            )
        )
        if approval is None:
            raise ApprovalStateError("Approval request not found.")
        return approval


def run_out(run: AgentRun) -> AgentRunOut:
    return AgentRunOut(
        id=run.id,
        workspace_id=run.workspace_id,
        user_id=run.user_id,
        status=run.status,
        objective="[REDACTED_CONTENT]" if run.objective else "",
        dry_run=bool(run.dry_run),
        plan=run.plan_json if isinstance(run.plan_json, dict) else {},
        current_step_index=int(run.current_step_index or 0),
        current_step_name=run.current_step_name or "",
        model=run.model or "",
        prompt_version=run.prompt_version or "",
        token_usage=run.token_usage_json if isinstance(run.token_usage_json, dict) else {},
        estimated_cost=float(run.estimated_cost) if run.estimated_cost is not None else None,
        latency_ms=int(run.latency_ms or 0),
        error_category=run.error_category or "",
        idempotency_key=run.idempotency_key or "",
        created_at=run.created_at,
        updated_at=run.updated_at,
        completed_at=run.completed_at,
    )


def step_out(step: AgentStep) -> AgentStepOut:
    return AgentStepOut(
        id=step.id,
        run_id=step.run_id,
        workspace_id=step.workspace_id,
        step_index=int(step.step_index or 0),
        status=step.status,
        title=step.title,
        tool_name=step.tool_name,
        input=sanitize_for_trace(
            step.input_json if isinstance(step.input_json, dict) else {}
        ),
        output=sanitize_for_trace(
            step.output_json if isinstance(step.output_json, dict) else {}
        ),
        approval_state=step.approval_state,
        error_category=step.error_category or "",
        latency_ms=int(step.latency_ms or 0),
        created_at=step.created_at,
        updated_at=step.updated_at,
        completed_at=step.completed_at,
    )


def approval_out(approval: AgentApprovalRequest) -> AgentApprovalRequestOut:
    return AgentApprovalRequestOut(
        id=approval.id,
        run_id=approval.run_id,
        step_id=approval.step_id,
        tool_call_id=approval.tool_call_id,
        workspace_id=approval.workspace_id,
        user_id=approval.user_id,
        tool_name=approval.tool_name,
        action_type=approval.action_type,
        approval_state=approval.approval_state,
        tool_arguments=sanitize_for_trace(
            approval.tool_arguments_json
            if isinstance(approval.tool_arguments_json, dict)
            else {}
        ),
        decision=sanitize_for_trace(
            approval.decision_json if isinstance(approval.decision_json, dict) else {}
        ),
        idempotency_key=approval.idempotency_key or "",
        requested_at=approval.requested_at,
        decided_at=approval.decided_at,
        decided_by_user_id=approval.decided_by_user_id or "",
    )


def trace_out(event) -> AgentTraceEventOut:
    error_category_value = event.error_category or ""
    return AgentTraceEventOut(
        id=event.id,
        run_id=event.run_id,
        step_id=event.step_id,
        tool_call_id=event.tool_call_id,
        workspace_id=event.workspace_id,
        user_id=event.user_id,
        event_type=event.event_type,
        status=event.status or "",
        model=event.model or "",
        tool_name=event.tool_name or "",
        latency_ms=int(event.latency_ms or 0),
        token_usage=event.token_usage if isinstance(event.token_usage, dict) else {},
        estimated_cost=float(event.estimated_cost) if event.estimated_cost is not None else None,
        approval_decision=event.approval_decision or "",
        error_category=error_category_value,
        message=safe_trace_message(event.message or "", error_category_value=error_category_value),
        data=sanitize_for_trace(event.data_json if isinstance(event.data_json, dict) else {}),
        untrusted_input=bool(event.untrusted_input),
        created_at=event.created_at,
    )
