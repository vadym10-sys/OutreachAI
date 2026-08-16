from __future__ import annotations


class AgentRuntimeError(RuntimeError):
    """Base error for AI Control Plane runtime failures."""

    category = "runtime_error"


class FeatureDisabledError(AgentRuntimeError):
    category = "feature_disabled"


class StructuredPlanValidationError(AgentRuntimeError):
    category = "invalid_structured_plan"


class UnknownToolError(AgentRuntimeError):
    category = "unknown_tool"


class ToolArgumentValidationError(AgentRuntimeError):
    category = "invalid_tool_arguments"


class ToolOutputValidationError(AgentRuntimeError):
    category = "invalid_tool_output"


class ApprovalRequiredError(AgentRuntimeError):
    category = "approval_required"


class ApprovalStateError(AgentRuntimeError):
    category = "invalid_approval_state"


class ToolExecutionBlockedError(AgentRuntimeError):
    category = "tool_execution_blocked"


class AgentRunStateError(AgentRuntimeError):
    category = "invalid_run_state"


class IdempotencyConflictError(AgentRunStateError):
    category = "idempotency_conflict"


class PermissionDeniedError(AgentRuntimeError):
    category = "permission_denied"
