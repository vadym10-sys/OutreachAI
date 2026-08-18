import { describe, expect, it } from "vitest";
import { buildAgentApprovalsPath, buildAgentRunsPath } from "@/lib/agent-runtime-api";
import {
  agentApprovalPageSchema,
  agentRunDetailSchema,
  agentRunPageSchema,
  agentRunTraceSchema,
  agentRuntimeStatusSchema,
  parseAgentRuntimeResponse
} from "@/lib/agent-runtime-contracts";

const now = "2026-08-18T10:00:00.000Z";
const run = {
  id: "run_1",
  workspace_id: "workspace_1",
  user_id: "user_1",
  status: "waiting_approval",
  objective: "Find companies safely.",
  dry_run: true,
  plan: {},
  current_step_index: 1,
  current_step_name: "Review",
  model: "test",
  prompt_version: "v1",
  token_usage: { total_tokens: 12 },
  estimated_cost: 0.001,
  latency_ms: 100,
  error_category: "",
  idempotency_key: "",
  created_at: now,
  updated_at: now,
  completed_at: null
};

const step = {
  id: "step_1",
  run_id: run.id,
  workspace_id: run.workspace_id,
  step_index: 0,
  status: "waiting_approval",
  title: "Send reviewed email",
  tool_name: "send_email",
  input: { email_id: "email_1" },
  output: {},
  approval_state: "pending",
  error_category: "",
  latency_ms: 0,
  created_at: now,
  updated_at: now,
  completed_at: null
};

const approval = {
  id: "approval_1",
  run_id: run.id,
  step_id: step.id,
  tool_call_id: "tool_call_1",
  workspace_id: run.workspace_id,
  user_id: run.user_id,
  tool_name: "send_email",
  action_type: "external_side_effect",
  approval_state: "pending",
  tool_arguments: { email_id: "email_1" },
  decision: { required_confirmations: ["manual_draft_approval", "separate_final_send_confirmation"] },
  idempotency_key: "",
  requested_at: now,
  decided_at: null,
  decided_by_user_id: ""
};

describe("Agent Runtime API contracts", () => {
  it("validates safe status, list, detail, approvals, and trace responses", () => {
    expect(parseAgentRuntimeResponse(agentRuntimeStatusSchema, {
      enabled: false,
      can_create_runs: false,
      force_dry_run: true,
      registered_tools_count: 9,
      future_field: true
    }, "status").registered_tools_count).toBe(9);
    expect(parseAgentRuntimeResponse(agentRunPageSchema, {
      runs: [run],
      next_cursor: "cursor",
      has_more: true,
      limit: 1
    }, "runs").runs[0].status).toBe("waiting_approval");
    expect(parseAgentRuntimeResponse(agentRunDetailSchema, {
      run,
      steps: [step],
      approvals: [approval]
    }, "detail").approvals[0].tool_name).toBe("send_email");
    expect(parseAgentRuntimeResponse(agentApprovalPageSchema, {
      approvals: [approval],
      next_cursor: "",
      has_more: false,
      limit: 20
    }, "approvals").approvals[0].approval_state).toBe("pending");
    expect(parseAgentRuntimeResponse(agentRunTraceSchema, {
      run,
      trace: [{
        id: "trace_1",
        run_id: run.id,
        step_id: step.id,
        tool_call_id: null,
        workspace_id: run.workspace_id,
        user_id: run.user_id,
        event_type: "tool.succeeded",
        status: "succeeded",
        model: "",
        tool_name: "search_companies",
        latency_ms: 2,
        token_usage: {},
        estimated_cost: null,
        approval_decision: "",
        error_category: "",
        message: "",
        data: { body: "[REDACTED_CONTENT]" },
        untrusted_input: true,
        created_at: now
      }]
    }, "trace").trace[0].untrusted_input).toBe(true);
  });

  it("rejects incompatible responses and clamps list limits", () => {
    expect(() => parseAgentRuntimeResponse(agentRunPageSchema, {
      runs: [{ ...run, status: "sent" }],
      next_cursor: "",
      has_more: false,
      limit: 20
    }, "runs")).toThrow(/status/);
    expect(buildAgentRunsPath({ status: "completed", cursor: "abc", limit: 500 })).toBe("/api/workspace-app/agent-runs?status=completed&cursor=abc&limit=50");
    expect(buildAgentApprovalsPath({ status: "approved", limit: 0 })).toBe("/api/workspace-app/agent-runs/approvals?status=approved&limit=20");
  });
});
