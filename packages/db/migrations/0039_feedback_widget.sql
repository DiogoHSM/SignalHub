CREATE TABLE IF NOT EXISTS feedback_widget_settings (
  project_id text NOT NULL,
  environment_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT 'Send feedback',
  prompt text NOT NULL DEFAULT 'Tell us what happened or what could be better.',
  placeholder text NOT NULL DEFAULT 'Write your feedback...',
  button_label text NOT NULL DEFAULT 'Feedback',
  accent_color text NOT NULL DEFAULT '#66e38a',
  allow_screenshot boolean NOT NULL DEFAULT false,
  privacy_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id),
  CONSTRAINT feedback_widget_settings_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback_items (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'archived')),
  message text NOT NULL,
  category text,
  page_url text,
  path text,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  release text,
  source text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_items_scope_fk
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS feedback_items_scope_status_time_idx
  ON feedback_items(project_id, environment_id, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS feedback_items_scope_actor_time_idx
  ON feedback_items(project_id, environment_id, tenant_id, user_id, submitted_at DESC);
