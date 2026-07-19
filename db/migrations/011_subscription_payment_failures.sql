ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_payment_error VARCHAR(500);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_decline_code VARCHAR(120);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_failure_message TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_payment_failed_at TIMESTAMP;
