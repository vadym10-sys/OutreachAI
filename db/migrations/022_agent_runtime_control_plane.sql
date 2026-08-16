-- Rollback:
-- DROP TABLE IF EXISTS agent_trace_events;
-- DROP TABLE IF EXISTS agent_approval_requests;
-- DROP TABLE IF EXISTS agent_tool_calls;
-- DROP TABLE IF EXISTS agent_steps;
-- DROP TABLE IF EXISTS agent_runs;

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  objective TEXT NOT NULL DEFAULT '',
  dry_run BOOLEAN NOT NULL DEFAULT false,
  plan_json JSONB NOT NULL DEFAULT '{}',
  current_step_index INTEGER NOT NULL DEFAULT 0,
  current_step_name VARCHAR(160) NOT NULL DEFAULT '',
  input_json JSONB NOT NULL DEFAULT '{}',
  output_json JSONB NOT NULL DEFAULT '{}',
  model VARCHAR(120) NOT NULL DEFAULT '',
  prompt_version VARCHAR(120) NOT NULL DEFAULT '',
  token_usage_json JSONB NOT NULL DEFAULT '{}',
  estimated_cost NUMERIC,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_category VARCHAR(80) NOT NULL DEFAULT '',
  idempotency_key VARCHAR(160) NOT NULL DEFAULT '',
  request_fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  CONSTRAINT ck_agent_runs_status CHECK (status IN ('queued', 'planning', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  title VARCHAR(160) NOT NULL DEFAULT '',
  tool_name VARCHAR(120) NOT NULL DEFAULT '',
  input_json JSONB NOT NULL DEFAULT '{}',
  output_json JSONB NOT NULL DEFAULT '{}',
  approval_state VARCHAR(32) NOT NULL DEFAULT 'none',
  model VARCHAR(120) NOT NULL DEFAULT '',
  prompt_version VARCHAR(120) NOT NULL DEFAULT '',
  token_usage_json JSONB NOT NULL DEFAULT '{}',
  estimated_cost NUMERIC,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_category VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  CONSTRAINT uq_agent_steps_run_index UNIQUE (run_id, step_index),
  CONSTRAINT ck_agent_steps_status CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'skipped')),
  CONSTRAINT ck_agent_steps_approval_state CHECK (approval_state IN ('none', 'pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES agent_steps(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  tool_name VARCHAR(120) NOT NULL,
  action_type VARCHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  arguments_json JSONB NOT NULL DEFAULT '{}',
  result_json JSONB NOT NULL DEFAULT '{}',
  approval_state VARCHAR(32) NOT NULL DEFAULT 'none',
  model VARCHAR(120) NOT NULL DEFAULT '',
  prompt_version VARCHAR(120) NOT NULL DEFAULT '',
  token_usage_json JSONB NOT NULL DEFAULT '{}',
  estimated_cost NUMERIC,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_category VARCHAR(80) NOT NULL DEFAULT '',
  idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_agent_tool_calls_action_type CHECK (action_type IN ('read_only', 'internal_write', 'external_side_effect')),
  CONSTRAINT ck_agent_tool_calls_status CHECK (status IN ('pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'blocked', 'skipped')),
  CONSTRAINT ck_agent_tool_calls_approval_state CHECK (approval_state IN ('none', 'pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS agent_approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES agent_steps(id) ON DELETE SET NULL,
  tool_call_id UUID REFERENCES agent_tool_calls(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  tool_name VARCHAR(120) NOT NULL,
  action_type VARCHAR(40) NOT NULL,
  approval_state VARCHAR(32) NOT NULL DEFAULT 'pending',
  tool_arguments_json JSONB NOT NULL DEFAULT '{}',
  decision_json JSONB NOT NULL DEFAULT '{}',
  idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
  requested_at TIMESTAMP NOT NULL DEFAULT now(),
  decided_at TIMESTAMP,
  decided_by_user_id VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_agent_approval_requests_action_type CHECK (action_type IN ('read_only', 'internal_write', 'external_side_effect')),
  CONSTRAINT ck_agent_approval_requests_approval_state CHECK (approval_state IN ('none', 'pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS agent_trace_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES agent_steps(id) ON DELETE SET NULL,
  tool_call_id UUID REFERENCES agent_tool_calls(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '',
  model VARCHAR(120) NOT NULL DEFAULT '',
  tool_name VARCHAR(120) NOT NULL DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  token_usage JSONB NOT NULL DEFAULT '{}',
  estimated_cost NUMERIC,
  approval_decision VARCHAR(32) NOT NULL DEFAULT '',
  error_category VARCHAR(80) NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  data_json JSONB NOT NULL DEFAULT '{}',
  untrusted_input BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_id
  ON agent_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_status_created
  ON agent_runs(workspace_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_workspace_idempotency
  ON agent_runs(workspace_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_agent_steps_workspace_id
  ON agent_steps(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_workspace_run
  ON agent_steps(workspace_id, run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_workspace_id
  ON agent_tool_calls(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_workspace_run
  ON agent_tool_calls(workspace_id, run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_workspace_tool
  ON agent_tool_calls(workspace_id, tool_name, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_tool_calls_idempotency
  ON agent_tool_calls(workspace_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_agent_approval_requests_workspace_id
  ON agent_approval_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_approval_requests_workspace_run
  ON agent_approval_requests(workspace_id, run_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_approval_requests_workspace_state
  ON agent_approval_requests(workspace_id, approval_state, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_approval_requests_idempotency
  ON agent_approval_requests(workspace_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_agent_trace_events_workspace_id
  ON agent_trace_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_workspace_run
  ON agent_trace_events(workspace_id, run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_workspace_tool
  ON agent_trace_events(workspace_id, tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_workspace_error
  ON agent_trace_events(workspace_id, error_category, created_at DESC);
