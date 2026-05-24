import type { ColumnType } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type JsonColumn = ColumnType<unknown, unknown | undefined, unknown>;
type NullableJsonColumn = ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
type DefaultedBoolean = ColumnType<boolean, boolean | undefined, boolean>;
type DefaultedInteger = ColumnType<number, number | undefined, number>;
type NumericString = ColumnType<string, string | number | undefined, string | number>;
type RequiredNumericString = ColumnType<string, string | number, string | number>;
type NullableNumericString = ColumnType<string | null, string | number | null | undefined, string | number | null>;

export interface UsersTable {
  id: string;
  email: string;
  password_hash: string | null;
  google_subject: string | null;
  is_admin: DefaultedBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface ProjectsTable {
  id: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface EnvironmentsTable {
  id: string;
  project_id: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface ApiKeysTable {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  prefix: string;
  hash: string;
  created_at: Timestamp;
  revoked_at: NullableTimestamp;
}

export type SourceMapUploadTokensTable = {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  prefix: string;
  hash: string;
  created_at: Timestamp;
  last_used_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
};

export interface EventsTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  name: string;
  properties: JsonColumn;
}

export interface BreadcrumbsTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  type: "navigation" | "click" | "console" | "network" | "custom";
  category: string | null;
  message: string;
  level: "debug" | "info" | "warning" | "error" | "fatal";
  data: JsonColumn;
}

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export interface ErrorGroupsTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  grouping_fingerprint: string;
  message: string;
  type: string | null;
  top_stack_frame: string | null;
  severity: string;
  status: ColumnType<ErrorGroupStatus, ErrorGroupStatus | undefined, ErrorGroupStatus>;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  last_regressed_at: NullableTimestamp;
  occurrence_count: DefaultedInteger;
  affected_users_count: DefaultedInteger;
  affected_tenants_count: DefaultedInteger;
  latest_error_id: string | null;
  latest_release: string | null;
  resolved_at: NullableTimestamp;
  ignored_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ErrorsTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  message: string;
  type: string | null;
  severity: string;
  stack: string | null;
  status: ColumnType<string, string | undefined, string>;
  fingerprint: string | null;
  context: JsonColumn;
  error_group_id: string | null;
  grouping_fingerprint: string | null;
}

export interface LlmCallsTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  provider: string;
  model: string;
  prompt_name: string | null;
  input_tokens: DefaultedInteger;
  output_tokens: DefaultedInteger;
  cost_usd: NumericString;
  latency_ms: number | null;
  status: string;
  error: string | null;
  input_preview: string | null;
  output_preview: string | null;
}

export interface TracesTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  name: string;
  status: string;
  started_at: Timestamp;
  ended_at: NullableTimestamp;
  duration_ms: number | null;
}

export interface SpansTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  parent_span_id: string | null;
  name: string;
  status: string;
  started_at: Timestamp;
  ended_at: NullableTimestamp;
  duration_ms: number | null;
  input: NullableJsonColumn;
  output: NullableJsonColumn;
  error: NullableJsonColumn;
  cost_usd: NullableNumericString;
}

export interface DeadLetterJobsTable {
  id: string;
  queue_name: string;
  job_name: string;
  payload: JsonColumn;
  error_message: string;
  created_at: Timestamp;
}

export interface RetentionRunsTable {
  id: ColumnType<string, string | undefined, string>;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
  status: "success" | "failed";
  error_message: string | null;
  deleted_events: DefaultedInteger;
  deleted_errors: DefaultedInteger;
  deleted_traces: DefaultedInteger;
  deleted_spans: DefaultedInteger;
  deleted_llm_calls: DefaultedInteger;
  deleted_breadcrumbs: DefaultedInteger;
  source_maps_enabled: DefaultedBoolean;
  source_maps_days: DefaultedInteger;
  source_maps_batch_size: DefaultedInteger;
  deleted_source_map_artifacts: DefaultedInteger;
  deleted_source_map_files: DefaultedInteger;
  events_days: number;
  errors_days: number;
  traces_days: number;
  spans_days: number;
  llm_calls_days: number;
  breadcrumbs_days: DefaultedInteger;
  created_at: Timestamp;
}

export interface BackupRunsTable {
  id: ColumnType<string, string | undefined, string>;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  filename: string;
  local_path: string;
  size_bytes: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  checksum_sha256: string | null;
  s3_bucket: string | null;
  s3_key: string | null;
  error_message: string | null;
  created_at: Timestamp;
}

export interface SystemHeartbeatsTable {
  component: string;
  last_heartbeat_at: Timestamp;
  metadata: JsonColumn;
  updated_at: Timestamp;
}

export type AlertRuleType = "critical_errors" | "error_count" | "trace_p95_latency" | "llm_cost";
export type AlertSeverity = "info" | "warning" | "critical";

export interface NotificationChannelsTable {
  id: ColumnType<string, string | undefined, string>;
  name: string;
  type: "webhook";
  url: string;
  secret_header_name: string | null;
  secret_header_value: string | null;
  enabled: DefaultedBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AlertRulesTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  notification_channel_id: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  window_minutes: number;
  threshold: RequiredNumericString;
  cooldown_minutes: number;
  enabled: DefaultedBoolean;
  last_evaluated_at: NullableTimestamp;
  last_triggered_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AlertEventsTable {
  id: ColumnType<string, string | undefined, string>;
  rule_id: string;
  project_id: string;
  environment_id: string;
  status: "triggered";
  severity: AlertSeverity;
  triggered_at: Timestamp;
  window_start: Timestamp;
  window_end: Timestamp;
  observed_value: RequiredNumericString;
  threshold: RequiredNumericString;
  message: string;
  metadata: JsonColumn;
  created_at: Timestamp;
}

export interface NotificationDeliveriesTable {
  id: ColumnType<string, string | undefined, string>;
  alert_event_id: string;
  notification_channel_id: string;
  status: "success" | "failed";
  attempted_at: Timestamp;
  response_status: number | null;
  error_message: string | null;
  created_at: Timestamp;
}

export interface SourceMapArtifactsTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  release: string;
  minified_file: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  storage_path: string;
  uploaded_by_user_id: string | null;
  uploaded_by_token_id: string | null;
  created_at: Timestamp;
  deleted_at: NullableTimestamp;
}

export interface ErrorStackResolutionsTable {
  id: ColumnType<string, string | undefined, string>;
  error_id: string;
  project_id: string;
  environment_id: string;
  release: string;
  source_map_artifact_id: string;
  frame_index: number;
  minified_file: string;
  minified_line: number;
  minified_column: number;
  original_source: string;
  original_line: number;
  original_column: number;
  original_name: string | null;
  created_at: Timestamp;
}

export interface MigrationsTable {
  name: string;
  checksum: string;
  applied_at: Timestamp;
}

export interface Database {
  users: UsersTable;
  projects: ProjectsTable;
  environments: EnvironmentsTable;
  api_keys: ApiKeysTable;
  source_map_upload_tokens: SourceMapUploadTokensTable;
  events: EventsTable;
  breadcrumbs: BreadcrumbsTable;
  error_groups: ErrorGroupsTable;
  errors: ErrorsTable;
  llm_calls: LlmCallsTable;
  traces: TracesTable;
  spans: SpansTable;
  dead_letter_jobs: DeadLetterJobsTable;
  retention_runs: RetentionRunsTable;
  backup_runs: BackupRunsTable;
  system_heartbeats: SystemHeartbeatsTable;
  notification_channels: NotificationChannelsTable;
  alert_rules: AlertRulesTable;
  alert_events: AlertEventsTable;
  notification_deliveries: NotificationDeliveriesTable;
  source_map_artifacts: SourceMapArtifactsTable;
  error_stack_resolutions: ErrorStackResolutionsTable;
  _migrations: MigrationsTable;
}
