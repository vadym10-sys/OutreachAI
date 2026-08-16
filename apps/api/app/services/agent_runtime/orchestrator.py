from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from openai import OpenAI, OpenAIError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import (
    AgentApprovalRequest,
    AgentRun,
    AgentStep,
    AgentTraceEvent,
    AgentToolCall,
    Workspace,
)
from app.services.agent_runtime.adapters import ToolExecutionContext, default_tool_registry
from app.services.agent_runtime.approval_policy import AgentApprovalPolicy
from app.services.agent_runtime.errors import (
    AgentRunStateError,
    ApprovalStateError,
    FeatureDisabledError,
    IdempotencyConflictError,
    PermissionDeniedError,
    StructuredPlanValidationError,
    ToolArgumentValidationError,
    ToolOutputValidationError,
    ToolExecutionBlockedError,
    UnknownToolError,
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
    AgentRunCreateIn,
    AgentRunDetailOut,
    AgentRunOut,
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
from app.services.agent_runtime.tracing import error_category, record_trace, sanitize_for_trace
from app.services.ai import ProviderConfigurationError, ProviderRequestError, _trust_payload, _trust_system_prompt

PROMPT_VERSION = "agent-runtime-plan-v1"


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
    ) -> None:
        self.registry = registry or default_tool_registry()
        self.policy = policy or AgentApprovalPolicy()
        self.planner = planner or OpenAIAgentPlanner()
        self.permission_resolver = permission_resolver or WorkspaceRolePermissionResolver()
        self._feature_enabled = feature_enabled

    @property
    def feature_enabled(self) -> bool:
        if self._feature_enabled is not None:
            return self._feature_enabled
        return bool(get_settings().ai_control_plane_enabled)

    def list_tools(self) -> list[ToolRegistryItemOut]:
        return [tool.public_metadata() for tool in self.registry.all()]

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
        request_fingerprint = self._request_fingerprint(payload)
        existing = self._existing_run_for_key(
            db, workspace_id=workspace.id, key=payload.idempotency_key
        )
        if existing is not None:
            if existing.request_fingerprint != request_fingerprint:
                raise IdempotencyConflictError(
                    "Idempotency request already exists with a different payload."
                )
            return existing
        started = time.perf_counter()
        run = AgentRun(
            workspace_id=workspace.id,
            user_id=user_id,
            status="queued",
            objective=payload.objective,
            dry_run=payload.dry_run,
            input_json=sanitize_for_trace(
                {"objective": payload.objective, "dry_run": payload.dry_run}
            ),
            idempotency_key=payload.idempotency_key.strip(),
            request_fingerprint=request_fingerprint,
        )
        db.add(run)
        db.flush()
        record_trace(
            db,
            run_id=run.id,
            workspace_id=workspace.id,
            user_id=user_id,
            event_type="run.created",
            status=run.status,
            data={"request_id": request_id},
        )
        try:
            transition_run(run, "planning")
            plan_result = self.planner.plan(
                objective=payload.objective,
                workspace=workspace,
                tools=self.registry.all(),
            )
            validated_plan = self._validate_plan(run=run, plan=plan_result.plan)
            run.model = plan_result.model
            run.prompt_version = plan_result.prompt_version
            run.token_usage_json = merge_token_usage(
                run.token_usage_json, plan_result.token_usage
            )
            run.estimated_cost = plan_result.estimated_cost
            run.latency_ms = plan_result.latency_ms
            run.plan_json = sanitize_for_trace(validated_plan.model_dump())
            record_trace(
                db,
                run_id=run.id,
                workspace_id=workspace.id,
                user_id=user_id,
                event_type="model.plan",
                status="succeeded",
                model=run.model,
                latency_ms=plan_result.latency_ms,
                token_usage=plan_result.token_usage.model_dump(),
                estimated_cost=plan_result.estimated_cost,
                data=run.plan_json,
                untrusted_input=True,
            )
            self._create_steps(db, run=run, plan=validated_plan)
            transition_run(run, "running")
            self._execute_available_steps(
                db,
                run=run,
                workspace=workspace,
                user_id=user_id,
                request_id=request_id,
            )
        except Exception as exc:
            transition_run(run, "failed", error_category=error_category(exc))
            run.latency_ms = run.latency_ms or round((time.perf_counter() - started) * 1000)
            record_trace(
                db,
                run_id=run.id,
                workspace_id=workspace.id,
                user_id=user_id,
                event_type="run.failed",
                status="failed",
                error=exc,
                untrusted_input=True,
            )
        run.updated_at = datetime.utcnow()
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
        transition_run(run, "running")
        self._execute_available_steps(
            db,
            run=run,
            workspace=workspace,
            user_id=user_id,
            request_id=request_id,
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

    def _execute_available_steps(
        self,
        db: Session,
        *,
        run: AgentRun,
        workspace: Workspace,
        user_id: str,
        request_id: str,
    ) -> None:
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
    ) -> bool:
        tool = self.registry.get(step.tool_name)
        arguments = self._validate_and_prepare_arguments(
            run=run,
            tool=tool,
            arguments=step.input_json or {},
        )
        step.input_json = sanitize_for_trace(arguments.model_dump(mode="json"))
        decision = self.policy.decision_for_tool(tool)
        idempotency_key = self._tool_call_idempotency_key(run, step, tool, arguments.model_dump(mode="json"))
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
        if decision.requires_approval:
            approval = self._approval_for_step(db, run=run, step=step, tool_call=tool_call, tool=tool)
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
                        "tool_arguments": step.input_json,
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
            raise AgentRunStateError(f"Tool call is not retryable in state {tool_call.status}.")
        transition_step(step, "running")
        tool_call.status = "running"
        tool_call.started_at = datetime.utcnow()
        context = ToolExecutionContext(db=db, workspace=workspace, user_id=user_id, request_id=request_id)
        started = time.perf_counter()
        try:
            raw_output = tool.handler(context, arguments)
            output = tool.validate_output(raw_output)
        except Exception as exc:
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
                data={"tool_arguments": step.input_json},
                untrusted_input=True,
            )
            raise
        latency_ms = round((time.perf_counter() - started) * 1000)
        result_json = sanitize_for_trace(output.model_dump(mode="json"))
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
        for index, item in enumerate(plan.steps):
            db.add(
                AgentStep(
                    run_id=run.id,
                    workspace_id=run.workspace_id,
                    user_id=run.user_id,
                    step_index=index,
                    status="queued",
                    title=item.title,
                    tool_name=item.tool_name,
                    input_json=sanitize_for_trace(item.arguments),
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
            tool_arguments_json=step.input_json or {},
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
        raw = json.dumps(sanitize_for_trace(arguments), sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
        return f"agent-tool:{run.workspace_id}:{run.id}:{step.step_index}:{tool.name}:{digest}"

    def _require_enabled(self) -> None:
        if not self.feature_enabled:
            raise FeatureDisabledError("AI Control Plane is disabled.")

    def _request_fingerprint(self, payload: AgentRunCreateIn) -> str:
        raw = json.dumps(
            {
                "version": "agent-run-create-v1",
                "objective": payload.objective,
                "dry_run": payload.dry_run,
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
        objective=run.objective,
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
        input=step.input_json if isinstance(step.input_json, dict) else {},
        output=step.output_json if isinstance(step.output_json, dict) else {},
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
        tool_arguments=approval.tool_arguments_json if isinstance(approval.tool_arguments_json, dict) else {},
        decision=approval.decision_json if isinstance(approval.decision_json, dict) else {},
        idempotency_key=approval.idempotency_key or "",
        requested_at=approval.requested_at,
        decided_at=approval.decided_at,
        decided_by_user_id=approval.decided_by_user_id or "",
    )


def trace_out(event) -> AgentTraceEventOut:
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
        error_category=event.error_category or "",
        message=event.message or "",
        data=event.data_json if isinstance(event.data_json, dict) else {},
        untrusted_input=bool(event.untrusted_input),
        created_at=event.created_at,
    )
