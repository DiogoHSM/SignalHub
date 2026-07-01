ALTER TABLE alert_rules
  ADD COLUMN escalation_minutes integer CHECK (escalation_minutes IS NULL OR escalation_minutes > 0),
  ADD COLUMN escalation_channel_id text REFERENCES notification_channels(id);

CREATE INDEX alert_rules_escalation_channel_idx ON alert_rules(escalation_channel_id);

ALTER TABLE alert_events DROP CONSTRAINT alert_events_status_check;
ALTER TABLE alert_events
  ADD CONSTRAINT alert_events_status_check CHECK (
    status IN ('triggered', 'acknowledged', 'snoozed', 'resolved')
  );

ALTER TABLE alert_events
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by_user_id text REFERENCES users(id),
  ADD COLUMN acknowledged_by_email text,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by_user_id text REFERENCES users(id),
  ADD COLUMN resolved_by_email text,
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN triage_note text,
  ADD COLUMN escalation_due_at timestamptz,
  ADD COLUMN escalated_at timestamptz;

CREATE INDEX alert_events_triage_scope_idx
  ON alert_events(project_id, environment_id, status, triggered_at DESC);

CREATE INDEX alert_events_escalation_due_idx
  ON alert_events(escalation_due_at, triggered_at DESC)
  WHERE escalation_due_at IS NOT NULL AND escalated_at IS NULL AND status = 'triggered';
