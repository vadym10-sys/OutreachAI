ALTER TABLE website_analyses
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS company VARCHAR(220) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS industry VARCHAR(160),
  ADD COLUMN IF NOT EXISTS location VARCHAR(160),
  ADD COLUMN IF NOT EXISTS products_services JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS technologies JSONB NOT NULL DEFAULT '[]';

ALTER TABLE website_analyses
  ALTER COLUMN lead_id DROP NOT NULL,
  ALTER COLUMN services SET DEFAULT '[]',
  ALTER COLUMN strengths SET DEFAULT '[]',
  ALTER COLUMN weaknesses SET DEFAULT '[]';

UPDATE website_analyses
SET user_id = leads.user_id
FROM leads
WHERE website_analyses.lead_id = leads.id
  AND website_analyses.user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_website_analyses_user_id ON website_analyses(user_id);

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS follow_up_1 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS follow_up_2 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(40) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reply_body TEXT,
  ADD COLUMN IF NOT EXISTS reply_assistant JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_email_messages_provider_message_id ON email_messages(provider_message_id);
