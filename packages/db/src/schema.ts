import type { ColumnType } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type JsonColumn = ColumnType<unknown, unknown | undefined, unknown>;
type NullableJsonColumn = ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
type DefaultedBoolean = ColumnType<boolean, boolean | undefined, boolean>;
type DefaultedInteger = ColumnType<number, number | undefined, number>;
type NumericString = ColumnType<string, string | number | undefined, string | number>;
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
  events_days: number;
  errors_days: number;
  traces_days: number;
  spans_days: number;
  llm_calls_days: number;
  created_at: Timestamp;
}

export interface SystemHeartbeatsTable {
  component: string;
  last_heartbeat_at: Timestamp;
  metadata: JsonColumn;
  updated_at: Timestamp;
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
  events: EventsTable;
  errors: ErrorsTable;
  llm_calls: LlmCallsTable;
  traces: TracesTable;
  spans: SpansTable;
  dead_letter_jobs: DeadLetterJobsTable;
  retention_runs: RetentionRunsTable;
  system_heartbeats: SystemHeartbeatsTable;
  _migrations: MigrationsTable;
}
