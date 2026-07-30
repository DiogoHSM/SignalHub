CREATE TABLE analytics_promoted_event_properties (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  property_key text NOT NULL CHECK (property_key ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  display_name text NOT NULL,
  index_name text,
  index_status text NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending', 'building', 'ready', 'failed')),
  index_error text,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT analytics_promoted_event_properties_scope_fk
    FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX analytics_promoted_event_properties_scope_key_active_idx
  ON analytics_promoted_event_properties(project_id, environment_id, property_key)
  WHERE archived_at IS NULL;

CREATE INDEX analytics_promoted_event_properties_scope_active_idx
  ON analytics_promoted_event_properties(project_id, environment_id, created_at ASC)
  WHERE archived_at IS NULL;

CREATE TABLE analytics_insights (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  name text NOT NULL,
  description text,
  definition jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT analytics_insights_definition_object_check CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT analytics_insights_scope_fk
    FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX analytics_insights_scope_name_active_idx
  ON analytics_insights(project_id, environment_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX analytics_insights_scope_active_idx
  ON analytics_insights(project_id, environment_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE event_rollup_hourly (
  project_id text NOT NULL,
  environment_id text NOT NULL,
  bucket_start timestamptz NOT NULL,
  event_name text NOT NULL,
  breakdown_property text NOT NULL DEFAULT '',
  breakdown_value text NOT NULL DEFAULT '',
  actor_type text NOT NULL DEFAULT '',
  actor_id text NOT NULL DEFAULT '',
  event_count bigint NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    project_id,
    environment_id,
    bucket_start,
    event_name,
    breakdown_property,
    breakdown_value,
    actor_type,
    actor_id
  ),
  CONSTRAINT event_rollup_hourly_actor_check CHECK (
    (actor_type = '' AND actor_id = '') OR
    (actor_type IN ('user', 'tenant', 'session', 'trace') AND actor_id <> '')
  ),
  CONSTRAINT event_rollup_hourly_scope_fk
    FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX event_rollup_hourly_scope_bucket_idx
  ON event_rollup_hourly(project_id, environment_id, bucket_start, event_name);

CREATE INDEX event_rollup_hourly_scope_breakdown_idx
  ON event_rollup_hourly(project_id, environment_id, breakdown_property, bucket_start)
  WHERE breakdown_property <> '';
