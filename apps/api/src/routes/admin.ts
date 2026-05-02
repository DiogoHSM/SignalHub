import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApiKey, hashApiKey as hashTelemetryApiKey } from "@signal-hub/telemetry/api-keys";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

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

export type AdminRouteOptions = {
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
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

type CreateUserInput = z.infer<typeof createUserSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;
type CreateProjectInput = z.infer<typeof createProjectSchema>;
type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
type CreateEnvironmentBody = z.infer<typeof createEnvironmentSchema>;
type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;
type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
type CreateEnvironmentInput = CreateEnvironmentBody & { projectId: string };
type CreateApiKeyRecordInput = CreateApiKeyBody & { projectId: string; prefix: string; hash: string };

function redactApiKeyHash(apiKey: AdminApiKey): Omit<AdminApiKey, "hash"> {
  const { hash: _hash, ...safeApiKey } = apiKey;
  return safeApiKey;
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
}
