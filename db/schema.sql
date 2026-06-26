CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id VARCHAR(128) UNIQUE NOT NULL,
  email VARCHAR(320) NOT NULL,
  name VARCHAR(160),
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(128),
  stripe_subscription_id VARCHAR(128),
  plan VARCHAR(32) NOT NULL DEFAULT 'Starter',
  status VARCHAR(64) NOT NULL DEFAULT 'trialing',
  current_period_end TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(220) NOT NULL,
  industry VARCHAR(160) NOT NULL DEFAULT '',
  countries JSONB NOT NULL DEFAULT '[]',
  cities JSONB NOT NULL DEFAULT '[]',
  company_size VARCHAR(80),
  keywords JSONB NOT NULL DEFAULT '[]',
  website_filters JSONB NOT NULL DEFAULT '[]',
  language VARCHAR(80) NOT NULL DEFAULT 'English',
  offer TEXT NOT NULL DEFAULT '',
  cta VARCHAR(220) NOT NULL DEFAULT 'Book a quick call',
  email_tone VARCHAR(80) NOT NULL DEFAULT 'Professional',
  signature TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'Draft',
  schedule_at TIMESTAMP,
  follow_up_days INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  company VARCHAR(220) NOT NULL,
  website VARCHAR(500),
  industry VARCHAR(160),
  country VARCHAR(120),
  city VARCHAR(120),
  contact VARCHAR(160),
  email VARCHAR(320),
  phone VARCHAR(80),
  linkedin VARCHAR(500),
  niche VARCHAR(120),
  status VARCHAR(32) NOT NULL DEFAULT 'New',
  notes TEXT,
  revenue NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_lead_email UNIQUE (user_id, email)
);

CREATE TABLE IF NOT EXISTS website_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  niche VARCHAR(120),
  services JSONB NOT NULL DEFAULT '{}',
  strengths JSONB NOT NULL DEFAULT '{}',
  weaknesses JSONB NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction VARCHAR(16) NOT NULL,
  subject VARCHAR(300) NOT NULL,
  preview VARCHAR(500) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  cta VARCHAR(220) NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  value NUMERIC,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128),
  action VARCHAR(128) NOT NULL,
  ip_address VARCHAR(64),
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'info',
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) UNIQUE NOT NULL,
  workspace VARCHAR(180) NOT NULL DEFAULT 'Outreach workspace',
  company VARCHAR(180) NOT NULL DEFAULT '',
  avatar_url VARCHAR(500),
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  language VARCHAR(80) NOT NULL DEFAULT 'English',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) UNIQUE NOT NULL,
  general JSONB NOT NULL DEFAULT '{}',
  ai JSONB NOT NULL DEFAULT '{}',
  email JSONB NOT NULL DEFAULT '{}',
  billing JSONB NOT NULL DEFAULT '{}',
  security JSONB NOT NULL DEFAULT '{}',
  api JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user_event ON analytics_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_audit_user_action ON audit_logs(user_id, action);

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_profiles_user_id ON workspace_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_user_id ON app_settings(user_id);
