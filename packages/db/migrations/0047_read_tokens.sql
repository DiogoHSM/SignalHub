CREATE TABLE IF NOT EXISTS read_tokens (
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

CREATE INDEX IF NOT EXISTS read_tokens_scope_created_idx
  ON read_tokens(project_id, environment_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS read_tokens_active_prefix_idx
  ON read_tokens(prefix)
  WHERE revoked_at IS NULL;
