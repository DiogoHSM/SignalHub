CREATE INDEX IF NOT EXISTS session_replays_user_started_idx
  ON session_replays (project_id, environment_id, user_id, started_at DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS session_replays_tenant_started_idx
  ON session_replays (project_id, environment_id, tenant_id, started_at DESC, id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_replay_name_idx
  ON events (project_id, environment_id, replay_id, name, timestamp DESC, id DESC)
  WHERE replay_id IS NOT NULL;
