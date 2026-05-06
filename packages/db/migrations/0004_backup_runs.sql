CREATE TABLE backup_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  filename text NOT NULL,
  local_path text NOT NULL,
  size_bytes bigint,
  s3_bucket text,
  s3_key text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX backup_runs_started_at_idx ON backup_runs(started_at DESC);
CREATE INDEX backup_runs_success_started_at_idx ON backup_runs(started_at DESC) WHERE status = 'success';
CREATE INDEX backup_runs_failed_started_at_idx ON backup_runs(started_at DESC) WHERE status = 'failed';
