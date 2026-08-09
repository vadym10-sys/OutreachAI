CREATE TABLE IF NOT EXISTS test_entitlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  user_email VARCHAR(320) NOT NULL DEFAULT '',
  plan VARCHAR(32) NOT NULL DEFAULT 'Starter',
  reason TEXT NOT NULL,
  granted_by_user_id VARCHAR(128) NOT NULL,
  granted_by_email VARCHAR(320) NOT NULL DEFAULT '',
  granted_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  revoked_by_user_id VARCHAR(128),
  revoked_by_email VARCHAR(320),
  revoke_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_entitlements_workspace_user
  ON test_entitlements(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_test_entitlements_active_lookup
  ON test_entitlements(workspace_id, user_id, expires_at, revoked_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_test_entitlements_one_unrevoked
  ON test_entitlements(workspace_id, user_id)
  WHERE revoked_at IS NULL;
