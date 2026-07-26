CREATE INDEX IF NOT EXISTS events_scope_name_time_idx
  ON events(project_id, environment_id, name, timestamp DESC);
