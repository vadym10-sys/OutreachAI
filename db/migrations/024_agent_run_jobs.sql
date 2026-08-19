-- Rollback:
-- DROP TABLE IF EXISTS agent_run_jobs;

CREATE TABLE IF NOT EXISTS agent_run_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  operation VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMP NOT NULL DEFAULT now(),
  locked_by VARCHAR(120) NOT NULL DEFAULT '',
  claim_token VARCHAR(128) NOT NULL DEFAULT '',
  locked_at TIMESTAMP,
  lease_expires_at TIMESTAMP,
  request_id VARCHAR(160) NOT NULL DEFAULT '',
  error_category VARCHAR(80) NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  CONSTRAINT ck_agent_run_jobs_operation CHECK (operation IN ('start', 'resume')),
  CONSTRAINT ck_agent_run_jobs_status CHECK (status IN ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_agent_run_jobs_workspace_id
  ON agent_run_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_jobs_workspace_status
  ON agent_run_jobs(workspace_id, status, available_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_run_jobs_run_operation
  ON agent_run_jobs(run_id, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_jobs_claim_token
  ON agent_run_jobs(claim_token);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_jobs_active_operation
  ON agent_run_jobs(workspace_id, run_id, operation)
  WHERE status IN ('queued', 'running', 'retrying');
