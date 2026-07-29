# OutreachAI AI Memory

## Architecture

AI Memory is a workspace-scoped retrieval layer for AI analysis and email drafting. It stores only sanitized business context, explicit preferences, interactions, AI assumptions, and real outcomes. Memory entries are treated as untrusted data and are passed to LLM prompts through the existing trust-boundary envelope.

Flow:

1. Workspace profile and confirmed facts are written to `ai_memory_entries`.
2. Before AI Sales analysis or email drafting, retrieval filters by `workspace_id`, `company_id`, `lead_id`, active retention state, relevance, and budget.
3. If PostgreSQL pgvector is installed and an OpenAI embedding is available, retrieval can run a workspace-scoped pgvector similarity query. If OpenAI embeddings are available but pgvector is not used, ranking happens in application code and reports `openai_embedding`. If embeddings are unavailable, deterministic keyword/metadata scoring is used.
4. The AI result includes `memory_context` with mode, memory ids, item types, sources, relevance scores, verification state, influence notes, truncation, and reason when memory was not used.
5. Draft, approval, send, webhook open/click/reply/meeting/rejection/unsubscribe events are stored as `interaction` or `outcome`.

No automatic fine-tuning is performed.

## Data Model

- `ai_memory_settings`: one row per workspace with enablement, limits, retention, embedding status, and last retrieval mode.
- `ai_memory_entries`: workspace-isolated entries with `memory_type`, sanitized content, source, entity references, dedupe hash, trust flags, optional embedding JSON, TTL, and soft delete.
- `ai_memory_audit_logs`: audit trail for settings, upsert, retrieval, correction, deletion, and clear operations.

Memory types:

- `verified_fact`: confirmed factual context.
- `approved_preference`: explicitly confirmed user preference.
- `interaction`: selected drafts, approvals, and prior workspace interactions.
- `ai_inference`: model assumptions, never promoted to verified fact automatically.
- `outcome`: factual delivery and reply outcomes.

## Environment Variables

- `AI_MEMORY_DEFAULT_ENABLED`: default workspace memory enablement. Production-safe default is `false`; enable only through Settings or an explicit production environment override.
- `AI_MEMORY_EMBEDDINGS_ENABLED`: enables embedding attempts.
- `AI_MEMORY_MAX_ITEMS`: maximum memory records per AI call.
- `AI_MEMORY_MAX_CHARACTERS`: maximum memory context characters per AI call.
- `AI_MEMORY_RELEVANCE_THRESHOLD`: minimum relevance for non-trusted entries.
- `AI_MEMORY_RETENTION_DAYS`: default TTL.
- `OPENAI_EMBEDDING_MODEL`: embedding model, default `text-embedding-3-small`.
- `OPENAI_API_KEY`: required only for OpenAI embeddings and LLM calls.

## Embedding Cost And Limits

Embeddings are created only for sanitized memory content and retrieval queries when AI Memory is enabled, an OpenAI key is configured, and memory embeddings are enabled. Disabled memory does not call the embedding provider. The default model is `text-embedding-3-small`. Local deterministic fallback does not masquerade as vector retrieval. Retrieval has hard limits (`max_items`, `max_characters`, relevance threshold) to avoid sending full history to the LLM.

If embeddings fail, AI analysis and email generation continue with keyword retrieval.

## Privacy And Retention

- Entries are scoped by `workspace_id` and `user_id`.
- Retrieval excludes deleted and expired entries.
- API keys, passwords, tokens, cookies, and authorization headers are redacted before storage.
- Full inbound/outbound email bodies are not stored as memory by default; memory stores subject, CTA, event type, and short safe excerpts.
- Workspace clear uses soft delete for safety and auditability.
- Customer data is never used across workspaces.

## pgvector

Migration `011_ai_memory.sql` checks `pg_available_extensions` before `CREATE EXTENSION IF NOT EXISTS vector`, and catches `insufficient_privilege` and `undefined_file` so ordinary memory tables still migrate when optional vector setup is unavailable. It creates the vector column and ivfflat index only after the extension is installed. Do not force-install pgvector in an unsupported Railway/PostgreSQL environment.

Retrieval modes are exact:

- `pgvector`: PostgreSQL executed similarity through the `embedding vector(1536)` column and cosine operator.
- `openai_embedding`: OpenAI embeddings were used, but ranking happened outside pgvector.
- `keyword`: deterministic keyword/metadata fallback. Hash or keyword fallback must never be reported as vector or pgvector.
- `none`: no memory was used.

Production verification:

```sql
SELECT name, installed_version
FROM pg_available_extensions
WHERE name = 'vector';

SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

## Fallback

When pgvector or embeddings are unavailable, retrieval uses deterministic keyword, trust, entity, and recency scoring. The result reports `retrieval_mode: "keyword"` or `none`. If OpenAI embeddings are available without pgvector, the result reports `retrieval_mode: "openai_embedding"`.

## Migration

Apply normal app startup migrations. For existing Postgres databases, `011_ai_memory.sql` creates tables and indexes idempotently. For new databases, `db/schema.sql` includes the same objects.

Staged rollout order:

1. Apply migration `011_ai_memory.sql`.
2. Verify `ai_memory_settings`, `ai_memory_entries`, and `ai_memory_audit_logs` exist.
3. Verify pgvector availability with the SQL checks above; pgvector may remain unavailable without blocking rollout.
4. Keep `AI_MEMORY_DEFAULT_ENABLED=false` for staged production rollout unless there is an explicit production configuration decision.
5. Manually enable AI Memory for one test workspace from Settings.
6. Generate an AI analysis/email draft and verify `memory_context.retrieval_mode` is `keyword`, `openai_embedding`, `pgvector`, or `none` according to actual runtime behavior.

The migration and config do not automatically enable memory for existing workspaces.

## Rollback

```sql
DROP INDEX IF EXISTS idx_ai_memory_entries_embedding;
DROP TABLE IF EXISTS ai_memory_audit_logs;
DROP TABLE IF EXISTS ai_memory_entries;
DROP TABLE IF EXISTS ai_memory_settings;
```

Do not automatically drop the `vector` extension; it may be used by another service.
