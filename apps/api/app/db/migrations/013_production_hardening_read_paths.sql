CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_direction_created_id
  ON email_messages(workspace_id, direction, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_lead_created_id
  ON email_messages(workspace_id, lead_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_workspace_company_created_id
  ON contacts(workspace_id, company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_workspace_company_created_id
  ON deals(workspace_id, company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_workspace_company_created_id
  ON notes(workspace_id, company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_workspace_lead_created_id
  ON audit_logs(workspace_id, (metadata_json->>'lead_id'), created_at DESC, id DESC);
