CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS vector;
      RAISE NOTICE 'AI Memory pgvector extension is installed or already available.';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'AI Memory optional pgvector setup skipped: insufficient privilege to CREATE EXTENSION vector.';
      WHEN undefined_file THEN
        RAISE NOTICE 'AI Memory optional pgvector setup skipped: vector extension files are not installed.';
    END;
  ELSE
    RAISE NOTICE 'AI Memory optional pgvector setup skipped: vector is not listed in pg_available_extensions.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id VARCHAR(128) UNIQUE NOT NULL,
  email VARCHAR(320) NOT NULL,
  name VARCHAR(160),
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id VARCHAR(128) NOT NULL,
  name VARCHAR(180) NOT NULL DEFAULT 'Outreach workspace',
  company VARCHAR(180) NOT NULL DEFAULT '',
  industry VARCHAR(160) NOT NULL DEFAULT '',
  target_country VARCHAR(120) NOT NULL DEFAULT '',
  target_customer VARCHAR(240) NOT NULL DEFAULT '',
  offer TEXT NOT NULL DEFAULT '',
  cta VARCHAR(220) NOT NULL DEFAULT 'Book a quick call',
  tone VARCHAR(80) NOT NULL DEFAULT 'Professional',
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  language VARCHAR(80) NOT NULL DEFAULT 'English',
  onboarding_step INTEGER NOT NULL DEFAULT 1,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
  CONSTRAINT uq_workspaces_owner_user_id UNIQUE (owner_user_id)
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

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(128),
  stripe_subscription_id VARCHAR(128),
  plan VARCHAR(32) NOT NULL DEFAULT 'Starter',
  status VARCHAR(64) NOT NULL DEFAULT 'trialing',
  trial_end TIMESTAMP,
  current_period_end TIMESTAMP,
  plan_limits JSONB NOT NULL DEFAULT '{}',
  stripe_event_created_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

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
  metadata_json JSONB NOT NULL DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
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
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS ai_sales_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  role VARCHAR(160) NOT NULL DEFAULT 'AI Sales Development Representative',
  product_service TEXT NOT NULL DEFAULT '',
  target_customer VARCHAR(240) NOT NULL DEFAULT '',
  target_countries JSONB NOT NULL DEFAULT '[]',
  target_industries JSONB NOT NULL DEFAULT '[]',
  offer TEXT NOT NULL DEFAULT '',
  cta VARCHAR(220) NOT NULL DEFAULT 'Book a quick call',
  sending_mode VARCHAR(32) NOT NULL DEFAULT 'Review Mode',
  daily_limit INTEGER NOT NULL DEFAULT 25,
  working_hours VARCHAR(80) NOT NULL DEFAULT '09:00-17:00',
  tone VARCHAR(80) NOT NULL DEFAULT 'Professional',
  language VARCHAR(80) NOT NULL DEFAULT 'English',
  signature TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  strict_limits JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  sales_employee_id UUID REFERENCES ai_sales_employees(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  name VARCHAR(220) NOT NULL,
  website VARCHAR(500),
  domain VARCHAR(220),
  phone VARCHAR(80),
  email VARCHAR(320),
  address VARCHAR(500),
  city VARCHAR(120),
  country VARCHAR(120),
  industry VARCHAR(160),
  google_rating NUMERIC,
  place_id VARCHAR(160),
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  ai_summary TEXT NOT NULL DEFAULT '',
  suggested_offer TEXT NOT NULL DEFAULT '',
  outreach_strategy TEXT NOT NULL DEFAULT '',
  sales_angle TEXT NOT NULL DEFAULT '',
  expected_reply_rate VARCHAR(80) NOT NULL DEFAULT '',
  email_status VARCHAR(80) NOT NULL DEFAULT 'Not prepared',
  crm_stage VARCHAR(80) NOT NULL DEFAULT 'New Lead',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  name VARCHAR(180) NOT NULL DEFAULT '',
  title VARCHAR(180) NOT NULL DEFAULT '',
  email VARCHAR(320),
  phone VARCHAR(80),
  linkedin VARCHAR(500),
  confidence VARCHAR(80) NOT NULL DEFAULT '',
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  email_status VARCHAR(80) NOT NULL DEFAULT 'Unknown',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  name VARCHAR(220) NOT NULL,
  stage VARCHAR(80) NOT NULL DEFAULT 'New Lead',
  value NUMERIC NOT NULL DEFAULT 0,
  probability INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  next_step TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  kind VARCHAR(80) NOT NULL DEFAULT 'note',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_employee_lead_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sales_employee_id UUID NOT NULL REFERENCES ai_sales_employees(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  industry VARCHAR(160) NOT NULL DEFAULT '',
  services JSONB NOT NULL DEFAULT '[]',
  pain_points JSONB NOT NULL DEFAULT '[]',
  icp_score INTEGER NOT NULL DEFAULT 0,
  purchase_probability INTEGER NOT NULL DEFAULT 0,
  best_sales_angle TEXT NOT NULL DEFAULT '',
  best_cta VARCHAR(220) NOT NULL DEFAULT '',
  recommended_plan VARCHAR(120) NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_sales_employee_lead_insight UNIQUE (sales_employee_id, lead_id)
);

CREATE TABLE IF NOT EXISTS website_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  company VARCHAR(220) NOT NULL DEFAULT '',
  website VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  industry VARCHAR(160),
  location VARCHAR(160),
  niche VARCHAR(120),
  products_services JSONB NOT NULL DEFAULT '[]',
  services JSONB NOT NULL DEFAULT '[]',
  technologies JSONB NOT NULL DEFAULT '[]',
  strengths JSONB NOT NULL DEFAULT '[]',
  weaknesses JSONB NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction VARCHAR(16) NOT NULL,
  subject VARCHAR(300) NOT NULL,
  recipient_email VARCHAR(320),
  preview VARCHAR(500) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  cta VARCHAR(220) NOT NULL DEFAULT '',
  follow_up_1 TEXT NOT NULL DEFAULT '',
  follow_up_2 TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '{}',
  provider_message_id VARCHAR(160),
  delivery_status VARCHAR(40) NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  bounced_at TIMESTAMP,
  replied_at TIMESTAMP,
  reply_body TEXT,
  reply_assistant JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  value NUMERIC,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  action VARCHAR(128) NOT NULL,
  ip_address VARCHAR(64),
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_memory_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  max_items INTEGER NOT NULL DEFAULT 12,
  max_characters INTEGER NOT NULL DEFAULT 6000,
  relevance_threshold NUMERIC NOT NULL DEFAULT 0.18,
  retention_days INTEGER NOT NULL DEFAULT 365,
  embeddings_enabled BOOLEAN NOT NULL DEFAULT true,
  pgvector_available BOOLEAN NOT NULL DEFAULT false,
  embedding_provider VARCHAR(80) NOT NULL DEFAULT '',
  embedding_model VARCHAR(120) NOT NULL DEFAULT '',
  last_retrieval_mode VARCHAR(20) NOT NULL DEFAULT 'none',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_memory_settings_workspace UNIQUE (workspace_id)
);

CREATE TABLE IF NOT EXISTS ai_memory_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  memory_type VARCHAR(40) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  summary VARCHAR(500) NOT NULL DEFAULT '',
  source VARCHAR(120) NOT NULL DEFAULT '',
  source_id VARCHAR(160) NOT NULL DEFAULT '',
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email_id UUID REFERENCES email_messages(id) ON DELETE SET NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  trust_level VARCHAR(40) NOT NULL DEFAULT 'untrusted',
  verified BOOLEAN NOT NULL DEFAULT false,
  approved_by_user BOOLEAN NOT NULL DEFAULT false,
  confidence INTEGER NOT NULL DEFAULT 50,
  dedupe_hash VARCHAR(128) NOT NULL,
  keywords JSONB NOT NULL DEFAULT '[]',
  embedding_json JSONB NOT NULL DEFAULT '[]',
  embedding_status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
  expires_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_memory_workspace_dedupe UNIQUE (workspace_id, dedupe_hash)
);

CREATE TABLE IF NOT EXISTS ai_memory_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  memory_entry_id UUID REFERENCES ai_memory_entries(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'ai_memory_entries'
          AND column_name = 'embedding'
      ) THEN
        ALTER TABLE ai_memory_entries ADD COLUMN embedding vector(1536);
      END IF;
      RAISE NOTICE 'AI Memory pgvector column is available.';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'AI Memory optional pgvector column skipped: insufficient privilege.';
      WHEN undefined_file THEN
        RAISE NOTICE 'AI Memory optional pgvector column skipped: vector type is unavailable.';
    END;
  ELSE
    RAISE NOTICE 'AI Memory pgvector column skipped: vector extension is not installed.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL DEFAULT 'info',
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(128) UNIQUE NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
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
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  general JSONB NOT NULL DEFAULT '{}',
  ai JSONB NOT NULL DEFAULT '{}',
  email JSONB NOT NULL DEFAULT '{}',
  billing JSONB NOT NULL DEFAULT '{}',
  security JSONB NOT NULL DEFAULT '{}',
  api JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_counters_workspace_id ON usage_counters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_status_customer ON subscriptions(workspace_id, status, stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> '';
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_id ON email_messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_direction_created ON email_messages(workspace_id, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_direction_created_id ON email_messages(workspace_id, direction, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_lead_created ON email_messages(workspace_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_lead_created_id ON email_messages(workspace_id, lead_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_message_id ON email_messages(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user_event ON analytics_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_audit_user_action ON audit_logs(user_id, action);
CREATE INDEX IF NOT EXISTS idx_ai_memory_settings_workspace_id ON ai_memory_settings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_settings_user_id ON ai_memory_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_entries_workspace_type_created ON ai_memory_entries(workspace_id, memory_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memory_entries_workspace_entity ON ai_memory_entries(workspace_id, company_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_entries_active ON ai_memory_entries(workspace_id, deleted_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_memory_entries_source ON ai_memory_entries(workspace_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_audit_workspace_action ON ai_memory_audit_logs(workspace_id, action, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'ai_memory_entries'
        AND column_name = 'embedding'
    ) THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_ai_memory_entries_embedding
        ON ai_memory_entries
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
      RAISE NOTICE 'AI Memory pgvector index is available.';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'AI Memory optional pgvector index skipped: insufficient privilege.';
      WHEN undefined_file THEN
        RAISE NOTICE 'AI Memory optional pgvector index skipped: vector operator class is unavailable.';
    END;
  ELSE
    RAISE NOTICE 'AI Memory pgvector index skipped: vector extension or embedding column is unavailable.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_workspace_id ON leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_companies_workspace_updated ON companies(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_workspace_lead_id ON companies(workspace_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_company_created ON contacts(workspace_id, company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_company_created_id ON contacts(workspace_id, company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deals_workspace_company_created ON deals(workspace_id, company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_workspace_company_created_id ON deals(workspace_id, company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_company_created ON notes(workspace_id, company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_company_created_id ON notes(workspace_id, company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_website_analyses_user_id ON website_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_website_analyses_workspace_id ON website_analyses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_website_analyses_workspace_lead_created ON website_analyses(workspace_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_profiles_user_id ON workspace_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_user_id ON app_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_id ON campaign_sequences(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_employees_workspace_id ON ai_sales_employees(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_employees_user_id ON ai_sales_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_sales_employee_id ON leads(sales_employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_lead_insights_employee_id ON sales_employee_lead_insights(sales_employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_lead_insights_lead_id ON sales_employee_lead_insights(lead_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_workspace_id ON analytics_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_id ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_lead_created_id ON audit_logs(workspace_id, (metadata_json->>'lead_id'), created_at DESC, id DESC);
