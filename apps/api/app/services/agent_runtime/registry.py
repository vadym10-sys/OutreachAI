from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from app.services.agent_runtime.errors import (
    ToolArgumentValidationError,
    ToolOutputValidationError,
    UnknownToolError,
)
from app.services.agent_runtime.schemas import (
    ActionType,
    GenerateEmailDraftInput,
    GenerateEmailDraftOutput,
    IdempotencyPolicy,
    ResearchCompanyInput,
    ResearchCompanyOutput,
    RetryPolicy,
    SaveToCrmInput,
    SaveToCrmOutput,
    ScoreLeadInput,
    ScoreLeadOutput,
    SearchCompaniesInput,
    SearchCompaniesOutput,
    SendEmailInput,
    SendEmailOutput,
    SyncRepliesInput,
    SyncRepliesOutput,
    ToolRegistryItemOut,
    UnderstandBusinessInput,
    UnderstandBusinessOutput,
    VerifyEmailInput,
    VerifyEmailOutput,
)

ToolHandler = Callable[[Any, BaseModel], BaseModel]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    action_type: ActionType
    timeout_seconds: float
    retry_policy: RetryPolicy
    idempotency_policy: IdempotencyPolicy
    required_permissions: tuple[str, ...]
    workspace_context: bool
    audit_metadata: dict[str, Any]
    dry_run_supported: bool
    requires_approval: bool
    handler: ToolHandler

    def validate_arguments(self, arguments: dict[str, Any]) -> BaseModel:
        try:
            return self.input_model.model_validate(arguments)
        except ValidationError as exc:
            raise ToolArgumentValidationError(str(exc)) from exc

    def validate_output(self, output: BaseModel | dict[str, Any]) -> BaseModel:
        try:
            return self.output_model.model_validate(output)
        except ValidationError as exc:
            raise ToolOutputValidationError(str(exc)) from exc

    def public_metadata(self) -> ToolRegistryItemOut:
        return ToolRegistryItemOut(
            name=self.name,
            description=self.description,
            action_type=self.action_type,
            timeout_seconds=self.timeout_seconds,
            retry_policy=self.retry_policy,
            idempotency_policy=self.idempotency_policy,
            required_permissions=list(self.required_permissions),
            workspace_context=self.workspace_context,
            audit_metadata=self.audit_metadata,
            dry_run_supported=self.dry_run_supported,
            requires_approval=self.requires_approval,
            input_schema=self.input_model.model_json_schema(),
            output_schema=self.output_model.model_json_schema(),
        )


class ToolRegistry:
    def __init__(self, tools: list[ToolDefinition]) -> None:
        self._tools: dict[str, ToolDefinition] = {}
        for tool in tools:
            if tool.name in self._tools:
                raise ValueError(f"Duplicate agent tool registered: {tool.name}")
            self._tools[tool.name] = tool

    def get(self, name: str) -> ToolDefinition:
        tool = self._tools.get(name)
        if tool is None:
            raise UnknownToolError(f"Unknown AI tool: {name}")
        return tool

    def all(self) -> list[ToolDefinition]:
        return [self._tools[name] for name in sorted(self._tools)]


def build_default_tool_registry(handlers: dict[str, ToolHandler]) -> ToolRegistry:
    return ToolRegistry(
        [
            ToolDefinition(
                name="understand_business",
                description="Read the workspace profile and objective to establish safe business context.",
                input_model=UnderstandBusinessInput,
                output_model=UnderstandBusinessOutput,
                action_type="read_only",
                timeout_seconds=5,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("workspace:read",),
                workspace_context=True,
                audit_metadata={"category": "context", "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=False,
                handler=handlers["understand_business"],
            ),
            ToolDefinition(
                name="search_companies",
                description="Prepare or dry-run a Customer Finder search without direct external provider calls in v1.",
                input_model=SearchCompaniesInput,
                output_model=SearchCompaniesOutput,
                action_type="read_only",
                timeout_seconds=10,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("customer_finder:read",),
                workspace_context=True,
                audit_metadata={"category": "customer_finder", "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=False,
                handler=handlers["search_companies"],
            ),
            ToolDefinition(
                name="research_company",
                description="Read existing workspace-scoped company facts; external website research stays dry-run in v1.",
                input_model=ResearchCompanyInput,
                output_model=ResearchCompanyOutput,
                action_type="read_only",
                timeout_seconds=10,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("crm:read",),
                workspace_context=True,
                audit_metadata={"category": "research", "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=False,
                handler=handlers["research_company"],
            ),
            ToolDefinition(
                name="verify_email",
                description="Run local email sanity checks; provider verification requires a future approved adapter.",
                input_model=VerifyEmailInput,
                output_model=VerifyEmailOutput,
                action_type="read_only",
                timeout_seconds=5,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("contacts:read",),
                workspace_context=True,
                audit_metadata={"category": "email_verification", "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=False,
                handler=handlers["verify_email"],
            ),
            ToolDefinition(
                name="score_lead",
                description="Score a lead from explicit signals using deterministic local scoring.",
                input_model=ScoreLeadInput,
                output_model=ScoreLeadOutput,
                action_type="read_only",
                timeout_seconds=5,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("crm:read",),
                workspace_context=True,
                audit_metadata={"category": "lead_scoring", "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=False,
                handler=handlers["score_lead"],
            ),
            ToolDefinition(
                name="save_to_crm",
                description="Save explicitly approved lead/company data to workspace CRM.",
                input_model=SaveToCrmInput,
                output_model=SaveToCrmOutput,
                action_type="internal_write",
                timeout_seconds=10,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("crm:write",),
                workspace_context=True,
                audit_metadata={"category": "crm_write", "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=True,
                handler=handlers["save_to_crm"],
            ),
            ToolDefinition(
                name="generate_email_draft",
                description="Create a draft-only email record from validated subject/body; never sends.",
                input_model=GenerateEmailDraftInput,
                output_model=GenerateEmailDraftOutput,
                action_type="internal_write",
                timeout_seconds=10,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("email:draft",),
                workspace_context=True,
                audit_metadata={"category": "email_draft", "draft_only": True, "untrusted_output": True},
                dry_run_supported=True,
                requires_approval=False,
                handler=handlers["generate_email_draft"],
            ),
            ToolDefinition(
                name="send_email",
                description="Registered external email send action; blocked in v1 unless a future explicit sender implements it.",
                input_model=SendEmailInput,
                output_model=SendEmailOutput,
                action_type="external_side_effect",
                timeout_seconds=20,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("email:send",),
                workspace_context=True,
                audit_metadata={"category": "email_send", "requires_final_send_confirmation": True},
                dry_run_supported=False,
                requires_approval=True,
                handler=handlers["send_email"],
            ),
            ToolDefinition(
                name="sync_replies",
                description="Registered Gmail reply sync action; blocked in v1 without explicit approval and future adapter.",
                input_model=SyncRepliesInput,
                output_model=SyncRepliesOutput,
                action_type="external_side_effect",
                timeout_seconds=20,
                retry_policy=RetryPolicy(max_attempts=1),
                idempotency_policy=IdempotencyPolicy(required=True, scope="tool_call"),
                required_permissions=("gmail:read", "crm:write"),
                workspace_context=True,
                audit_metadata={"category": "reply_sync"},
                dry_run_supported=True,
                requires_approval=True,
                handler=handlers["sync_replies"],
            ),
        ]
    )
