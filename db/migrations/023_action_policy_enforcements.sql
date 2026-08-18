-- Rollback:
-- DROP TABLE IF EXISTS action_policy_enforcements;

CREATE TABLE IF NOT EXISTS action_policy_enforcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL DEFAULT '',
  delegated_by_user_id VARCHAR(128) NOT NULL DEFAULT '',
  delegation_type VARCHAR(80) NOT NULL DEFAULT '',
  delegation_evidence_id VARCHAR(160) NOT NULL DEFAULT '',
  delegation_fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  action_name VARCHAR(160) NOT NULL,
  action_type VARCHAR(40) NOT NULL,
  resource_id VARCHAR(160) NOT NULL DEFAULT '',
  required_permissions_json JSONB NOT NULL DEFAULT '[]',
  approval_state VARCHAR(32) NOT NULL DEFAULT 'none',
  approval_fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  request_fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
  dry_run BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(32) NOT NULL DEFAULT 'started',
  execution_claim_token VARCHAR(128) NOT NULL DEFAULT '',
  claim_expires_at TIMESTAMP,
  result_json JSONB NOT NULL DEFAULT '{}',
  error_category VARCHAR(80) NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  CONSTRAINT ck_action_policy_enforcements_actor_type CHECK (actor_type IN ('human', 'ai', 'worker', 'system')),
  CONSTRAINT ck_action_policy_enforcements_action_type CHECK (action_type IN ('read_only', 'internal_write', 'external_side_effect')),
  CONSTRAINT ck_action_policy_enforcements_status CHECK (status IN ('started', 'succeeded', 'failed', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_action_policy_enforcements_workspace_action
  ON action_policy_enforcements(workspace_id, action_name, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_action_policy_enforcements_idempotency
  ON action_policy_enforcements(workspace_id, idempotency_key)
  WHERE idempotency_key <> '';

ALTER TABLE action_policy_enforcements
  ADD COLUMN IF NOT EXISTS delegated_by_user_id VARCHAR(128) NOT NULL DEFAULT '';

ALTER TABLE action_policy_enforcements
  ADD COLUMN IF NOT EXISTS delegation_type VARCHAR(80) NOT NULL DEFAULT '';

ALTER TABLE action_policy_enforcements
  ADD COLUMN IF NOT EXISTS delegation_evidence_id VARCHAR(160) NOT NULL DEFAULT '';

ALTER TABLE action_policy_enforcements
  ADD COLUMN IF NOT EXISTS delegation_fingerprint VARCHAR(128) NOT NULL DEFAULT '';

ALTER TABLE action_policy_enforcements
  ADD COLUMN IF NOT EXISTS execution_claim_token VARCHAR(128) NOT NULL DEFAULT '';

ALTER TABLE action_policy_enforcements
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMP;
