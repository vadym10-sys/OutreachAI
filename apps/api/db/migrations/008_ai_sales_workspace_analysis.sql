CREATE TABLE IF NOT EXISTS ai_sales_workspace_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  user_id VARCHAR(128) NOT NULL,
  provider VARCHAR(80) NOT NULL DEFAULT 'openai',
  model VARCHAR(120) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  analysis_json JSONB NOT NULL DEFAULT '{}',
  evidence_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_sales_workspace_company UNIQUE (workspace_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_sales_workspace_workspace_id ON ai_sales_workspace_analyses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_workspace_company_id ON ai_sales_workspace_analyses(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_workspace_lead_id ON ai_sales_workspace_analyses(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_workspace_user_id ON ai_sales_workspace_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_sales_workspace_updated_at ON ai_sales_workspace_analyses(updated_at);
