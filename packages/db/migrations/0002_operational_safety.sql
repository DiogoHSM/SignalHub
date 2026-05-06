CREATE TABLE retention_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  error_message text,
  deleted_events integer NOT NULL DEFAULT 0,
  deleted_errors integer NOT NULL DEFAULT 0,
  deleted_traces integer NOT NULL DEFAULT 0,
  deleted_spans integer NOT NULL DEFAULT 0,
  deleted_llm_calls integer NOT NULL DEFAULT 0,
  events_days integer NOT NULL,
  errors_days integer NOT NULL,
  traces_days integer NOT NULL,
  spans_days integer NOT NULL,
  llm_calls_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retention_runs_started_at_idx ON retention_runs(started_at DESC);

CREATE TABLE system_heartbeats (
  component text PRIMARY KEY,
  last_heartbeat_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
