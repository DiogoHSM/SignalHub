CREATE INDEX IF NOT EXISTS user_profiles_first_seen_idx
  ON user_profiles(project_id, environment_id, first_seen_at);

CREATE INDEX IF NOT EXISTS tenant_profiles_first_seen_idx
  ON tenant_profiles(project_id, environment_id, first_seen_at);
