CREATE TABLE event_actor_daily (
  project_id     text NOT NULL,
  environment_id text NOT NULL,
  day            date NOT NULL,
  actor_type     text NOT NULL CHECK (actor_type IN ('user','tenant','session','trace')),
  actor_id       text NOT NULL,
  event_name     text NOT NULL,
  events         bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id, day, actor_type, actor_id, event_name),
  CONSTRAINT event_actor_daily_scope_fk
    FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX event_actor_daily_scope_name_day_idx
  ON event_actor_daily(project_id, environment_id, event_name, day);

CREATE TABLE event_rollup_state (
  project_id     text NOT NULL,
  environment_id text NOT NULL,
  rollup         text NOT NULL,
  watermark_at   timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id, rollup)
);
