import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApiKey, hashApiKey as hashTelemetryApiKey } from "@signal-hub/telemetry/api-keys";
import { isIP } from "node:net";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";
import type { AlertRuleRecord, NotificationChannelRecord } from "@signal-hub/db/repositories/alerts.js";

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

export type AdminResourceDependencies = {
  projects?: ProjectAdministrationDependencies;
  environments?: EnvironmentAdministrationDependencies;
  apiKeys?: ApiKeyAdministrationDependencies;
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

export type SourceMapUploadInput = {
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile?: string;
  uploadedByUserId: string;
  originalFilename: string;
  contentType: string;
  content: Buffer;
};

export type SourceMapBundleUploadInput = {
  projectId: string;
  environmentId: string;
  release: string;
  uploadedByUserId: string;
  originalFilename: string;
  contentType: string;
  content: Buffer;
};

export type SourceMapAdministrationDependencies = {
  list?: (filters: { projectId: string; environmentId: string; release?: string }) => Promise<unknown[]>;
  uploadMap?: (input: SourceMapUploadInput) => Promise<unknown[]>;
  uploadBundle?: (input: SourceMapBundleUploadInput) => Promise<unknown[]>;
  remove?: (input: { id: string; projectId: string; environmentId: string }) => Promise<void>;
};

export type AdminRouteOptions = {
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  alerts?: AlertAdministrationDependencies;
  sourceMaps?: SourceMapAdministrationDependencies;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
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

const notificationChannelBaseSchema = z.object({
  name: z.string().trim().min(1).max(256),
  type: z.literal("webhook"),
  url: z.string().url(),
  secretHeaderName: z.string().trim().min(1).max(128).nullable().optional(),
  secretHeaderValue: z.string().trim().min(1).max(4096).nullable().optional(),
  enabled: z.boolean()
});

const notificationChannelSchema = notificationChannelBaseSchema
  .extend({ enabled: z.boolean().default(true) })
  .refine((input) => !input.secretHeaderValue || Boolean(input.secretHeaderName), {
    message: "secret_header_name_required"
  });

const updateNotificationChannelSchema = notificationChannelBaseSchema
  .partial()
  .refine((input) => input.secretHeaderValue == null || typeof input.secretHeaderName === "string", {
    message: "secret_header_name_required"
  })
  .refine((input) => Object.keys(input).length > 0, { message: "at_least_one_field_required" });

const thresholdSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0);

const alertRuleSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  notificationChannelId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(256),
  type: z.enum(["critical_errors", "error_count", "trace_p95_latency", "llm_cost"]),
  severity: z.enum(["info", "warning", "critical"]),
  windowMinutes: z.number().int().min(1),
  threshold: thresholdSchema,
  cooldownMinutes: z.number().int().min(1),
  enabled: z.boolean().default(true)
});

const updateAlertRuleSchema = alertRuleSchema.partial().refine((input) => Object.keys(input).length > 0, {
  message: "at_least_one_field_required"
});

const alertRuleListQuerySchema = z.object({
  project_id: z.string().trim().min(1).optional(),
  environment_id: z.string().trim().min(1).optional()
});

const sourceMapScopeQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
  release: z.string().trim().min(1).optional()
});

type CreateUserInput = z.infer<typeof createUserSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;
type CreateProjectInput = z.infer<typeof createProjectSchema>;
type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
type CreateEnvironmentBody = z.infer<typeof createEnvironmentSchema>;
type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;
type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
type CreateNotificationChannelInput = z.infer<typeof notificationChannelSchema>;
type UpdateNotificationChannelInput = z.infer<typeof updateNotificationChannelSchema>;
type CreateAlertRuleInput = z.infer<typeof alertRuleSchema>;
type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
type AlertRuleListFilters = {
  projectId?: string;
  environmentId?: string;
};
type CreateEnvironmentInput = CreateEnvironmentBody & { projectId: string };
type CreateApiKeyRecordInput = CreateApiKeyBody & { projectId: string; prefix: string; hash: string };

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

function redactNotificationChannel(
  channel: NotificationChannelRecord
): Omit<NotificationChannelRecord, "secretHeaderValue"> {
  const { secretHeaderValue: _secretHeaderValue, ...safeChannel } = channel;
  return safeChannel;
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
  return normalizedHeaderName.startsWith("x-") || normalizedHeaderName.startsWith("signalhub-");
}

function validateWebhookUrl(rawUrl: string, nodeEnv: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  if (url.username !== "" || url.password !== "") {
    return false;
  }

  return nodeEnv === "production" ? !isPrivateWebhookHost(url.hostname) : true;
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

function isPrivateWebhookHost(rawHost: string): boolean {
  const host = normalizeLiteralHost(rawHost);

  if (host === "localhost") {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return isPrivateIpv4Host(host);
  }

  const mappedIpv4Host = parseIpv4MappedIpv6Host(host);
  if (mappedIpv4Host) {
    return isPrivateIpv4Host(mappedIpv4Host);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6Host(host);
  }

  return false;
}

function normalizeLiteralHost(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function parseIpv4MappedIpv6Host(host: string): string | null {
  const mappedPrefix = "::ffff:";
  if (!host.startsWith(mappedPrefix)) {
    return null;
  }

  const mappedAddress = host.slice(mappedPrefix.length);
  if (isIP(mappedAddress) === 4) {
    return mappedAddress;
  }

  const hextets = mappedAddress.split(":");
  if (hextets.length !== 2) {
    return null;
  }

  const high = parseIpv6MappedHextet(hextets[0]);
  const low = parseIpv6MappedHextet(hextets[1]);
  if (high === null || low === null) {
    return null;
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function parseIpv6MappedHextet(hextet: string | undefined): number | null {
  if (!hextet || !/^[0-9a-f]{1,4}$/.test(hextet)) {
    return null;
  }

  return Number.parseInt(hextet, 16);
}

function isPrivateIpv4Host(host: string): boolean {
  const octets = host.split(".").map((octet) => Number(octet));
  const [first, second] = octets;

  return (
    host === "0.0.0.0" ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6Host(host: string): boolean {
  if (host === "::" || host === "::1" || isUnspecifiedIpv6Host(host)) {
    return true;
  }

  const firstHextet = Number.parseInt(host.split(":")[0] ?? "", 16);
  if (Number.isNaN(firstHextet)) {
    return false;
  }

  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}

function isUnspecifiedIpv6Host(host: string): boolean {
  return host.replace(/:/g, "").replace(/0/g, "").length === 0;
}

function isValidNotificationChannelInput(
  input: Pick<CreateNotificationChannelInput, "url" | "secretHeaderName">,
  options: AdminRouteOptions
): boolean {
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

async function parseSourceMapUploadRequest(
  request: FastifyRequest,
  uploadedByUserId: string
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
      await part.toBuffer();
      continue;
    }

    if (file) {
      await part.toBuffer();
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
      uploadedByUserId,
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
    uploadedByUserId,
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

    let artifacts: unknown[];
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

    const input = await parseSourceMapUploadRequest(request, admin.id);
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
    } catch {
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
      (parsed.data.url !== undefined && !validateWebhookUrl(parsed.data.url, options.nodeEnv)) ||
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
}
