CREATE TABLE dead_letter_job_actions (
  id text PRIMARY KEY,
  dead_letter_job_id text NOT NULL,
  queue_name text NOT NULL,
  job_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('deleted', 'replayed')),
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dead_letter_job_actions_job_created_idx ON dead_letter_job_actions (dead_letter_job_id, created_at DESC, id DESC);
CREATE INDEX dead_letter_job_actions_created_idx ON dead_letter_job_actions (created_at DESC, id DESC);
