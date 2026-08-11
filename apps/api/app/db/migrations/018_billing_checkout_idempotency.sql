CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  stripe_customer_id VARCHAR(128) NOT NULL DEFAULT '',
  stripe_session_id VARCHAR(128) NOT NULL DEFAULT '',
  stripe_session_url TEXT NOT NULL DEFAULT '',
  plan VARCHAR(32) NOT NULL DEFAULT 'Starter',
  billing_period VARCHAR(32) NOT NULL DEFAULT 'monthly',
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_workspace_user
  ON billing_checkout_sessions(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_session
  ON billing_checkout_sessions(stripe_session_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_checkout_open_lifecycle
  ON billing_checkout_sessions(workspace_id, user_id, plan, billing_period)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_checkout_stripe_session_id
  ON billing_checkout_sessions(stripe_session_id)
  WHERE stripe_session_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_checkout_idempotency_key
  ON billing_checkout_sessions(idempotency_key);
