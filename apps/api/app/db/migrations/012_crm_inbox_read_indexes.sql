CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_direction_created
  ON email_messages(workspace_id, direction, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_direction_created_id
  ON email_messages(workspace_id, direction, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_lead_created
  ON email_messages(workspace_id, lead_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_lead_created_id
  ON email_messages(workspace_id, lead_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_workspace_updated
  ON companies(workspace_id, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_workspace_lead_id
  ON companies(workspace_id, lead_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_workspace_company_created
  ON contacts(workspace_id, company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_workspace_company_created
  ON deals(workspace_id, company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_workspace_company_created
  ON notes(workspace_id, company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_website_analyses_workspace_lead_created
  ON website_analyses(workspace_id, lead_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_workspace_created
  ON audit_logs(workspace_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_workspace_lead_created_id
  ON audit_logs(workspace_id, (metadata_json->>'lead_id'), created_at DESC, id DESC);
