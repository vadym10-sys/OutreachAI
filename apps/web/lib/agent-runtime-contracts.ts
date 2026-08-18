import { z } from "zod";

const recordSchema = z.record(z.unknown());

export const agentRunStatusSchema = z.enum([
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled"
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentApprovalStateSchema = z.enum(["none", "pending", "approved", "rejected"]);
export type AgentApprovalState = z.infer<typeof agentApprovalStateSchema>;

export const agentStepStatusSchema = z.enum(["queued", "running", "waiting_approval", "completed", "failed", "skipped"]);
export type AgentStepStatus = z.infer<typeof agentStepStatusSchema>;

export const agentRunSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  user_id: z.string(),
  status: agentRunStatusSchema,
  objective: z.string(),
  dry_run: z.boolean(),
  plan: recordSchema,
  current_step_index: z.number(),
  current_step_name: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  token_usage: recordSchema,
  estimated_cost: z.number().nullable(),
  latency_ms: z.number(),
  error_category: z.string(),
  idempotency_key: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable()
}).passthrough();
export type AgentRun = z.infer<typeof agentRunSchema>;

export const agentStepSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  workspace_id: z.string(),
  step_index: z.number(),
  status: agentStepStatusSchema,
  title: z.string(),
  tool_name: z.string(),
  input: recordSchema,
  output: recordSchema,
  approval_state: agentApprovalStateSchema,
  error_category: z.string(),
  latency_ms: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable()
}).passthrough();
export type AgentStep = z.infer<typeof agentStepSchema>;

export const agentApprovalRequestSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_id: z.string().nullable(),
  tool_call_id: z.string().nullable(),
  workspace_id: z.string(),
  user_id: z.string(),
  tool_name: z.string(),
  action_type: z.string(),
  approval_state: z.enum(["pending", "approved", "rejected", "none"]),
  tool_arguments: recordSchema,
  decision: recordSchema,
  idempotency_key: z.string(),
  requested_at: z.string(),
  decided_at: z.string().nullable(),
  decided_by_user_id: z.string()
}).passthrough();
export type AgentApprovalRequest = z.infer<typeof agentApprovalRequestSchema>;

export const agentTraceEventSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_id: z.string().nullable(),
  tool_call_id: z.string().nullable(),
  workspace_id: z.string(),
  user_id: z.string(),
  event_type: z.string(),
  status: z.string(),
  model: z.string(),
  tool_name: z.string(),
  latency_ms: z.number(),
  token_usage: recordSchema,
  estimated_cost: z.number().nullable(),
  approval_decision: z.string(),
  error_category: z.string(),
  message: z.string(),
  data: recordSchema,
  untrusted_input: z.boolean(),
  created_at: z.string()
}).passthrough();
export type AgentTraceEvent = z.infer<typeof agentTraceEventSchema>;

export const agentRunDetailSchema = z.object({
  run: agentRunSchema,
  steps: z.array(agentStepSchema),
  approvals: z.array(agentApprovalRequestSchema)
}).passthrough();
export type AgentRunDetail = z.infer<typeof agentRunDetailSchema>;

export const agentRuntimeStatusSchema = z.object({
  enabled: z.boolean(),
  can_create_runs: z.boolean(),
  registered_tools_count: z.number()
}).passthrough();
export type AgentRuntimeStatus = z.infer<typeof agentRuntimeStatusSchema>;

export const agentRunPageSchema = z.object({
  runs: z.array(agentRunSchema),
  next_cursor: z.string(),
  has_more: z.boolean(),
  limit: z.number()
}).passthrough();
export type AgentRunPage = z.infer<typeof agentRunPageSchema>;

export const agentApprovalPageSchema = z.object({
  approvals: z.array(agentApprovalRequestSchema),
  next_cursor: z.string(),
  has_more: z.boolean(),
  limit: z.number()
}).passthrough();
export type AgentApprovalPage = z.infer<typeof agentApprovalPageSchema>;

export const agentRunTraceSchema = z.object({
  run: agentRunSchema,
  trace: z.array(agentTraceEventSchema)
}).passthrough();
export type AgentRunTrace = z.infer<typeof agentRunTraceSchema>;

export function parseAgentRuntimeResponse<T>(schema: z.ZodType<T>, value: unknown, label = "AI Tasks"): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} response did not match the expected contract: ${parsed.error.message}`);
  }
  return parsed.data;
}
