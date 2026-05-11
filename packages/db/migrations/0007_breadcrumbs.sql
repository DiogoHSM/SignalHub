CREATE TABLE IF NOT EXISTS breadcrumbs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  type text NOT NULL,
  category text,
  message text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (type IN ('navigation', 'click', 'console', 'network', 'custom')),
  CHECK (level IN ('debug', 'info', 'warning', 'error', 'fatal')),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX breadcrumbs_scope_session_timestamp_idx
  ON breadcrumbs(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX breadcrumbs_scope_timestamp_idx
  ON breadcrumbs(project_id, environment_id, timestamp DESC);

ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS deleted_breadcrumbs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breadcrumbs_days integer NOT NULL DEFAULT 30;
