CREATE TABLE experiments (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'archived')),
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'tenant', 'session')),
  exposure_event text NOT NULL DEFAULT 'sigmon.experiment.exposed',
  conversion_event text NOT NULL,
  variants jsonb NOT NULL DEFAULT '[]',
  primary_metric jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT experiments_scope_fk FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX experiments_scope_active_idx
  ON experiments(project_id, environment_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX experiments_scope_key_active_idx
  ON experiments(project_id, environment_id, lower(key))
  WHERE archived_at IS NULL;
