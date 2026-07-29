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

CREATE TABLE IF NOT EXISTS ai_memory_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
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

-- Rollback:
-- DROP INDEX IF EXISTS idx_ai_memory_entries_embedding;
-- DROP TABLE IF EXISTS ai_memory_audit_logs;
-- DROP TABLE IF EXISTS ai_memory_entries;
-- DROP TABLE IF EXISTS ai_memory_settings;
-- Do not drop EXTENSION vector automatically; it may be shared by other services.
