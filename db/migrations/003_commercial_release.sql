CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leadstatus') THEN
    ALTER TYPE leadstatus ADD VALUE IF NOT EXISTS 'contacted';
    ALTER TYPE leadstatus ADD VALUE IF NOT EXISTS 'interested';
    ALTER TYPE leadstatus ADD VALUE IF NOT EXISTS 'archive';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id VARCHAR(128) NOT NULL,
  name VARCHAR(180) NOT NULL DEFAULT 'Outreach workspace',
  company VARCHAR(180) NOT NULL DEFAULT '',
  industry VARCHAR(160) NOT NULL DEFAULT '',
  target_country VARCHAR(120) NOT NULL DEFAULT '',
  target_customer VARCHAR(240) NOT NULL DEFAULT '',
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  language VARCHAR(80) NOT NULL DEFAULT 'English',
  onboarding_step INTEGER NOT NULL DEFAULT 1,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  email VARCHAR(320) NOT NULL DEFAULT '',
  role VARCHAR(32) NOT NULL DEFAULT 'Member',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_member_user UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period VARCHAR(7) NOT NULL,
  leads INTEGER NOT NULL DEFAULT 0,
  ai_generations INTEGER NOT NULL DEFAULT 0,
  email_sends INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_usage_period UNIQUE (workspace_id, period)
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'UTC';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE website_analyses ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE workspace_profiles ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS campaign_sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(300) NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  delay_days INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_campaign_sequence_step UNIQUE (campaign_id, step_order)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leadstatus') THEN
    UPDATE leads SET status = 'qualified' WHERE status::text = 'email_generated';
    UPDATE leads SET status = 'contacted' WHERE status::text IN ('sent', 'opened');
    UPDATE leads SET status = 'interested' WHERE status::text = 'replied';
  ELSE
    UPDATE leads SET status = 'Qualified' WHERE status = 'Email Generated';
    UPDATE leads SET status = 'Contacted' WHERE status IN ('Sent', 'Opened');
    UPDATE leads SET status = 'Interested' WHERE status = 'Replied';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_counters_workspace_id ON usage_counters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_workspace_id ON leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_website_analyses_workspace_id ON website_analyses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_id ON email_messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_workspace_id ON analytics_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_id ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_id ON campaign_sequences(campaign_id);
