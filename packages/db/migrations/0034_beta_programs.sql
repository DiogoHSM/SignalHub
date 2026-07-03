CREATE TABLE IF NOT EXISTS beta_programs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'tenant')),
  feature_flag_id text REFERENCES feature_flags(id) ON DELETE SET NULL,
  feature_flag_variant text NOT NULL DEFAULT 'on',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS beta_programs_scope_key_active_idx
  ON beta_programs (project_id, environment_id, lower(key))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS beta_programs_scope_status_idx
  ON beta_programs (project_id, environment_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS beta_program_participants (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES beta_programs(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'tenant')),
  actor_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'opted_out', 'removed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS beta_program_participants_active_actor_idx
  ON beta_program_participants (program_id, actor_type, actor_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS beta_program_participants_scope_idx
  ON beta_program_participants (project_id, environment_id, program_id, status, updated_at DESC)
  WHERE removed_at IS NULL;
