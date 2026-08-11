ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_event_created_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_status_customer
  ON subscriptions(workspace_id, status, stripe_customer_id);

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_count
  FROM (
    SELECT stripe_subscription_id
    FROM subscriptions
    WHERE stripe_subscription_id IS NOT NULL
      AND stripe_subscription_id <> ''
    GROUP BY stripe_subscription_id
    HAVING COUNT(*) > 1
  ) duplicate_stripe_subscription_ids;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'migration 019 aborted: % duplicate nonempty stripe_subscription_id values exist; resolve duplicate Subscription rows before creating uq_subscriptions_stripe_subscription_id', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_stripe_subscription_id
  ON subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> '';
