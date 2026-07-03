CREATE TABLE IF NOT EXISTS feature_flags (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  default_variant text NOT NULL,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT feature_flags_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_scope_key_active_idx
  ON feature_flags(project_id, environment_id, lower(key))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS feature_flags_scope_active_idx
  ON feature_flags(project_id, environment_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS feature_flag_audit (
  id text PRIMARY KEY,
  feature_flag_id text NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'archived')),
  actor_id text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_flag_audit_flag_idx
  ON feature_flag_audit(feature_flag_id, created_at ASC);
