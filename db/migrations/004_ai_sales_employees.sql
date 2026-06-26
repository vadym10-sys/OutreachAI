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

ALTER TABLE leads ADD COLUMN IF NOT EXISTS sales_employee_id UUID REFERENCES ai_sales_employees(id) ON DELETE SET NULL;

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

CREATE INDEX IF NOT EXISTS idx_ai_sales_employees_workspace_id ON ai_sales_employees(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_employees_user_id ON ai_sales_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_sales_employee_id ON leads(sales_employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_lead_insights_employee_id ON sales_employee_lead_insights(sales_employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_lead_insights_lead_id ON sales_employee_lead_insights(lead_id);
