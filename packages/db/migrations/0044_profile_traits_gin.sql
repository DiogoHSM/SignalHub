CREATE INDEX IF NOT EXISTS user_profiles_traits_gin_idx
  ON user_profiles USING gin (traits jsonb_path_ops);

CREATE INDEX IF NOT EXISTS tenant_profiles_traits_gin_idx
  ON tenant_profiles USING gin (traits jsonb_path_ops);
