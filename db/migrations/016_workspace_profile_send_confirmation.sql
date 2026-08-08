ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS offer TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cta VARCHAR(220) NOT NULL DEFAULT 'Book a quick call',
  ADD COLUMN IF NOT EXISTS tone VARCHAR(80) NOT NULL DEFAULT 'Professional';

DO $$
DECLARE
  duplicate_owners TEXT;
BEGIN
  SELECT string_agg(owner_user_id || ':' || duplicate_count, ', ' ORDER BY owner_user_id)
  INTO duplicate_owners
  FROM (
    SELECT owner_user_id, count(*) AS duplicate_count
    FROM workspaces
    GROUP BY owner_user_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_owners IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add uq_workspaces_owner_user_id; duplicate workspaces exist for owner_user_id counts: %', duplicate_owners
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_owner_user_id
  ON workspaces(owner_user_id);
