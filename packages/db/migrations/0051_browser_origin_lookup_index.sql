CREATE INDEX project_browser_origins_origin_active_idx
  ON project_browser_origins(origin)
  WHERE archived_at IS NULL;
