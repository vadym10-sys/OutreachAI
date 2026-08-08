CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  object_key VARCHAR(700) NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 VARCHAR(128) NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  restore_verified BOOLEAN NOT NULL DEFAULT false,
  restore_verified_at TIMESTAMP,
  triggered_by VARCHAR(128) NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_provider ON backup_runs(provider);
CREATE INDEX IF NOT EXISTS idx_backup_runs_status ON backup_runs(status);
CREATE INDEX IF NOT EXISTS idx_backup_runs_restore_verified ON backup_runs(restore_verified);
CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at);
