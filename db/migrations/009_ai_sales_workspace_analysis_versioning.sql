ALTER TABLE ai_sales_workspace_analyses
ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;

UPDATE ai_sales_workspace_analyses
SET version_number = CASE
  WHEN NULLIF(TRIM(analysis_json->>'version'), '') IS NOT NULL THEN GREATEST(1, (analysis_json->>'version')::INTEGER)
  ELSE 1
END;

ALTER TABLE ai_sales_workspace_analyses
DROP CONSTRAINT IF EXISTS uq_ai_sales_workspace_company;

ALTER TABLE ai_sales_workspace_analyses
ADD CONSTRAINT uq_ai_sales_workspace_company_version UNIQUE (workspace_id, company_id, version_number);

CREATE INDEX IF NOT EXISTS idx_ai_sales_workspace_company_version
ON ai_sales_workspace_analyses(workspace_id, company_id, version_number DESC);