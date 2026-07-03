CREATE TABLE IF NOT EXISTS surveys (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'tenant', 'session')),
  trigger_event text,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT surveys_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS surveys_scope_key_active_idx
  ON surveys(project_id, environment_id, lower(key))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS surveys_scope_active_idx
  ON surveys(project_id, environment_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS survey_responses (
  id text PRIMARY KEY,
  survey_id text NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'tenant', 'session', 'anonymous')),
  actor_id text,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  release text,
  source text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT survey_responses_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
);

CREATE INDEX IF NOT EXISTS survey_responses_survey_time_idx
  ON survey_responses(survey_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS survey_responses_scope_actor_idx
  ON survey_responses(project_id, environment_id, actor_type, actor_id, submitted_at DESC);
