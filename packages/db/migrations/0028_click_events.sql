CREATE TABLE click_events (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  route text NOT NULL,
  selector text NOT NULL,
  element_tag text,
  element_role text,
  x numeric NOT NULL CHECK (x >= 0 AND x <= 1),
  y numeric NOT NULL CHECK (y >= 0 AND y <= 1),
  viewport_width integer NOT NULL CHECK (viewport_width > 0),
  viewport_height integer NOT NULL CHECK (viewport_height > 0),
  scroll_x integer,
  scroll_y integer,
  masked boolean NOT NULL DEFAULT true,
  CONSTRAINT click_events_scope_fk FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX click_events_route_time_idx
  ON click_events(project_id, environment_id, route, timestamp DESC, id DESC);

CREATE INDEX click_events_scope_time_idx
  ON click_events(project_id, environment_id, timestamp DESC, id DESC);

CREATE INDEX click_events_selector_time_idx
  ON click_events(project_id, environment_id, route, selector, timestamp DESC, id DESC);
