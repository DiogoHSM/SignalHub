import {
  tenantIdentifyPayloadSchema,
  userIdentifyPayloadSchema,
  type TenantIdentifyPayload,
  type UserIdentifyPayload
} from "@sigmon/telemetry/ingestion-schemas";
import type { FastifyInstance } from "fastify";
import { requireApiKeyScope, type ApiKeyVerifier, type ApiKeyScope } from "./api-key-auth.js";

type IdentifyScope = Pick<ApiKeyScope, "projectId" | "environmentId">;

type IdentifyUserInput = IdentifyScope & {
  userId: string;
  tenantId?: string | null;
  traits: Record<string, unknown>;
  timestamp: Date;
};

type IdentifyTenantInput = IdentifyScope & {
  tenantId: string;
  traits: Record<string, unknown>;
  timestamp: Date;
};

export type IdentifyRouteDependencies = {
  verifyApiKey: ApiKeyVerifier;
  identifyUser: (input: IdentifyUserInput) => Promise<void>;
  identifyTenant: (input: IdentifyTenantInput) => Promise<void>;
};

function validationDetails(error: { issues: Array<{ path: PropertyKey[]; message: string; code: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code
  }));
}

function payloadTimestamp(payload: UserIdentifyPayload | TenantIdentifyPayload): Date {
  return payload.timestamp ? new Date(payload.timestamp) : new Date();
}

export function registerIdentifyRoutes(app: FastifyInstance, identify?: IdentifyRouteDependencies): void {
  app.post("/v1/identify/user", async (request, reply) => {
    const scope = await requireApiKeyScope(request, reply, identify?.verifyApiKey);
    if (!scope || !identify) {
      return reply;
    }

    const parsed = userIdentifyPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_identify_payload",
        details: validationDetails(parsed.error)
      });
    }

    try {
      await identify.identifyUser({
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        userId: parsed.data.user_id,
        tenantId: parsed.data.tenant_id,
        traits: parsed.data.traits,
        timestamp: payloadTimestamp(parsed.data)
      });
    } catch {
      return reply.status(503).send({ error: "ingestion_unavailable" });
    }

    return reply.status(202).send({ accepted: true });
  });

  app.post("/v1/identify/tenant", async (request, reply) => {
    const scope = await requireApiKeyScope(request, reply, identify?.verifyApiKey);
    if (!scope || !identify) {
      return reply;
    }

    const parsed = tenantIdentifyPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_identify_payload",
        details: validationDetails(parsed.error)
      });
    }

    try {
      await identify.identifyTenant({
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        tenantId: parsed.data.tenant_id,
        traits: parsed.data.traits,
        timestamp: payloadTimestamp(parsed.data)
      });
    } catch {
      return reply.status(503).send({ error: "ingestion_unavailable" });
    }

    return reply.status(202).send({ accepted: true });
  });
}
