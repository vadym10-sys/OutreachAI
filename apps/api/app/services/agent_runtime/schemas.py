from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ActionType = Literal["read_only", "internal_write", "external_side_effect"]
RunStatus = Literal[
    "queued",
    "planning",
    "running",
    "waiting_approval",
    "completed",
    "failed",
    "cancelled",
]
StepStatus = Literal["queued", "running", "waiting_approval", "completed", "failed", "skipped"]
ApprovalState = Literal["none", "pending", "approved", "rejected"]
ToolCallStatus = Literal["pending", "running", "waiting_approval", "succeeded", "failed", "blocked", "skipped"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelUsage(StrictModel):
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class RetryPolicy(StrictModel):
    max_attempts: int = Field(default=1, ge=1, le=3)
    backoff_seconds: float = Field(default=0.0, ge=0.0, le=30.0)


class IdempotencyPolicy(StrictModel):
    required: bool = True
    scope: Literal["workspace", "run", "tool_call"] = "tool_call"


class AgentPlanStep(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=160)
    tool_name: str = Field(min_length=1, max_length=120)
    arguments: dict[str, Any] = Field(default_factory=dict)
    reason: str = Field(default="", max_length=500)


class AgentPlan(StrictModel):
    objective: str = Field(min_length=4, max_length=2000)
    steps: list[AgentPlanStep] = Field(min_length=1, max_length=12)

    @field_validator("steps")
    @classmethod
    def require_unique_step_ids(cls, value: list[AgentPlanStep]) -> list[AgentPlanStep]:
        ids = [item.id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("step ids must be unique")
        return value


class AgentRunCreateIn(StrictModel):
    objective: str = Field(min_length=4, max_length=2000)
    idempotency_key: str = Field(default="", max_length=160)
    dry_run: bool = False


class AgentApprovalDecisionIn(StrictModel):
    approval_request_id: UUID
    idempotency_key: str = Field(default="", max_length=160)
    actor_type: Literal["user", "ai"] = "user"
    manual_draft_approval: bool = False
    final_send_confirmation: bool = False
    reason: str = Field(default="", max_length=500)


class AgentApprovalRejectIn(StrictModel):
    approval_request_id: UUID
    reason: str = Field(default="", max_length=500)


class AgentRunCancelIn(StrictModel):
    reason: str = Field(default="", max_length=500)


class AgentRunOut(StrictModel):
    id: UUID
    workspace_id: UUID
    user_id: str
    status: RunStatus
    objective: str
    dry_run: bool = False
    plan: dict[str, Any] = Field(default_factory=dict)
    current_step_index: int = 0
    current_step_name: str = ""
    model: str = ""
    prompt_version: str = ""
    token_usage: dict[str, Any] = Field(default_factory=dict)
    estimated_cost: Optional[float] = None
    latency_ms: int = 0
    error_category: str = ""
    idempotency_key: str = ""
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class AgentStepOut(StrictModel):
    id: UUID
    run_id: UUID
    workspace_id: UUID
    step_index: int
    status: StepStatus
    title: str
    tool_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    approval_state: ApprovalState = "none"
    error_category: str = ""
    latency_ms: int = 0
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class AgentTraceEventOut(StrictModel):
    id: UUID
    run_id: UUID
    step_id: Optional[UUID] = None
    tool_call_id: Optional[UUID] = None
    workspace_id: UUID
    user_id: str
    event_type: str
    status: str = ""
    model: str = ""
    tool_name: str = ""
    latency_ms: int = 0
    token_usage: dict[str, Any] = Field(default_factory=dict)
    estimated_cost: Optional[float] = None
    approval_decision: str = ""
    error_category: str = ""
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    untrusted_input: bool = False
    created_at: datetime


class AgentApprovalRequestOut(StrictModel):
    id: UUID
    run_id: UUID
    step_id: Optional[UUID] = None
    tool_call_id: Optional[UUID] = None
    workspace_id: UUID
    user_id: str
    tool_name: str
    action_type: ActionType
    approval_state: ApprovalState
    tool_arguments: dict[str, Any] = Field(default_factory=dict)
    decision: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = ""
    requested_at: datetime
    decided_at: Optional[datetime] = None
    decided_by_user_id: str = ""


class AgentRunDetailOut(StrictModel):
    run: AgentRunOut
    steps: list[AgentStepOut] = Field(default_factory=list)
    approvals: list[AgentApprovalRequestOut] = Field(default_factory=list)


class AgentRunTraceOut(StrictModel):
    run: AgentRunOut
    trace: list[AgentTraceEventOut] = Field(default_factory=list)


class ToolRegistryItemOut(StrictModel):
    name: str
    description: str
    action_type: ActionType
    timeout_seconds: float
    retry_policy: RetryPolicy
    idempotency_policy: IdempotencyPolicy
    required_permissions: list[str]
    workspace_context: bool
    audit_metadata: dict[str, Any]
    dry_run_supported: bool
    requires_approval: bool
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]


class UnderstandBusinessInput(StrictModel):
    objective: str = Field(default="", max_length=2000)


class UnderstandBusinessOutput(StrictModel):
    workspace_summary: dict[str, Any]
    objective: str
    untrusted_input: bool = True


class SearchCompaniesInput(StrictModel):
    query: str = Field(min_length=2, max_length=500)
    target_country: str = Field(default="", max_length=120)
    target_industry: str = Field(default="", max_length=160)
    max_results: int = Field(default=5, ge=1, le=25)
    dry_run: bool = True


class SearchCompaniesOutput(StrictModel):
    executed: bool
    results: list[dict[str, Any]] = Field(default_factory=list)
    reason: str = ""
    untrusted_input: bool = True


class ResearchCompanyInput(StrictModel):
    company_id: Optional[UUID] = None
    website: str = Field(default="", max_length=500)
    dry_run: bool = True

    @model_validator(mode="after")
    def require_company_or_website(self) -> "ResearchCompanyInput":
        if not self.company_id and not self.website.strip():
            raise ValueError("company_id or website is required")
        return self


class ResearchCompanyOutput(StrictModel):
    executed: bool
    company: dict[str, Any] = Field(default_factory=dict)
    facts: list[str] = Field(default_factory=list)
    reason: str = ""
    untrusted_input: bool = True


class VerifyEmailInput(StrictModel):
    email: str = Field(min_length=3, max_length=320)
    dry_run: bool = True


class VerifyEmailOutput(StrictModel):
    executed: bool
    status: str
    confidence: int = Field(default=0, ge=0, le=100)
    reason: str = ""
    untrusted_input: bool = True


class ScoreLeadInput(StrictModel):
    company_name: str = Field(min_length=1, max_length=220)
    signals: list[str] = Field(default_factory=list, max_length=12)
    contact_verified: bool = False


class ScoreLeadOutput(StrictModel):
    score: int = Field(ge=0, le=100)
    reasons: list[str] = Field(default_factory=list)
    untrusted_input: bool = True


class SaveToCrmInput(StrictModel):
    company_name: str = Field(min_length=2, max_length=220)
    website: str = Field(default="", max_length=500)
    contact_email: str = Field(default="", max_length=320)
    notes: str = Field(default="", max_length=4000)
    dry_run: bool = False


class SaveToCrmOutput(StrictModel):
    status: str
    dry_run: bool
    company_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    untrusted_input: bool = True


class GenerateEmailDraftInput(StrictModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=10000)
    lead_id: Optional[UUID] = None
    company_id: Optional[UUID] = None
    recipient_email: str = Field(default="", max_length=320)
    dry_run: bool = False


class GenerateEmailDraftOutput(StrictModel):
    status: str
    draft_only: bool = True
    email_id: Optional[UUID] = None
    delivery_status: str = "draft"
    untrusted_input: bool = True


class SendEmailInput(StrictModel):
    email_id: UUID
    confirmed_draft_approval: bool = False
    confirmed_final_send: bool = False


class SendEmailOutput(StrictModel):
    sent: bool = False
    status: str
    reason: str = ""
    untrusted_input: bool = True


class SyncRepliesInput(StrictModel):
    since_hours: int = Field(default=24, ge=1, le=720)
    dry_run: bool = True


class SyncRepliesOutput(StrictModel):
    executed: bool = False
    synced: int = 0
    reason: str = ""
    untrusted_input: bool = True
