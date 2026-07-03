CREATE TABLE analytics_dashboards (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'operational' CHECK (category IN ('executive', 'operational', 'product')),
  filters jsonb NOT NULL DEFAULT '{}',
  widgets jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT analytics_dashboards_scope_fk FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX analytics_dashboards_scope_active_idx
  ON analytics_dashboards(project_id, environment_id, category, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX analytics_dashboards_scope_name_active_idx
  ON analytics_dashboards(project_id, environment_id, lower(name))
  WHERE archived_at IS NULL;
