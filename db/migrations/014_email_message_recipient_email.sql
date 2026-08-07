ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(320);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_recipient_email
  ON email_messages(workspace_id, recipient_email);
