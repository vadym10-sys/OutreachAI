-- Rollback:
-- DROP TABLE IF EXISTS plan_usage_reservations;

CREATE TABLE IF NOT EXISTS plan_usage_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period VARCHAR(7) NOT NULL,
  metric VARCHAR(32) NOT NULL,
  amount INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'reserved',
  idempotency_key VARCHAR(160) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  finalized_at TIMESTAMP,
  released_at TIMESTAMP,
  release_reason VARCHAR(240) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_plan_usage_reservations_amount_positive CHECK (amount > 0),
  CONSTRAINT uq_plan_usage_reservation_idempotency UNIQUE (workspace_id, period, metric, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_plan_usage_reservations_workspace_id
  ON plan_usage_reservations(workspace_id);

CREATE INDEX IF NOT EXISTS idx_plan_usage_reservations_active
  ON plan_usage_reservations(workspace_id, period, metric, status, expires_at);
