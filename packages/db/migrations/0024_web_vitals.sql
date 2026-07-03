CREATE TABLE web_vitals (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  name text NOT NULL,
  value numeric(18, 6) NOT NULL,
  rating text NOT NULL,
  route text,
  navigation_type text,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX web_vitals_scope_time_id_idx
  ON web_vitals(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX web_vitals_scope_route_metric_time_idx
  ON web_vitals(project_id, environment_id, route, name, timestamp DESC);

CREATE INDEX web_vitals_scope_release_time_idx
  ON web_vitals(project_id, environment_id, release, timestamp DESC)
  WHERE release IS NOT NULL;

ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS deleted_web_vitals integer NOT NULL DEFAULT 0;

ALTER TABLE retention_runs
  ADD CONSTRAINT retention_runs_deleted_web_vitals_nonnegative CHECK (deleted_web_vitals >= 0);
