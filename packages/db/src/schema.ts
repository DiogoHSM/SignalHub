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

export interface ProjectBrowserOriginsTable {
  id: string;
  project_id: string;
  origin: string;
  created_at: Timestamp;
  archived_at: NullableTimestamp;
}

export type CodeIntegrationProvider = "github" | "gitlab";

export interface ProjectCodeIntegrationsTable {
  id: string;
  project_id: string;
  provider: CodeIntegrationProvider;
  name: string;
  owner: string;
  repo: string;
  web_base_url: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  revoked_at: NullableTimestamp;
}

export interface IncidentExternalLinksTable {
  id: string;
  project_id: string;
  environment_id: string;
  error_group_id: string;
  integration_id: string | null;
  provider: CodeIntegrationProvider;
  external_key: string;
  title: string;
  url: string;
  state: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReleaseMetadataTable {
  id: string;
  project_id: string;
  environment_id: string;
  release: string;
  integration_id: string | null;
  commit_sha: string | null;
  commit_url: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
  deployed_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type AnalyticsSegmentActorType = "user" | "tenant";

export interface AnalyticsSegmentsTable {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  description: string | null;
  actor_type: AnalyticsSegmentActorType;
  definition: JsonColumn;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AnalyticsDashboardsTable {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  description: string | null;
  category: "executive" | "operational" | "product";
  filters: JsonColumn;
  widgets: JsonColumn;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export type ExperimentStatus = "draft" | "running" | "paused" | "completed" | "archived";
export type ExperimentActorType = "user" | "tenant" | "session";

export interface ExperimentsTable {
  id: string;
  project_id: string;
  environment_id: string;
  key: string;
  name: string;
  description: string | null;
  status: ColumnType<ExperimentStatus, ExperimentStatus | undefined, ExperimentStatus>;
  actor_type: ColumnType<ExperimentActorType, ExperimentActorType | undefined, ExperimentActorType>;
  exposure_event: string;
  conversion_event: string;
  variants: JsonColumn;
  primary_metric: JsonColumn;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export type FeatureFlagStatus = "draft" | "active" | "paused" | "archived";

export interface FeatureFlagsTable {
  id: string;
  project_id: string;
  environment_id: string;
  key: string;
  name: string;
  description: string | null;
  status: ColumnType<FeatureFlagStatus, FeatureFlagStatus | undefined, FeatureFlagStatus>;
  default_variant: string;
  variants: JsonColumn;
  rules: JsonColumn;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export type FeatureFlagAuditAction = "created" | "updated" | "archived";

export interface FeatureFlagAuditTable {
  id: string;
  feature_flag_id: string;
  project_id: string;
  environment_id: string;
  action: FeatureFlagAuditAction;
  actor_id: string | null;
  changes: JsonColumn;
  created_at: Timestamp;
}

export type BetaProgramStatus = "draft" | "active" | "paused" | "archived";
export type BetaProgramActorType = "user" | "tenant";

export interface BetaProgramsTable {
  id: string;
  project_id: string;
  environment_id: string;
  key: string;
  name: string;
  description: string | null;
  status: ColumnType<BetaProgramStatus, BetaProgramStatus | undefined, BetaProgramStatus>;
  actor_type: ColumnType<BetaProgramActorType, BetaProgramActorType | undefined, BetaProgramActorType>;
  feature_flag_id: string | null;
  feature_flag_variant: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export type BetaProgramParticipantStatus = "invited" | "active" | "opted_out" | "removed";

export interface BetaProgramParticipantsTable {
  id: string;
  program_id: string;
  project_id: string;
  environment_id: string;
  actor_type: ColumnType<BetaProgramActorType, BetaProgramActorType | undefined, BetaProgramActorType>;
  actor_id: string;
  status: ColumnType<BetaProgramParticipantStatus, BetaProgramParticipantStatus | undefined, BetaProgramParticipantStatus>;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  removed_at: NullableTimestamp;
}

export interface DataGovernancePoliciesTable {
  project_id: string;
  environment_id: string;
  retention_policy: JsonColumn;
  property_rules: JsonColumn;
  updated_by_user_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type WarehouseDestinationType = "postgres";
export type WarehouseExportRunTrigger = "scheduled" | "manual" | "retry";
export type WarehouseExportRunStatus = "running" | "success" | "failed";

export interface WarehouseDestinationsTable {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  destination_type: WarehouseDestinationType;
  connection_url: string;
  datasets: JsonColumn;
  cursor: JsonColumn;
  batch_size: DefaultedInteger;
  enabled: DefaultedBoolean;
  last_run_at: NullableTimestamp;
  last_success_at: NullableTimestamp;
  last_failure_at: NullableTimestamp;
  last_error_message: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface WarehouseExportRunsTable {
  id: string;
  destination_id: string;
  project_id: string;
  environment_id: string;
  trigger: WarehouseExportRunTrigger;
  status: WarehouseExportRunStatus;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
  cursor_before: JsonColumn;
  cursor_after: JsonColumn;
  exported: JsonColumn;
  error_message: string | null;
  created_at: Timestamp;
}

export interface EnvironmentsTable {
  id: string;
  project_id: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface UserProfilesTable {
  project_id: string;
  environment_id: string;
  user_id: string;
  tenant_id: string | null;
  traits: JsonColumn;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  updated_at: Timestamp;
}

export interface TenantProfilesTable {
  project_id: string;
  environment_id: string;
  tenant_id: string;
  traits: JsonColumn;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  updated_at: Timestamp;
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
  replay_id: string | null;
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
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";

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
  priority: ErrorGroupPriority | null;
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
  assigned_to_user_id: string | null;
  silenced_until: NullableTimestamp;
  incident_number: string | null;
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
  replay_id: string | null;
  context: JsonColumn;
  error_group_id: string | null;
  grouping_fingerprint: string | null;
}

export interface SessionReplaysTable {
  id: string;
  replay_id: string;
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
  route: string | null;
  error_id: string | null;
  started_at: Timestamp;
  ended_at: NullableTimestamp;
  duration_ms: number | null;
  event_count: DefaultedInteger;
  masked: DefaultedBoolean;
  events: JsonColumn;
  created_at: Timestamp;
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

export interface WebVitalsTable {
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
  value: RequiredNumericString;
  rating: string;
  route: string | null;
  navigation_type: string | null;
}

export interface ClickEventsTable {
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
  route: string;
  selector: string;
  element_tag: string | null;
  element_role: string | null;
  x: RequiredNumericString;
  y: RequiredNumericString;
  viewport_width: number;
  viewport_height: number;
  scroll_x: number | null;
  scroll_y: number | null;
  masked: DefaultedBoolean;
}

export interface ProfilesTable {
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
  kind: "cpu" | "memory";
  runtime: string;
  service: string | null;
  route: string | null;
  started_at: Timestamp;
  ended_at: NullableTimestamp;
  duration_ms: number | null;
  sample_count: DefaultedInteger;
  sampling_interval_ms: number | null;
  cpu_usage_percent: NullableNumericString;
  cpu_user_ms: number | null;
  cpu_system_ms: number | null;
  rss_bytes: NullableNumericString;
  heap_used_bytes: NullableNumericString;
  heap_total_bytes: NullableNumericString;
  external_bytes: NullableNumericString;
  array_buffers_bytes: NullableNumericString;
  top_functions: JsonColumn;
  summary: JsonColumn;
}

export interface DeadLetterJobsTable {
  id: string;
  project_id: string | null;
  environment_id: string | null;
  queue_name: string;
  job_name: string;
  payload: JsonColumn;
  error_message: string;
  created_at: Timestamp;
}

export interface DeadLetterJobActionsTable {
  id: string;
  dead_letter_job_id: string;
  queue_name: string;
  job_name: string;
  action: "deleted" | "replayed" | "expired";
  actor_user_id: string | null;
  actor_email: string;
  metadata: JsonColumn;
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
  deleted_web_vitals: DefaultedInteger;
  deleted_profiles: DefaultedInteger;
  deleted_breadcrumbs: DefaultedInteger;
  deleted_dead_letter_jobs: DefaultedInteger;
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
  profiles_days: DefaultedInteger;
  breadcrumbs_days: DefaultedInteger;
  dead_letter_jobs_days: DefaultedInteger;
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

export interface SystemHealthSamplesTable {
  id: ColumnType<string, string | undefined, string>;
  captured_at: Timestamp;
  postgres_latency_ms: number | null;
  redis_latency_ms: number | null;
  queue_waiting: DefaultedInteger;
  queue_active: DefaultedInteger;
  queue_failed: DefaultedInteger;
}

export type AlertRuleType =
  | "critical_errors"
  | "error_count"
  | "error_rate"
  | "trace_p95_latency"
  | "llm_cost"
  | "dead_letter_count";
export type AlertSeverity = "info" | "warning" | "critical";

export interface NotificationChannelsTable {
  id: ColumnType<string, string | undefined, string>;
  name: string;
  type: "webhook" | "email";
  url: string | null;
  email_recipients: JsonColumn;
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
  escalation_channel_id: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  window_minutes: number;
  threshold: RequiredNumericString;
  cooldown_minutes: number;
  escalation_minutes: number | null;
  route_pattern: string | null;
  minimum_sample_size: number;
  enabled: DefaultedBoolean;
  last_evaluated_at: NullableTimestamp;
  last_triggered_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AlertEventsTable {
  id: ColumnType<string, string | undefined, string>;
  rule_id: string | null;
  monitor_id: string | null;
  project_id: string;
  environment_id: string;
  status: "triggered" | "acknowledged" | "snoozed" | "resolved";
  severity: AlertSeverity;
  triggered_at: Timestamp;
  window_start: Timestamp;
  window_end: Timestamp;
  observed_value: RequiredNumericString;
  threshold: RequiredNumericString;
  message: string;
  metadata: JsonColumn;
  acknowledged_at: NullableTimestamp;
  acknowledged_by_user_id: string | null;
  acknowledged_by_email: string | null;
  resolved_at: NullableTimestamp;
  resolved_by_user_id: string | null;
  resolved_by_email: string | null;
  snoozed_until: NullableTimestamp;
  triage_note: string | null;
  escalation_due_at: NullableTimestamp;
  escalated_at: NullableTimestamp;
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

export interface MonitorsTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  notification_channel_id: string | null;
  kind: "http" | "heartbeat";
  name: string;
  enabled: DefaultedBoolean;
  status: "unknown" | "up" | "down" | "degraded" | "paused";
  url: string | null;
  method: "GET" | "HEAD" | null;
  expected_status: string | null;
  body_contains: string | null;
  timeout_ms: number | null;
  interval_minutes: number | null;
  failure_threshold: number;
  recovery_threshold: number;
  consecutive_failures: number;
  consecutive_successes: number;
  expected_interval_minutes: number | null;
  grace_minutes: number | null;
  secret_hash: string | null;
  last_checked_at: NullableTimestamp;
  last_check_status: "success" | "failed" | null;
  last_check_latency_ms: number | null;
  last_check_response_status: number | null;
  last_check_error_message: string | null;
  last_heartbeat_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface MonitorChecksTable {
  id: ColumnType<string, string | undefined, string>;
  monitor_id: string;
  checked_at: Timestamp;
  status: "success" | "failed";
  latency_ms: number | null;
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

export interface TriageNotesTable {
  id: string;
  error_group_id: string;
  author_user_id: string | null;
  author_email: string;
  body: string;
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
  project_browser_origins: ProjectBrowserOriginsTable;
  project_code_integrations: ProjectCodeIntegrationsTable;
  incident_external_links: IncidentExternalLinksTable;
  release_metadata: ReleaseMetadataTable;
  analytics_segments: AnalyticsSegmentsTable;
  analytics_dashboards: AnalyticsDashboardsTable;
  experiments: ExperimentsTable;
  feature_flags: FeatureFlagsTable;
  feature_flag_audit: FeatureFlagAuditTable;
  beta_programs: BetaProgramsTable;
  beta_program_participants: BetaProgramParticipantsTable;
  data_governance_policies: DataGovernancePoliciesTable;
  warehouse_destinations: WarehouseDestinationsTable;
  warehouse_export_runs: WarehouseExportRunsTable;
  environments: EnvironmentsTable;
  user_profiles: UserProfilesTable;
  tenant_profiles: TenantProfilesTable;
  api_keys: ApiKeysTable;
  source_map_upload_tokens: SourceMapUploadTokensTable;
  events: EventsTable;
  breadcrumbs: BreadcrumbsTable;
  error_groups: ErrorGroupsTable;
  errors: ErrorsTable;
  session_replays: SessionReplaysTable;
  llm_calls: LlmCallsTable;
  traces: TracesTable;
  spans: SpansTable;
  web_vitals: WebVitalsTable;
  click_events: ClickEventsTable;
  profiles: ProfilesTable;
  dead_letter_jobs: DeadLetterJobsTable;
  dead_letter_job_actions: DeadLetterJobActionsTable;
  retention_runs: RetentionRunsTable;
  backup_runs: BackupRunsTable;
  system_heartbeats: SystemHeartbeatsTable;
  system_health_samples: SystemHealthSamplesTable;
  notification_channels: NotificationChannelsTable;
  alert_rules: AlertRulesTable;
  alert_events: AlertEventsTable;
  notification_deliveries: NotificationDeliveriesTable;
  monitors: MonitorsTable;
  monitor_checks: MonitorChecksTable;
  source_map_artifacts: SourceMapArtifactsTable;
  error_stack_resolutions: ErrorStackResolutionsTable;
  triage_notes: TriageNotesTable;
  _migrations: MigrationsTable;
}
