CREATE TABLE source_map_artifacts (
  id text PRIMARY KEY DEFAULT ('smap_' || encode(gen_random_bytes(12), 'hex')),
  project_id text NOT NULL,
  environment_id text NOT NULL,
  release text NOT NULL,
  minified_file text NOT NULL,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by_user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT source_map_artifacts_byte_size_check CHECK (byte_size > 0)
);

CREATE UNIQUE INDEX source_map_artifacts_active_unique_idx
  ON source_map_artifacts(project_id, environment_id, release, minified_file)
  WHERE deleted_at IS NULL;

CREATE INDEX source_map_artifacts_scope_release_idx
  ON source_map_artifacts(project_id, environment_id, release, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE error_stack_resolutions (
  id text PRIMARY KEY DEFAULT ('esr_' || encode(gen_random_bytes(12), 'hex')),
  error_id text NOT NULL REFERENCES errors(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  release text NOT NULL,
  source_map_artifact_id text NOT NULL REFERENCES source_map_artifacts(id),
  frame_index integer NOT NULL,
  minified_file text NOT NULL,
  minified_line integer NOT NULL,
  minified_column integer NOT NULL,
  original_source text NOT NULL,
  original_line integer NOT NULL,
  original_column integer NOT NULL,
  original_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT error_stack_resolutions_frame_index_check CHECK (frame_index >= 0),
  CONSTRAINT error_stack_resolutions_minified_line_check CHECK (minified_line > 0),
  CONSTRAINT error_stack_resolutions_minified_column_check CHECK (minified_column >= 0),
  CONSTRAINT error_stack_resolutions_original_line_check CHECK (original_line > 0),
  CONSTRAINT error_stack_resolutions_original_column_check CHECK (original_column >= 0)
);

CREATE UNIQUE INDEX error_stack_resolutions_error_frame_idx
  ON error_stack_resolutions(error_id, frame_index);

CREATE INDEX error_stack_resolutions_artifact_idx
  ON error_stack_resolutions(source_map_artifact_id);
