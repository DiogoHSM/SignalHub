CREATE TABLE profiles (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
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
  kind text NOT NULL CHECK (kind IN ('cpu', 'memory')),
  runtime text NOT NULL,
  service text,
  route text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer,
  sample_count integer NOT NULL DEFAULT 0,
  sampling_interval_ms integer,
  cpu_usage_percent numeric(8, 4),
  cpu_user_ms integer,
  cpu_system_ms integer,
  rss_bytes numeric(20, 0),
  heap_used_bytes numeric(20, 0),
  heap_total_bytes numeric(20, 0),
  external_bytes numeric(20, 0),
  array_buffers_bytes numeric(20, 0),
  top_functions jsonb NOT NULL DEFAULT '[]',
  summary jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT profiles_scope_fk FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT profiles_duration_nonnegative CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT profiles_sample_count_nonnegative CHECK (sample_count >= 0),
  CONSTRAINT profiles_sampling_interval_positive CHECK (sampling_interval_ms IS NULL OR sampling_interval_ms > 0),
  CONSTRAINT profiles_cpu_usage_range CHECK (cpu_usage_percent IS NULL OR (cpu_usage_percent >= 0 AND cpu_usage_percent <= 100)),
  CONSTRAINT profiles_memory_nonnegative CHECK (
    (rss_bytes IS NULL OR rss_bytes >= 0) AND
    (heap_used_bytes IS NULL OR heap_used_bytes >= 0) AND
    (heap_total_bytes IS NULL OR heap_total_bytes >= 0) AND
    (external_bytes IS NULL OR external_bytes >= 0) AND
    (array_buffers_bytes IS NULL OR array_buffers_bytes >= 0)
  )
);

CREATE INDEX profiles_scope_time_id_idx
  ON profiles(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX profiles_scope_kind_time_id_idx
  ON profiles(project_id, environment_id, kind, timestamp DESC, id DESC);

CREATE INDEX profiles_scope_route_runtime_time_idx
  ON profiles(project_id, environment_id, route, runtime, timestamp DESC)
  WHERE route IS NOT NULL;

CREATE INDEX profiles_scope_trace_time_id_idx
  ON profiles(project_id, environment_id, trace_id, timestamp DESC, id DESC)
  WHERE trace_id IS NOT NULL;

ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS deleted_profiles integer NOT NULL DEFAULT 0;

ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS profiles_days integer NOT NULL DEFAULT 30;

ALTER TABLE retention_runs
  ADD CONSTRAINT retention_runs_deleted_profiles_nonnegative CHECK (deleted_profiles >= 0);
