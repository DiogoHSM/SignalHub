import type { TelemetryJobKind, TelemetryJobPayload } from "@sigmon/queues";
import { createId } from "@sigmon/telemetry/ids";
import {
  breadcrumbPayloadSchema,
  clickEventPayloadSchema,
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  profilePayloadSchema,
  sessionReplayPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema,
  webVitalPayloadSchema
} from "@sigmon/telemetry/ingestion-schemas";
import type { FastifyInstance } from "fastify";
import type { ZodType } from "zod";
import { requireApiKeyScope, type ApiKeyVerifier } from "./api-key-auth.js";

export type IngestionDependencies = {
  verifyApiKey: ApiKeyVerifier;
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
  { path: "/v1/web-vitals", kind: "web_vital", idPrefix: "wvt", schema: webVitalPayloadSchema },
  { path: "/v1/clicks", kind: "click", idPrefix: "clk", schema: clickEventPayloadSchema },
  { path: "/v1/replays", kind: "replay", idPrefix: "rpl", schema: sessionReplayPayloadSchema },
  { path: "/v1/profiles", kind: "profile", idPrefix: "prf", schema: profilePayloadSchema },
  { path: "/v1/breadcrumbs", kind: "breadcrumb", idPrefix: "brd", schema: breadcrumbPayloadSchema }
];

function validationDetails(error: { issues: Array<{ path: PropertyKey[]; message: string; code: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code
  }));
}

const invalidPayloadHint =
  "Check the endpoint payload shape in /docs or /openapi.json. SDK payloads are generated for the correct schema automatically.";

const ingestionUnavailableHint =
  "Sigmon accepted the request path but could not enqueue telemetry. Check Redis connectivity and worker/scheduler health.";

export function registerIngestionRoutes(app: FastifyInstance, ingestion?: IngestionDependencies): void {
  for (const route of ingestionRoutes) {
    app.post(route.path, async (request, reply) => {
      const scope = await requireApiKeyScope(request, reply, ingestion?.verifyApiKey, { includeHints: true });
      if (!scope || !ingestion) {
        return reply;
      }

      const parsed = route.schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_ingestion_payload",
          hint: invalidPayloadHint,
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
        return reply.status(503).send({
          error: "ingestion_unavailable",
          hint: ingestionUnavailableHint
        });
      }

      return reply.status(202).send({ accepted: true, id });
    });
  }
}
