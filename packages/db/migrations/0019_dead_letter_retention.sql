ALTER TABLE dead_letter_job_actions
  DROP CONSTRAINT IF EXISTS dead_letter_job_actions_action_check,
  ADD CONSTRAINT dead_letter_job_actions_action_check CHECK (action IN ('deleted', 'replayed', 'expired'));

ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS deleted_dead_letter_jobs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dead_letter_jobs_days integer NOT NULL DEFAULT 30;

ALTER TABLE retention_runs
  ADD CONSTRAINT retention_runs_deleted_dead_letter_jobs_nonnegative CHECK (deleted_dead_letter_jobs >= 0),
  ADD CONSTRAINT retention_runs_dead_letter_jobs_days_positive CHECK (dead_letter_jobs_days > 0);

CREATE INDEX IF NOT EXISTS dead_letter_jobs_retention_idx
  ON dead_letter_jobs (created_at ASC, id ASC);
