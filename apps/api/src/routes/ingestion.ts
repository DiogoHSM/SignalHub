import type { TelemetryJobKind, TelemetryJobPayload } from "@sigmon/queues";
import { createId } from "@sigmon/telemetry/ids";
import {
  breadcrumbPayloadSchema,
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@sigmon/telemetry/ingestion-schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodType } from "zod";

type ApiKeyScope = {
  projectId: string;
  environmentId: string;
};

export type IngestionDependencies = {
  verifyApiKey: (secret: string) => Promise<ApiKeyScope | null | undefined>;
  enqueue: (job: TelemetryJobPayload) => Promise<void>;
};

type IngestionRouteConfig = {
  path: string;
  kind: TelemetryJobKind;
  idPrefix: string;
  schema: ZodType;
};

const ingestionRoutes: IngestionRouteConfig[] = [
  { path: "/v1/events", kind: "event", idPrefix: "evt", schema: eventPayloadSchema },
  { path: "/v1/errors", kind: "error", idPrefix: "err", schema: errorPayloadSchema },
  { path: "/v1/llm", kind: "llm", idPrefix: "llm", schema: llmCallPayloadSchema },
  { path: "/v1/traces", kind: "trace", idPrefix: "trc", schema: tracePayloadSchema },
  { path: "/v1/spans", kind: "span", idPrefix: "spn", schema: spanPayloadSchema },
  { path: "/v1/breadcrumbs", kind: "breadcrumb", idPrefix: "brd", schema: breadcrumbPayloadSchema }
];

function parseBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}

async function requireApiKeyScope(
  request: FastifyRequest,
  reply: FastifyReply,
  ingestion: IngestionDependencies | undefined
): Promise<ApiKeyScope | undefined> {
  const secret = parseBearerToken(request);
  if (!secret) {
    reply.status(401).send({ error: "invalid_api_key" });
    return undefined;
  }

  if (!ingestion) {
    reply.status(503).send({ error: "ingestion_unavailable" });
    return undefined;
  }

  let scope: ApiKeyScope | null | undefined;
  try {
    scope = await ingestion.verifyApiKey(secret);
  } catch {
    reply.status(503).send({ error: "ingestion_unavailable" });
    return undefined;
  }

  if (!scope) {
    reply.status(401).send({ error: "invalid_api_key" });
    return undefined;
  }

  return scope;
}

function validationDetails(error: { issues: Array<{ path: PropertyKey[]; message: string; code: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code
  }));
}

export function registerIngestionRoutes(app: FastifyInstance, ingestion?: IngestionDependencies): void {
  for (const route of ingestionRoutes) {
    app.post(route.path, async (request, reply) => {
      const scope = await requireApiKeyScope(request, reply, ingestion);
      if (!scope || !ingestion) {
        return reply;
      }

      const parsed = route.schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_ingestion_payload",
          details: validationDetails(parsed.error)
        });
      }

      const id = createId(route.idPrefix);
      const job: TelemetryJobPayload = {
        kind: route.kind,
        id,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        payload: parsed.data as Record<string, unknown>
      };

      try {
        await ingestion.enqueue(job);
      } catch {
        return reply.status(503).send({ error: "ingestion_unavailable" });
      }

      return reply.status(202).send({ accepted: true, id });
    });
  }
}
