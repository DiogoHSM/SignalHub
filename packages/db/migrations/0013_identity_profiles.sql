CREATE TABLE user_profiles (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id text NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  tenant_id text,
  traits jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id, user_id),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX user_profiles_last_seen_idx ON user_profiles(project_id, environment_id, last_seen_at DESC);
CREATE INDEX user_profiles_tenant_idx ON user_profiles(project_id, environment_id, tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE tenant_profiles (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id text NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  traits jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id, tenant_id),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX tenant_profiles_last_seen_idx ON tenant_profiles(project_id, environment_id, last_seen_at DESC);
