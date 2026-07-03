CREATE TABLE analytics_segments (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  name text NOT NULL,
  description text,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'tenant')),
  definition jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT analytics_segments_scope_fk FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX analytics_segments_scope_active_idx
  ON analytics_segments(project_id, environment_id, created_at ASC)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX analytics_segments_scope_name_active_idx
  ON analytics_segments(project_id, environment_id, lower(name))
  WHERE archived_at IS NULL;
