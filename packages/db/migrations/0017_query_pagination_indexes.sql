CREATE INDEX IF NOT EXISTS events_scope_time_id_idx
  ON events(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS errors_scope_time_id_idx
  ON errors(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS llm_calls_scope_time_id_idx
  ON llm_calls(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS traces_scope_time_id_idx
  ON traces(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS spans_scope_time_id_idx
  ON spans(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS events_scope_session_time_id_idx
  ON events(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS errors_scope_session_time_id_idx
  ON errors(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_calls_scope_session_time_id_idx
  ON llm_calls(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS traces_scope_session_time_id_idx
  ON traces(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS spans_scope_session_time_id_idx
  ON spans(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_map_artifacts_scope_created_id_idx
  ON source_map_artifacts(project_id, environment_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS monitor_checks_monitor_checked_id_idx
  ON monitor_checks(monitor_id, checked_at DESC, created_at DESC, id DESC);
