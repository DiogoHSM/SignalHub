ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_type_check;
ALTER TABLE notification_channels ALTER COLUMN url DROP NOT NULL;
ALTER TABLE notification_channels ADD COLUMN email_recipients jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_type_check CHECK (type IN ('webhook', 'email'));
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_shape_check CHECK (
    (type = 'webhook' AND url IS NOT NULL AND jsonb_array_length(email_recipients) = 0)
    OR
    (type = 'email' AND url IS NULL AND jsonb_array_length(email_recipients) > 0
      AND secret_header_name IS NULL AND secret_header_value IS NULL)
  );

ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_type_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_type_check CHECK (
    type IN ('critical_errors', 'error_count', 'error_rate', 'trace_p95_latency', 'llm_cost')
  );
ALTER TABLE alert_rules ADD COLUMN route_pattern text;
ALTER TABLE alert_rules ADD COLUMN minimum_sample_size integer NOT NULL DEFAULT 1 CHECK (minimum_sample_size > 0);

CREATE TABLE monitors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  notification_channel_id text REFERENCES notification_channels(id),
  kind text NOT NULL CHECK (kind IN ('http', 'heartbeat')),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'up', 'down', 'degraded', 'paused')),
  url text,
  method text CHECK (method IN ('GET', 'HEAD')),
  expected_status text,
  body_contains text,
  timeout_ms integer CHECK (timeout_ms > 0),
  interval_minutes integer CHECK (interval_minutes > 0),
  failure_threshold integer NOT NULL DEFAULT 2 CHECK (failure_threshold > 0),
  recovery_threshold integer NOT NULL DEFAULT 1 CHECK (recovery_threshold > 0),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  consecutive_successes integer NOT NULL DEFAULT 0 CHECK (consecutive_successes >= 0),
  expected_interval_minutes integer CHECK (expected_interval_minutes > 0),
  grace_minutes integer CHECK (grace_minutes >= 0),
  secret_hash text,
  last_checked_at timestamptz,
  last_check_status text CHECK (last_check_status IN ('success', 'failed')),
  last_check_latency_ms integer,
  last_check_response_status integer,
  last_check_error_message text,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CHECK (
    (kind = 'http' AND url IS NOT NULL AND method IS NOT NULL AND expected_status IS NOT NULL
      AND timeout_ms IS NOT NULL AND interval_minutes IS NOT NULL
      AND expected_interval_minutes IS NULL AND grace_minutes IS NULL AND secret_hash IS NULL)
    OR
    (kind = 'heartbeat' AND url IS NULL AND method IS NULL AND expected_status IS NULL AND body_contains IS NULL
      AND timeout_ms IS NULL AND interval_minutes IS NULL
      AND expected_interval_minutes IS NOT NULL AND grace_minutes IS NOT NULL AND secret_hash IS NOT NULL)
  )
);

CREATE INDEX monitors_scope_idx ON monitors(project_id, environment_id, kind, enabled, archived_at);
CREATE INDEX monitors_channel_idx ON monitors(notification_channel_id);
CREATE INDEX monitors_due_http_idx ON monitors(last_checked_at, interval_minutes)
  WHERE kind = 'http' AND enabled = true AND archived_at IS NULL;
CREATE INDEX monitors_stale_heartbeat_idx ON monitors(last_heartbeat_at, expected_interval_minutes, grace_minutes)
  WHERE kind = 'heartbeat' AND enabled = true AND archived_at IS NULL;

CREATE TABLE monitor_checks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  monitor_id text NOT NULL REFERENCES monitors(id),
  checked_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  latency_ms integer,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monitor_checks_monitor_time_idx ON monitor_checks(monitor_id, checked_at DESC);

ALTER TABLE alert_events DROP CONSTRAINT alert_events_rule_id_project_id_environment_id_fkey;
ALTER TABLE alert_events ALTER COLUMN rule_id DROP NOT NULL;
ALTER TABLE alert_events ADD COLUMN monitor_id text REFERENCES monitors(id);
ALTER TABLE alert_events
  ADD CONSTRAINT alert_events_origin_check CHECK (
    (rule_id IS NOT NULL AND monitor_id IS NULL)
    OR
    (rule_id IS NULL AND monitor_id IS NOT NULL)
  );
ALTER TABLE alert_events
  ADD CONSTRAINT alert_events_rule_id_project_id_environment_id_fkey
  FOREIGN KEY (rule_id, project_id, environment_id) REFERENCES alert_rules(id, project_id, environment_id);
CREATE INDEX alert_events_monitor_time_idx ON alert_events(monitor_id, triggered_at DESC);
