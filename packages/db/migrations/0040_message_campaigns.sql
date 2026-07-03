CREATE TABLE IF NOT EXISTS message_campaigns (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  channel_type text NOT NULL DEFAULT 'in_app' CHECK (channel_type IN ('email', 'webhook', 'in_app')),
  notification_channel_id text REFERENCES notification_channels(id),
  segment_id text REFERENCES analytics_segments(id),
  conversion_event text,
  subject text,
  body text NOT NULL,
  cta_url text,
  consent_category text NOT NULL DEFAULT 'product',
  privacy_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT message_campaigns_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id),
  CONSTRAINT message_campaigns_channel_shape_check CHECK (
    (channel_type = 'in_app' AND notification_channel_id IS NULL)
    OR (channel_type IN ('email', 'webhook') AND notification_channel_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS message_campaigns_scope_key_active_idx
  ON message_campaigns(project_id, environment_id, lower(key))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS message_campaigns_scope_status_idx
  ON message_campaigns(project_id, environment_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS message_campaign_events (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES message_campaigns(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'converted', 'failed', 'opted_out')),
  actor_type text NOT NULL DEFAULT 'anonymous' CHECK (actor_type IN ('user', 'tenant', 'session', 'anonymous')),
  actor_id text,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  release text,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_campaign_events_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
);

CREATE INDEX IF NOT EXISTS message_campaign_events_campaign_time_idx
  ON message_campaign_events(campaign_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS message_campaign_events_scope_actor_idx
  ON message_campaign_events(project_id, environment_id, actor_type, actor_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS message_campaign_opt_outs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  campaign_id text REFERENCES message_campaigns(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'tenant', 'session', 'anonymous')),
  actor_id text NOT NULL,
  category text NOT NULL DEFAULT 'product',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_campaign_opt_outs_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS message_campaign_opt_outs_unique_idx
  ON message_campaign_opt_outs(project_id, environment_id, coalesce(campaign_id, ''), actor_type, actor_id, lower(category));
