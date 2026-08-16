from __future__ import annotations

from datetime import datetime

from app.models.entities import AgentRun, AgentStep
from app.services.agent_runtime.errors import AgentRunStateError

RUN_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
RUN_STATUSES = {
    "queued",
    "planning",
    "running",
    "waiting_approval",
    "completed",
    "failed",
    "cancelled",
}
STEP_TERMINAL_STATUSES = {"completed", "failed", "skipped"}


def transition_run(run: AgentRun, status: str, *, error_category: str = "") -> None:
    if status not in RUN_STATUSES:
        raise AgentRunStateError(f"Unsupported run status: {status}")
    if run.status in RUN_TERMINAL_STATUSES and run.status != status:
        raise AgentRunStateError(f"Cannot transition terminal run {run.id} from {run.status} to {status}")
    run.status = status
    run.error_category = error_category or run.error_category
    run.updated_at = datetime.utcnow()
    if status in RUN_TERMINAL_STATUSES:
        run.completed_at = run.completed_at or datetime.utcnow()


def transition_step(step: AgentStep, status: str, *, error_category: str = "") -> None:
    if status not in {"queued", "running", "waiting_approval", "completed", "failed", "skipped"}:
        raise AgentRunStateError(f"Unsupported step status: {status}")
    if step.status in STEP_TERMINAL_STATUSES and step.status != status:
        raise AgentRunStateError(f"Cannot transition terminal step {step.id} from {step.status} to {status}")
    step.status = status
    step.error_category = error_category or step.error_category
    step.updated_at = datetime.utcnow()
    if status in STEP_TERMINAL_STATUSES:
        step.completed_at = step.completed_at or datetime.utcnow()
