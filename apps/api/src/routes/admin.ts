import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

export type UserAdministrationDependencies = {
  listUsers?: () => Promise<AuthenticatedUser[]>;
  createUser?: (input: CreateUserInput) => Promise<AuthenticatedUser>;
  updateUser?: (id: string, input: UpdateUserInput) => Promise<AuthenticatedUser | null | undefined>;
  archiveUser?: (id: string) => Promise<void>;
};

export type AdminRouteOptions = {
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
};

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  isAdmin: z.boolean().default(false)
});

const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.string().min(1).optional(),
    isAdmin: z.boolean().optional()
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "at_least_one_field_required"
  });

type CreateUserInput = z.infer<typeof createUserSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthDependencies | undefined
): Promise<AuthenticatedUser | undefined> {
  const user = await auth?.findSessionUser(request);
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
}
