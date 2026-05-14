ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS source_maps_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_maps_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS source_maps_batch_size integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS deleted_source_map_artifacts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_source_map_files integer NOT NULL DEFAULT 0;

ALTER TABLE retention_runs
  ADD CONSTRAINT retention_runs_source_maps_days_positive CHECK (source_maps_days > 0),
  ADD CONSTRAINT retention_runs_source_maps_batch_size_positive CHECK (source_maps_batch_size > 0),
  ADD CONSTRAINT retention_runs_deleted_source_map_artifacts_nonnegative CHECK (deleted_source_map_artifacts >= 0),
  ADD CONSTRAINT retention_runs_deleted_source_map_files_nonnegative CHECK (deleted_source_map_files >= 0);

CREATE INDEX IF NOT EXISTS source_map_artifacts_retention_idx
  ON source_map_artifacts (created_at, id)
  WHERE deleted_at IS NULL;
