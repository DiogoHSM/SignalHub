DELETE FROM error_stack_resolutions esr
WHERE NOT EXISTS (
  SELECT 1
  FROM errors e
  WHERE e.id = esr.error_id
    AND e.project_id = esr.project_id
    AND e.environment_id = esr.environment_id
    AND e.release = esr.release
)
OR NOT EXISTS (
  SELECT 1
  FROM source_map_artifacts sma
  WHERE sma.id = esr.source_map_artifact_id
    AND sma.project_id = esr.project_id
    AND sma.environment_id = esr.environment_id
    AND sma.release = esr.release
    AND sma.minified_file = esr.minified_file
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'errors_id_scope_release_unique'
  ) THEN
    ALTER TABLE errors
      ADD CONSTRAINT errors_id_scope_release_unique
      UNIQUE (id, project_id, environment_id, release);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_map_artifacts_id_scope_release_file_unique'
  ) THEN
    ALTER TABLE source_map_artifacts
      ADD CONSTRAINT source_map_artifacts_id_scope_release_file_unique
      UNIQUE (id, project_id, environment_id, release, minified_file);
  END IF;
END $$;

ALTER TABLE error_stack_resolutions
  DROP CONSTRAINT IF EXISTS error_stack_resolutions_error_id_fkey,
  DROP CONSTRAINT IF EXISTS error_stack_resolutions_source_map_artifact_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_stack_resolutions_error_scope_release_fk'
  ) THEN
    ALTER TABLE error_stack_resolutions
      ADD CONSTRAINT error_stack_resolutions_error_scope_release_fk
      FOREIGN KEY (error_id, project_id, environment_id, release)
      REFERENCES errors(id, project_id, environment_id, release)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_stack_resolutions_artifact_scope_release_file_fk'
  ) THEN
    ALTER TABLE error_stack_resolutions
      ADD CONSTRAINT error_stack_resolutions_artifact_scope_release_file_fk
      FOREIGN KEY (source_map_artifact_id, project_id, environment_id, release, minified_file)
      REFERENCES source_map_artifacts(id, project_id, environment_id, release, minified_file);
  END IF;
END $$;
