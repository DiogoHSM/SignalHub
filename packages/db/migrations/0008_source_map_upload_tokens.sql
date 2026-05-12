CREATE TABLE IF NOT EXISTS source_map_upload_tokens (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id text NOT NULL,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_map_upload_tokens_scope_created_idx
  ON source_map_upload_tokens(project_id, environment_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS source_map_upload_tokens_active_prefix_idx
  ON source_map_upload_tokens(prefix)
  WHERE revoked_at IS NULL;

ALTER TABLE source_map_artifacts
  ADD COLUMN IF NOT EXISTS uploaded_by_token_id text REFERENCES source_map_upload_tokens(id) ON DELETE SET NULL;

ALTER TABLE source_map_artifacts
  ALTER COLUMN uploaded_by_user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_map_artifacts_one_uploader_check'
  ) THEN
    ALTER TABLE source_map_artifacts
      ADD CONSTRAINT source_map_artifacts_one_uploader_check
      CHECK (
        (uploaded_by_user_id IS NOT NULL AND uploaded_by_token_id IS NULL)
        OR (uploaded_by_user_id IS NULL AND uploaded_by_token_id IS NOT NULL)
      );
  END IF;
END $$;
