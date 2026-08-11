ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_event_created_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_status_customer
  ON subscriptions(workspace_id, status, stripe_customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_stripe_subscription_id
  ON subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> '';
