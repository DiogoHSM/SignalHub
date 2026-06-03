import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createApiKey,
  createSourceMapUploadToken,
  hashApiKey as hashTelemetryApiKey
} from "@sigmon/telemetry/api-keys";
import { validateWebhookTargetUrl } from "@sigmon/config";
import type {
  CreateHeartbeatMonitorInput,
  CreateHttpMonitorInput,
  MonitorCheckRecord,
  MonitorKind,
  MonitorRecord,
  UpdateMonitorInput
} from "@sigmon/db/repositories/monitors.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";
import type { AlertRuleRecord, NotificationChannelRecord } from "@sigmon/db/repositories/alerts.js";

export interface AdminProject {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface AdminEnvironment {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface AdminProjectBrowserOrigin {
  id: string;
  projectId: string;
  origin: string;
  createdAt: Date;
  archivedAt: Date | null;
}

export interface AdminApiKey {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export type UserAdministrationDependencies = {
  listUsers?: () => Promise<AuthenticatedUser[]>;
  createUser?: (input: CreateUserInput) => Promise<AuthenticatedUser>;
  updateUser?: (id: string, input: UpdateUserInput) => Promise<AuthenticatedUser | null | undefined>;
  archiveUser?: (id: string) => Promise<void>;
};

export type ProjectAdministrationDependencies = {
  list: () => Promise<AdminProject[]>;
  get: (id: string) => Promise<AdminProject | null | undefined>;
  create: (input: CreateProjectInput) => Promise<AdminProject>;
  update: (id: string, input: UpdateProjectInput) => Promise<AdminProject | null | undefined>;
  archive: (id: string) => Promise<void>;
};

export type EnvironmentAdministrationDependencies = {
  list: (projectId: string) => Promise<AdminEnvironment[]>;
  create: (input: CreateEnvironmentInput) => Promise<AdminEnvironment>;
  update: (id: string, input: UpdateEnvironmentInput) => Promise<AdminEnvironment | null | undefined>;
  archive: (id: string) => Promise<void>;
};

export type ApiKeyAdministrationDependencies = {
  list: (projectId: string) => Promise<AdminApiKey[]>;
  create: (input: CreateApiKeyRecordInput) => Promise<AdminApiKey>;
  revoke: (id: string) => Promise<void>;
};

export type BrowserOriginAdministrationDependencies = {
  list: (projectId: string) => Promise<AdminProjectBrowserOrigin[]>;
  create: (input: CreateBrowserOriginInput) => Promise<AdminProjectBrowserOrigin>;
  archive: (id: string) => Promise<void>;
};

export type AdminResourceDependencies = {
  projects?: ProjectAdministrationDependencies;
  environments?: EnvironmentAdministrationDependencies;
  apiKeys?: ApiKeyAdministrationDependencies;
  browserOrigins?: BrowserOriginAdministrationDependencies;
};

export type AlertAdministrationDependencies = {
  listNotificationChannels?: () => Promise<NotificationChannelRecord[]>;
  createNotificationChannel?: (input: CreateNotificationChannelInput) => Promise<NotificationChannelRecord>;
  updateNotificationChannel?: (
    id: string,
    input: UpdateNotificationChannelInput
  ) => Promise<NotificationChannelRecord | null | undefined>;
  archiveNotificationChannel?: (id: string) => Promise<void>;
  getNotificationChannel?: (id: string) => Promise<NotificationChannelRecord | null | undefined>;
  listAlertRules?: (filters: AlertRuleListFilters) => Promise<AlertRuleRecord[]>;
  createAlertRule?: (input: CreateAlertRuleInput) => Promise<AlertRuleRecord>;
  updateAlertRule?: (id: string, input: UpdateAlertRuleInput) => Promise<AlertRuleRecord | null | undefined>;
  archiveAlertRule?: (id: string) => Promise<void>;
};

export type MonitorAdministrationDependencies = {
  listMonitors?: (filters: MonitorListFilters) => Promise<MonitorRecord[]>;
  getMonitor?: (id: string) => Promise<MonitorRecord | null | undefined>;
  createHttpMonitor?: (input: CreateHttpMonitorInput) => Promise<MonitorRecord>;
  createHeartbeatMonitor?: (input: CreateHeartbeatMonitorInput) => Promise<MonitorRecord>;
  updateMonitor?: (id: string, input: UpdateMonitorInput) => Promise<MonitorRecord | null | undefined>;
  archiveMonitor?: (id: string) => Promise<void>;
  listMonitorChecks?: (input: { monitorId: string; limit?: number }) => Promise<MonitorCheckRecord[]>;
};

export type SourceMapUploadAttribution =
  | { uploadedByUserId: string; uploadedByTokenId?: never }
  | { uploadedByUserId?: never; uploadedByTokenId: string };

export type SourceMapUploadInput = SourceMapUploadAttribution & {
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile?: string;
  originalFilename: string;
  contentType: string;
  content: Buffer;
};

export type SourceMapBundleUploadInput = SourceMapUploadAttribution & {
  projectId: string;
  environmentId: string;
  release: string;
  originalFilename: string;
  contentType: string;
  content: Buffer;
};

export type SourceMapArtifactResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
  uploadedByUserId: string | null;
  uploadedByTokenId?: string | null;
  createdAt: Date | string;
  deletedAt: Date | string | null;
};

export type SourceMapAdministrationDependencies = {
  list?: (filters: { projectId: string; environmentId: string; release?: string }) => Promise<SourceMapArtifactResponse[]>;
  uploadMap?: (input: SourceMapUploadInput) => Promise<SourceMapArtifactResponse[]>;
  uploadBundle?: (input: SourceMapBundleUploadInput) => Promise<SourceMapArtifactResponse[]>;
  remove?: (input: { id: string; projectId: string; environmentId: string }) => Promise<void>;
};

export type SourceMapUploadTokenResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
};

export type SourceMapUploadTokenAdministrationDependencies = {
  list?: (scope: { projectId: string; environmentId: string }) => Promise<SourceMapUploadTokenResponse[]>;
  create?: (input: {
    projectId: string;
    environmentId: string;
    name: string;
    prefix: string;
    hash: string;
  }) => Promise<SourceMapUploadTokenResponse>;
  revoke?: (input: { id: string; projectId: string; environmentId: string }) => Promise<void>;
};

export type AdminRouteOptions = {
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  alerts?: AlertAdministrationDependencies;
  monitors?: MonitorAdministrationDependencies;
  sourceMaps?: SourceMapAdministrationDependencies;
  sourceMapUploadTokens?: SourceMapUploadTokenAdministrationDependencies;
  createSourceMapUploadToken?: () => { secret: string; prefix: string };
  createHeartbeatSecret?: () => string;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
  hashHeartbeatSecret?: (secret: string) => Promise<string>;
  nodeEnv?: string;
};

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().trim().min(12).max(256),
  isAdmin: z.boolean().default(false)
});

const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.string().trim().min(12).max(256).optional(),
    isAdmin: z.boolean().optional()
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "at_least_one_field_required"
  });

const idParamsSchema = z.object({ id: z.string().min(1) });
const projectIdParamsSchema = z.object({ projectId: z.string().min(1) });

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(256)
});

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional()
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "at_least_one_field_required"
  });

const createEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(256)
});

const updateEnvironmentSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional()
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "at_least_one_field_required"
  });

const createApiKeySchema = z.object({
  environmentId: z.string().min(1),
  name: z.string().trim().min(1).max(256)
});

function isValidBrowserOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const createBrowserOriginSchema = z.object({
  origin: z.string().trim().min(1).max(2048).refine(isValidBrowserOrigin)
});

const notificationChannelNameSchema = z.string().trim().min(1).max(256);
const notificationChannelEmailRecipientsSchema = z.array(z.string().trim().email()).min(1).max(10);

const webhookNotificationChannelSchema = z.object({
  name: notificationChannelNameSchema,
  type: z.literal("webhook"),
  url: z.string().url(),
  secretHeaderName: z.string().trim().min(1).max(128).nullable().optional(),
  secretHeaderValue: z.string().trim().min(1).max(4096).nullable().optional(),
  enabled: z.boolean().default(true)
});

const emailNotificationChannelSchema = z.object({
  name: notificationChannelNameSchema,
  type: z.literal("email"),
  emailRecipients: notificationChannelEmailRecipientsSchema,
  enabled: z.boolean().default(true)
});

const notificationChannelSchema = z
  .discriminatedUnion("type", [webhookNotificationChannelSchema, emailNotificationChannelSchema])
  .refine((input) => input.type !== "webhook" || !input.secretHeaderValue || Boolean(input.secretHeaderName), {
    message: "secret_header_name_required"
  });

const updateNotificationChannelSchema = z
  .object({
    name: notificationChannelNameSchema.optional(),
    type: z.enum(["webhook", "email"]).optional(),
    url: z.string().url().nullable().optional(),
    emailRecipients: notificationChannelEmailRecipientsSchema.optional(),
    secretHeaderName: z.string().trim().min(1).max(128).nullable().optional(),
    secretHeaderValue: z.string().trim().min(1).max(4096).nullable().optional(),
    enabled: z.boolean().optional()
  })
  .refine((input) => input.secretHeaderValue == null || typeof input.secretHeaderName === "string", {
    message: "secret_header_name_required"
  })
  .refine((input) => Object.keys(input).length > 0, { message: "at_least_one_field_required" });

const thresholdSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0);
const minimumSampleSizeSchema = z.number().int().min(1);

const alertRuleBaseSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  notificationChannelId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(256),
  type: z.enum(["critical_errors", "error_count", "error_rate", "trace_p95_latency", "llm_cost"]),
  severity: z.enum(["info", "warning", "critical"]),
  windowMinutes: z.number().int().min(1),
  threshold: thresholdSchema,
  cooldownMinutes: z.number().int().min(1),
  routePattern: z.string().trim().min(1).max(256).nullable().optional(),
  minimumSampleSize: minimumSampleSizeSchema,
  enabled: z.boolean()
});

const alertRuleSchema = alertRuleBaseSchema.extend({
  minimumSampleSize: minimumSampleSizeSchema.default(1),
  enabled: z.boolean().default(true)
});

const updateAlertRuleSchema = alertRuleBaseSchema.partial().refine((input) => Object.keys(input).length > 0, {
  message: "at_least_one_field_required"
});

const alertRuleListQuerySchema = z.object({
  project_id: z.string().trim().min(1).optional(),
  environment_id: z.string().trim().min(1).optional()
});

const monitorKindSchema = z.enum(["http", "heartbeat"]);
const monitorStatusSchema = z.enum(["unknown", "up", "down", "degraded", "paused"]);
const expectedStatusSchema = z.string().trim().regex(/^(\d{3}|\d{3}-\d{3}|[1-5]xx)$/);

const httpMonitorSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  notificationChannelId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(256),
  url: z.string().url(),
  method: z.enum(["GET", "HEAD"]).default("GET"),
  intervalMinutes: z.number().int().min(1).default(5),
  timeoutMs: z.number().int().min(100).max(60_000).default(5000),
  expectedStatus: expectedStatusSchema.default("2xx"),
  bodyContains: z.string().trim().min(1).max(2048).nullable().optional(),
  failureThreshold: z.number().int().min(1).default(2),
  recoveryThreshold: z.number().int().min(1).default(2),
  enabled: z.boolean().default(true)
});

const heartbeatMonitorSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  notificationChannelId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(256),
  expectedIntervalMinutes: z.number().int().min(1),
  graceMinutes: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true)
});

const updateMonitorSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    environmentId: z.string().trim().min(1).optional(),
    notificationChannelId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(256).optional(),
    enabled: z.boolean().optional(),
    status: monitorStatusSchema.optional(),
    url: z.string().url().nullable().optional(),
    method: z.enum(["GET", "HEAD"]).nullable().optional(),
    expectedStatus: expectedStatusSchema.nullable().optional(),
    bodyContains: z.string().trim().min(1).max(2048).nullable().optional(),
    timeoutMs: z.number().int().min(100).max(60_000).nullable().optional(),
    intervalMinutes: z.number().int().min(1).nullable().optional(),
    failureThreshold: z.number().int().min(1).optional(),
    recoveryThreshold: z.number().int().min(1).optional(),
    expectedIntervalMinutes: z.number().int().min(1).nullable().optional(),
    graceMinutes: z.number().int().min(0).nullable().optional()
  })
  .refine((input) => Object.keys(input).length > 0, { message: "at_least_one_field_required" });

const monitorListQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
  kind: monitorKindSchema.optional()
});

const monitorChecksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional()
});

const sourceMapScopeQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
  release: z.string().trim().min(1).optional()
});

const sourceMapUploadTokenScopeQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1)
});

const createSourceMapUploadTokenSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(256)
});

type CreateUserInput = z.infer<typeof createUserSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;
type CreateProjectInput = z.infer<typeof createProjectSchema>;
type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
type CreateEnvironmentBody = z.infer<typeof createEnvironmentSchema>;
type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;
type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
type CreateBrowserOriginBody = z.infer<typeof createBrowserOriginSchema>;
type CreateNotificationChannelInput = z.infer<typeof notificationChannelSchema>;
type UpdateNotificationChannelInput = z.infer<typeof updateNotificationChannelSchema>;
type CreateAlertRuleInput = z.infer<typeof alertRuleSchema>;
type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
type AlertRuleListFilters = {
  projectId?: string;
  environmentId?: string;
};
type MonitorListFilters = {
  projectId: string;
  environmentId: string;
  kind?: MonitorKind;
};
type CreateEnvironmentInput = CreateEnvironmentBody & { projectId: string };
type CreateApiKeyRecordInput = CreateApiKeyBody & { projectId: string; prefix: string; hash: string };
type CreateBrowserOriginInput = CreateBrowserOriginBody & { projectId: string };

type MultipartFieldPart = {
  type: "field";
  fieldname: string;
  value: unknown;
};

type MultipartFilePart = {
  type: "file";
  fieldname: string;
  filename: string;
  mimetype: string;
  file?: {
    resume: () => void;
  };
  toBuffer: () => Promise<Buffer>;
};

type MultipartPart = MultipartFieldPart | MultipartFilePart;

type MultipartRequest = FastifyRequest & {
  isMultipart?: () => boolean;
  parts: () => AsyncIterable<MultipartPart>;
};

function redactApiKeyHash(apiKey: AdminApiKey): Omit<AdminApiKey, "hash"> {
  const { hash: _hash, ...safeApiKey } = apiKey;
  return safeApiKey;
}

function redactSourceMapUploadToken(
  token: SourceMapUploadTokenResponse
): Omit<SourceMapUploadTokenResponse, "hash"> {
  return {
    id: token.id,
    projectId: token.projectId,
    environmentId: token.environmentId,
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt
  };
}

function redactNotificationChannel(
  channel: NotificationChannelRecord
): Omit<NotificationChannelRecord, "secretHeaderValue"> {
  const { secretHeaderValue: _secretHeaderValue, ...safeChannel } = channel;
  return safeChannel;
}

function redactMonitor(monitor: MonitorRecord): Omit<MonitorRecord, "secretHash"> {
  const { secretHash: _secretHash, ...safeMonitor } = monitor;
  return safeMonitor;
}

async function hashAdminApiKeySecret(secret: string, options: AdminRouteOptions): Promise<string | undefined> {
  if (options.hashApiKeySecret) {
    return options.hashApiKeySecret(secret);
  }

  if (options.apiKeyPepper) {
    return hashTelemetryApiKey(secret, options.apiKeyPepper);
  }

  return undefined;
}

function createDefaultHeartbeatSecret(): string {
  return `shhb_${randomBytes(32).toString("base64url")}`;
}

async function hashAdminHeartbeatSecret(secret: string, options: AdminRouteOptions): Promise<string | undefined> {
  if (options.hashHeartbeatSecret) {
    return options.hashHeartbeatSecret(secret);
  }

  if (options.apiKeyPepper) {
    return hashTelemetryApiKey(secret, options.apiKeyPepper);
  }

  return undefined;
}

function isKnownAdminResourceError(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}

const SECRET_HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

function isValidSecretHeaderName(headerName: string | null | undefined): boolean {
  if (!headerName) {
    return true;
  }

  if (!SECRET_HEADER_NAME_PATTERN.test(headerName)) {
    return false;
  }

  const normalizedHeaderName = headerName.toLowerCase();
  return normalizedHeaderName.startsWith("x-") || normalizedHeaderName.startsWith("sigmon-");
}

function validateWebhookUrl(rawUrl: string, _nodeEnv: string | undefined): boolean {
  try {
    validateWebhookTargetUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

async function validateAlertRuleNotificationChannel(
  notificationChannelId: string | null | undefined,
  options: AdminRouteOptions,
  reply: FastifyReply
): Promise<boolean> {
  if (typeof notificationChannelId !== "string") {
    return true;
  }

  if (!options.alerts?.getNotificationChannel) {
    reply.status(501).send({ error: "alert_rules_repository_unavailable" });
    return false;
  }

  let channel: NotificationChannelRecord | null | undefined;
  try {
    channel = await options.alerts.getNotificationChannel(notificationChannelId);
  } catch {
    reply.status(503).send({ error: "alert_rules_unavailable" });
    return false;
  }

  if (!channel || channel.enabled !== true || channel.archivedAt !== null) {
    reply.status(404).send({ error: "notification_channel_not_found" });
    return false;
  }

  return true;
}

async function validateMonitorNotificationChannel(
  notificationChannelId: string | null | undefined,
  options: AdminRouteOptions,
  reply: FastifyReply
): Promise<boolean> {
  if (typeof notificationChannelId !== "string") {
    return true;
  }

  if (!options.alerts?.getNotificationChannel) {
    reply.status(501).send({ error: "monitors_repository_unavailable" });
    return false;
  }

  let channel: NotificationChannelRecord | null | undefined;
  try {
    channel = await options.alerts.getNotificationChannel(notificationChannelId);
  } catch {
    reply.status(503).send({ error: "monitors_unavailable" });
    return false;
  }

  if (!channel || channel.enabled !== true || channel.archivedAt !== null) {
    reply.status(404).send({ error: "notification_channel_not_found" });
    return false;
  }

  return true;
}

function isValidNotificationChannelInput(
  input: CreateNotificationChannelInput,
  options: AdminRouteOptions
): boolean {
  if (input.type === "email") {
    return true;
  }

  return validateWebhookUrl(input.url, options.nodeEnv) && isValidSecretHeaderName(input.secretHeaderName);
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthDependencies | undefined
): Promise<AuthenticatedUser | undefined> {
  const user = await auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
  if (!user) {
    setCurrentUser(request, null);
    reply.status(401).send({ error: "unauthenticated" });
    return undefined;
  }

  setCurrentUser(request, user);
  if (!user.isAdmin) {
    reply.status(403).send({ error: "admin_required" });
    return undefined;
  }

  return user;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function drainMultipartFilePart(part: MultipartFilePart): void {
  part.file?.resume();
}

const SOURCE_MAP_BAD_REQUEST_ERRORS = new Set([
  "invalid_source_map",
  "indexed_source_maps_unsupported",
  "source_map_file_missing",
  "source_map_zip_empty",
  "source_map_duplicate_minified_file",
  "source_map_storage_path_invalid"
]);

const SOURCE_MAP_PAYLOAD_TOO_LARGE_ERRORS = new Set([
  "source_map_upload_too_large",
  "source_map_zip_uncompressed_too_large",
  "source_map_zip_too_many_entries"
]);

export function sourceMapUploadErrorStatus(error: unknown): 400 | 413 | undefined {
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") {
    return undefined;
  }

  if (SOURCE_MAP_BAD_REQUEST_ERRORS.has(error.message)) {
    return 400;
  }

  if (SOURCE_MAP_PAYLOAD_TOO_LARGE_ERRORS.has(error.message)) {
    return 413;
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  const errorText = `${name} ${code} ${error.message}`.toLowerCase();
  if (
    code.startsWith("FST_") &&
    (errorText.includes("limit") ||
      errorText.includes("too large") ||
      errorText.includes("too many") ||
      errorText.includes("field") ||
      errorText.includes("fields") ||
      errorText.includes("file") ||
      errorText.includes("files") ||
      errorText.includes("part") ||
      errorText.includes("parts"))
  ) {
    return 413;
  }
  if (
    errorText.includes("multipart") ||
    errorText.includes("part") ||
    errorText.includes("field") ||
    errorText.includes("file")
  ) {
    return errorText.includes("limit") || errorText.includes("too many") || errorText.includes("too large") ? 413 : 400;
  }
  if (errorText.includes("zip")) {
    return 400;
  }

  return undefined;
}

export async function parseSourceMapUploadRequest(
  request: FastifyRequest,
  attribution: SourceMapUploadAttribution
): Promise<SourceMapUploadInput | SourceMapBundleUploadInput | undefined> {
  const multipartRequest = request as MultipartRequest;
  if (!multipartRequest.isMultipart?.()) {
    return undefined;
  }

  const fields = new Map<string, string>();
  let file:
    | {
        kind: "file" | "bundle";
        originalFilename: string;
        contentType: string;
        content: Buffer;
      }
    | undefined;

  for await (const part of multipartRequest.parts()) {
    if (part.type === "field") {
      const value = stringField(part.value);
      if (value !== undefined) {
        fields.set(part.fieldname, value);
      }
      continue;
    }

    if (part.fieldname !== "file" && part.fieldname !== "bundle") {
      drainMultipartFilePart(part);
      return undefined;
    }

    if (file) {
      drainMultipartFilePart(part);
      return undefined;
    }

    file = {
      kind: part.fieldname,
      originalFilename: part.filename,
      contentType: part.mimetype || (part.fieldname === "file" ? "application/json" : "application/octet-stream"),
      content: await part.toBuffer()
    };
  }

  const baseInput = {
    projectId: fields.get("project_id"),
    environmentId: fields.get("environment_id"),
    release: fields.get("release")
  };
  if (!baseInput.projectId || !baseInput.environmentId || !baseInput.release || !file?.originalFilename) {
    return undefined;
  }

  if (file.kind === "bundle") {
    return {
      projectId: baseInput.projectId,
      environmentId: baseInput.environmentId,
      release: baseInput.release,
      ...attribution,
      originalFilename: file.originalFilename,
      contentType: file.contentType,
      content: file.content
    };
  }

  return {
    projectId: baseInput.projectId,
    environmentId: baseInput.environmentId,
    release: baseInput.release,
    minifiedFile: fields.get("minified_file"),
    ...attribution,
    originalFilename: file.originalFilename,
    contentType: file.contentType || "application/json",
    content: file.content
  };
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminRouteOptions): void {
  app.get("/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.users?.listUsers) {
      return reply.status(501).send({ error: "users_repository_unavailable" });
    }

    const users = await options.users.listUsers();
    return reply.send({ users });
  });

  app.post("/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.users?.createUser) {
      return reply.status(501).send({ error: "users_repository_unavailable" });
    }

    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_user_request" });
    }

    const user = await options.users.createUser(parsed.data);
    return reply.status(201).send({ user });
  });

  app.patch("/admin/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.users?.updateUser) {
      return reply.status(501).send({ error: "users_repository_unavailable" });
    }

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_user_request" });
    }

    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_user_request" });
    }

    const user = await options.users.updateUser(params.data.id, parsed.data);
    if (!user) {
      return reply.status(404).send({ error: "user_not_found" });
    }

    return reply.send({ user });
  });

  app.delete("/admin/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.users?.archiveUser) {
      return reply.status(501).send({ error: "users_repository_unavailable" });
    }

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_user_request" });
    }

    await options.users.archiveUser(params.data.id);

    return reply.status(204).send();
  });

  app.get("/admin/projects", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.projects) {
      return reply.status(501).send({ error: "projects_repository_unavailable" });
    }

    const projects = await options.adminResources.projects.list();
    return reply.send({ projects });
  });

  app.post("/admin/projects", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.projects) {
      return reply.status(501).send({ error: "projects_repository_unavailable" });
    }

    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_project_request" });
    }

    const project = await options.adminResources.projects.create(parsed.data);
    return reply.status(201).send({ project });
  });

  app.get("/admin/projects/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.projects) {
      return reply.status(501).send({ error: "projects_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_project_request" });
    }

    const project = await options.adminResources.projects.get(params.data.id);
    if (!project) {
      return reply.status(404).send({ error: "project_not_found" });
    }

    return reply.send({ project });
  });

  app.patch("/admin/projects/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.projects) {
      return reply.status(501).send({ error: "projects_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_project_request" });
    }

    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_project_request" });
    }

    const project = await options.adminResources.projects.update(params.data.id, parsed.data);
    if (!project) {
      return reply.status(404).send({ error: "project_not_found" });
    }

    return reply.send({ project });
  });

  app.delete("/admin/projects/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.projects) {
      return reply.status(501).send({ error: "projects_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_project_request" });
    }

    await options.adminResources.projects.archive(params.data.id);
    return reply.status(204).send();
  });

  app.get("/admin/projects/:projectId/browser-origins", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.browserOrigins) {
      return reply.status(501).send({ error: "browser_origins_repository_unavailable" });
    }

    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_browser_origin_request" });
    }

    const origins = await options.adminResources.browserOrigins.list(params.data.projectId);
    return reply.send({ origins });
  });

  app.post("/admin/projects/:projectId/browser-origins", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.browserOrigins) {
      return reply.status(501).send({ error: "browser_origins_repository_unavailable" });
    }

    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_browser_origin_request" });
    }

    const parsed = createBrowserOriginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_browser_origin_request" });
    }

    let origin: AdminProjectBrowserOrigin;
    try {
      origin = await options.adminResources.browserOrigins.create({
        projectId: params.data.projectId,
        origin: parsed.data.origin
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_project_not_found")) {
        return reply.status(404).send({ error: "project_not_found" });
      }
      if (isKnownAdminResourceError(error, "invalid_browser_origin")) {
        return reply.status(400).send({ error: "invalid_browser_origin_request" });
      }
      throw error;
    }

    return reply.status(201).send({ origin });
  });

  app.delete("/admin/browser-origins/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.browserOrigins) {
      return reply.status(501).send({ error: "browser_origins_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_browser_origin_request" });
    }

    await options.adminResources.browserOrigins.archive(params.data.id);
    return reply.status(204).send();
  });

  app.get("/admin/projects/:projectId/environments", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.environments) {
      return reply.status(501).send({ error: "environments_repository_unavailable" });
    }

    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_environment_request" });
    }

    const environments = await options.adminResources.environments.list(params.data.projectId);
    return reply.send({ environments });
  });

  app.post("/admin/projects/:projectId/environments", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.environments) {
      return reply.status(501).send({ error: "environments_repository_unavailable" });
    }

    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_environment_request" });
    }

    const parsed = createEnvironmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_environment_request" });
    }

    let environment: AdminEnvironment;
    try {
      environment = await options.adminResources.environments.create({
        projectId: params.data.projectId,
        ...parsed.data
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_project_not_found")) {
        return reply.status(404).send({ error: "project_not_found" });
      }
      throw error;
    }

    return reply.status(201).send({ environment });
  });

  app.patch("/admin/environments/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.environments) {
      return reply.status(501).send({ error: "environments_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_environment_request" });
    }

    const parsed = updateEnvironmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_environment_request" });
    }

    const environment = await options.adminResources.environments.update(params.data.id, parsed.data);
    if (!environment) {
      return reply.status(404).send({ error: "environment_not_found" });
    }

    return reply.send({ environment });
  });

  app.delete("/admin/environments/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.environments) {
      return reply.status(501).send({ error: "environments_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_environment_request" });
    }

    await options.adminResources.environments.archive(params.data.id);
    return reply.status(204).send();
  });

  app.get("/admin/projects/:projectId/api-keys", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.apiKeys) {
      return reply.status(501).send({ error: "api_keys_repository_unavailable" });
    }

    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_api_key_request" });
    }

    const apiKeys = await options.adminResources.apiKeys.list(params.data.projectId);
    return reply.send({ apiKeys: apiKeys.map(redactApiKeyHash) });
  });

  app.post("/admin/projects/:projectId/api-keys", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.apiKeys) {
      return reply.status(501).send({ error: "api_keys_repository_unavailable" });
    }

    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_api_key_request" });
    }

    const parsed = createApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_api_key_request" });
    }

    const generatedApiKey = createApiKey();
    const hash = await hashAdminApiKeySecret(generatedApiKey.secret, options);
    if (!hash) {
      return reply.status(501).send({ error: "api_key_hashing_unavailable" });
    }

    let apiKey: AdminApiKey;
    try {
      apiKey = await options.adminResources.apiKeys.create({
        projectId: params.data.projectId,
        environmentId: parsed.data.environmentId,
        name: parsed.data.name,
        prefix: generatedApiKey.prefix,
        hash
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_api_key_scope_not_found")) {
        return reply.status(404).send({ error: "api_key_scope_not_found" });
      }
      throw error;
    }

    return reply.status(201).send({
      apiKey: {
        ...redactApiKeyHash(apiKey),
        secret: generatedApiKey.secret
      }
    });
  });

  app.delete("/admin/api-keys/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.adminResources?.apiKeys) {
      return reply.status(501).send({ error: "api_keys_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_api_key_request" });
    }

    await options.adminResources.apiKeys.revoke(params.data.id);
    return reply.status(204).send();
  });

  app.get("/admin/source-map-upload-tokens", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.sourceMapUploadTokens?.list) {
      return reply.status(501).send({ error: "source_map_upload_tokens_repository_unavailable" });
    }

    const parsed = sourceMapUploadTokenScopeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_source_map_upload_token_request" });
    }

    const tokens = await options.sourceMapUploadTokens.list({
      projectId: parsed.data.project_id,
      environmentId: parsed.data.environment_id
    });

    return reply.send({ tokens: tokens.map(redactSourceMapUploadToken) });
  });

  app.post("/admin/source-map-upload-tokens", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.sourceMapUploadTokens?.create) {
      return reply.status(501).send({ error: "source_map_upload_tokens_repository_unavailable" });
    }

    const parsed = createSourceMapUploadTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_source_map_upload_token_request" });
    }

    const generatedToken = options.createSourceMapUploadToken?.() ?? createSourceMapUploadToken();
    const hash = await hashAdminApiKeySecret(generatedToken.secret, options);
    if (!hash) {
      return reply.status(501).send({ error: "source_map_upload_token_hashing_unavailable" });
    }

    let token: SourceMapUploadTokenResponse;
    try {
      token = await options.sourceMapUploadTokens.create({
        projectId: parsed.data.projectId,
        environmentId: parsed.data.environmentId,
        name: parsed.data.name,
        prefix: generatedToken.prefix,
        hash
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_source_map_upload_token_scope_not_found")) {
        return reply.status(404).send({ error: "source_map_upload_token_scope_not_found" });
      }
      throw error;
    }

    return reply.status(201).send({
      token: {
        ...redactSourceMapUploadToken(token),
        secret: generatedToken.secret
      }
    });
  });

  app.delete("/admin/source-map-upload-tokens/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.sourceMapUploadTokens?.revoke) {
      return reply.status(501).send({ error: "source_map_upload_tokens_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    const query = sourceMapUploadTokenScopeQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "invalid_source_map_upload_token_request" });
    }

    await options.sourceMapUploadTokens.revoke({
      id: params.data.id,
      projectId: query.data.project_id,
      environmentId: query.data.environment_id
    });

    return reply.status(204).send();
  });

  app.get("/admin/source-maps", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.sourceMaps?.list) {
      return reply.status(501).send({ error: "source_maps_repository_unavailable" });
    }

    const parsed = sourceMapScopeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_source_map_request" });
    }

    let artifacts: SourceMapArtifactResponse[];
    try {
      artifacts = await options.sourceMaps.list({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id,
        release: parsed.data.release
      });
    } catch {
      return reply.status(503).send({ error: "source_maps_unavailable" });
    }

    return reply.send({ artifacts });
  });

  app.post("/admin/source-maps", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    let input: SourceMapUploadInput | SourceMapBundleUploadInput | undefined;
    try {
      input = await parseSourceMapUploadRequest(request, { uploadedByUserId: admin.id });
    } catch (error) {
      const status = sourceMapUploadErrorStatus(error);
      if (status) {
        return reply.status(status).send({ error: "invalid_source_map_request" });
      }
      return reply.status(400).send({ error: "invalid_source_map_request" });
    }
    if (!input) {
      return reply.status(400).send({ error: "invalid_source_map_request" });
    }

    try {
      if ("minifiedFile" in input) {
        if (!options.sourceMaps?.uploadMap) {
          return reply.status(501).send({ error: "source_maps_repository_unavailable" });
        }
        const artifacts = await options.sourceMaps.uploadMap(input);
        return reply.send({ artifacts });
      }

      if (!options.sourceMaps?.uploadBundle) {
        return reply.status(501).send({ error: "source_maps_repository_unavailable" });
      }
      const artifacts = await options.sourceMaps.uploadBundle(input);
      return reply.send({ artifacts });
    } catch (error) {
      const status = sourceMapUploadErrorStatus(error);
      if (status) {
        return reply.status(status).send({ error: "invalid_source_map_request" });
      }
      return reply.status(503).send({ error: "source_maps_unavailable" });
    }
  });

  app.delete("/admin/source-maps/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.sourceMaps?.remove) {
      return reply.status(501).send({ error: "source_maps_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    const query = sourceMapScopeQuerySchema.omit({ release: true }).safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "invalid_source_map_request" });
    }

    try {
      await options.sourceMaps.remove({
        id: params.data.id,
        projectId: query.data.project_id,
        environmentId: query.data.environment_id
      });
    } catch {
      return reply.status(503).send({ error: "source_maps_unavailable" });
    }

    return reply.status(204).send();
  });

  app.get("/admin/notification-channels", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.listNotificationChannels) {
      return reply.status(501).send({ error: "notification_channels_repository_unavailable" });
    }

    let channels: NotificationChannelRecord[];
    try {
      channels = await options.alerts.listNotificationChannels();
    } catch {
      return reply.status(503).send({ error: "notification_channels_unavailable" });
    }

    return reply.send({ channels: channels.map(redactNotificationChannel) });
  });

  app.post("/admin/notification-channels", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.createNotificationChannel) {
      return reply.status(501).send({ error: "notification_channels_repository_unavailable" });
    }

    const parsed = notificationChannelSchema.safeParse(request.body);
    if (!parsed.success || !isValidNotificationChannelInput(parsed.data, options)) {
      return reply.status(400).send({ error: "invalid_notification_channel_request" });
    }

    let channel: NotificationChannelRecord;
    try {
      channel = await options.alerts.createNotificationChannel(parsed.data);
    } catch {
      return reply.status(503).send({ error: "notification_channels_unavailable" });
    }

    return reply.status(201).send({ channel: redactNotificationChannel(channel) });
  });

  app.patch("/admin/notification-channels/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.updateNotificationChannel) {
      return reply.status(501).send({ error: "notification_channels_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_notification_channel_request" });
    }

    const parsed = updateNotificationChannelSchema.safeParse(request.body);
    if (
      !parsed.success ||
      (typeof parsed.data.url === "string" && !validateWebhookUrl(parsed.data.url, options.nodeEnv)) ||
      (parsed.data.secretHeaderName !== undefined && !isValidSecretHeaderName(parsed.data.secretHeaderName))
    ) {
      return reply.status(400).send({ error: "invalid_notification_channel_request" });
    }

    const input =
      parsed.data.secretHeaderName === null ? { ...parsed.data, secretHeaderValue: null } : parsed.data;
    let channel: NotificationChannelRecord | null | undefined;
    try {
      channel = await options.alerts.updateNotificationChannel(params.data.id, input);
    } catch {
      return reply.status(503).send({ error: "notification_channels_unavailable" });
    }

    if (!channel) {
      return reply.status(404).send({ error: "notification_channel_not_found" });
    }

    return reply.send({ channel: redactNotificationChannel(channel) });
  });

  app.delete("/admin/notification-channels/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.archiveNotificationChannel) {
      return reply.status(501).send({ error: "notification_channels_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_notification_channel_request" });
    }

    try {
      await options.alerts.archiveNotificationChannel(params.data.id);
    } catch {
      return reply.status(503).send({ error: "notification_channels_unavailable" });
    }

    return reply.status(204).send();
  });

  app.get("/admin/alert-rules", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.listAlertRules) {
      return reply.status(501).send({ error: "alert_rules_repository_unavailable" });
    }

    const parsed = alertRuleListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_rule_request" });
    }

    let rules: AlertRuleRecord[];
    try {
      rules = await options.alerts.listAlertRules({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id
      });
    } catch {
      return reply.status(503).send({ error: "alert_rules_unavailable" });
    }

    return reply.send({ rules });
  });

  app.post("/admin/alert-rules", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.createAlertRule) {
      return reply.status(501).send({ error: "alert_rules_repository_unavailable" });
    }

    const parsed = alertRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_rule_request" });
    }
    if (!(await validateAlertRuleNotificationChannel(parsed.data.notificationChannelId, options, reply))) {
      return reply;
    }

    let rule: AlertRuleRecord;
    try {
      rule = await options.alerts.createAlertRule(parsed.data);
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_alert_rule_scope_not_found")) {
        return reply.status(404).send({ error: "alert_rule_scope_not_found" });
      }
      return reply.status(503).send({ error: "alert_rules_unavailable" });
    }

    return reply.status(201).send({ rule });
  });

  app.patch("/admin/alert-rules/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.updateAlertRule) {
      return reply.status(501).send({ error: "alert_rules_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_alert_rule_request" });
    }

    const parsed = updateAlertRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_rule_request" });
    }
    if (!(await validateAlertRuleNotificationChannel(parsed.data.notificationChannelId, options, reply))) {
      return reply;
    }

    let rule: AlertRuleRecord | null | undefined;
    try {
      rule = await options.alerts.updateAlertRule(params.data.id, parsed.data);
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_alert_rule_scope_not_found")) {
        return reply.status(404).send({ error: "alert_rule_scope_not_found" });
      }
      return reply.status(503).send({ error: "alert_rules_unavailable" });
    }

    if (!rule) {
      return reply.status(404).send({ error: "alert_rule_not_found" });
    }

    return reply.send({ rule });
  });

  app.delete("/admin/alert-rules/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.alerts?.archiveAlertRule) {
      return reply.status(501).send({ error: "alert_rules_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_alert_rule_request" });
    }

    try {
      await options.alerts.archiveAlertRule(params.data.id);
    } catch {
      return reply.status(503).send({ error: "alert_rules_unavailable" });
    }

    return reply.status(204).send();
  });

  app.get("/admin/monitors", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.monitors?.listMonitors) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const parsed = monitorListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_monitor_request" });
    }

    let monitors: MonitorRecord[];
    try {
      monitors = await options.monitors.listMonitors({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id,
        kind: parsed.data.kind
      });
    } catch {
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    return reply.send({ monitors: monitors.map(redactMonitor) });
  });

  app.post("/admin/monitors/http", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.monitors?.createHttpMonitor) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const parsed = httpMonitorSchema.safeParse(request.body);
    if (!parsed.success || !validateWebhookUrl(parsed.data.url, options.nodeEnv)) {
      return reply.status(400).send({ error: "invalid_monitor_request" });
    }
    if (!(await validateMonitorNotificationChannel(parsed.data.notificationChannelId, options, reply))) {
      return reply;
    }

    let monitor: MonitorRecord;
    try {
      monitor = await options.monitors.createHttpMonitor({
        ...parsed.data,
        notificationChannelId: parsed.data.notificationChannelId ?? null,
        bodyContains: parsed.data.bodyContains ?? null
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_monitor_scope_not_found")) {
        return reply.status(404).send({ error: "monitor_scope_not_found" });
      }
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    return reply.status(201).send({ monitor: redactMonitor(monitor) });
  });

  app.post("/admin/monitors/heartbeat", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.monitors?.createHeartbeatMonitor) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const parsed = heartbeatMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_monitor_request" });
    }
    if (!(await validateMonitorNotificationChannel(parsed.data.notificationChannelId, options, reply))) {
      return reply;
    }

    const secret = (options.createHeartbeatSecret ?? createDefaultHeartbeatSecret)();
    const secretHash = await hashAdminHeartbeatSecret(secret, options);
    if (!secretHash) {
      return reply.status(501).send({ error: "heartbeat_secret_hashing_unavailable" });
    }

    let monitor: MonitorRecord;
    try {
      monitor = await options.monitors.createHeartbeatMonitor({
        ...parsed.data,
        notificationChannelId: parsed.data.notificationChannelId ?? null,
        secretHash
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_monitor_scope_not_found")) {
        return reply.status(404).send({ error: "monitor_scope_not_found" });
      }
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    return reply.status(201).send({ monitor: redactMonitor(monitor), secret });
  });

  app.patch("/admin/monitors/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.monitors?.updateMonitor) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    const parsed = updateMonitorSchema.safeParse(request.body);
    if (
      !params.success ||
      !parsed.success ||
      (typeof parsed.data.url === "string" && !validateWebhookUrl(parsed.data.url, options.nodeEnv))
    ) {
      return reply.status(400).send({ error: "invalid_monitor_request" });
    }
    if (!(await validateMonitorNotificationChannel(parsed.data.notificationChannelId, options, reply))) {
      return reply;
    }

    let monitor: MonitorRecord | null | undefined;
    try {
      monitor = await options.monitors.updateMonitor(params.data.id, parsed.data);
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_monitor_scope_not_found")) {
        return reply.status(404).send({ error: "monitor_scope_not_found" });
      }
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    if (!monitor) {
      return reply.status(404).send({ error: "monitor_not_found" });
    }

    return reply.send({ monitor: redactMonitor(monitor) });
  });

  app.delete("/admin/monitors/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.monitors?.archiveMonitor) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_monitor_request" });
    }

    try {
      await options.monitors.archiveMonitor(params.data.id);
    } catch {
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    return reply.status(204).send();
  });

  app.get("/admin/monitors/:id/checks", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.monitors?.listMonitorChecks) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    const query = monitorChecksQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "invalid_monitor_request" });
    }

    let checks: MonitorCheckRecord[];
    try {
      checks = await options.monitors.listMonitorChecks({
        monitorId: params.data.id,
        limit: query.data.limit
      });
    } catch {
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    return reply.send({ checks });
  });
}
