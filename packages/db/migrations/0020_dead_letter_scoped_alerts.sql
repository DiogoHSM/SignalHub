ALTER TABLE dead_letter_jobs
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS environment_id text;

ALTER TABLE dead_letter_jobs
  ADD CONSTRAINT dead_letter_jobs_scope_shape_check CHECK (
    (project_id IS NULL AND environment_id IS NULL)
    OR
    (project_id IS NOT NULL AND environment_id IS NOT NULL)
  ),
  ADD CONSTRAINT dead_letter_jobs_scope_fk FOREIGN KEY (project_id, environment_id)
    REFERENCES environments(project_id, id);

CREATE INDEX IF NOT EXISTS dead_letter_jobs_scope_created_idx
  ON dead_letter_jobs (project_id, environment_id, created_at DESC, id DESC)
  WHERE project_id IS NOT NULL AND environment_id IS NOT NULL;

ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_type_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_type_check CHECK (
    type IN ('critical_errors', 'error_count', 'error_rate', 'trace_p95_latency', 'llm_cost', 'dead_letter_count')
  );
