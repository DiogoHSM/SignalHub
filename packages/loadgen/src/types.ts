import type { SignalMetadata, SignalStatus } from "@sigmon/sdk";

export type MonitorKind = "http" | "heartbeat";

export type ServiceDefinition = {
  name: string;
  role: string;
  callsServices: string[];
  eventsPerHour: number;
  errorRatePercent: number;
  tracesPerHour: number;
  hasLlmCalls: boolean;
  llmCallsPerHour: number;
};

export type IncidentTemplate = {
  key: string;
  serviceName: string;
  errorRateMultiplier: number;
  llmCallMultiplier: number;
  durationMinutes: number;
  monitorKind?: MonitorKind;
};

export type TenantIdentity = {
  tenantId: string;
  traits: SignalMetadata;
};

export type UserIdentity = {
  userId: string;
  tenantId?: string;
  traits: SignalMetadata;
};

export type Profile = {
  key: string;
  services: ServiceDefinition[];
  incidents: IncidentTemplate[];
  tenants: TenantIdentity[];
  users: UserIdentity[];
};

type BeatBase = {
  timestampMs: number;
  projectIndex: number;
  serviceName: string;
};

export type EventBeat = BeatBase & {
  kind: "event";
  name: string;
  properties: SignalMetadata;
};

export type ErrorBeat = BeatBase & {
  kind: "error";
  message: string;
  severity: "error";
  traceId?: string;
};

export type TraceBeat = BeatBase & {
  kind: "trace";
  traceId: string;
  name: string;
  status: SignalStatus;
  durationMs: number;
};

export type SpanBeat = BeatBase & {
  kind: "span";
  callerServiceName: string;
  traceId: string;
  name: string;
  status: SignalStatus;
  durationMs: number;
};

export type LlmCallBeat = BeatBase & {
  kind: "llmCall";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: SignalStatus;
};

export type IdentifyUserBeat = BeatBase & {
  kind: "identifyUser";
  userId: string;
  tenantId?: string;
  traits: SignalMetadata;
};

export type IdentifyTenantBeat = BeatBase & {
  kind: "identifyTenant";
  tenantId: string;
  traits: SignalMetadata;
};

export type BreadcrumbBeat = BeatBase & {
  kind: "breadcrumb";
  message: string;
};

export type Beat =
  | EventBeat
  | ErrorBeat
  | TraceBeat
  | SpanBeat
  | LlmCallBeat
  | IdentifyUserBeat
  | IdentifyTenantBeat
  | BreadcrumbBeat;

export type IncidentWindow = {
  startMs: number;
  endMs: number;
  projectIndex: number;
  serviceName: string;
  incidentKey: string;
  errorRateMultiplier: number;
  llmCallMultiplier: number;
  monitorKind?: MonitorKind;
};

export type Timeline = {
  beats: Beat[];
  incidentWindows: IncidentWindow[];
};
