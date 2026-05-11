CREATE TABLE error_groups (
  id text PRIMARY KEY DEFAULT ('egrp_' || encode(gen_random_bytes(12), 'hex')),
  project_id text NOT NULL,
  environment_id text NOT NULL,
  grouping_fingerprint text NOT NULL,
  message text NOT NULL,
  type text,
  top_stack_frame text,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_regressed_at timestamptz,
  occurrence_count integer NOT NULL DEFAULT 0,
  affected_users_count integer NOT NULL DEFAULT 0,
  affected_tenants_count integer NOT NULL DEFAULT 0,
  latest_error_id text,
  latest_release text,
  resolved_at timestamptz,
  ignored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT error_groups_status_check CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')),
  CONSTRAINT error_groups_occurrence_count_check CHECK (occurrence_count >= 0),
  CONSTRAINT error_groups_affected_users_count_check CHECK (affected_users_count >= 0),
  CONSTRAINT error_groups_affected_tenants_count_check CHECK (affected_tenants_count >= 0)
);

CREATE UNIQUE INDEX error_groups_scope_fingerprint_idx
  ON error_groups(project_id, environment_id, grouping_fingerprint);

CREATE UNIQUE INDEX error_groups_id_scope_idx
  ON error_groups(id, project_id, environment_id);

CREATE INDEX error_groups_scope_status_seen_idx
  ON error_groups(project_id, environment_id, status, last_seen_at DESC);

CREATE INDEX error_groups_scope_severity_seen_idx
  ON error_groups(project_id, environment_id, severity, last_seen_at DESC);

ALTER TABLE errors
  ADD COLUMN error_group_id text,
  ADD COLUMN grouping_fingerprint text,
  ADD CONSTRAINT errors_error_group_scope_fk
    FOREIGN KEY (error_group_id, project_id, environment_id)
    REFERENCES error_groups(id, project_id, environment_id);

CREATE INDEX errors_group_time_idx ON errors(error_group_id, timestamp DESC);
CREATE INDEX errors_grouping_fingerprint_idx ON errors(project_id, environment_id, grouping_fingerprint);
