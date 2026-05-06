CREATE TABLE notification_channels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('webhook')),
  url text NOT NULL,
  secret_header_name text,
  secret_header_value text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX notification_channels_active_idx ON notification_channels(enabled, archived_at);

CREATE TABLE alert_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  notification_channel_id text REFERENCES notification_channels(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('critical_errors', 'error_count', 'trace_p95_latency', 'llm_cost')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  window_minutes integer NOT NULL CHECK (window_minutes > 0),
  threshold numeric(18, 6) NOT NULL CHECK (threshold > 0),
  cooldown_minutes integer NOT NULL CHECK (cooldown_minutes > 0),
  enabled boolean NOT NULL DEFAULT true,
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(id, project_id, environment_id),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX alert_rules_active_scope_idx ON alert_rules(project_id, environment_id, enabled, archived_at);
CREATE INDEX alert_rules_channel_idx ON alert_rules(notification_channel_id);
CREATE INDEX alert_rules_enabled_created_at_idx ON alert_rules(created_at ASC) WHERE enabled = true AND archived_at IS NULL;

CREATE TABLE alert_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rule_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('triggered')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  triggered_at timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  observed_value numeric(18, 6) NOT NULL,
  threshold numeric(18, 6) NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  FOREIGN KEY (rule_id, project_id, environment_id) REFERENCES alert_rules(id, project_id, environment_id)
);

CREATE INDEX alert_events_scope_time_idx ON alert_events(project_id, environment_id, triggered_at DESC);
CREATE INDEX alert_events_rule_time_idx ON alert_events(rule_id, triggered_at DESC);

CREATE TABLE notification_deliveries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  alert_event_id text NOT NULL REFERENCES alert_events(id),
  notification_channel_id text NOT NULL REFERENCES notification_channels(id),
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  attempted_at timestamptz NOT NULL,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_deliveries_event_idx ON notification_deliveries(alert_event_id);
CREATE INDEX notification_deliveries_channel_time_idx ON notification_deliveries(notification_channel_id, attempted_at DESC);
