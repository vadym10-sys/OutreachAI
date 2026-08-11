CREATE TABLE IF NOT EXISTS billing_subscription_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  stripe_customer_id VARCHAR(128) NOT NULL,
  stripe_subscription_id VARCHAR(128) NOT NULL,
  stripe_schedule_id VARCHAR(128) NOT NULL DEFAULT '',
  from_plan VARCHAR(32) NOT NULL,
  to_plan VARCHAR(32) NOT NULL,
  billing_period VARCHAR(32) NOT NULL DEFAULT 'monthly',
  direction VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(160) NOT NULL,
  effective_at TIMESTAMP,
  stripe_event_created_at TIMESTAMP,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  canceled_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_subscription_transitions_workspace
  ON billing_subscription_transitions(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_subscription_transitions_subscription
  ON billing_subscription_transitions(stripe_subscription_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_subscription_transition_open
  ON billing_subscription_transitions(workspace_id, stripe_subscription_id)
  WHERE status IN ('pending', 'scheduled');

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_subscription_transition_idempotency_key
  ON billing_subscription_transitions(idempotency_key);
