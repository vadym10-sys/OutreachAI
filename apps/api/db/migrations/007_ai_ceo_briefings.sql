CREATE TABLE IF NOT EXISTS ai_ceo_briefings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  length VARCHAR(20) NOT NULL DEFAULT '1 min',
  language VARCHAR(40) NOT NULL DEFAULT 'English',
  title VARCHAR(180) NOT NULL DEFAULT 'AI CEO Daily Report',
  transcript TEXT NOT NULL DEFAULT '',
  summary_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_ceo_briefings_workspace_id ON ai_ceo_briefings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_ceo_briefings_user_id ON ai_ceo_briefings(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_ceo_briefings_created_at ON ai_ceo_briefings(created_at);
