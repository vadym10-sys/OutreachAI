CREATE TABLE IF NOT EXISTS ai_customer_finder_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  request_id VARCHAR(80) NOT NULL,
  criteria_json JSONB NOT NULL DEFAULT '{}',
  progress_json JSONB NOT NULL DEFAULT '{}',
  summary_json JSONB NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL DEFAULT '',
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  locked_by VARCHAR(120) NOT NULL DEFAULT '',
  locked_at TIMESTAMP,
  run_after TIMESTAMP NOT NULL DEFAULT now(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_customer_finder_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  job_id UUID NOT NULL REFERENCES ai_customer_finder_jobs(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  company_name VARCHAR(220) NOT NULL,
  official_website VARCHAR(500) NOT NULL DEFAULT '',
  domain VARCHAR(220) NOT NULL DEFAULT '',
  industry VARCHAR(160) NOT NULL DEFAULT '',
  country VARCHAR(120) NOT NULL DEFAULT '',
  company_size VARCHAR(80) NOT NULL DEFAULT '',
  contact_name VARCHAR(180) NOT NULL DEFAULT '',
  contact_title VARCHAR(180) NOT NULL DEFAULT '',
  public_work_contact VARCHAR(320) NOT NULL DEFAULT '',
  signal_type VARCHAR(80) NOT NULL DEFAULT '',
  signal_description TEXT NOT NULL DEFAULT '',
  signal_date VARCHAR(80) NOT NULL DEFAULT 'Unknown',
  source_url VARCHAR(1000) NOT NULL,
  source_title VARCHAR(500) NOT NULL DEFAULT '',
  source_type VARCHAR(80) NOT NULL DEFAULT 'official_website',
  evidence_excerpt TEXT NOT NULL DEFAULT '',
  evidence_summary TEXT NOT NULL DEFAULT '',
  fit_explanation TEXT NOT NULL DEFAULT '',
  ai_relevance_score INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  verified_status VARCHAR(40) NOT NULL DEFAULT 'verified',
  checked_at TIMESTAMP NOT NULL DEFAULT now(),
  source_provider VARCHAR(80) NOT NULL DEFAULT '',
  dedupe_key VARCHAR(320) NOT NULL DEFAULT '',
  signal_fingerprint VARCHAR(128) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_customer_finder_result_signal UNIQUE (workspace_id, job_id, signal_fingerprint)
);

CREATE TABLE IF NOT EXISTS ai_customer_finder_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  job_id UUID NOT NULL REFERENCES ai_customer_finder_jobs(id) ON DELETE CASCADE,
  result_id UUID NOT NULL REFERENCES ai_customer_finder_results(id) ON DELETE CASCADE,
  source_url VARCHAR(1000) NOT NULL,
  canonical_url VARCHAR(1000) NOT NULL DEFAULT '',
  source_title VARCHAR(500) NOT NULL DEFAULT '',
  source_type VARCHAR(80) NOT NULL DEFAULT 'official_website',
  publication_date VARCHAR(80) NOT NULL DEFAULT 'Unknown',
  retrieved_at TIMESTAMP NOT NULL DEFAULT now(),
  content_hash VARCHAR(128) NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_customer_finder_jobs_workspace_status ON ai_customer_finder_jobs(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_customer_finder_jobs_run_after ON ai_customer_finder_jobs(status, run_after, priority);
CREATE INDEX IF NOT EXISTS idx_ai_customer_finder_results_workspace_job ON ai_customer_finder_results(workspace_id, job_id);
CREATE INDEX IF NOT EXISTS idx_ai_customer_finder_results_domain ON ai_customer_finder_results(workspace_id, domain);
CREATE INDEX IF NOT EXISTS idx_ai_customer_finder_sources_result ON ai_customer_finder_sources(result_id);
