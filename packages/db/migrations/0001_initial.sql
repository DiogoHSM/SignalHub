CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text,
  google_subject text UNIQUE,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE environments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(project_id, name)
);

CREATE TABLE api_keys (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  name text NOT NULL,
  prefix text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX api_keys_prefix_idx ON api_keys(prefix);

CREATE TABLE events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE errors (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  message text NOT NULL,
  type text,
  severity text NOT NULL,
  stack text,
  status text NOT NULL DEFAULT 'open',
  fingerprint text,
  context jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE llm_calls (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  model text NOT NULL,
  prompt_name text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(18, 6) NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL,
  error text,
  input_preview text,
  output_preview text
);

CREATE TABLE traces (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  name text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer
);

CREATE TABLE spans (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  parent_span_id text,
  name text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer,
  input jsonb,
  output jsonb,
  error jsonb,
  cost_usd numeric(18, 6)
);

CREATE TABLE dead_letter_jobs (
  id text PRIMARY KEY,
  queue_name text NOT NULL,
  job_name text NOT NULL,
  payload jsonb NOT NULL,
  error_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_project_env_time_idx ON events(project_id, environment_id, timestamp DESC);
CREATE INDEX errors_project_env_time_idx ON errors(project_id, environment_id, timestamp DESC);
CREATE INDEX llm_calls_project_env_time_idx ON llm_calls(project_id, environment_id, timestamp DESC);
CREATE INDEX traces_project_env_time_idx ON traces(project_id, environment_id, timestamp DESC);
CREATE INDEX spans_trace_id_idx ON spans(trace_id);
