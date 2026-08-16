from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.models.entities import AgentApprovalRequest
from app.services.agent_runtime.errors import ApprovalStateError
from app.services.agent_runtime.registry import ToolDefinition


class ApprovalPolicyDecision(BaseModel):
    allowed: bool = False
    requires_approval: bool = False
    reason: str = ""
    approval_type: str = ""
    required_confirmations: list[str] = Field(default_factory=list)


class AgentApprovalPolicy:
    """Central fail-closed approval policy for AI Control Plane actions."""

    def decision_for_tool(self, tool: ToolDefinition) -> ApprovalPolicyDecision:
        if tool.action_type == "read_only":
            return ApprovalPolicyDecision(allowed=True, reason="read_only_auto_allowed")
        if tool.name == "generate_email_draft":
            return ApprovalPolicyDecision(
                allowed=True,
                reason="draft_creation_allowed_without_send",
            )
        if tool.name == "save_to_crm":
            return ApprovalPolicyDecision(
                allowed=False,
                requires_approval=True,
                reason="crm_write_requires_user_approval",
                approval_type="crm_write",
                required_confirmations=["manual_user_approval"],
            )
        if tool.name == "send_email":
            return ApprovalPolicyDecision(
                allowed=False,
                requires_approval=True,
                reason="send_email_requires_draft_approval_and_final_send_confirmation",
                approval_type="email_send",
                required_confirmations=[
                    "manual_draft_approval",
                    "separate_final_send_confirmation",
                ],
            )
        if tool.action_type == "external_side_effect":
            return ApprovalPolicyDecision(
                allowed=False,
                requires_approval=True,
                reason="external_side_effect_requires_user_approval",
                approval_type="external_side_effect",
                required_confirmations=["manual_user_approval"],
            )
        return ApprovalPolicyDecision(
            allowed=False,
            requires_approval=True,
            reason="unknown_write_policy_blocks_action",
            approval_type="manual_review",
            required_confirmations=["manual_user_approval"],
        )

    def validate_approval_decision(
        self,
        *,
        tool: ToolDefinition,
        approval: AgentApprovalRequest | None,
    ) -> None:
        if not tool.requires_approval:
            return
        if approval is None:
            raise ApprovalStateError("Missing approval state blocks this action.")
        if approval.approval_state != "approved":
            raise ApprovalStateError("Approval state is not approved.")
        decision = approval.decision_json if isinstance(approval.decision_json, dict) else {}
        if decision.get("actor_type") != "user":
            raise ApprovalStateError("AI cannot approve its own action.")
        if not approval.decided_by_user_id:
            raise ApprovalStateError("Approval must be tied to a user.")
        if tool.name == "send_email":
            if decision.get("manual_draft_approval") is not True:
                raise ApprovalStateError("Manual draft approval is required before send_email.")
            if decision.get("final_send_confirmation") is not True:
                raise ApprovalStateError("Separate final Send confirmation is required before send_email.")

    def approval_request_metadata(self, tool: ToolDefinition) -> dict[str, Any]:
        decision = self.decision_for_tool(tool)
        return {
            "reason": decision.reason,
            "approval_type": decision.approval_type,
            "required_confirmations": decision.required_confirmations,
            "fail_closed": True,
        }
