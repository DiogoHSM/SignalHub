CREATE INDEX IF NOT EXISTS events_scope_trace_time_id_idx
  ON events(project_id, environment_id, trace_id, timestamp DESC, id DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS errors_scope_trace_time_id_idx
  ON errors(project_id, environment_id, trace_id, timestamp DESC, id DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_calls_scope_trace_time_id_idx
  ON llm_calls(project_id, environment_id, trace_id, timestamp DESC, id DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS traces_scope_trace_time_id_idx
  ON traces(project_id, environment_id, trace_id, timestamp DESC, id DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS spans_scope_trace_time_id_idx
  ON spans(project_id, environment_id, trace_id, timestamp DESC, id DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_scope_tenant_time_id_idx
  ON events(project_id, environment_id, tenant_id, timestamp DESC, id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS errors_scope_tenant_time_id_idx
  ON errors(project_id, environment_id, tenant_id, timestamp DESC, id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_calls_scope_tenant_time_id_idx
  ON llm_calls(project_id, environment_id, tenant_id, timestamp DESC, id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS traces_scope_tenant_time_id_idx
  ON traces(project_id, environment_id, tenant_id, timestamp DESC, id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS spans_scope_tenant_time_id_idx
  ON spans(project_id, environment_id, tenant_id, timestamp DESC, id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_scope_user_time_id_idx
  ON events(project_id, environment_id, user_id, timestamp DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS errors_scope_user_time_id_idx
  ON errors(project_id, environment_id, user_id, timestamp DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_calls_scope_user_time_id_idx
  ON llm_calls(project_id, environment_id, user_id, timestamp DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS traces_scope_user_time_id_idx
  ON traces(project_id, environment_id, user_id, timestamp DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS spans_scope_user_time_id_idx
  ON spans(project_id, environment_id, user_id, timestamp DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_map_artifacts_scope_release_created_id_idx
  ON source_map_artifacts(project_id, environment_id, release, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS errors_group_tenant_idx
  ON errors(error_group_id, tenant_id)
  WHERE error_group_id IS NOT NULL AND tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS errors_group_user_idx
  ON errors(error_group_id, user_id)
  WHERE error_group_id IS NOT NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS error_groups_scope_cursor_order_idx
  ON error_groups(
    project_id,
    environment_id,
    (case when status = 'open' and last_regressed_at is not null then 0 else 1 end),
    (case severity when 'fatal' then 0 when 'critical' then 1 when 'error' then 2 when 'warning' then 3 when 'info' then 4 when 'debug' then 5 else 6 end),
    (case status when 'open' then 0 when 'investigating' then 1 else 2 end),
    last_seen_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS alert_events_scope_triggered_created_id_idx
  ON alert_events(project_id, environment_id, triggered_at DESC, created_at DESC, id DESC);
