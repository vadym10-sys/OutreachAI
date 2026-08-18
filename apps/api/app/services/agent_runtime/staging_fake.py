from __future__ import annotations

from dataclasses import dataclass

from app.models.entities import Workspace
from app.services.agent_runtime.adapters import AgentToolAdapters
from app.services.agent_runtime.orchestrator import PlanResult
from app.services.agent_runtime.registry import ToolDefinition, build_default_tool_registry
from app.services.agent_runtime.schemas import AgentPlan, ModelUsage

FAKE_PROVIDER_CALL_COUNT = 0


@dataclass
class DeterministicStagingPlanner:
    model: str = "staging-fake-local-planner"
    prompt_version: str = "staging-fake-plan-v1"

    def plan(
        self,
        *,
        objective: str,
        workspace: Workspace,
        tools: list[ToolDefinition],
    ) -> PlanResult:
        del tools
        company_name = (workspace.company or workspace.name or "Synthetic Dry Run Co")[:120]
        return PlanResult(
            plan=AgentPlan.model_validate(
                {
                    "objective": objective,
                    "steps": [
                        {
                            "id": "context",
                            "title": "Read workspace context",
                            "tool_name": "understand_business",
                            "arguments": {"objective": "Synthetic dry-run task"},
                            "reason": "Use workspace-scoped context only.",
                        },
                        {
                            "id": "crm-review",
                            "title": "Prepare CRM review",
                            "tool_name": "save_to_crm",
                            "arguments": {
                                "company_name": company_name,
                                "website": "https://synthetic-dry-run.example",
                                "contact_email": "buyer@synthetic-dry-run.example",
                                "notes": "Synthetic dry-run only.",
                                "dry_run": False,
                            },
                            "reason": "Pause for human approval before a CRM write.",
                        },
                        {
                            "id": "draft",
                            "title": "Prepare draft preview",
                            "tool_name": "generate_email_draft",
                            "arguments": {
                                "subject": "Synthetic dry-run intro",
                                "body": "Synthetic dry-run body. No email is created or sent.",
                                "recipient_email": "buyer@synthetic-dry-run.example",
                                "dry_run": False,
                            },
                            "reason": "Produce a dry-run draft result after approval.",
                        },
                    ],
                }
            ),
            model=self.model,
            prompt_version=self.prompt_version,
            token_usage=ModelUsage(),
            estimated_cost=0,
            latency_ms=0,
        )


class StagingFakeAgentToolAdapters(AgentToolAdapters):
    def registry(self):
        return build_default_tool_registry(self.handlers())


def staging_fake_provider_call_count() -> int:
    return FAKE_PROVIDER_CALL_COUNT
