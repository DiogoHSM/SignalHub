CREATE TABLE project_browser_origins (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX project_browser_origins_project_active_idx
  ON project_browser_origins(project_id, created_at)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX project_browser_origins_project_origin_active_idx
  ON project_browser_origins(project_id, origin)
  WHERE archived_at IS NULL;
