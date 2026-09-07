type OpenApiDocument = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  externalDocs?: { description: string; url: string };
  components: {
    securitySchemes: Record<string, Record<string, unknown>>;
    schemas: Record<string, Record<string, unknown>>;
    responses: Record<string, Record<string, unknown>>;
  };
  paths: Record<string, Record<string, unknown>>;
};

const acceptedResponse = {
  description: "Signal accepted for asynchronous persistence",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/AcceptedResponse" },
      examples: {
        accepted: {
          value: { accepted: true, id: "evt_example" }
        }
      }
    }
  }
};

const identifyAcceptedResponse = {
  description: "Identify payload accepted for persistence",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/IdentifyAcceptedResponse" },
      examples: {
        accepted: {
          value: { accepted: true }
        }
      }
    }
  }
};

const dataGovernanceRetentionProperties = {
  events: { type: "integer", minimum: 1, maximum: 3650 },
  errors: { type: "integer", minimum: 1, maximum: 3650 },
  traces: { type: "integer", minimum: 1, maximum: 3650 },
  spans: { type: "integer", minimum: 1, maximum: 3650 },
  llmCalls: { type: "integer", minimum: 1, maximum: 3650 },
  profiles: { type: "integer", minimum: 1, maximum: 3650 },
  breadcrumbs: { type: "integer", minimum: 1, maximum: 3650 },
  webVitals: { type: "integer", minimum: 1, maximum: 3650 },
  clicks: { type: "integer", minimum: 1, maximum: 3650 },
  replays: { type: "integer", minimum: 1, maximum: 3650 }
};

const dataGovernanceRetentionDescription =
  "Closed per-category project/environment overrides in days. Omitted categories use their corresponding installation defaults; clicks, replays, and webVitals inherit RETENTION_EVENTS_DAYS. Unknown categories are rejected.";

const jsonBody = (schema: string, example: Record<string, unknown>) => ({
  required: true,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schema}` },
      examples: {
        default: { value: example }
      }
    }
  }
});

const ingestionOperation = (
  summary: string,
  description: string,
  schema: string,
  example: Record<string, unknown>
) => ({
  tags: ["Ingestion"],
  summary,
  description,
  security: [{ ingestionApiKey: [] }],
  requestBody: jsonBody(schema, example),
  responses: {
    "202": acceptedResponse,
    "400": { $ref: "#/components/responses/BadRequest" },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "503": { $ref: "#/components/responses/Unavailable" }
  }
});

const identifyOperation = (
  summary: string,
  description: string,
  schema: string,
  example: Record<string, unknown>
) => ({
  tags: ["Ingestion"],
  summary,
  description,
  security: [{ ingestionApiKey: [] }],
  requestBody: jsonBody(schema, example),
  responses: {
    "202": identifyAcceptedResponse,
    "400": { $ref: "#/components/responses/BadRequest" },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "503": { $ref: "#/components/responses/Unavailable" }
  }
});

const apiDescription = `Self-hosted telemetry API for product events, errors, breadcrumbs, browser click maps, privacy-safe session replays, LLM calls, traces, spans, Web Vitals, source maps, and operator workflows.

## Integration guide

For TypeScript, Node.js, browser, and Next.js projects, use the official \`@sigmon/sdk\` package when it is available in your package registry or vendored workspace. The SDK is the recommended path for complete integrations because it keeps browser and server entrypoints separate, maps payloads consistently, provides Next.js route/action wrappers, and exposes identify helpers for user and tenant traits.

Raw HTTP remains the stable contract for other languages, automation, and direct integrations. All ingestion requests use project/environment-scoped API keys created in the SignalMonitor console.

## Recommended rollout

1. Create one SignalMonitor project and one environment per deployed app environment.
2. Create separate ingestion keys for server and browser telemetry.
3. Use server-only variables such as \`SIGMON_ENDPOINT\` and \`SIGMON_API_KEY\` for API routes, workers, server actions, and scheduled jobs.
4. Use browser variables such as \`NEXT_PUBLIC_SIGMON_ENDPOINT\` and \`NEXT_PUBLIC_SIGMON_BROWSER_KEY\` only with a browser-scoped ingestion key.
5. Send \`identifyUser\` / \`POST /v1/identify/user\` after login or session load, and \`identifyTenant\` / \`POST /v1/identify/tenant\` after tenant/workspace selection.
6. Send events, errors, breadcrumbs, click maps, privacy-safe session replays, traces, spans, Web Vitals, experiment exposures, and LLM calls with stable \`tenant_id\`, \`user_id\`, \`session_id\`, \`trace_id\`, \`source\`, and \`release\` fields when available.
7. Upload source maps from CI for minified browser bundles so production stacks can be resolved.

## Key model

Browser ingestion keys are public by design, but they must be scoped to one project and environment. Server ingestion keys and source-map upload tokens must stay in server or CI secret storage.`;

const sessionRoute = (summary: string, description: string) => ({
  tags: ["Session authenticated"],
  summary,
  description,
  security: [{ sessionCookie: [] }],
  responses: {
    "200": { description: "Request succeeded" },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": { $ref: "#/components/responses/Forbidden" }
  }
});

const queryReadRoute = (summary: string, description: string) => ({
  tags: ["Session authenticated"],
  summary,
  description,
  security: [{ sessionCookie: [] }, { readToken: [] }],
  responses: {
    "200": { description: "Request succeeded" },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": { $ref: "#/components/responses/Forbidden" }
  }
});

const adminIdParameter = { name: "id", in: "path", required: true, schema: { type: "string" } };
const adminProjectIdParameter = { name: "projectId", in: "path", required: true, schema: { type: "string" } };
const adminScopeParameters = [
  { name: "project_id", in: "query", required: true, schema: { type: "string" } },
  { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
];

const inlineJsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { "application/json": { schema } }
});

const adminOperation = (
  summary: string,
  description: string,
  options: {
    parameters?: Array<Record<string, unknown>>;
    requestBody?: Record<string, unknown>;
    successStatus?: "200" | "201" | "204";
    successDescription?: string;
    notFound?: string;
    conflict?: string;
    payloadTooLarge?: string;
  } = {}
) => {
  const successStatus = options.successStatus ?? "200";
  return {
    tags: ["Session authenticated"],
    summary,
    description,
    security: [{ sessionCookie: [] }],
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.requestBody ? { requestBody: options.requestBody } : {}),
    responses: {
      [successStatus]: { description: options.successDescription ?? "Request succeeded" },
      "400": { $ref: "#/components/responses/BadRequest" },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "403": { $ref: "#/components/responses/Forbidden" },
      ...(options.notFound ? { "404": { description: options.notFound } } : {}),
      ...(options.conflict ? { "409": { description: options.conflict } } : {}),
      ...(options.payloadTooLarge ? { "413": { description: options.payloadTooLarge } } : {}),
      "501": { $ref: "#/components/responses/Unavailable" },
      "503": { $ref: "#/components/responses/Unavailable" }
    }
  };
};

const analyticsSegmentDefinitionSchema = {
  description: "Saved user/tenant segment definition. Version 2 definitions use a recursive group/leaf expression tree; legacy definitions use event/property filters.",
  oneOf: [
    {
      type: "object",
      required: ["version", "root"],
      properties: {
        version: { type: "integer", const: 2 },
        window: { type: "string", enum: ["24h", "7d", "30d"] },
        root: { $ref: "#/components/schemas/AnalyticsSegmentNode" }
      }
    },
    {
      type: "object",
      anyOf: [{ required: ["eventName"] }, { required: ["propertyName"] }],
      dependentRequired: { propertyValue: ["propertyName"] },
      additionalProperties: false,
      properties: {
        window: { type: "string", enum: ["24h", "7d", "30d"], default: "30d" },
        eventName: { type: "string", maxLength: 256 },
        propertyName: { type: "string", maxLength: 128 },
        propertyValue: { type: "string", maxLength: 512 }
      }
    }
  ]
};

const analyticsSegmentInputSchema = {
  type: "object",
  required: ["projectId", "environmentId", "name", "actorType", "definition"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string" },
    environmentId: { type: "string" },
    name: { type: "string", minLength: 1, maxLength: 256 },
    description: { type: ["string", "null"], maxLength: 1024 },
    actorType: { type: "string", enum: ["user", "tenant"] },
    definition: analyticsSegmentDefinitionSchema
  }
};

const experimentInputProperties = {
  projectId: { type: "string" },
  environmentId: { type: "string" },
  key: { type: "string", minLength: 1, maxLength: 80 },
  name: { type: "string", minLength: 1, maxLength: 256 },
  description: { type: ["string", "null"], maxLength: 1024 },
  status: { type: "string", enum: ["draft", "running", "paused", "completed", "archived"], default: "draft" },
  actorType: { type: "string", enum: ["user", "tenant", "session"], default: "user" },
  exposureEvent: { type: "string", maxLength: 256, default: "sigmon.experiment.exposed" },
  conversionEvent: { type: "string", minLength: 1, maxLength: 256 },
  variants: {
    type: "array",
    minItems: 2,
    maxItems: 20,
    items: {
      type: "object",
      required: ["key", "name", "weight"],
      properties: {
        key: { type: "string", maxLength: 80 },
        name: { type: "string", maxLength: 120 },
        weight: { type: "integer", minimum: 0, maximum: 100 }
      }
    }
  },
  primaryMetric: {
    type: "object",
    required: ["eventName"],
    properties: {
      eventName: { type: "string", maxLength: 256 },
      windowHours: { type: "integer", minimum: 1, maximum: 720, default: 24 }
    }
  }
};

const notificationChannelCommonProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  enabled: { type: "boolean", default: true }
};

const notificationChannelInputSchema = {
  oneOf: [
    ...(["webhook", "slack", "discord"] as const).map((type) => ({
      type: "object",
      required: ["name", "type", "url"],
      additionalProperties: false,
      properties: {
        ...notificationChannelCommonProperties,
        type: { type: "string", const: type },
        url: { type: "string", format: "uri" },
        secretHeaderName: { type: ["string", "null"], minLength: 1, maxLength: 128 },
        secretHeaderValue: { type: ["string", "null"], minLength: 1, maxLength: 4096, writeOnly: true }
      }
    })),
    {
      type: "object",
      required: ["name", "type", "emailRecipients"],
      additionalProperties: false,
      properties: {
        ...notificationChannelCommonProperties,
        type: { type: "string", const: "email" },
        emailRecipients: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", format: "email" } }
      }
    }
  ]
};

const notificationChannelUpdateSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    ...notificationChannelCommonProperties,
    type: { type: "string", enum: ["webhook", "slack", "discord", "email"] },
    url: { type: ["string", "null"], format: "uri" },
    emailRecipients: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", format: "email" } },
    secretHeaderName: { type: ["string", "null"], minLength: 1, maxLength: 128 },
    secretHeaderValue: { type: ["string", "null"], minLength: 1, maxLength: 4096, writeOnly: true }
  }
};

const alertRuleInputProperties = {
  projectId: { type: "string" },
  environmentId: { type: "string" },
  notificationChannelId: { type: ["string", "null"] },
  escalationChannelId: { type: ["string", "null"] },
  name: { type: "string", minLength: 1, maxLength: 256 },
  type: { type: "string", enum: ["critical_errors", "error_count", "error_rate", "trace_p95_latency", "llm_cost", "dead_letter_count"] },
  severity: { type: "string", enum: ["info", "warning", "critical"] },
  windowMinutes: { type: "integer", minimum: 1 },
  threshold: { type: "string", pattern: "^\\d+(\\.\\d{1,6})?$" },
  cooldownMinutes: { type: "integer", minimum: 1 },
  escalationMinutes: { type: ["integer", "null"], minimum: 1 },
  routePattern: { type: ["string", "null"], maxLength: 256 },
  minimumSampleSize: { type: "integer", minimum: 1, default: 1 },
  enabled: { type: "boolean", default: true }
};

const systemActionOperation = (summary: string, description: string) => ({
  tags: ["Session authenticated"],
  summary,
  description,
  security: [{ sessionCookie: [] }],
  responses: {
    "200": {
      description: "System action completed or skipped",
      content: { "application/json": { schema: { $ref: "#/components/schemas/SystemActionResponse" } } }
    },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": { $ref: "#/components/responses/Forbidden" },
    "501": { $ref: "#/components/responses/Unavailable" },
    "503": { $ref: "#/components/responses/Unavailable" }
  }
});

const backupActionOperation = (summary: string, description: string) => ({
  tags: ["Session authenticated"],
  summary,
  description,
  security: [{ sessionCookie: [] }],
  responses: {
    "202": {
      description: "Backup job accepted",
      content: { "application/json": { schema: { $ref: "#/components/schemas/SystemBackupActionResponse" } } }
    },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": { $ref: "#/components/responses/Forbidden" },
    "501": { $ref: "#/components/responses/Unavailable" },
    "503": { $ref: "#/components/responses/Unavailable" }
  }
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "SignalMonitor API",
    version: "0.1.0",
    description: apiDescription
  },
  servers: [{ url: "https://my.sigmon.app", description: "Production" }],
  tags: [
    { name: "Health", description: "Public service health and readiness checks." },
    {
      name: "Ingestion",
      description:
        "API-key authenticated telemetry ingestion endpoints. These endpoints are safe to call from SDKs or raw HTTP clients as long as the API key is scoped to the intended project/environment."
    },
    { name: "Source maps", description: "CI source-map uploads with dedicated source-map upload tokens." },
    { name: "Auth", description: "Human session login and session management." },
    { name: "Session authenticated", description: "Admin, query, alert, and system routes that require a human session cookie." }
  ],
  externalDocs: {
    description: "Raw OpenAPI document",
    url: "/openapi.json"
  },
  components: {
    securitySchemes: {
      ingestionApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "SignalMonitor ingestion API key",
        description: "Project/environment scoped ingestion key, for example `sh_...`."
      },
      sourceMapUploadToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "SignalMonitor source-map upload token",
        description: "CI-only source-map upload token created from the Artifacts console."
      },
      heartbeatSecret: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "SignalMonitor heartbeat monitor secret",
        description: "One-time heartbeat monitor secret returned when creating a heartbeat monitor."
      },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-sigmon_session",
        description: "Production human session cookie set by `/auth/login`."
      },
      readToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "SignalMonitor read token",
        description: "Project/environment scoped, read-only, revocable credential, for example `shread_...`. Accepted as an alternative to the session cookie on `/query/*` read routes only; it cannot access fleet routes or perform any mutation."
      }
    },
    schemas: {
      AnalyticsSegmentLeafValue: {
        oneOf: [
          { type: "string", maxLength: 1024 },
          { type: "number" },
          { type: "boolean" },
          { type: "array", maxItems: 64, items: { type: "string", maxLength: 1024 } }
        ]
      },
      AnalyticsSegmentPropertyCondition: {
        type: "object",
        required: ["name", "operator"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,64}$" },
          operator: { type: "string", enum: ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "in", "exists"] },
          value: { $ref: "#/components/schemas/AnalyticsSegmentLeafValue" }
        }
      },
      AnalyticsSegmentGroupNode: {
        type: "object",
        required: ["kind", "op", "children"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "group" },
          op: { type: "string", enum: ["and", "or", "not"] },
          children: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { $ref: "#/components/schemas/AnalyticsSegmentNode" }
          }
        },
        allOf: [
          {
            if: { properties: { op: { const: "not" } }, required: ["op"] },
            then: { properties: { children: { maxItems: 1 } } }
          }
        ]
      },
      AnalyticsSegmentEventNode: {
        type: "object",
        required: ["kind"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "event" },
          eventName: { type: "string", minLength: 1, maxLength: 256 },
          property: { $ref: "#/components/schemas/AnalyticsSegmentPropertyCondition" },
          frequency: {
            type: "object",
            required: ["operator", "count"],
            additionalProperties: false,
            properties: {
              operator: { type: "string", enum: ["gte", "lte", "eq"] },
              count: { type: "integer", minimum: 0 }
            }
          },
          recency: {
            type: "object",
            required: ["withinDays"],
            additionalProperties: false,
            properties: { withinDays: { type: "integer", minimum: 1, maximum: 3650 } }
          }
        }
      },
      AnalyticsSegmentTraitNode: {
        type: "object",
        required: ["kind", "source", "name", "operator"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "trait" },
          source: { type: "string", enum: ["user", "tenant"] },
          name: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,64}$" },
          operator: { type: "string", enum: ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "in", "exists"] },
          value: { $ref: "#/components/schemas/AnalyticsSegmentLeafValue" }
        }
      },
      AnalyticsSegmentNode: {
        description: "Recursive analytics segment expression. Definitions are limited to 32 nodes and depth 5.",
        oneOf: [
          { $ref: "#/components/schemas/AnalyticsSegmentGroupNode" },
          { $ref: "#/components/schemas/AnalyticsSegmentEventNode" },
          { $ref: "#/components/schemas/AnalyticsSegmentTraitNode" }
        ]
      },
      AcceptedResponse: {
        type: "object",
        required: ["accepted", "id"],
        properties: {
          accepted: { type: "boolean", const: true },
          id: { type: "string", description: "Generated telemetry signal id." }
        }
      },
      IdentifyAcceptedResponse: {
        type: "object",
        required: ["accepted"],
        properties: {
          accepted: { type: "boolean", const: true }
        }
      },
      AnalyticsInsightInput: {
        type: "object",
        required: ["projectId", "environmentId", "name", "definition"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          name: { type: "string", minLength: 1, maxLength: 256 },
          description: { type: ["string", "null"], maxLength: 1024 },
          definition: {
            type: "object",
            required: ["bucket", "metric"],
            properties: {
              bucket: { type: "string", enum: ["hour", "day"] },
              metric: { type: "string", enum: ["count", "unique_actors"] },
              eventName: { type: "string" },
              breakdownProperty: { type: "string" },
              filters: { type: "array", items: { type: "object" }, maxItems: 12 }
            }
          }
        }
      },
      AnalyticsInsightPatch: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 256 },
          description: { type: ["string", "null"], maxLength: 1024 },
          definition: { $ref: "#/components/schemas/AnalyticsInsightInput/properties/definition" }
        }
      },
      PromotedEventPropertyInput: {
        type: "object",
        required: ["projectId", "environmentId", "property"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          property: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,64}$" },
          displayName: { type: "string", maxLength: 80 }
        }
      },
      AnalyticsDashboardInput: {
        type: "object",
        required: ["projectId", "environmentId", "name", "widgets"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          name: { type: "string", minLength: 1, maxLength: 256 },
          description: { type: ["string", "null"], maxLength: 1024 },
          category: { type: "string", enum: ["executive", "operational", "product"], default: "operational" },
          filters: {
            type: "object",
            additionalProperties: false,
            properties: { window: { type: "string", enum: ["24h", "7d", "30d"], default: "7d" } }
          },
          widgets: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              required: ["type", "title"],
              properties: {
                id: { type: "string" },
                type: { type: "string", enum: ["metric.events", "metric.errors", "top.events", "trend.events", "trend.errors", "insight"] },
                title: { type: "string", minLength: 1, maxLength: 120 },
                width: { type: "string", enum: ["half", "full"], default: "half" },
                options: { type: "object", additionalProperties: true }
              }
            }
          }
        }
      },
      AnalyticsDashboardPatch: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 256 },
          description: { type: ["string", "null"], maxLength: 1024 },
          category: { type: "string", enum: ["executive", "operational", "product"] },
          filters: {
            type: "object",
            additionalProperties: false,
            properties: { window: { type: "string", enum: ["24h", "7d", "30d"] } }
          },
          widgets: { $ref: "#/components/schemas/AnalyticsDashboardInput/properties/widgets" }
        }
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          hint: {
            type: "string",
            description: "Optional actionable setup guidance returned by ingestion endpoints for common integration failures."
          }
        }
      },
      SurveyQuestion: {
        type: "object",
        required: ["id", "type", "label", "required"],
        properties: {
          id: { type: "string", examples: ["satisfaction"] },
          type: { type: "string", enum: ["rating", "choice", "text"] },
          label: { type: "string", examples: ["How satisfied are you with this workflow?"] },
          required: { type: "boolean", default: true },
          scale: {
            type: "object",
            properties: {
              min: { type: "integer", examples: [1] },
              max: { type: "integer", examples: [5] },
              minLabel: { type: "string", examples: ["Hard"] },
              maxLabel: { type: "string", examples: ["Great"] }
            }
          },
          options: { type: "array", items: { type: "string" } }
        }
      },
      Survey: {
        type: "object",
        required: ["id", "projectId", "environmentId", "key", "name", "status", "actorType", "questions", "targeting"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          key: { type: "string", examples: ["activation_pulse"] },
          name: { type: "string", examples: ["Activation pulse"] },
          description: { type: ["string", "null"] },
          status: { type: "string", enum: ["draft", "active", "paused", "archived"] },
          actorType: { type: "string", enum: ["user", "tenant", "session"] },
          triggerEvent: { type: ["string", "null"], examples: ["checkout.completed"] },
          questions: { type: "array", items: { $ref: "#/components/schemas/SurveyQuestion" } },
          targeting: {
            type: "object",
            properties: {
              segmentId: { type: "string" },
              userId: { type: "string" },
              tenantId: { type: "string" },
              eventName: { type: "string" },
              sampleRate: { type: "number", minimum: 0, maximum: 1 }
            }
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          archivedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      SurveyResponsePayload: {
        type: "object",
        required: ["survey_id", "answers"],
        properties: {
          survey_id: { type: "string", examples: ["srv_123"] },
          actor_type: { type: "string", enum: ["user", "tenant", "session", "anonymous"], default: "user" },
          actor_id: { type: "string" },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["web"] },
          release: { type: "string", examples: ["2026.06.01"] },
          answers: {
            type: "object",
            description: "Question id to answer value map. Secrets should not be sent.",
            additionalProperties: true,
            examples: [{ satisfaction: 5, comment: "Great" }]
          },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      FeedbackPayload: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", examples: ["The export button is confusing."] },
          category: { type: "string", examples: ["ux"] },
          page_url: { type: "string", format: "uri", examples: ["https://app.example.com/reports"] },
          path: { type: "string", examples: ["/reports?tab=exports"] },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["browser"] },
          release: { type: "string", examples: ["2026.06.01"] },
          user_agent: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      FeedbackWidgetSettings: {
        type: "object",
        required: ["projectId", "environmentId", "enabled", "title", "prompt", "placeholder", "buttonLabel", "accentColor", "allowScreenshot"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          enabled: { type: "boolean" },
          title: { type: "string" },
          prompt: { type: "string" },
          placeholder: { type: "string" },
          buttonLabel: { type: "string" },
          accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          allowScreenshot: { type: "boolean", description: "Reserved for a future privacy-safe screenshot flow." },
          privacyNote: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      FeedbackItem: {
        type: "object",
        required: ["id", "projectId", "environmentId", "status", "message", "metadata", "submittedAt", "receivedAt", "updatedAt"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          status: { type: "string", enum: ["open", "reviewed", "archived"] },
          message: { type: "string" },
          category: { type: ["string", "null"] },
          pageUrl: { type: ["string", "null"] },
          path: { type: ["string", "null"] },
          tenantId: { type: ["string", "null"] },
          userId: { type: ["string", "null"] },
          sessionId: { type: ["string", "null"] },
          traceId: { type: ["string", "null"] },
          release: { type: ["string", "null"] },
          source: { type: ["string", "null"] },
          userAgent: { type: ["string", "null"] },
          metadata: { type: "object", additionalProperties: true },
          submittedAt: { type: "string", format: "date-time" },
          receivedAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      SurveyResults: {
        type: "object",
        required: ["survey", "window", "totals", "questions", "recentResponses"],
        properties: {
          survey: { $ref: "#/components/schemas/Survey" },
          window: { type: "string", enum: ["24h", "7d", "30d"] },
          totals: {
            type: "object",
            required: ["responses", "users", "tenants", "sessions"],
            properties: {
              responses: { type: "integer" },
              users: { type: "integer" },
              tenants: { type: "integer" },
              sessions: { type: "integer" }
            }
          },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                type: { type: "string", enum: ["rating", "choice", "text"] },
                responses: { type: "integer" },
                average: { type: "number" },
                choices: { type: "array", items: { type: "object", properties: { value: { type: "string" }, count: { type: "integer" } } } }
              }
            }
          },
          recentResponses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                surveyId: { type: "string" },
                actorType: { type: "string", enum: ["user", "tenant", "session", "anonymous"] },
                actorId: { type: ["string", "null"] },
                tenantId: { type: ["string", "null"] },
                userId: { type: ["string", "null"] },
                sessionId: { type: ["string", "null"] },
                answers: { type: "object", additionalProperties: true },
                submittedAt: { type: "string", format: "date-time" }
              }
            }
          }
        }
      },
      MessageCampaign: {
        type: "object",
        required: ["id", "projectId", "environmentId", "key", "name", "status", "channelType", "body", "consentCategory"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          key: { type: "string", examples: ["invoice_activation"] },
          name: { type: "string", examples: ["Invoice activation"] },
          description: { type: ["string", "null"] },
          status: { type: "string", enum: ["draft", "active", "paused", "archived"] },
          channelType: { type: "string", enum: ["email", "webhook", "in_app"] },
          notificationChannelId: { type: ["string", "null"], description: "Required for email and webhook campaigns." },
          segmentId: { type: ["string", "null"], description: "Optional analytics segment id for the target audience." },
          conversionEvent: { type: ["string", "null"], examples: ["invoice.paid"] },
          subject: { type: ["string", "null"] },
          body: { type: "string" },
          ctaUrl: { type: ["string", "null"], format: "uri" },
          consentCategory: { type: "string", examples: ["product"] },
          privacyNote: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          archivedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      MessageCampaignResults: {
        type: "object",
        required: ["campaign", "window", "totals", "rates", "recentEvents", "optOuts"],
        properties: {
          campaign: { $ref: "#/components/schemas/MessageCampaign" },
          window: { type: "string", enum: ["24h", "7d", "30d"] },
          totals: {
            type: "object",
            required: ["queued", "sent", "delivered", "opened", "clicked", "converted", "failed", "optedOut", "uniqueActors"],
            properties: {
              queued: { type: "integer" },
              sent: { type: "integer" },
              delivered: { type: "integer" },
              opened: { type: "integer" },
              clicked: { type: "integer" },
              converted: { type: "integer" },
              failed: { type: "integer" },
              optedOut: { type: "integer" },
              uniqueActors: { type: "integer" }
            }
          },
          rates: {
            type: "object",
            required: ["deliveryRate", "openRate", "clickRate", "conversionRate", "optOutRate"],
            properties: {
              deliveryRate: { type: "number" },
              openRate: { type: "number" },
              clickRate: { type: "number" },
              conversionRate: { type: "number" },
              optOutRate: { type: "number" }
            }
          },
          recentEvents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                campaignId: { type: "string" },
                type: { type: "string", enum: ["queued", "sent", "delivered", "opened", "clicked", "converted", "failed", "opted_out"] },
                actorType: { type: "string", enum: ["user", "tenant", "session", "anonymous"] },
                actorId: { type: ["string", "null"] },
                tenantId: { type: ["string", "null"] },
                userId: { type: ["string", "null"] },
                occurredAt: { type: "string", format: "date-time" }
              }
            }
          },
          optOuts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                actorType: { type: "string", enum: ["user", "tenant", "session", "anonymous"] },
                actorId: { type: "string" },
                category: { type: "string" },
                reason: { type: ["string", "null"] },
                createdAt: { type: "string", format: "date-time" }
              }
            }
          }
        }
      },
      NpsSegmentSummary: {
        type: "object",
        required: ["key", "label", "responses", "score", "promoters", "passives", "detractors"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          responses: { type: "integer" },
          score: { type: "integer", minimum: -100, maximum: 100 },
          promoters: { type: "integer" },
          passives: { type: "integer" },
          detractors: { type: "integer" }
        }
      },
      NpsResults: {
        type: "object",
        required: ["survey", "window", "questionId", "totals", "trend", "segments", "recentResponses"],
        properties: {
          survey: { $ref: "#/components/schemas/Survey" },
          window: { type: "string", enum: ["24h", "7d", "30d"] },
          questionId: { type: "string" },
          totals: {
            type: "object",
            required: ["responses", "promoters", "passives", "detractors", "score", "average"],
            properties: {
              responses: { type: "integer" },
              promoters: { type: "integer" },
              passives: { type: "integer" },
              detractors: { type: "integer" },
              score: { type: "integer", minimum: -100, maximum: 100 },
              average: { type: ["number", "null"] }
            }
          },
          trend: {
            type: "array",
            items: {
              type: "object",
              required: ["bucket", "responses", "score", "promoters", "passives", "detractors"],
              properties: {
                bucket: { type: "string", examples: ["2026-05-01"] },
                responses: { type: "integer" },
                score: { type: "integer", minimum: -100, maximum: 100 },
                promoters: { type: "integer" },
                passives: { type: "integer" },
                detractors: { type: "integer" }
              }
            }
          },
          segments: {
            type: "object",
            required: ["tenants", "releases", "plans"],
            properties: {
              tenants: { type: "array", items: { $ref: "#/components/schemas/NpsSegmentSummary" } },
              releases: { type: "array", items: { $ref: "#/components/schemas/NpsSegmentSummary" } },
              plans: { type: "array", items: { $ref: "#/components/schemas/NpsSegmentSummary" } }
            }
          },
          recentResponses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                surveyId: { type: "string" },
                actorType: { type: "string", enum: ["user", "tenant", "session", "anonymous"] },
                actorId: { type: ["string", "null"] },
                tenantId: { type: ["string", "null"] },
                userId: { type: ["string", "null"] },
                sessionId: { type: ["string", "null"] },
                answers: { type: "object", additionalProperties: true },
                submittedAt: { type: "string", format: "date-time" }
              }
            }
          }
        }
      },
      FeatureFlagVariant: {
        type: "object",
        required: ["key", "value"],
        properties: {
          key: { type: "string", examples: ["off", "on"] },
          value: { oneOf: [{ type: "boolean" }, { type: "string" }, { type: "number" }, { type: "null" }] }
        }
      },
      FeatureFlagRule: {
        type: "object",
        required: ["variant"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          variant: { type: "string", examples: ["on"] },
          match: {
            type: "object",
            properties: {
              userId: { type: "string" },
              tenantId: { type: "string" },
              sessionId: { type: "string" },
              traits: { type: "object", additionalProperties: true }
            }
          },
          rollout: {
            type: "object",
            description: "Optional deterministic percentage rollout applied after match conditions pass.",
            required: ["percentage", "stickiness"],
            properties: {
              percentage: { type: "number", minimum: 0, maximum: 100, examples: [10] },
              stickiness: { type: "string", enum: ["user", "tenant", "session"], examples: ["user"] },
              salt: { type: "string" }
            }
          }
        }
      },
      FeatureFlag: {
        type: "object",
        required: ["id", "projectId", "environmentId", "key", "name", "status", "defaultVariant", "variants", "rules"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          key: { type: "string", examples: ["new_checkout"] },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          status: { type: "string", enum: ["draft", "active", "paused", "archived"] },
          defaultVariant: { type: "string", examples: ["off"] },
          variants: { type: "array", items: { $ref: "#/components/schemas/FeatureFlagVariant" } },
          rules: { type: "array", items: { $ref: "#/components/schemas/FeatureFlagRule" } },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          archivedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      FeatureFlagAudit: {
        type: "object",
        required: ["id", "featureFlagId", "projectId", "environmentId", "action", "changes", "createdAt"],
        properties: {
          id: { type: "string" },
          featureFlagId: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          action: { type: "string", enum: ["created", "updated", "archived"] },
          actorId: { type: ["string", "null"] },
          changes: { type: "object", additionalProperties: true },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      FeatureFlagEvaluation: {
        type: "object",
        required: ["key", "variant", "value", "reason", "matched"],
        properties: {
          key: { type: "string", examples: ["new_checkout"] },
          variant: { type: "string", examples: ["on"] },
          value: { oneOf: [{ type: "boolean" }, { type: "string" }, { type: "number" }, { type: "null" }] },
          reason: { type: "string", enum: ["rule_match", "default", "missing", "inactive"] },
          matched: { type: "boolean" },
          ruleId: { type: "string" }
        }
      },
      BetaProgram: {
        type: "object",
        required: ["id", "projectId", "environmentId", "key", "name", "status", "actorType", "featureFlagVariant"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          key: { type: "string", examples: ["checkout_beta"] },
          name: { type: "string", examples: ["Checkout beta"] },
          description: { type: ["string", "null"] },
          status: { type: "string", enum: ["draft", "active", "paused", "archived"] },
          actorType: { type: "string", enum: ["user", "tenant"] },
          featureFlagId: { type: ["string", "null"], description: "Optional linked flag. Active participants are synced as targeting rules." },
          featureFlagVariant: { type: "string", examples: ["on"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          archivedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      BetaProgramParticipant: {
        type: "object",
        required: ["id", "programId", "projectId", "environmentId", "actorType", "actorId", "status"],
        properties: {
          id: { type: "string" },
          programId: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          actorType: { type: "string", enum: ["user", "tenant"] },
          actorId: { type: "string" },
          status: { type: "string", enum: ["invited", "active", "opted_out", "removed"] },
          notes: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          removedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      BetaProgramAdoption: {
        type: "object",
        required: ["programId", "window", "participants", "activeParticipants", "activeActorsWithEvents", "events", "adoptionRate", "samples"],
        properties: {
          programId: { type: "string" },
          window: { type: "string", enum: ["24h", "7d", "30d"] },
          participants: { type: "integer" },
          activeParticipants: { type: "integer" },
          activeActorsWithEvents: { type: "integer" },
          events: { type: "integer" },
          adoptionRate: { type: "number" },
          samples: {
            type: "array",
            items: {
              type: "object",
              properties: {
                actorId: { type: "string" },
                events: { type: "integer" },
                lastSeenAt: { type: "string", format: "date-time" }
              }
            }
          }
        }
      },
      DataGovernancePropertyRule: {
        type: "object",
        required: ["target", "path", "action"],
        properties: {
          target: {
            type: "string",
            enum: [
              "metadata",
              "event.properties",
              "error.context",
              "span.input",
              "span.output",
              "span.error",
              "breadcrumb.data",
              "replay.event.data",
              "identity.traits"
            ]
          },
          path: { type: "string", examples: ["user.email", "headers.authorization"] },
          action: { type: "string", enum: ["mask", "block"] }
        }
      },
      DataGovernancePolicy: {
        type: "object",
        required: ["projectId", "environmentId", "retentionPolicy", "propertyRules"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          retentionPolicy: {
            type: "object",
            description: dataGovernanceRetentionDescription,
            properties: dataGovernanceRetentionProperties,
            additionalProperties: false,
            examples: [{ events: 90, errors: 180, traces: 30 }]
          },
          propertyRules: {
            type: "array",
            items: { $ref: "#/components/schemas/DataGovernancePropertyRule" }
          },
          updatedByUserId: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodeIntegration: {
        type: "object",
        required: ["id", "projectId", "provider", "name", "owner", "repo", "webBaseUrl"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          provider: { type: "string", enum: ["github", "gitlab"] },
          name: { type: "string", examples: ["Web app"] },
          owner: { type: "string", examples: ["acme"] },
          repo: { type: "string", examples: ["web"] },
          webBaseUrl: { type: "string", format: "uri" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      IncidentExternalLink: {
        type: "object",
        required: ["id", "projectId", "environmentId", "errorGroupId", "provider", "externalKey", "title", "url", "state"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          errorGroupId: { type: "string" },
          integrationId: { type: ["string", "null"] },
          provider: { type: "string", enum: ["github", "gitlab"] },
          externalKey: { type: "string", examples: ["42"] },
          title: { type: "string" },
          url: { type: "string", format: "uri" },
          state: { type: "string", examples: ["open"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      IncidentIssueDraft: {
        type: "object",
        required: ["provider", "integrationId", "title", "body", "url"],
        properties: {
          provider: { type: "string", enum: ["github", "gitlab"] },
          integrationId: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          url: { type: "string", format: "uri" }
        }
      },
      ErrorGroupRecord: {
        type: "object",
        required: [
          "id",
          "projectId",
          "environmentId",
          "groupingFingerprint",
          "message",
          "type",
          "topStackFrame",
          "severity",
          "status",
          "priority",
          "firstSeenAt",
          "lastSeenAt",
          "lastRegressedAt",
          "occurrenceCount",
          "affectedUsersCount",
          "affectedTenantsCount",
          "latestErrorId",
          "latestRelease",
          "resolvedAt",
          "ignoredAt",
          "assignedToUserId",
          "assignedTo",
          "silencedUntil",
          "incidentNumber",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          groupingFingerprint: { type: "string" },
          message: { type: "string" },
          type: { type: ["string", "null"] },
          topStackFrame: { type: ["string", "null"] },
          severity: { type: "string" },
          status: { type: "string", enum: ["open", "investigating", "resolved", "ignored"] },
          priority: { type: ["string", "null"], enum: ["urgent", "high", "normal", "low", null] },
          firstSeenAt: { type: "string", format: "date-time" },
          lastSeenAt: { type: "string", format: "date-time" },
          lastRegressedAt: { type: ["string", "null"], format: "date-time" },
          occurrenceCount: { type: "integer", minimum: 0 },
          affectedUsersCount: { type: "integer", minimum: 0 },
          affectedTenantsCount: { type: "integer", minimum: 0 },
          latestErrorId: { type: ["string", "null"] },
          latestRelease: { type: ["string", "null"] },
          resolvedAt: { type: ["string", "null"], format: "date-time" },
          ignoredAt: { type: ["string", "null"], format: "date-time" },
          assignedToUserId: { type: ["string", "null"] },
          assignedTo: {
            type: ["object", "null"],
            properties: { id: { type: "string" }, email: { type: "string" } }
          },
          silencedUntil: { type: ["string", "null"], format: "date-time" },
          incidentNumber: { type: ["string", "null"] },
          trend: { type: "array", items: { type: "number" }, description: "Optional recent-occurrence sparkline series." },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      ErrorGroupTriagePatch: {
        type: "object",
        minProperties: 1,
        description: "At least one of status, priority, or assignedToUserId must be present.",
        properties: {
          status: { type: "string", enum: ["open", "investigating", "resolved", "ignored"] },
          priority: { type: ["string", "null"], enum: ["urgent", "high", "normal", "low", null] },
          assignedToUserId: { type: ["string", "null"], description: "User id to assign, or null to unassign." }
        }
      },
      TriageNoteInput: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 5000 }
        }
      },
      SilenceIncidentInput: {
        type: "object",
        required: ["minutes"],
        properties: {
          minutes: {
            type: ["integer", "null"],
            minimum: 0,
            description: "Minutes from now to silence the incident. `0` or `null` clears an existing silence."
          }
        }
      },
      TriageNoteRecord: {
        type: "object",
        required: ["id", "errorGroupId", "authorUserId", "authorEmail", "body", "createdAt"],
        properties: {
          id: { type: "string" },
          errorGroupId: { type: "string" },
          authorUserId: { type: ["string", "null"] },
          authorEmail: { type: "string" },
          body: { type: "string", maxLength: 5000 },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      EntityTenantSummary: {
        type: "object",
        required: [
          "tenantId",
          "label",
          "traits",
          "keyTraits",
          "isUnassigned",
          "impactScore",
          "firstSeenAt",
          "lastSeenAt",
          "profileUpdatedAt",
          "events",
          "errors",
          "openErrors",
          "severeErrors",
          "traces",
          "failedTraces",
          "llmCalls",
          "failedLlmCalls",
          "llmCostUsd",
          "activeUsers",
          "activeSessions"
        ],
        properties: {
          tenantId: { type: ["string", "null"] },
          label: { type: "string" },
          traits: { type: "object", additionalProperties: true },
          keyTraits: { type: "object", additionalProperties: { type: "string" } },
          isUnassigned: { type: "boolean" },
          impactScore: { type: "number" },
          firstSeenAt: { type: ["string", "null"], format: "date-time" },
          lastSeenAt: { type: ["string", "null"], format: "date-time" },
          profileUpdatedAt: { type: ["string", "null"], format: "date-time" },
          events: { type: "integer", minimum: 0 },
          errors: { type: "integer", minimum: 0 },
          openErrors: { type: "integer", minimum: 0 },
          severeErrors: { type: "integer", minimum: 0 },
          traces: { type: "integer", minimum: 0 },
          failedTraces: { type: "integer", minimum: 0 },
          llmCalls: { type: "integer", minimum: 0 },
          failedLlmCalls: { type: "integer", minimum: 0 },
          llmCostUsd: { type: "string" },
          activeUsers: { type: "integer", minimum: 0 },
          activeSessions: { type: "integer", minimum: 0 }
        }
      },
      EntityUserSummary: {
        type: "object",
        required: [
          "userId",
          "label",
          "traits",
          "keyTraits",
          "isAnonymous",
          "impactScore",
          "firstSeenAt",
          "lastSeenAt",
          "profileUpdatedAt",
          "events",
          "errors",
          "openErrors",
          "severeErrors",
          "traces",
          "failedTraces",
          "llmCalls",
          "failedLlmCalls",
          "llmCostUsd",
          "activeTenants",
          "activeSessions"
        ],
        properties: {
          userId: { type: ["string", "null"] },
          label: { type: "string" },
          traits: { type: "object", additionalProperties: true },
          keyTraits: { type: "object", additionalProperties: { type: "string" } },
          isAnonymous: { type: "boolean" },
          impactScore: { type: "number" },
          firstSeenAt: { type: ["string", "null"], format: "date-time" },
          lastSeenAt: { type: ["string", "null"], format: "date-time" },
          profileUpdatedAt: { type: ["string", "null"], format: "date-time" },
          events: { type: "integer", minimum: 0 },
          errors: { type: "integer", minimum: 0 },
          openErrors: { type: "integer", minimum: 0 },
          severeErrors: { type: "integer", minimum: 0 },
          traces: { type: "integer", minimum: 0 },
          failedTraces: { type: "integer", minimum: 0 },
          llmCalls: { type: "integer", minimum: 0 },
          failedLlmCalls: { type: "integer", minimum: 0 },
          llmCostUsd: { type: "string" },
          activeTenants: { type: "integer", minimum: 0 },
          activeSessions: { type: "integer", minimum: 0 }
        }
      },
      ReleaseMetadata: {
        type: "object",
        required: ["id", "projectId", "environmentId", "release"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          release: { type: "string", examples: ["web@1.2.3"] },
          integrationId: { type: ["string", "null"] },
          commitSha: { type: ["string", "null"] },
          commitUrl: { type: ["string", "null"], format: "uri" },
          pullRequestNumber: { type: ["integer", "null"] },
          pullRequestUrl: { type: ["string", "null"], format: "uri" },
          deployedBy: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      WarehouseDestination: {
        type: "object",
        required: [
          "id",
          "projectId",
          "environmentId",
          "name",
          "destinationType",
          "connectionUrlPreview",
          "datasets",
          "cursor",
          "batchSize",
          "enabled"
        ],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          name: { type: "string" },
          destinationType: { type: "string", enum: ["postgres"] },
          connectionUrlPreview: {
            type: "string",
            description: "Redacted connection URL. The raw URL is write-only and never returned."
          },
          datasets: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            description:
              "Selected incremental datasets. Identity profiles preserve traits and use a project/environment/actor source id for idempotent destination upserts.",
            items: { type: "string", enum: ["events", "errors", "traces", "llmCalls", "userProfiles", "tenantProfiles"] }
          },
          cursor: { type: "object", additionalProperties: true },
          batchSize: { type: "integer", minimum: 1, maximum: 5000 },
          enabled: { type: "boolean" },
          lastRunAt: { type: ["string", "null"], format: "date-time" },
          lastSuccessAt: { type: ["string", "null"], format: "date-time" },
          lastFailureAt: { type: ["string", "null"], format: "date-time" },
          lastErrorMessage: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          archivedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      WarehouseExportRun: {
        type: "object",
        required: ["id", "destinationId", "projectId", "environmentId", "trigger", "status", "startedAt", "exported"],
        properties: {
          id: { type: "string" },
          destinationId: { type: "string" },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          trigger: { type: "string", enum: ["scheduled", "manual", "retry"] },
          status: { type: "string", enum: ["running", "success", "failed"] },
          startedAt: { type: "string", format: "date-time" },
          finishedAt: { type: ["string", "null"], format: "date-time" },
          cursorBefore: { type: "object", additionalProperties: true },
          cursorAfter: { type: "object", additionalProperties: true },
          exported: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
          errorMessage: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      EventPayload: {
        type: "object",
        required: ["name"],
        description: "Product or business event. Include stable identity and release fields whenever possible so the console can filter by tenant, user, session, trace, source, and deploy version.",
        properties: {
          name: { type: "string", description: "Event name using a stable dot-case convention.", examples: ["checkout.started"] },
          tenant_id: { type: "string", description: "Stable tenant/workspace/account id." },
          user_id: { type: "string", description: "Stable authenticated user id." },
          session_id: { type: "string", description: "Client or server session id used to connect related activity." },
          trace_id: { type: "string", description: "Trace id when this event belongs to a larger workflow." },
          replay_id: {
            type: "string",
            description:
              "Optional privacy-safe replay id. Send the same id to /v1/replays to show product event markers in the replay timeline."
          },
          source: { type: "string", description: "Emitter or service name.", examples: ["web"] },
          release: { type: "string", description: "Application version or deploy id.", examples: ["2026.05.24"] },
          properties: { type: "object", description: "Event-specific attributes. Avoid secrets, tokens, cookies, and full request/response bodies.", additionalProperties: true },
          metadata: { type: "object", description: "Operational metadata such as request id, module, route, or correlation id.", additionalProperties: true },
          timestamp: { type: "string", format: "date-time", description: "Optional event timestamp. Defaults to server receive time when omitted." }
        }
      },
      ErrorPayload: {
        type: "object",
        required: ["message"],
        description: "Exception or error occurrence. Use fingerprint to control grouping when the default grouping is too broad or too noisy.",
        properties: {
          message: { type: "string", description: "Human-readable error message." },
          type: { type: "string", description: "Exception class, error name, or domain error type." },
          severity: {
            type: "string",
            enum: ["debug", "info", "warning", "error", "critical", "fatal"],
            description: "Severity used by filters and alerting. Defaults to error."
          },
          fingerprint: { type: "string", description: "Optional grouping key. Events with the same fingerprint are grouped together." },
          replay_id: {
            type: "string",
            description: "Optional privacy-safe replay id. Send the same id to /v1/replays so incident detail can show the masked timeline around this error."
          },
          stack: { type: "string", description: "Raw stack trace. Source maps can resolve minified browser frames when uploaded for the matching release." },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", description: "Emitter or service name, for example web, api, worker, or scheduler." },
          release: { type: "string", description: "Application version or deploy id." },
          context: { type: "object", description: "Debug context for this occurrence. Avoid secrets and full payload bodies.", additionalProperties: true },
          metadata: { type: "object", description: "Operational metadata such as route, module, request id, or correlation id.", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      BreadcrumbPayload: {
        type: "object",
        required: ["type", "message"],
        properties: {
          type: { type: "string", enum: ["navigation", "click", "console", "network", "custom"] },
          category: { type: "string" },
          message: { type: "string" },
          level: { type: "string", enum: ["debug", "info", "warning", "error", "fatal"] },
          data: { type: "object", additionalProperties: true },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string" },
          release: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      ClickEventPayload: {
        type: "object",
        required: ["route", "selector", "x", "y", "viewport_width", "viewport_height"],
        description:
          "Opt-in browser click map sample. Stores normalized viewport coordinates and privacy-safe selectors only; do not send text content, form values, DOM snapshots, or screenshots.",
        properties: {
          route: { type: "string", description: "Browser route or path where the click occurred.", examples: ["/checkout"] },
          selector: {
            type: "string",
            description: "Stable safe selector. Prefer a deliberate data-sigmon-id value instead of generated DOM paths.",
            examples: ['[data-sigmon-id="checkout-submit"]']
          },
          element_tag: { type: "string", description: "Optional lower-case element tag, for example button or a." },
          element_role: { type: "string", description: "Optional ARIA role when available." },
          x: { type: "number", minimum: 0, maximum: 1, description: "Normalized viewport x coordinate from 0 to 1." },
          y: { type: "number", minimum: 0, maximum: 1, description: "Normalized viewport y coordinate from 0 to 1." },
          viewport_width: { type: "integer", minimum: 1 },
          viewport_height: { type: "integer", minimum: 1 },
          scroll_x: { type: "integer" },
          scroll_y: { type: "integer" },
          masked: { type: "boolean", default: true, description: "True when the SDK captured the click through the privacy-safe browser helper." },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["web"] },
          release: { type: "string", description: "Application version or deploy id." },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      SessionReplayPayload: {
        type: "object",
        required: ["replay_id", "started_at"],
        description:
          "Privacy-safe browser session timeline linked to errors through replay_id. This is not video replay and must not include screenshots, DOM snapshots, raw text, input values, passwords, cookies, or HTML. The complete JSON payload must not exceed 64 KiB.",
        properties: {
          replay_id: { type: "string", description: "Stable id generated by the browser SDK for this replay buffer." },
          started_at: { type: "string", format: "date-time" },
          ended_at: { type: "string", format: "date-time" },
          duration_ms: { type: "integer", minimum: 0 },
          route: { type: "string", description: "Browser route or path where the replay started." },
          error_id: { type: "string", description: "Optional error id when available after capture." },
          masked: { type: "boolean", default: true },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["web"] },
          release: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          events: {
            type: "array",
            maxItems: 300,
            description: "Ordered privacy-safe timeline, limited to 300 events per replay payload.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["offset_ms", "type"],
              properties: {
                offset_ms: { type: "integer", minimum: 0 },
                type: {
                  type: "string",
                  enum: ["navigation", "click", "input", "console", "network", "error", "custom"]
                },
                route: { type: "string" },
                selector: { type: "string", description: "Stable safe selector, preferably based on data-sigmon-id." },
                message: {
                  type: "string",
                  description: "Optional source message. The API always stores it as the literal [REDACTED]."
                },
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                data: {
                  type: "object",
                  additionalProperties: true,
                  description:
                    "Privacy-safe JSON metadata limited to 5 container levels and 64 object keys in total for this event. Keys that can carry raw text, HTML, input values, or passwords are rejected."
                }
              }
            }
          },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      LlmPayload: {
        type: "object",
        required: ["provider", "model"],
        properties: {
          provider: { type: "string", examples: ["openai"] },
          model: { type: "string", examples: ["gpt-5-mini"] },
          prompt_name: { type: "string" },
          status: { type: "string", enum: ["success", "error", "pending"] },
          input_tokens: { type: "integer", minimum: 0 },
          output_tokens: { type: "integer", minimum: 0 },
          cost_usd: { type: "number", minimum: 0 },
          latency_ms: { type: "integer", minimum: 0 },
          input_preview: { type: "string" },
          output_preview: { type: "string" },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          trace_id: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      WebVitalPayload: {
        type: "object",
        required: ["name", "value"],
        description:
          "Browser Web Vital sample. Use the browser SDK helper when possible so metric names, ratings, route, navigation type, release, and context are normalized consistently.",
        properties: {
          name: { type: "string", enum: ["CLS", "FCP", "FID", "INP", "LCP", "TTFB"] },
          value: { type: "number", minimum: 0, description: "Metric value. CLS is unitless; timing metrics are milliseconds." },
          rating: { type: "string", enum: ["good", "needs-improvement", "poor"], default: "good" },
          route: { type: "string", description: "Browser route or path where the metric was observed." },
          navigation_type: { type: "string", description: "Browser navigation type such as navigate, reload, back-forward, or prerender." },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["web"] },
          release: { type: "string", description: "Application version or deploy id used for regression comparison." },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      ProfilePayload: {
        type: "object",
        required: ["name", "kind", "started_at"],
        description:
          "Bounded runtime profile summary. Use @sigmon/sdk/node helpers for targeted CPU windows and memory snapshots; do not upload raw heap dumps or full profiler files.",
        properties: {
          name: { type: "string", description: "Route, job, worker task, or operation being profiled." },
          kind: { type: "string", enum: ["cpu", "memory"] },
          runtime: { type: "string", default: "node" },
          service: { type: "string", description: "Service or process name, for example api, worker, scheduler." },
          route: { type: "string", description: "HTTP route or job name when applicable." },
          started_at: { type: "string", format: "date-time" },
          ended_at: { type: "string", format: "date-time" },
          duration_ms: { type: "integer", minimum: 0 },
          sample_count: { type: "integer", minimum: 0 },
          sampling_interval_ms: { type: "integer", minimum: 1 },
          cpu_usage_percent: { type: "number", minimum: 0, maximum: 100 },
          cpu_user_ms: { type: "integer", minimum: 0 },
          cpu_system_ms: { type: "integer", minimum: 0 },
          rss_bytes: { type: "integer", minimum: 0 },
          heap_used_bytes: { type: "integer", minimum: 0 },
          heap_total_bytes: { type: "integer", minimum: 0 },
          external_bytes: { type: "integer", minimum: 0 },
          array_buffers_bytes: { type: "integer", minimum: 0 },
          top_functions: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              required: ["function_name"],
              properties: {
                function_name: { type: "string" },
                url: { type: "string" },
                line_number: { type: "integer", minimum: 0 },
                column_number: { type: "integer", minimum: 0 },
                self_time_ms: { type: "number", minimum: 0 },
                total_time_ms: { type: "number", minimum: 0 },
                sample_count: { type: "integer", minimum: 0 }
              }
            }
          },
          summary: { type: "object", additionalProperties: true },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["node"] },
          release: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      TracePayload: {
        type: "object",
        required: ["name", "started_at"],
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["success", "error", "pending"] },
          started_at: { type: "string", format: "date-time" },
          ended_at: { type: "string", format: "date-time" },
          duration_ms: { type: "integer", minimum: 0 },
          trace_id: { type: "string" },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          source: { type: "string" },
          release: { type: "string" },
          metadata: { type: "object", additionalProperties: true }
        }
      },
      SpanPayload: {
        type: "object",
        required: ["trace_id", "name", "started_at"],
        properties: {
          trace_id: { type: "string" },
          parent_span_id: { type: "string" },
          name: { type: "string" },
          status: { type: "string", enum: ["success", "error", "pending"] },
          started_at: { type: "string", format: "date-time" },
          ended_at: { type: "string", format: "date-time" },
          duration_ms: { type: "integer", minimum: 0 },
          input: { description: "Any JSON value. Avoid secrets and full payload bodies." },
          output: { description: "Any JSON value. Avoid secrets and full payload bodies." },
          error: { description: "Any JSON value describing a failed child operation." },
          cost_usd: { type: "number", minimum: 0 },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          source: { type: "string" },
          release: { type: "string" },
          metadata: { type: "object", additionalProperties: true }
        }
      },
      UserIdentifyPayload: {
        type: "object",
        required: ["user_id", "traits"],
        description:
          "Upserts a project/environment-scoped user profile. Identify traits shallow-merge into existing stored traits. Telemetry with matching user_id updates last_seen_at, but only identify calls update stored traits.",
        properties: {
          user_id: { type: "string", description: "Stable authenticated user id from the monitored product." },
          tenant_id: { type: "string", description: "Optional current tenant/workspace/account id for this user." },
          traits: {
            type: "object",
            description: "Sanitized profile traits such as name, email, role, plan, locale, or operation mode. Secrets are not allowed.",
            additionalProperties: true,
            examples: [{ name: "Ana Souza", email: "ana@example.com", role: "admin", plan: "pro" }]
          },
          metadata: { type: "object", description: "Accepted for envelope compatibility but not persisted in profile rows in this MVP.", additionalProperties: true },
          timestamp: { type: "string", format: "date-time", description: "Optional identify timestamp." }
        }
      },
      TenantIdentifyPayload: {
        type: "object",
        required: ["tenant_id", "traits"],
        description:
          "Upserts a project/environment-scoped tenant profile used by Entities investigation views and tenant-level filters. Identify traits shallow-merge into existing stored traits.",
        properties: {
          tenant_id: { type: "string", description: "Stable tenant/workspace/account id from the monitored product." },
          traits: {
            type: "object",
            description: "Sanitized tenant traits such as name, plan, status, tier, region, or operation_mode. Secrets are not allowed.",
            additionalProperties: true,
            examples: [{ name: "MicroERP", plan: "pro", operation_mode: "production" }]
          },
          metadata: { type: "object", description: "Accepted for envelope compatibility but not persisted in profile rows in this MVP.", additionalProperties: true },
          timestamp: { type: "string", format: "date-time", description: "Optional identify timestamp." }
        }
      },
      LoginPayload: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" }
        }
      },
      HttpMonitorPayload: {
        type: "object",
        required: ["projectId", "environmentId", "name", "url"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          notificationChannelId: { type: ["string", "null"] },
          name: { type: "string" },
          url: { type: "string", format: "uri" },
          method: { type: "string", enum: ["GET", "HEAD"], default: "GET" },
          intervalMinutes: { type: "integer", minimum: 1, default: 5 },
          timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 5000 },
          expectedStatus: { type: "string", examples: ["2xx", "200", "200-299"] },
          bodyContains: { type: ["string", "null"] },
          failureThreshold: { type: "integer", minimum: 1, default: 2 },
          recoveryThreshold: { type: "integer", minimum: 1, default: 2 },
          enabled: { type: "boolean", default: true }
        }
      },
      HeartbeatMonitorPayload: {
        type: "object",
        required: ["projectId", "environmentId", "name", "expectedIntervalMinutes"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          notificationChannelId: { type: ["string", "null"] },
          name: { type: "string" },
          expectedIntervalMinutes: { type: "integer", minimum: 1 },
          graceMinutes: { type: "integer", minimum: 0, default: 0 },
          enabled: { type: "boolean", default: true }
        }
      },
      CreateReadTokenPayload: {
        type: "object",
        required: ["projectId", "environmentId", "name"],
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          name: { type: "string", minLength: 1, maxLength: 256 }
        }
      },
      UpdateReadTokenPayload: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 256 }
        }
      },
      ReadToken: {
        type: "object",
        required: ["id", "projectId", "environmentId", "name", "prefix", "createdAt", "lastUsedAt", "revokedAt"],
        properties: {
          id: { type: "string", examples: ["rdtok_example"] },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          name: { type: "string" },
          prefix: { type: "string", description: "First 16 characters of the secret, safe to display for identification." },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      ReadTokenCreateResponse: {
        type: "object",
        required: ["token"],
        properties: {
          token: {
            allOf: [
              { $ref: "#/components/schemas/ReadToken" },
              {
                type: "object",
                required: ["secret"],
                properties: {
                  secret: {
                    type: "string",
                    description: "Full read token secret, for example `shread_...`. Returned only on creation — store it now, it cannot be retrieved again."
                  }
                }
              }
            ]
          }
        }
      },
      ReadTokenResponse: {
        type: "object",
        required: ["token"],
        properties: {
          token: { $ref: "#/components/schemas/ReadToken" }
        }
      },
      ReadTokenListResponse: {
        type: "object",
        required: ["tokens"],
        properties: {
          tokens: {
            type: "array",
            items: { $ref: "#/components/schemas/ReadToken" }
          }
        }
      },
      MonitorResponse: {
        type: "object",
        required: ["monitor"],
        properties: {
          monitor: {
            type: "object",
            additionalProperties: true,
            description: "Monitor record with secretHash redacted."
          },
          secret: {
            type: "string",
            description: "Heartbeat secret returned only when creating a heartbeat monitor."
          }
        }
      },
      DeadLetterJob: {
        type: "object",
        required: ["id", "projectId", "environmentId", "queueName", "jobName", "payload", "errorMessage", "createdAt"],
        properties: {
          id: { type: "string" },
          projectId: {
            type: ["string", "null"],
            description: "Project scope captured from the failed telemetry job when available."
          },
          environmentId: {
            type: ["string", "null"],
            description: "Environment scope captured from the failed telemetry job when available."
          },
          queueName: { type: "string", examples: ["telemetry"] },
          jobName: { type: "string", examples: ["event"] },
          payload: {
            type: "object",
            description: "sanitized failed job payload retained for operator inspection.",
            additionalProperties: true
          },
          errorMessage: { type: "string", description: "Sanitized failure message." },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      DeadLetterJobListResponse: {
        type: "object",
        required: ["deadLetterJobs"],
        properties: {
          deadLetterJobs: {
            type: "array",
            items: { $ref: "#/components/schemas/DeadLetterJob" }
          },
          cursor: { type: "string", nullable: true, description: "Opaque cursor for the next newest-first page." }
        }
      },
      DeadLetterJobResponse: {
        type: "object",
        required: ["deadLetterJob"],
        properties: {
          deadLetterJob: { $ref: "#/components/schemas/DeadLetterJob" }
        }
      },
      DeadLetterJobAction: {
        type: "object",
        required: ["id", "deadLetterJobId", "queueName", "jobName", "action", "actorEmail", "metadata", "createdAt"],
        properties: {
          id: { type: "string" },
          deadLetterJobId: { type: "string" },
          queueName: { type: "string" },
          jobName: { type: "string" },
          action: { type: "string", enum: ["deleted", "replayed", "expired"] },
          actorUserId: { type: "string", nullable: true },
          actorEmail: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      DeadLetterJobActionsResponse: {
        type: "object",
        required: ["actions"],
        properties: {
          actions: {
            type: "array",
            items: { $ref: "#/components/schemas/DeadLetterJobAction" }
          }
        }
      },
      DeadLetterReplayResponse: {
        type: "object",
        required: ["replayed", "id"],
        properties: {
          replayed: { type: "boolean", const: true },
          id: { type: "string" }
        }
      },
      SystemActionResponse: {
        type: "object",
        required: ["ok", "action", "status", "message", "generatedAt"],
        properties: {
          ok: { type: "boolean", const: true },
          action: { type: "string", enum: ["doctor", "retention"] },
          status: { type: "string", enum: ["success", "skipped"] },
          message: { type: "string" },
          ran: { type: "boolean" },
          skipped: { type: "boolean" },
          generatedAt: { type: "string", format: "date-time" }
        }
      },
      SystemBackupActionResponse: {
        type: "object",
        required: ["ok", "action", "status", "message", "jobId", "generatedAt"],
        properties: {
          ok: { type: "boolean", const: true },
          action: { type: "string", const: "backup" },
          status: { type: "string", const: "accepted" },
          message: { type: "string", const: "Backup queued." },
          jobId: { type: "string" },
          generatedAt: { type: "string", format: "date-time" }
        }
      },
      SystemHealthSample: {
        type: "object",
        required: ["capturedAt", "postgresLatencyMs", "redisLatencyMs", "queueWaiting", "queueActive", "queueFailed"],
        properties: {
          capturedAt: { type: "string", format: "date-time" },
          postgresLatencyMs: { type: ["number", "null"] },
          redisLatencyMs: { type: ["number", "null"] },
          queueWaiting: { type: "integer", minimum: 0 },
          queueActive: { type: "integer", minimum: 0 },
          queueFailed: { type: "integer", minimum: 0 }
        }
      },
      AlertEventRecord: {
        type: "object",
        required: [
          "id",
          "projectId",
          "environmentId",
          "status",
          "severity",
          "triggeredAt",
          "windowStart",
          "windowEnd",
          "observedValue",
          "threshold",
          "message",
          "metadata",
          "createdAt"
        ],
        properties: {
          id: { type: "string" },
          ruleId: { type: ["string", "null"] },
          monitorId: { type: ["string", "null"] },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          status: { type: "string", enum: ["triggered", "acknowledged", "snoozed", "resolved"] },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          triggeredAt: { type: "string", format: "date-time" },
          windowStart: { type: "string", format: "date-time" },
          windowEnd: { type: "string", format: "date-time" },
          observedValue: { type: "string" },
          threshold: { type: "string" },
          message: { type: "string" },
          metadata: { type: ["object", "null"], additionalProperties: true },
          acknowledgedAt: { type: ["string", "null"], format: "date-time" },
          acknowledgedByUserId: { type: ["string", "null"] },
          acknowledgedByEmail: { type: ["string", "null"] },
          resolvedAt: { type: ["string", "null"], format: "date-time" },
          resolvedByUserId: { type: ["string", "null"] },
          resolvedByEmail: { type: ["string", "null"] },
          snoozedUntil: { type: ["string", "null"], format: "date-time" },
          triageNote: { type: ["string", "null"] },
          escalationDueAt: { type: ["string", "null"], format: "date-time" },
          escalatedAt: { type: ["string", "null"], format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          latestDeliveryStatus: { type: ["string", "null"], enum: ["success", "failed", null] }
        }
      },
      AlertEventTriagePatch: {
        type: "object",
        required: ["status"],
        description: "`snoozedUntil` is required and must be a valid date when `status` is `snoozed`.",
        properties: {
          status: { type: "string", enum: ["triggered", "acknowledged", "snoozed", "resolved"] },
          snoozedUntil: { type: ["string", "null"], format: "date-time" },
          note: { type: ["string", "null"], maxLength: 2000 }
        }
      },
      AlertSuggestion: {
        type: "object",
        description: "Heuristic alert rule suggestion derived from recent error, latency, LLM cost, or dead-letter activity. Suggestions are omitted when an active rule of the same type (and route pattern, where applicable) already exists.",
        required: ["key", "type", "severity", "title", "sub", "windowMinutes", "threshold", "rationale", "cooldownMinutes"],
        properties: {
          key: { type: "string" },
          type: {
            type: "string",
            enum: ["critical_errors", "error_count", "error_rate", "trace_p95_latency", "llm_cost", "dead_letter_count"]
          },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          sub: { type: "string" },
          windowMinutes: { type: "integer", minimum: 1 },
          threshold: { type: "string" },
          routePattern: { type: ["string", "null"] },
          minimumSampleSize: { type: "integer", minimum: 0 },
          rationale: { type: "string" },
          cooldownMinutes: { type: "integer", minimum: 0 }
        }
      }
    },
    responses: {
      BadRequest: {
        description: "Invalid request payload or query parameters",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      },
      Unauthorized: {
        description: "Missing or invalid authentication",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      },
      Forbidden: {
        description: "Authenticated caller is not allowed to perform this action",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      },
      Unavailable: {
        description: "Service dependency unavailable",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
      }
    }
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Check API liveness",
        description:
          "Returns the commit currently running as `version`, or `null` when the deployment did not stamp one. Compare it against the commit you expect to confirm a deploy actually replaced the running container.",
        responses: {
          "200": {
            description: "API is alive",
            content: {
              "application/json": {
                example: { ok: true, version: "e8460fbfef11972f7605a2221fee2d19c452ca9d" }
              }
            }
          }
        }
      }
    },
    "/ready": {
      get: {
        tags: ["Health"],
        summary: "Check API dependencies",
        responses: {
          "200": {
            description: "Postgres and Redis are ready",
            content: { "application/json": { example: { ok: true, checks: { postgres: true, redis: true } } } }
          },
          "503": {
            description: "One or more dependencies are not ready",
            content: { "application/json": { example: { ok: false, checks: { postgres: true, redis: false } } } }
          }
        }
      }
    },
    "/v1/events": {
      post: ingestionOperation("Ingest an event", "Track product or business events. Use this for product analytics, lifecycle events, and domain milestones.", "EventPayload", {
        name: "checkout.started",
        tenant_id: "tenant_123",
        user_id: "user_456",
        session_id: "sess_789",
        replay_id: "rpl_browser_123",
        source: "web",
        release: "2026.05.24",
        properties: { plan: "team", checkout_id: "chk_123" },
        metadata: { request_id: "req_abc" }
      })
    },
    "/v1/surveys/responses": {
      post: ingestionOperation(
        "Ingest an in-app survey response",
        "Track lightweight survey answers collected by browser widgets, SDK calls, or server-side product flows. Responses are scoped to a configured survey and can be linked to user, tenant, session, trace, source, and release context.",
        "SurveyResponsePayload",
        {
          survey_id: "srv_activation_pulse",
          actor_type: "user",
          actor_id: "user_456",
          tenant_id: "tenant_123",
          user_id: "user_456",
          session_id: "sess_789",
          source: "web",
          release: "2026.06.01",
          answers: { satisfaction: 5, comment: "Great" },
          metadata: { placement: "checkout_success" }
        }
      )
    },
    "/v1/feedback": {
      post: ingestionOperation(
        "Ingest product feedback",
        "Track text feedback collected by the Sigmon browser feedback widget or a custom product flow. Feedback is scoped to the ingestion key and can include page, actor, release, and metadata context.",
        "FeedbackPayload",
        {
          message: "The export button is confusing.",
          category: "ux",
          tenant_id: "tenant_123",
          user_id: "user_456",
          session_id: "sess_789",
          source: "browser",
          release: "2026.06.01",
          page_url: "https://app.example.com/reports",
          path: "/reports?tab=exports",
          metadata: { surface: "reports" }
        }
      )
    },
    "/v1/errors": {
      post: ingestionOperation("Ingest an error", "Track exceptions, crashes, and grouped error occurrences. Include stack, release, source, and identity fields to unlock issue detail, source-map resolution, and tenant/user drilldowns.", "ErrorPayload", {
        message: "Payment provider timeout",
        type: "PaymentTimeoutError",
        severity: "error",
        fingerprint: "payment-timeout",
        stack: "PaymentTimeoutError: provider timeout\n    at chargeCustomer",
        tenant_id: "tenant_123",
        user_id: "user_456",
        source: "api",
        release: "2026.05.24",
        context: { provider: "example-pay", operation: "charge" },
        metadata: { request_id: "req_abc" }
      })
    },
    "/v1/breadcrumbs": {
      post: ingestionOperation("Ingest a breadcrumb", "Track lightweight session context for navigation, UI, console, network, or custom steps.", "BreadcrumbPayload", {
        type: "custom",
        category: "checkout",
        message: "Selected shipping method"
      })
    },
    "/v1/clicks": {
      post: ingestionOperation(
        "Ingest a browser click map sample",
        "Track opt-in click density by route using normalized coordinates and privacy-safe selectors. Prefer the browser SDK helper so text, values, DOM, and screenshots are never collected.",
        "ClickEventPayload",
        {
          route: "/checkout",
          selector: '[data-sigmon-id="checkout-submit"]',
          element_tag: "button",
          element_role: "button",
          x: 0.72,
          y: 0.61,
          viewport_width: 1440,
          viewport_height: 900,
          scroll_x: 0,
          scroll_y: 320,
          masked: true,
          source: "web",
          release: "2026.05.24"
        }
      )
    },
    "/v1/replays": {
      post: ingestionOperation(
        "Ingest a privacy-safe session replay",
        "Track a masked browser interaction timeline and link it to errors through replay_id. The payload stores events such as navigation and safe selectors, not screenshots, DOM snapshots, raw text, input values, or HTML.",
        "SessionReplayPayload",
        {
          replay_id: "rpl_browser_123",
          started_at: "2026-06-01T12:00:00.000Z",
          ended_at: "2026-06-01T12:00:02.000Z",
          duration_ms: 2000,
          route: "/checkout",
          masked: true,
          session_id: "sess_789",
          source: "web",
          release: "2026.05.24",
          events: [
            { offset_ms: 0, type: "navigation", route: "/checkout", data: {} },
            { offset_ms: 750, type: "click", selector: "[data-sigmon-id=\"pay\"]", x: 0.52, y: 0.61, data: {} }
          ]
        }
      )
    },
    "/v1/llm": {
      post: ingestionOperation("Ingest an LLM call", "Track AI provider calls, latency, status, tokens, and cost.", "LlmPayload", {
        provider: "openai",
        model: "gpt-5-mini",
        prompt_name: "dashboard_summary",
        status: "success"
      })
    },
    "/v1/web-vitals": {
      post: ingestionOperation("Ingest Web Vitals", "Track browser UX metrics such as LCP, INP, CLS, FCP, FID, and TTFB by route and release.", "WebVitalPayload", {
        name: "LCP",
        value: 2420,
        rating: "needs-improvement",
        route: "/dashboard",
        navigation_type: "navigate",
        source: "web",
        release: "2026.05.24",
        metadata: { effective_type: "4g" }
      })
    },
    "/v1/profiles": {
      post: ingestionOperation("Ingest a runtime profile", "Track bounded CPU and memory profile summaries for Node.js routes, workers, jobs, and other runtime tasks.", "ProfilePayload", {
        name: "worker.tick",
        kind: "cpu",
        runtime: "node",
        service: "worker",
        started_at: "2026-05-24T12:00:00.000Z",
        duration_ms: 1000,
        sample_count: 5,
        top_functions: [{ function_name: "tick", self_time_ms: 25, sample_count: 5 }],
        source: "node",
        release: "2026.05.24"
      })
    },
    "/v1/traces": {
      post: ingestionOperation("Ingest a trace", "Track a top-level workflow trace.", "TracePayload", {
        name: "generate_dashboard",
        status: "success",
        trace_id: "trace_dashboard_001"
      })
    },
    "/v1/spans": {
      post: ingestionOperation("Ingest a span", "Track a child operation within a trace.", "SpanPayload", {
        trace_id: "trace_dashboard_001",
        name: "llm_generate_sql",
        status: "success"
      })
    },
    "/v1/identify/user": {
      post: identifyOperation("Identify a user", "Upsert user profile traits scoped to the ingestion API key. Traits shallow-merge into the existing profile. Call this after login/session load or whenever durable user traits change.", "UserIdentifyPayload", {
        user_id: "user_456",
        tenant_id: "tenant_123",
        traits: { name: "Ana Souza", email: "ana@example.com", role: "admin", plan: "pro" }
      })
    },
    "/v1/identify/tenant": {
      post: identifyOperation("Identify a tenant", "Upsert tenant profile traits scoped to the ingestion API key. Traits shallow-merge into the existing profile. Call this after tenant/workspace selection or whenever durable tenant traits change.", "TenantIdentifyPayload", {
        tenant_id: "tenant_123",
        traits: { name: "MicroERP", plan: "pro", operation_mode: "production" }
      })
    },
    "/v1/source-maps": {
      post: {
        tags: ["Source maps"],
        summary: "Upload source maps from CI",
        description: "Upload a single `.map` file or zip bundle using a dedicated source-map upload token. Do not use browser ingestion keys for this endpoint.",
        security: [{ sourceMapUploadToken: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["project_id", "environment_id", "release"],
                properties: {
                  project_id: { type: "string" },
                  environment_id: { type: "string" },
                  release: { type: "string" },
                  minified_file: {
                    type: "string",
                    description: "Required when uploading a single .map file. Omit for zip bundles."
                  },
                  file: {
                    type: "string",
                    format: "binary",
                    description: "Single source-map file. Provide exactly one of file or bundle."
                  },
                  bundle: {
                    type: "string",
                    format: "binary",
                    description: "Zip bundle containing one or more .map files. Provide exactly one of file or bundle."
                  }
                },
                anyOf: [{ required: ["file", "minified_file"] }, { required: ["bundle"] }]
              }
            }
          }
        },
        responses: {
          "201": { description: "Source-map artifact uploaded" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/v1/heartbeats/{id}": {
      post: {
        tags: ["Ingestion"],
        summary: "Check in a heartbeat monitor",
        description: "Records a successful heartbeat check-in for scheduler, queue, cron, or background services.",
        security: [{ heartbeatSecret: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "202": {
            description: "Heartbeat accepted",
            content: { "application/json": { example: { accepted: true } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Heartbeat monitor not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/surveys": {
      get: {
        tags: ["Session authenticated"],
        summary: "List in-app surveys",
        description: "List active survey definitions for a project/environment.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Survey definitions",
            content: {
              "application/json": {
                schema: { type: "object", properties: { surveys: { type: "array", items: { $ref: "#/components/schemas/Survey" } } } }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Create an in-app survey",
        description: "Create a project/environment-scoped survey with targeting, optional trigger event, and one or more questions.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "key", "name", "questions"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  key: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  status: { type: "string", enum: ["draft", "active", "paused", "archived"], default: "draft" },
                  actorType: { type: "string", enum: ["user", "tenant", "session"], default: "user" },
                  triggerEvent: { type: ["string", "null"] },
                  questions: { type: "array", items: { $ref: "#/components/schemas/SurveyQuestion" } },
                  targeting: { type: "object", additionalProperties: true }
                }
              },
              examples: {
                default: {
                  value: {
                    projectId: "prj_123",
                    environmentId: "env_123",
                    key: "activation_pulse",
                    name: "Activation pulse",
                    status: "active",
                    actorType: "user",
                    triggerEvent: "checkout.completed",
                    questions: [{ id: "satisfaction", type: "rating", label: "How satisfied are you?", required: true, scale: { min: 1, max: 5 } }],
                    targeting: { sampleRate: 0.25 }
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Survey created",
            content: { "application/json": { schema: { type: "object", properties: { survey: { $ref: "#/components/schemas/Survey" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/surveys/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Update an in-app survey",
        description: "Update mutable survey metadata, status, actor type, questions, trigger event, or targeting.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        },
        responses: {
          "200": {
            description: "Survey updated",
            content: { "application/json": { schema: { type: "object", properties: { survey: { $ref: "#/components/schemas/Survey" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Survey not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        tags: ["Session authenticated"],
        summary: "Archive an in-app survey",
        description: "Soft-archive a survey definition so it no longer appears in active lists.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Survey archived" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/message-campaigns": {
      get: {
        tags: ["Session authenticated"],
        summary: "List message campaigns",
        description: "List active product messaging campaign definitions for a project/environment.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Message campaign definitions",
            content: {
              "application/json": {
                schema: { type: "object", properties: { campaigns: { type: "array", items: { $ref: "#/components/schemas/MessageCampaign" } } } }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Create a message campaign",
        description: "Create a scoped campaign definition for in-app, email, or webhook delivery. Email and webhook campaigns require an existing notification channel id. Campaigns are measured from campaign events and respect opt-out records.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "key", "name", "body"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  key: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  status: { type: "string", enum: ["draft", "active", "paused", "archived"], default: "draft" },
                  channelType: { type: "string", enum: ["email", "webhook", "in_app"], default: "email" },
                  notificationChannelId: { type: ["string", "null"] },
                  segmentId: { type: ["string", "null"] },
                  conversionEvent: { type: ["string", "null"] },
                  subject: { type: ["string", "null"] },
                  body: { type: "string" },
                  ctaUrl: { type: ["string", "null"], format: "uri" },
                  consentCategory: { type: "string", default: "product" },
                  privacyNote: { type: ["string", "null"] }
                }
              },
              examples: {
                default: {
                  value: {
                    projectId: "prj_123",
                    environmentId: "env_123",
                    key: "invoice_activation",
                    name: "Invoice activation",
                    status: "active",
                    channelType: "in_app",
                    segmentId: "seg_123",
                    conversionEvent: "invoice.paid",
                    body: "Create your first invoice to finish onboarding.",
                    consentCategory: "product"
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Campaign created",
            content: { "application/json": { schema: { type: "object", properties: { campaign: { $ref: "#/components/schemas/MessageCampaign" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/message-campaigns/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Update a message campaign",
        description: "Update mutable campaign metadata, status, channel linkage, target segment, copy, conversion event, consent category, or privacy note.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        },
        responses: {
          "200": {
            description: "Campaign updated",
            content: { "application/json": { schema: { type: "object", properties: { campaign: { $ref: "#/components/schemas/MessageCampaign" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Campaign not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        tags: ["Session authenticated"],
        summary: "Archive a message campaign",
        description: "Soft-archive a campaign definition so it no longer appears in active lists.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Campaign archived" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/feedback-widget": {
      get: {
        tags: ["Session authenticated"],
        summary: "Get feedback widget settings",
        description: "Read project/environment feedback widget settings used by browser SDK installations.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Feedback widget settings",
            content: { "application/json": { schema: { type: "object", properties: { settings: { $ref: "#/components/schemas/FeedbackWidgetSettings" } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      put: {
        tags: ["Session authenticated"],
        summary: "Update feedback widget settings",
        description: "Enable/disable the browser feedback widget and update its copy and privacy note for one project environment.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "enabled"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  enabled: { type: "boolean" },
                  title: { type: "string" },
                  prompt: { type: "string" },
                  placeholder: { type: "string" },
                  buttonLabel: { type: "string" },
                  accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
                  allowScreenshot: { type: "boolean", description: "Reserved for a future privacy-safe screenshot flow." },
                  privacyNote: { type: ["string", "null"] }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Feedback widget settings",
            content: { "application/json": { schema: { type: "object", properties: { settings: { $ref: "#/components/schemas/FeedbackWidgetSettings" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/feature-flags": {
      get: {
        tags: ["Session authenticated"],
        summary: "List feature flags",
        description: "List active feature flag definitions for a project/environment.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Feature flags",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { flags: { type: "array", items: { $ref: "#/components/schemas/FeatureFlag" } } }
                }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Create feature flag",
        description: "Create a project/environment-scoped feature flag with a safe default variant and ordered targeting rules.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "key", "name", "defaultVariant", "variants"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  key: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  status: { type: "string", enum: ["draft", "active", "paused", "archived"], default: "draft" },
                  defaultVariant: { type: "string" },
                  variants: { type: "array", items: { $ref: "#/components/schemas/FeatureFlagVariant" } },
                  rules: { type: "array", items: { $ref: "#/components/schemas/FeatureFlagRule" } }
                }
              },
              examples: {
                default: {
                  value: {
                    projectId: "prj_123",
                    environmentId: "env_123",
                    key: "new_checkout",
                    name: "New checkout",
                    status: "active",
                    defaultVariant: "off",
                    variants: [{ key: "off", value: false }, { key: "on", value: true }],
                    rules: [{ variant: "on", match: { userId: "user_123" } }]
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Feature flag created",
            content: { "application/json": { schema: { type: "object", properties: { flag: { $ref: "#/components/schemas/FeatureFlag" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/feature-flags/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Update feature flag",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: {
          "200": {
            description: "Feature flag updated",
            content: { "application/json": { schema: { type: "object", properties: { flag: { $ref: "#/components/schemas/FeatureFlag" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Feature flag not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        tags: ["Session authenticated"],
        summary: "Archive feature flag",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Feature flag archived" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/feature-flags/{id}/audit": {
      get: {
        tags: ["Session authenticated"],
        summary: "List feature flag audit history",
        description: "Returns created, updated, and archived audit entries for a feature flag.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Feature flag audit entries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { audit: { type: "array", items: { $ref: "#/components/schemas/FeatureFlagAudit" } } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/feature-flags/{id}/evaluate": {
      post: {
        tags: ["Session authenticated"],
        summary: "Preview feature flag evaluation",
        description: "Evaluates a feature flag for a sample user, tenant, session, or trait context.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  fallbackVariant: { type: "string" },
                  subject: {
                    type: "object",
                    properties: {
                      userId: { type: "string" },
                      tenantId: { type: "string" },
                      sessionId: { type: "string" },
                      traits: { type: "object", additionalProperties: true }
                    }
                  }
                }
              },
              examples: {
                default: {
                  value: {
                    fallbackVariant: "off",
                    subject: { userId: "user_123", traits: { plan: "beta" } }
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Feature flag evaluation",
            content: { "application/json": { schema: { type: "object", properties: { evaluation: { $ref: "#/components/schemas/FeatureFlagEvaluation" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/beta-programs": {
      get: {
        tags: ["Session authenticated"],
        summary: "List beta programs",
        description: "List early-access/beta programs for a project/environment.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Beta programs",
            content: { "application/json": { schema: { type: "object", properties: { programs: { type: "array", items: { $ref: "#/components/schemas/BetaProgram" } } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Create beta program",
        description: "Create an early-access cohort. When featureFlagId is set, active participants are synced into that flag as targeting rules.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "key", "name"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  key: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  status: { type: "string", enum: ["draft", "active", "paused", "archived"], default: "draft" },
                  actorType: { type: "string", enum: ["user", "tenant"], default: "user" },
                  featureFlagId: { type: ["string", "null"] },
                  featureFlagVariant: { type: "string", default: "on" }
                }
              },
              examples: {
                default: {
                  value: {
                    projectId: "prj_123",
                    environmentId: "env_123",
                    key: "checkout_beta",
                    name: "Checkout beta",
                    status: "active",
                    actorType: "user",
                    featureFlagId: "flg_123",
                    featureFlagVariant: "on"
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Beta program created",
            content: { "application/json": { schema: { type: "object", properties: { program: { $ref: "#/components/schemas/BetaProgram" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/beta-programs/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Update beta program",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: {
          "200": { description: "Beta program updated", content: { "application/json": { schema: { type: "object", properties: { program: { $ref: "#/components/schemas/BetaProgram" } } } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Beta program not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        tags: ["Session authenticated"],
        summary: "Archive beta program",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Beta program archived" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/beta-programs/{id}/participants": {
      get: {
        tags: ["Session authenticated"],
        summary: "List beta program participants",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Participants",
            content: { "application/json": { schema: { type: "object", properties: { participants: { type: "array", items: { $ref: "#/components/schemas/BetaProgramParticipant" } } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Add beta program participant",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "actorId"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  actorType: { type: "string", enum: ["user", "tenant"], default: "user" },
                  actorId: { type: "string" },
                  status: { type: "string", enum: ["invited", "active", "opted_out", "removed"], default: "active" },
                  notes: { type: ["string", "null"] }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Participant added",
            content: { "application/json": { schema: { type: "object", properties: { participant: { $ref: "#/components/schemas/BetaProgramParticipant" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/beta-programs/{id}/participants/{participantId}": {
      delete: {
        tags: ["Session authenticated"],
        summary: "Remove beta program participant",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "participantId", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Participant removed" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/beta-programs/{id}/adoption": {
      get: {
        tags: ["Session authenticated"],
        summary: "Read beta program adoption",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"] } }
        ],
        responses: {
          "200": {
            description: "Adoption summary",
            content: { "application/json": { schema: { type: "object", properties: { adoption: { $ref: "#/components/schemas/BetaProgramAdoption" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/data-governance": {
      get: {
        tags: ["Session authenticated"],
        summary: "Read data governance policy",
        description: "Read scoped retention overrides and sensitive property rules for a project/environment. Categories absent from the policy use installation defaults.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Data governance policy",
            content: { "application/json": { schema: { type: "object", properties: { policy: { $ref: "#/components/schemas/DataGovernancePolicy" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      put: {
        tags: ["Session authenticated"],
        summary: "Update data governance policy",
        description: "Configure project/environment retention values that override installation defaults whether shorter or longer, plus property mask/block rules.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  retentionPolicy: {
                    type: "object",
                    description: dataGovernanceRetentionDescription,
                    properties: dataGovernanceRetentionProperties,
                    additionalProperties: false,
                    examples: [{ events: 90, errors: 180, traces: 30 }]
                  },
                  propertyRules: {
                    type: "array",
                    items: { $ref: "#/components/schemas/DataGovernancePropertyRule" }
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Data governance policy updated",
            content: { "application/json": { schema: { type: "object", properties: { policy: { $ref: "#/components/schemas/DataGovernancePolicy" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/projects/{projectId}/code-integrations": {
      get: {
        tags: ["Session authenticated"],
        summary: "List code hosting integrations",
        description: "List GitHub/GitLab repository links configured for a project. No provider token is stored by this MVP.",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Code integrations",
            content: { "application/json": { schema: { type: "object", properties: { integrations: { type: "array", items: { $ref: "#/components/schemas/CodeIntegration" } } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Connect a GitHub/GitLab repository",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider", "name", "owner", "repo"],
                properties: {
                  provider: { type: "string", enum: ["github", "gitlab"] },
                  name: { type: "string" },
                  owner: { type: "string", examples: ["acme", "platform/team"] },
                  repo: { type: "string", examples: ["web"] }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Code integration created",
            content: { "application/json": { schema: { type: "object", properties: { integration: { $ref: "#/components/schemas/CodeIntegration" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/projects/{projectId}/code-integrations/{id}": {
      delete: {
        tags: ["Session authenticated"],
        summary: "Disconnect a code hosting integration",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Code integration disconnected" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Code integration not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/projects/{projectId}/release-metadata": {
      post: {
        tags: ["Session authenticated"],
        summary: "Upsert release code metadata",
        description: "Attach commit/PR/deployer metadata to a release so Overview can show deploy context.",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["environmentId", "release"],
                properties: {
                  environmentId: { type: "string" },
                  release: { type: "string" },
                  integrationId: { type: ["string", "null"] },
                  commitSha: { type: ["string", "null"] },
                  commitUrl: { type: ["string", "null"], format: "uri" },
                  pullRequestNumber: { type: ["integer", "null"] },
                  pullRequestUrl: { type: ["string", "null"], format: "uri" },
                  deployedBy: { type: ["string", "null"] }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Release metadata saved",
            content: { "application/json": { schema: { type: "object", properties: { metadata: { $ref: "#/components/schemas/ReleaseMetadata" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/warehouse-destinations": {
      get: {
        tags: ["Session authenticated"],
        summary: "List warehouse export destinations",
        description: "List project/environment destinations for incremental warehouse export. Raw connection URLs are never returned.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Warehouse destinations",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { destinations: { type: "array", items: { $ref: "#/components/schemas/WarehouseDestination" } } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Create warehouse export destination",
        description: "Create a Postgres destination. The connection URL is write-only and stored for the scheduler.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId", "name", "connectionUrl", "datasets"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  name: { type: "string" },
                  destinationType: { type: "string", enum: ["postgres"], default: "postgres" },
                  connectionUrl: { type: "string", format: "uri" },
                  datasets: {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    description:
                      "Identity profile datasets export actor-id-ordered cyclic snapshots with scope-safe source ids. The cursor resets after a complete pass, so subsequent cycles re-export current profile state and pick up updates made behind an active cursor.",
                    items: { type: "string", enum: ["events", "errors", "traces", "llmCalls", "userProfiles", "tenantProfiles"] }
                  },
                  batchSize: { type: "integer", minimum: 1, maximum: 5000, default: 500 },
                  enabled: { type: "boolean", default: true }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Warehouse destination created",
            content: { "application/json": { schema: { type: "object", properties: { destination: { $ref: "#/components/schemas/WarehouseDestination" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/warehouse-destinations/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Update warehouse export destination",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" },
                  name: { type: "string" },
                  connectionUrl: { type: "string", format: "uri" },
                  datasets: {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    description:
                      "Identity profile datasets export actor-id-ordered cyclic snapshots with scope-safe source ids. The cursor resets after a complete pass, so subsequent cycles re-export current profile state and pick up updates made behind an active cursor.",
                    items: { type: "string", enum: ["events", "errors", "traces", "llmCalls", "userProfiles", "tenantProfiles"] }
                  },
                  batchSize: { type: "integer", minimum: 1, maximum: 5000 },
                  enabled: { type: "boolean" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Warehouse destination updated",
            content: { "application/json": { schema: { type: "object", properties: { destination: { $ref: "#/components/schemas/WarehouseDestination" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Warehouse destination not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        tags: ["Session authenticated"],
        summary: "Archive warehouse export destination",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Warehouse destination archived" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/warehouse-destinations/{id}/runs": {
      get: {
        tags: ["Session authenticated"],
        summary: "List warehouse export runs",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
        ],
        responses: {
          "200": {
            description: "Warehouse export runs",
            content: {
              "application/json": {
                schema: { type: "object", properties: { runs: { type: "array", items: { $ref: "#/components/schemas/WarehouseExportRun" } } } }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Run warehouse export now",
        description: "Trigger a manual incremental export for one destination.",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["projectId", "environmentId"],
                properties: {
                  projectId: { type: "string" },
                  environmentId: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "202": { description: "Warehouse export accepted" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Create a human session",
        requestBody: jsonBody("LoginPayload", { email: "admin@example.com", password: "replace-with-your-password" }),
        responses: {
          "200": { description: "Session cookie set and user returned" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/auth/me": {
      get: sessionRoute("Read current session user", "Returns the logged-in user for the active session cookie.")
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "End the human session",
        description: "Clears the session cookie for the current operator. Always returns success, including when no session was active.",
        responses: {
          "200": { description: "Session cookie cleared" }
        }
      }
    },
    "/auth/google": {
      get: {
        tags: ["Auth"],
        summary: "Start Google OAuth sign-in",
        description:
          "Redirects the browser to the Google OAuth consent screen and sets a short-lived, path-scoped OAuth state cookie used to validate `/auth/google/callback`. Disabled unless Google OAuth is configured. This is a browser redirect, not a JSON endpoint.",
        responses: {
          "302": {
            description: "Redirect to the Google OAuth authorization URL",
            headers: {
              Location: { schema: { type: "string", format: "uri" }, description: "Google OAuth authorization URL." }
            }
          },
          "404": { description: "Google OAuth is disabled" },
          "501": { description: "Google OAuth is not configured" }
        }
      }
    },
    "/auth/google/callback": {
      get: {
        tags: ["Auth"],
        summary: "Complete Google OAuth sign-in",
        description:
          "Validates the OAuth `state` cookie set by `/auth/google` against the `code`/`state` query parameters, exchanges the code, and creates a human session on success. Disabled unless Google OAuth is configured.",
        parameters: [
          { name: "code", in: "query", required: true, schema: { type: "string" } },
          { name: "state", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": { description: "Session cookie set and user returned" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "403": { description: "Authenticated Google account is not an allowed operator" },
          "404": { description: "Google OAuth is disabled" },
          "501": { description: "Google OAuth is not configured" },
          "503": { description: "Google OAuth token exchange or sign-in failed" }
        }
      }
    },
    "/admin/analytics-segments": {
      get: adminOperation("List analytics segments", "List saved user or tenant segments for one project/environment.", {
        parameters: adminScopeParameters
      }),
      post: adminOperation("Create an analytics segment", "Create a validated saved segment for reuse across analytics views.", {
        requestBody: inlineJsonBody(analyticsSegmentInputSchema),
        successStatus: "201",
        successDescription: "Analytics segment created"
      })
    },
    "/admin/analytics-segments/{id}": {
      patch: adminOperation("Update an analytics segment", "Update the name, description, actor type, or validated definition of a saved segment.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: analyticsSegmentInputSchema.properties.name,
            description: analyticsSegmentInputSchema.properties.description,
            actorType: analyticsSegmentInputSchema.properties.actorType,
            definition: analyticsSegmentDefinitionSchema
          }
        }),
        notFound: "Analytics segment not found"
      }),
      delete: adminOperation("Archive an analytics segment", "Archive a saved analytics segment.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Analytics segment archived"
      })
    },
    "/admin/analytics-segments/{id}/preview": {
      get: adminOperation("Preview an analytics segment", "Return a bounded sample of actors matching a saved segment.", {
        parameters: [
          adminIdParameter,
          ...adminScopeParameters,
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50 } }
        ],
        notFound: "Analytics segment not found"
      })
    },
    "/admin/experiments": {
      get: adminOperation("List experiments", "List experiments for one project/environment.", {
        parameters: adminScopeParameters
      }),
      post: adminOperation("Create an experiment", "Create an experiment definition used with deterministic SDK assignment and exposure/conversion telemetry.", {
        requestBody: inlineJsonBody({
          type: "object",
          required: ["projectId", "environmentId", "key", "name", "conversionEvent", "variants", "primaryMetric"],
          additionalProperties: false,
          properties: experimentInputProperties
        }),
        successStatus: "201",
        successDescription: "Experiment created"
      })
    },
    "/admin/experiments/{id}": {
      patch: adminOperation("Update an experiment", "Update an experiment within its project/environment scope.", {
        parameters: [adminIdParameter, ...adminScopeParameters],
        requestBody: inlineJsonBody({
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: experimentInputProperties.name,
            description: experimentInputProperties.description,
            status: experimentInputProperties.status,
            actorType: experimentInputProperties.actorType,
            exposureEvent: experimentInputProperties.exposureEvent,
            conversionEvent: experimentInputProperties.conversionEvent,
            variants: experimentInputProperties.variants,
            primaryMetric: experimentInputProperties.primaryMetric
          }
        }),
        notFound: "Experiment not found"
      }),
      delete: adminOperation("Archive an experiment", "Archive an experiment within its project/environment scope.", {
        parameters: [adminIdParameter, ...adminScopeParameters],
        successStatus: "204",
        successDescription: "Experiment archived"
      })
    },
    "/admin/source-maps": {
      get: adminOperation("List source-map artifacts", "List uploaded source-map artifacts for one project/environment, optionally filtered by release and paginated by cursor.", {
        parameters: [
          ...adminScopeParameters,
          { name: "release", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 250 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } }
        ]
      }),
      post: adminOperation("Upload source maps as an administrator", "Upload one source map or a bundle using the administrator session. Single-map uploads require `file` and `minified_file`; bundles require `bundle`.", {
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["project_id", "environment_id", "release"],
                properties: {
                  project_id: { type: "string" },
                  environment_id: { type: "string" },
                  release: { type: "string" },
                  minified_file: { type: "string" },
                  file: { type: "string", format: "binary" },
                  bundle: { type: "string", format: "binary" }
                },
                oneOf: [{ required: ["file", "minified_file"] }, { required: ["bundle"] }]
              }
            }
          }
        },
        successDescription: "Source-map artifacts uploaded",
        notFound: "Project or environment scope not found or archived",
        payloadTooLarge: "Compressed upload, expanded archive, or archive entry count exceeds the configured limit"
      })
    },
    "/admin/source-maps/{id}": {
      delete: adminOperation("Delete a source-map artifact", "Delete one artifact within its project/environment scope.", {
        parameters: [adminIdParameter, ...adminScopeParameters],
        successStatus: "204",
        successDescription: "Source-map artifact deleted"
      })
    },
    "/admin/notification-channels": {
      get: adminOperation("List notification channels", "List redacted email, webhook, Slack, and Discord notification channels."),
      post: adminOperation("Create a notification channel", "Create an email or outbound webhook-compatible notification channel. Secret header values are write-only.", {
        requestBody: inlineJsonBody(notificationChannelInputSchema),
        successStatus: "201",
        successDescription: "Notification channel created"
      })
    },
    "/admin/notification-channels/{id}": {
      patch: adminOperation("Update a notification channel", "Update a notification channel. Omitted secrets remain unchanged; clearing a secret header also clears its value.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody(notificationChannelUpdateSchema),
        notFound: "Notification channel not found"
      }),
      delete: adminOperation("Archive a notification channel", "Archive a notification channel.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Notification channel archived"
      })
    },
    "/admin/alert-rules": {
      get: adminOperation("List alert rules", "List alert rules, optionally filtered by project and environment.", {
        parameters: adminScopeParameters.map((parameter) => ({ ...parameter, required: false }))
      }),
      post: adminOperation("Create an alert rule", "Create a threshold alert rule and optionally attach notification and escalation channels.", {
        requestBody: inlineJsonBody({
          type: "object",
          required: ["projectId", "environmentId", "name", "type", "severity", "windowMinutes", "threshold", "cooldownMinutes"],
          additionalProperties: false,
          properties: alertRuleInputProperties
        }),
        successStatus: "201",
        successDescription: "Alert rule created",
        notFound: "Scope or notification channel not found"
      })
    },
    "/admin/alert-rules/{id}": {
      patch: adminOperation("Update an alert rule", "Update a threshold, routing, severity, status, or scope for an alert rule.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: alertRuleInputProperties
        }),
        notFound: "Alert rule, scope, or notification channel not found"
      }),
      delete: adminOperation("Archive an alert rule", "Archive an alert rule.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Alert rule archived"
      })
    },
    "/admin/users": {
      get: adminOperation("List console users", "List active console administrators."),
      post: adminOperation("Create a console user", "Create an administrator with an email address and password.", {
        requestBody: inlineJsonBody({
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 12, maxLength: 256, writeOnly: true },
            isAdmin: { type: "boolean", default: true, const: true }
          }
        }),
        successStatus: "201",
        successDescription: "Console user created"
      })
    },
    "/admin/users/{id}": {
      patch: adminOperation("Update a console user", "Change an administrator email, password, or administrator status.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 12, maxLength: 256, writeOnly: true },
            isAdmin: { type: "boolean" }
          }
        }),
        notFound: "User not found",
        conflict: "The update would demote the current or last active administrator"
      }),
      delete: adminOperation("Archive a console user", "Archive an administrator. The current or last active administrator cannot be archived.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Console user archived",
        conflict: "The current or last active administrator cannot be archived"
      })
    },
    "/admin/projects": {
      get: adminOperation("List projects", "List active SignalMonitor projects."),
      post: adminOperation("Create a project", "Create a SignalMonitor project.", {
        requestBody: inlineJsonBody({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 256 } }
        }),
        successStatus: "201",
        successDescription: "Project created"
      })
    },
    "/admin/projects/{id}": {
      get: adminOperation("Read a project", "Read one active SignalMonitor project.", {
        parameters: [adminIdParameter],
        notFound: "Project not found"
      }),
      patch: adminOperation("Update a project", "Rename an active SignalMonitor project.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 256 } }
        }),
        notFound: "Project not found"
      }),
      delete: adminOperation("Archive a project", "Archive a project and invalidate its browser-origin cache entries.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Project archived"
      })
    },
    "/admin/projects/{projectId}/browser-origins": {
      get: adminOperation("List browser origins", "List browser origins allowed to send telemetry for a project.", {
        parameters: [adminProjectIdParameter]
      }),
      post: adminOperation("Allow a browser origin", "Allow an absolute HTTP or HTTPS origin to use browser-scoped ingestion keys for a project.", {
        parameters: [adminProjectIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["origin"],
          additionalProperties: false,
          properties: { origin: { type: "string", format: "uri", maxLength: 2048, examples: ["https://app.example.com"] } }
        }),
        successStatus: "201",
        successDescription: "Browser origin allowed",
        notFound: "Project not found"
      })
    },
    "/admin/browser-origins/{id}": {
      delete: adminOperation("Archive a browser origin", "Remove a project browser origin from the runtime allowlist.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Browser origin archived"
      })
    },
    "/admin/projects/{projectId}/environments": {
      get: adminOperation("List environments", "List active environments under a project.", {
        parameters: [adminProjectIdParameter]
      }),
      post: adminOperation("Create an environment", "Create an environment under a project.", {
        parameters: [adminProjectIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 256 } }
        }),
        successStatus: "201",
        successDescription: "Environment created",
        notFound: "Project not found"
      })
    },
    "/admin/environments/{id}": {
      patch: adminOperation("Update an environment", "Rename an active environment.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 256 } }
        }),
        notFound: "Environment not found"
      }),
      delete: adminOperation("Archive an environment", "Archive an environment.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "Environment archived"
      })
    },
    "/admin/projects/{projectId}/api-keys": {
      get: adminOperation("List ingestion API keys", "List redacted ingestion API key records for a project.", {
        parameters: [adminProjectIdParameter]
      }),
      post: adminOperation("Create an ingestion API key", "Create a browser- or server-scoped ingestion key. The full secret is returned only once.", {
        parameters: [adminProjectIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["environmentId", "name", "capability"],
          additionalProperties: false,
          properties: {
            environmentId: { type: "string" },
            name: { type: "string", minLength: 1, maxLength: 120 },
            capability: { type: "string", enum: ["browser", "server"] }
          }
        }),
        successStatus: "201",
        successDescription: "API key created; the secret is shown only in this response",
        notFound: "Project or environment not found"
      })
    },
    "/admin/api-keys/{id}": {
      patch: adminOperation("Rename an ingestion API key", "Rename an ingestion key without exposing its secret or stored hash.", {
        parameters: [adminIdParameter],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 256 } }
        }),
        notFound: "API key not found"
      }),
      delete: adminOperation("Revoke an ingestion API key", "Revoke an ingestion key immediately.", {
        parameters: [adminIdParameter],
        successStatus: "204",
        successDescription: "API key revoked"
      })
    },
    "/admin/source-map-upload-tokens": {
      get: adminOperation("List source-map upload tokens", "List redacted CI source-map upload tokens for one project/environment.", {
        parameters: adminScopeParameters
      }),
      post: adminOperation("Create a source-map upload token", "Create a scoped CI upload token. The full secret is returned only once.", {
        requestBody: inlineJsonBody({
          type: "object",
          required: ["projectId", "environmentId", "name"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string" },
            environmentId: { type: "string" },
            name: { type: "string", minLength: 1, maxLength: 256 }
          }
        }),
        successStatus: "201",
        successDescription: "Upload token created; the secret is shown only in this response",
        notFound: "Project or environment not found"
      })
    },
    "/admin/source-map-upload-tokens/{id}": {
      patch: adminOperation("Rename a source-map upload token", "Rename a CI upload token within its project/environment scope.", {
        parameters: [adminIdParameter, ...adminScopeParameters],
        requestBody: inlineJsonBody({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 256 } }
        }),
        notFound: "Source-map upload token not found"
      }),
      delete: adminOperation("Revoke a source-map upload token", "Revoke a CI upload token within its project/environment scope.", {
        parameters: [adminIdParameter, ...adminScopeParameters],
        successStatus: "204",
        successDescription: "Source-map upload token revoked"
      })
    },
    "/admin/read-tokens": {
      get: {
        tags: ["Session authenticated"],
        summary: "List read tokens",
        description: "Admin route for listing scoped, revocable read-only credentials for one project/environment. Never includes the secret or the stored hash.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Read tokens for the requested scope",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ReadTokenListResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "501": { $ref: "#/components/responses/Unavailable" }
        }
      },
      post: {
        tags: ["Session authenticated"],
        summary: "Create a read token",
        description: "Admin route that generates a scoped, revocable read-only credential and returns the full secret exactly once, in this response. It cannot be retrieved again — only the redacted record (`prefix`, no `secret`, no `hash`) is returned by list, rename, or revoke.",
        security: [{ sessionCookie: [] }],
        requestBody: jsonBody("CreateReadTokenPayload", {
          projectId: "prj_example",
          environmentId: "env_example",
          name: "claude-desktop"
        }),
        responses: {
          "201": {
            description: "Read token created; `token.secret` is shown only in this response",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ReadTokenCreateResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Project/environment scope is archived or does not exist" },
          "501": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/read-tokens/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Rename a read token",
        description: "Admin route for renaming a read token within its project/environment scope. Never returns the secret or the stored hash.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: jsonBody("UpdateReadTokenPayload", { name: "claude-desktop" }),
        responses: {
          "200": {
            description: "Read token renamed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ReadTokenResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Read token not found in the requested scope" },
          "501": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        tags: ["Session authenticated"],
        summary: "Revoke a read token",
        description: "Admin route for revoking a read token within its project/environment scope.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Read token revoked" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "501": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/monitors": {
      get: sessionRoute("List monitors", "Admin route for listing HTTP and heartbeat monitors.")
    },
    "/admin/monitors/http": {
      post: {
        ...sessionRoute("Create an HTTP monitor", "Admin route for creating an uptime monitor."),
        requestBody: jsonBody("HttpMonitorPayload", {
          projectId: "prj_example",
          environmentId: "env_example",
          name: "API health",
          url: "https://api.example.com/health"
        }),
        responses: {
          "201": { description: "HTTP monitor created", content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorResponse" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/monitors/heartbeat": {
      post: {
        ...sessionRoute("Create a heartbeat monitor", "Admin route that returns the heartbeat secret one time."),
        requestBody: jsonBody("HeartbeatMonitorPayload", {
          projectId: "prj_example",
          environmentId: "env_example",
          name: "Queue worker heartbeat",
          expectedIntervalMinutes: 5,
          graceMinutes: 2
        }),
        responses: {
          "201": { description: "Heartbeat monitor created", content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorResponse" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/monitors/{id}": {
      patch: sessionRoute("Update a monitor", "Admin route for changing monitor configuration."),
      delete: sessionRoute("Archive a monitor", "Admin route for archiving a monitor.")
    },
    "/admin/monitors/{id}/checks": {
      get: {
        ...sessionRoute("List monitor checks", "Admin route for recent HTTP or heartbeat monitor check history."),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Monitor id."
          },
          {
            name: "project_id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Project scope for the monitor and cursor."
          },
          {
            name: "environment_id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Environment scope for the monitor and cursor."
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Opaque cursor returned by the previous response. Cursors are bound to the monitor, project, and environment."
          }
        ]
      }
    },
    "/admin/dead-letter-jobs": {
      get: {
        ...sessionRoute("List dead-letter jobs", "Admin route for inspecting sanitized jobs that failed permanently in workers."),
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 250, default: 50 }
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Opaque cursor returned by the previous response."
          },
          {
            name: "queue_name",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Exact queue name to inspect, for example `telemetry`."
          },
          {
            name: "job_name",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Exact worker job name to inspect, for example `event`, `error`, or `trace`."
          },
          {
            name: "error",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Case-insensitive substring search over the sanitized error message."
          },
          {
            name: "created_from",
            in: "query",
            required: false,
            schema: { type: "string", format: "date-time" },
            description: "Inclusive lower bound for dead-letter creation time."
          },
          {
            name: "created_to",
            in: "query",
            required: false,
            schema: { type: "string", format: "date-time" },
            description: "Inclusive upper bound for dead-letter creation time."
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["pending"] },
            description: "Current active dead-letter status. Historical replay/delete/expiration status is exposed through the job actions endpoint."
          }
        ],
        responses: {
          "200": {
            description: "Dead-letter jobs returned newest first",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DeadLetterJobListResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/dead-letter-jobs/{id}": {
      get: {
        ...sessionRoute("Get a dead-letter job", "Admin route for inspecting one sanitized permanently failed worker job."),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "200": {
            description: "Dead-letter job returned",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DeadLetterJobResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Dead-letter job not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      delete: {
        ...sessionRoute("Delete a dead-letter job", "Admin route for clearing a dead-letter job after inspection or manual remediation."),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "204": { description: "Dead-letter job deleted" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Dead-letter job not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/dead-letter-jobs/{id}/actions": {
      get: {
        ...sessionRoute("List dead-letter job actions", "Admin route for inspecting replay/delete audit actions for a dead-letter job id."),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "200": {
            description: "Dead-letter job actions returned",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DeadLetterJobActionsResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/dead-letter-jobs/{id}/replay": {
      post: {
        ...sessionRoute(
          "Replay a dead-letter job",
          "Admin route for re-enqueueing a sanitized telemetry dead-letter job and clearing it after the enqueue succeeds."
        ),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "202": {
            description: "Dead-letter job re-enqueued",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DeadLetterReplayResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Dead-letter job not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/me": {
      get: {
        ...queryReadRoute(
          "Introspect the calling principal",
          "Return the authenticated caller's principal kind: a session user, or a read token together with its scoped project_id/environment_id (IDs only, no name lookup). Useful for a caller that needs to know which project/environment a read token is bound to before issuing further /query/* reads."
        ),
        responses: {
          "200": {
            description: "Authenticated principal",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      oneOf: [
                        {
                          type: "object",
                          required: ["kind"],
                          properties: { kind: { type: "string", enum: ["user"] } }
                        },
                        {
                          type: "object",
                          required: ["kind", "projectId", "environmentId"],
                          properties: {
                            kind: { type: "string", enum: ["read-token"] },
                            projectId: { type: "string" },
                            environmentId: { type: "string" }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/query/fleet": {
      get: {
        ...sessionRoute(
          "Query fleet operations",
          "Read a cross-project operations rollup for the selected window. Project environment details are intentionally omitted from this response and can be loaded lazily from the project environments endpoint."
        ),
        parameters: [
          {
            name: "window",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" }
          }
        ],
        responses: {
          "200": {
            description: "Fleet operations rollup",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "projects", "rollup"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        projects: { type: "array", items: { type: "object", additionalProperties: true } },
                        rollup: { type: "object", additionalProperties: true }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token is scoped to project/environment reads and cannot access fleet routes (`read_token_scope_insufficient`)" },
          "501": { description: "Fleet query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/fleet/projects/{id}/environments": {
      get: {
        ...sessionRoute(
          "Query project fleet environments",
          "Lazily load environment-level operations status for one fleet project and window."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "window",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" }
          }
        ],
        responses: {
          "200": {
            description: "Project environment operations status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["projectId", "envs"],
                      properties: {
                        projectId: { type: "string" },
                        envs: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["name", "status", "incidents", "events"],
                            properties: {
                              name: { type: "string" },
                              status: { type: "string", enum: ["ok", "warning", "critical"] },
                              incidents: { type: "integer", minimum: 0 },
                              errorRatePercent: { type: ["number", "null"] },
                              events: { type: "integer", minimum: 0 },
                              note: { type: ["string", "null"] }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token is scoped to project/environment reads and cannot access fleet routes (`read_token_scope_insufficient`)" },
          "404": { description: "Project not found" },
          "501": { description: "Fleet environment query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/error-groups": {
      get: {
        ...queryReadRoute(
          "List error groups",
          "List error groups for a project environment with cursor pagination, most recently seen first. Query with project_id, environment_id, and optional status, severity, fingerprint, tenant_id, user_id, release, from, to, limit=1..500 (default 50), and cursor from a previous page's response."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["open", "investigating", "resolved", "ignored"] } },
          { name: "severity", in: "query", required: false, schema: { type: "string" } },
          { name: "fingerprint", in: "query", required: false, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "release", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 50 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Paginated error groups",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/ErrorGroupRecord" } },
                    cursor: { type: ["string", "null"] }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Error group query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/error-groups/{id}": {
      get: {
        ...queryReadRoute(
          "Query error-group detail",
          "Read one error group scoped to a project environment. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Error group detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/ErrorGroupRecord" } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Error group not found" },
          "501": { description: "Error group query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      },
      patch: {
        ...sessionRoute(
          "Update error-group triage state",
          "Update one error group's status, priority, and/or assignee. At least one of `status`, `priority`, or `assignedToUserId` must be present in the body; `status`/`priority` are applied first, then assignment. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: jsonBody("ErrorGroupTriagePatch", { status: "investigating", priority: "high" }),
        responses: {
          "200": {
            description: "Updated error group",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/ErrorGroupRecord" } }
                }
              }
            }
          },
          "400": {
            description:
              "Invalid request body/query, or (when assigning) `user_not_found`/`user_archived` in the `error` field of the response body.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token cannot perform mutations (`read_token_is_read_only`)" },
          "404": { description: "Error group not found" },
          "501": { description: "Triage mutation is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/error-groups/{id}/errors": {
      get: {
        ...queryReadRoute(
          "List error-group occurrences",
          "List raw error occurrences for one error group using cursor pagination. Results remain scoped to the requested project and environment."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Paginated error-group occurrences",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { type: "object", additionalProperties: true } },
                    cursor: { type: ["string", "null"] }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Error occurrence query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/aggregates/traces": {
      get: {
        ...queryReadRoute(
          "Query trace aggregates",
          "Read the stable public trace aggregate contract for a project environment: total traces and average trace duration in milliseconds. Optional actor, session, trace, and date filters narrow the aggregate without changing its response fields."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "session_id", in: "query", required: false, schema: { type: "string" } },
          { name: "trace_id", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } }
        ],
        responses: {
          "200": {
            description: "Trace count and average duration",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["total", "averageDurationMs"],
                      properties: {
                        total: { type: "integer", minimum: 0 },
                        averageDurationMs: { type: "number", minimum: 0 }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Trace aggregate query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/aggregates/errors": {
      get: {
        ...queryReadRoute(
          "Query error aggregates",
          "Read the stable public error aggregate contract for a project environment: total error count and open (unresolved) count. Optional actor, session, trace, and date filters narrow the aggregate without changing its response fields."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "session_id", in: "query", required: false, schema: { type: "string" } },
          { name: "trace_id", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } }
        ],
        responses: {
          "200": {
            description: "Error count and open count",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["total", "open"],
                      properties: {
                        total: { type: "integer", minimum: 0 },
                        open: { type: "integer", minimum: 0 }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Error aggregate query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/aggregates/events": {
      get: {
        ...queryReadRoute(
          "Query event aggregates",
          "Read the stable public event aggregate contract for a project environment: total event count and a per-event-name breakdown. Optional event_name, event_id, segment_id, actor, session, trace, and date filters narrow the aggregate without changing its response fields."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "session_id", in: "query", required: false, schema: { type: "string" } },
          { name: "trace_id", in: "query", required: false, schema: { type: "string" } },
          { name: "event_name", in: "query", required: false, schema: { type: "string" } },
          { name: "event_id", in: "query", required: false, schema: { type: "string" } },
          { name: "segment_id", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } }
        ],
        responses: {
          "200": {
            description: "Event count and per-name breakdown",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["total", "byName"],
                      properties: {
                        total: { type: "integer", minimum: 0 },
                        byName: { type: "object", additionalProperties: { type: "integer", minimum: 0 } }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Event aggregate query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/aggregates/llm": {
      get: {
        ...queryReadRoute(
          "Query LLM aggregates",
          "Read the stable public LLM aggregate contract for a project environment: total call count, total input/output tokens, and total cost. Optional provider, model, prompt_name, status, actor, session, trace, and date filters narrow the aggregate without changing its response fields."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "session_id", in: "query", required: false, schema: { type: "string" } },
          { name: "trace_id", in: "query", required: false, schema: { type: "string" } },
          { name: "provider", in: "query", required: false, schema: { type: "string" } },
          { name: "model", in: "query", required: false, schema: { type: "string" } },
          { name: "prompt_name", in: "query", required: false, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } }
        ],
        responses: {
          "200": {
            description: "LLM call count, token totals, and cost total",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["totalCalls", "totalInputTokens", "totalOutputTokens", "totalCostUsd"],
                      properties: {
                        totalCalls: { type: "integer", minimum: 0 },
                        totalInputTokens: { type: "integer", minimum: 0 },
                        totalOutputTokens: { type: "integer", minimum: 0 },
                        totalCostUsd: { type: "string", description: "Decimal string, e.g. \"1.2345\"." }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "LLM aggregate query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/events": {
      get: queryReadRoute("Query events", "Read project/environment scoped raw event telemetry.")
    },
    "/query/overview": {
      get: queryReadRoute(
        "Query project overview",
        "Read operational overview rollups for one project environment. Query with project_id, environment_id, window=24h|7d|30d, and optional release for exact deploy-version filtering."
      )
    },
    "/query/recent-activity": {
      get: queryReadRoute(
        "Query recent activity",
        "Read one mixed, time-ordered activity feed across events, errors, traces, and LLM calls for one project environment. Query with project_id, environment_id, window=24h|7d|30d, optional release, and optional limit."
      )
    },
    "/query/releases": {
      get: queryReadRoute(
        "Query releases",
        "List recently observed release values for one project environment, derived from events, errors, traces, and LLM calls. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/events/properties": {
      get: queryReadRoute(
        "Query event property catalog",
        "Read observed custom event properties for a project environment, including frequency, event coverage, inferred JSON types, safe sample values, type conflicts, and similar property-name groups. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/operations": {
      get: {
        ...queryReadRoute(
          "Query operations rollup",
          "Read a single-window operations rollup for one project environment: monitor status counts, alert rule/event summaries, telemetry health, incident counts, recent monitors/alerts/incidents, detected anomalies, and a heuristic operational-risk prediction. Query with project_id, environment_id, and optional window=24h|7d|30d (default 24h)."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" } }
        ],
        responses: {
          "200": {
            description: "Operations rollup",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "scope", "range", "status", "summary", "recent"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } }
                        },
                        status: { type: "string", enum: ["healthy", "degraded", "unhealthy", "not_configured"] },
                        summary: {
                          type: "object",
                          description: "Monitor, alert, telemetry, and incident count rollups.",
                          additionalProperties: true
                        },
                        recent: {
                          type: "object",
                          description: "Recent monitors, alerts, and incidents (bounded lists).",
                          additionalProperties: true
                        },
                        anomalies: {
                          type: "array",
                          items: { type: "object", additionalProperties: true },
                          description: "Detected volume/rate/latency/cost anomalies for the window."
                        },
                        predictions: {
                          type: "array",
                          items: { type: "object", additionalProperties: true },
                          description: "Heuristic-weighted operational-risk predictions."
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Operations query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/analytics-dashboards": {
      get: {
        ...sessionRoute("List analytics dashboards", "List saved dashboards for one project environment."),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ]
      },
      post: {
        ...sessionRoute("Create an analytics dashboard", "Create a dashboard composed of operational, product, and saved-insight widgets."),
        requestBody: jsonBody("AnalyticsDashboardInput", {
          projectId: "prj_example",
          environmentId: "env_example",
          name: "Checkout operations",
          category: "operational",
          filters: { window: "7d" },
          widgets: [{ type: "insight", title: "Checkout starts", width: "full", options: { insightId: "ins_example" } }]
        }),
        responses: {
          "201": { description: "Analytics dashboard created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" }
        }
      }
    },
    "/admin/analytics-dashboards/{id}": {
      patch: {
        ...sessionRoute("Update an analytics dashboard", "Update dashboard metadata, supported window filter, or widget layout."),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AnalyticsDashboardPatch" } } }
        }
      },
      delete: {
        ...sessionRoute("Archive an analytics dashboard", "Archive a dashboard within its project/environment scope."),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Analytics dashboard archived" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Analytics dashboard not found" }
        }
      }
    },
    "/admin/analytics/insights": {
      get: {
        ...sessionRoute(
          "List saved analytics insights",
          "List active saved trend definitions for one project environment."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ]
      },
      post: {
        ...sessionRoute(
          "Create an analytics insight",
          "Save a scoped event trend definition with hour/day buckets, count or unique-actor metrics, optional event name, promoted-property breakdown, and property filters."
        ),
        requestBody: jsonBody("AnalyticsInsightInput", {
          projectId: "prj_example",
          environmentId: "env_example",
          name: "Checkout starts by plan",
          definition: { bucket: "hour", metric: "count", eventName: "checkout.started", breakdownProperty: "plan" }
        }),
        responses: {
          "201": { description: "Analytics insight created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" }
        }
      }
    },
    "/admin/analytics/insights/{id}": {
      patch: {
        ...sessionRoute("Update an analytics insight", "Rename or replace a saved trend definition within its project/environment scope."),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AnalyticsInsightPatch" } } }
        }
      },
      delete: {
        ...sessionRoute("Archive an analytics insight", "Archive a saved trend definition."),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Analytics insight archived" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Analytics insight not found" }
        }
      }
    },
    "/admin/analytics/promoted-properties": {
      get: {
        ...sessionRoute(
          "List promoted event properties",
          "List event properties promoted for indexed analytics breakdowns, including index lifecycle state."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ]
      },
      post: {
        ...sessionRoute(
          "Promote an event property",
          "Create or retry a scoped expression index for an event property used by saved trend breakdowns."
        ),
        requestBody: jsonBody("PromotedEventPropertyInput", {
          projectId: "prj_example",
          environmentId: "env_example",
          property: "plan",
          displayName: "Subscription plan"
        }),
        responses: {
          "201": { description: "Event property promoted and index prepared" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/admin/analytics/promoted-properties/{id}": {
      delete: {
        ...sessionRoute(
          "Archive a promoted event property",
          "Remove a scoped property index when no active insight references it."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "204": { description: "Promoted event property archived" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Promoted event property not found" },
          "409": { description: "Property is referenced by an active insight" }
        }
      }
    },
    "/query/analytics/trends": {
      get: {
        ...queryReadRoute(
          "Query an analytics trend",
          "Execute a saved insight with insight_id or an explicit trend definition. Use either insight_id or bucket plus metric."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "from", in: "query", required: true, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: true, schema: { type: "string", format: "date-time" } },
          { name: "insight_id", in: "query", schema: { type: "string" } },
          { name: "bucket", in: "query", schema: { type: "string", enum: ["hour", "day"] } },
          { name: "metric", in: "query", schema: { type: "string", enum: ["count", "unique_actors"] } },
          { name: "event_name", in: "query", schema: { type: "string" } },
          { name: "breakdown_property", in: "query", schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,64}$" } },
          { name: "filters", in: "query", description: "JSON array with at most 12 exact/exists property filters.", schema: { type: "string" } }
        ]
      }
    },
    "/query/reports/dashboards/{id}": {
      get: {
        ...queryReadRoute(
          "Render a saved analytics dashboard",
          "Evaluate every dashboard widget for one project environment. Insight widget failures are isolated and returned on that widget instead of failing the full report."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ]
      }
    },
    "/query/events/funnel": {
      get: queryReadRoute(
        "Query event conversion funnel",
        "Analyze ordered event-step conversion for a project environment, aggregated entirely in SQL. Query with project_id, environment_id, window=24h|7d|30d, steps as a comma-separated list of 2-12 event names, and optional limit for sample actors. Optional conversion_window (e.g. 30m, 24h, 7d) bounds elapsed time from funnel entry to each step. Optional breakdown_property splits results into up to 20 series by an event property value. Optional tenant_id and segment_id further scope which actors are counted."
      )
    },
    "/query/experiments/{id}/results": {
      get: queryReadRoute(
        "Query experiment results",
        "Read A/B experiment conversion results by variant. Query with project_id, environment_id, window=24h|7d|30d, and optional limit. Results are derived from exposure and conversion events that include experiment_key and variant properties."
      )
    },
    "/query/surveys/{id}/results": {
      get: {
        ...queryReadRoute(
          "Query survey results",
          "Read in-app survey response totals, per-question summaries, and recent responses. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "30d" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }
        ],
        responses: {
          "200": {
            description: "Survey results",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/SurveyResults" } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Survey not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/surveys/{id}/nps": {
      get: {
        ...queryReadRoute(
          "Query NPS results",
          "Read Net Promoter Score totals, daily trend, tenant/release/plan segments, and recent responses for a 0-10 survey question. Query with project_id, environment_id, window=24h|7d|30d, and optional question_id, tenant_id, release, plan, and limit."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "30d" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
          { name: "question_id", in: "query", required: false, schema: { type: "string", default: "nps" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "release", in: "query", required: false, schema: { type: "string" } },
          { name: "plan", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "NPS results",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/NpsResults" } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Survey not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/message-campaigns/{id}/results": {
      get: {
        ...queryReadRoute(
          "Query message campaign results",
          "Read campaign delivery, engagement, conversion, recent event, and opt-out metrics. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "30d" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }
        ],
        responses: {
          "200": {
            description: "Message campaign results",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/MessageCampaignResults" } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Campaign not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/feedback": {
      get: {
        ...queryReadRoute(
          "List feedback submissions",
          "Read recent product feedback submissions for a project environment. Query with project_id, environment_id, optional status=open|reviewed|archived, tenant_id, user_id, and optional limit."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["open", "reviewed", "archived"] } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }
        ],
        responses: {
          "200": {
            description: "Feedback submissions",
            content: { "application/json": { schema: { type: "object", properties: { feedback: { type: "array", items: { $ref: "#/components/schemas/FeedbackItem" } } } } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/feedback/{id}": {
      patch: {
        tags: ["Session authenticated"],
        summary: "Update feedback status",
        description: "Mark a feedback submission as open, reviewed, or archived.",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["open", "reviewed", "archived"] } } } } }
        },
        responses: {
          "200": {
            description: "Feedback updated",
            content: { "application/json": { schema: { type: "object", properties: { feedback: { $ref: "#/components/schemas/FeedbackItem" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token cannot perform mutations (`read_token_is_read_only`)" },
          "404": { description: "Feedback not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/events/retention": {
      get: queryReadRoute(
        "Query event retention curves",
        "Analyze retention cohorts for a project environment. Cohorts are anchored on each actor's user_profiles.first_seen_at, not the minimum entry_event timestamp inside the queried window. Query with project_id, environment_id, window=24h|7d|30d, optional entry_event (cohort eligibility filter), optional return_event (absent means any event counts as retained), optional period=daily|weekly|monthly, optional intervals=2..12, and optional range_days=1..730 to override the window-derived range for long lookback queries. RETENTION_EVENTS_DAYS remains the installation-level raw-versus-rollup routing threshold; scoped events retention independently controls raw-row deletion and can be shorter or longer. The response reports source=raw|rollup."
      )
    },
    "/query/events/click-map": {
      get: queryReadRoute(
        "Query event click maps",
        "Aggregate opt-in browser click samples by route, safe selector, and grid bucket. Query with project_id, environment_id, route, window=24h|7d|30d, optional selector, tenant_id, user_id, session_id, grid_size=10..100, and limit."
      )
    },
    "/query/events/paths": {
      get: {
        ...queryReadRoute(
          "Query event paths",
          "Discover the most common event sequences leading to or from an anchor event for a project environment. At least one of start_event or end_event is required. Query with project_id, environment_id, and one or both of start_event/end_event, plus optional window=24h|7d|30d (default 7d), actor=auto|user|tenant|session|trace (default auto), max_depth=2..8 (default 5), from/to (from must be before to when both given), tenant_id, user_id, session_id, trace_id, segment_id, and limit."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          {
            name: "start_event",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "At least one of start_event/end_event is required."
          },
          {
            name: "end_event",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "At least one of start_event/end_event is required."
          },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "7d" } },
          {
            name: "actor",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["auto", "user", "tenant", "session", "trace"], default: "auto" }
          },
          { name: "max_depth", in: "query", required: false, schema: { type: "integer", minimum: 2, maximum: 8, default: 5 } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "session_id", in: "query", required: false, schema: { type: "string" } },
          { name: "trace_id", in: "query", required: false, schema: { type: "string" } },
          { name: "segment_id", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } }
        ],
        responses: {
          "200": {
            description: "Most common event path sequences",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "scope", "range", "filters", "totals", "paths"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } }
                        },
                        filters: {
                          type: "object",
                          properties: {
                            startEvent: { type: ["string", "null"] },
                            endEvent: { type: ["string", "null"] },
                            tenantId: { type: ["string", "null"] },
                            userId: { type: ["string", "null"] },
                            sessionId: { type: ["string", "null"] },
                            traceId: { type: ["string", "null"] },
                            segmentId: { type: ["string", "null"] },
                            actorType: { type: "string", enum: ["auto", "user", "tenant", "session", "trace"] },
                            pathLength: { type: "integer" }
                          }
                        },
                        totals: {
                          type: "object",
                          properties: {
                            actors: { type: "integer", minimum: 0 },
                            paths: { type: "integer", minimum: 0 },
                            events: { type: "integer", minimum: 0 }
                          }
                        },
                        paths: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["path", "actors", "occurrences", "firstSeenAt", "lastSeenAt", "sampleEvents"],
                            properties: {
                              path: { type: "array", items: { type: "string" } },
                              actors: { type: "integer", minimum: 0 },
                              occurrences: { type: "integer", minimum: 0 },
                              firstSeenAt: { type: "string", format: "date-time" },
                              lastSeenAt: { type: "string", format: "date-time" },
                              sampleEvents: {
                                type: "array",
                                items: {
                                  type: "object",
                                  required: ["id", "name", "timestamp", "actorId", "actorType"],
                                  properties: {
                                    id: { type: "string" },
                                    name: { type: "string" },
                                    timestamp: { type: "string", format: "date-time" },
                                    actorId: { type: "string" },
                                    actorType: { type: "string", enum: ["user", "tenant", "session", "trace"] }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Event path query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/sessions/{sessionId}/timeline": {
      get: {
        ...queryReadRoute(
          "Query session timeline",
          "Read one session's mixed, time-ordered timeline across breadcrumbs, events, errors, traces, and LLM calls for a project environment. Either from/to or center (with before/after) can be used to bound the range; center takes precedence when present. Query with project_id, environment_id, and optional tenant_id, user_id, from, to, center, before, after, types, and limit."
        ),
        parameters: [
          { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          {
            name: "center",
            in: "query",
            required: false,
            schema: { type: "string", format: "date-time" },
            description: "When present, replaces from/to with a window of `before` seconds earlier to `after` seconds later."
          },
          {
            name: "before",
            in: "query",
            required: false,
            schema: { type: "number", minimum: 0, default: 600 },
            description: "Seconds before `center` to include. Only applied when `center` is set."
          },
          {
            name: "after",
            in: "query",
            required: false,
            schema: { type: "number", minimum: 0, default: 120 },
            description: "Seconds after `center` to include. Only applied when `center` is set."
          },
          {
            name: "types",
            in: "query",
            required: false,
            schema: {
              type: "array",
              items: { type: "string", enum: ["breadcrumb", "event", "error", "trace", "llm"] }
            },
            style: "form",
            explode: true,
            description: "Repeatable or comma-separated. Defaults to all five types."
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            description: "Accepted up to 500 by the route; the timeline repository clamps to 1..200 (default 100)."
          }
        ],
        responses: {
          "200": {
            description: "Session timeline",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["sessionId", "scope", "range", "items", "page"],
                      properties: {
                        sessionId: { type: "string" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: {
                            from: { type: ["string", "null"], format: "date-time" },
                            to: { type: ["string", "null"], format: "date-time" }
                          }
                        },
                        items: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["id", "type", "timestamp", "receivedAt", "tenantId", "userId", "sessionId", "traceId", "source", "release", "title", "level"],
                            properties: {
                              id: { type: "string" },
                              type: { type: "string", enum: ["breadcrumb", "event", "error", "trace", "llm"] },
                              timestamp: { type: "string", format: "date-time" },
                              receivedAt: { type: "string", format: "date-time" },
                              tenantId: { type: ["string", "null"] },
                              userId: { type: ["string", "null"] },
                              sessionId: { type: "string" },
                              traceId: { type: ["string", "null"] },
                              source: { type: ["string", "null"] },
                              release: { type: ["string", "null"] },
                              title: { type: "string" },
                              level: { type: ["string", "null"] },
                              data: { description: "Type-specific payload excerpt." }
                            }
                          }
                        },
                        page: {
                          type: "object",
                          properties: {
                            nextCursor: { type: ["string", "null"] },
                            previousCursor: { type: ["string", "null"] }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Session timeline query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/replays": {
      get: queryReadRoute(
        "Query session replay samples",
        "List privacy-safe replay samples for a project environment. Supports saved segment filtering with segment_id plus tenant_id, user_id, event_name, and limit. Results include user, tenant, route, timestamp, and linked event/error context for cohort replay investigation."
      )
    },
    "/query/replays/{replayId}": {
      get: queryReadRoute(
        "Query session replay detail",
        "Read one privacy-safe replay timeline and its linked product event markers. Query with project_id and environment_id; replayId is the path parameter from event or error detail."
      )
    },
    "/query/entities/tenants": {
      get: {
        ...queryReadRoute(
          "List tenant activity",
          "List tenants observed in a project environment, ranked and keyset-paginated by an activity sort. Query with project_id, environment_id, optional window=24h|7d|30d (default 7d), optional search (matches tenant id/traits), optional limit=1..100 (default 50), optional sort, and optional cursor from a previous page's response. The cursor is an opaque base64url-encoded JSON object minted for a specific `sort`; reusing it with a different `sort` value is rejected."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "7d" } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          {
            name: "sort",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["impact", "usage", "errors", "llm_cost", "recent"], default: "impact" },
            description: "Ranking used for both ordering and keyset pagination."
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Opaque base64url-encoded JSON keyset cursor `{sort, value, actorId}` returned by a previous page. Must match the request's `sort`."
          }
        ],
        responses: {
          "200": {
            description: "Ranked, paginated tenant activity",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "scope", "range", "tenants"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } }
                        },
                        tenants: { type: "array", items: { $ref: "#/components/schemas/EntityTenantSummary" } },
                        cursor: { type: "string", description: "Present when another page is available." }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Tenant activity query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/entities/tenants/{tenantKey}": {
      get: {
        ...queryReadRoute(
          "Query tenant activity detail",
          "Read one tenant's activity summary, top users, and time-ordered signal timeline for a project environment. Query with project_id, environment_id, optional window=24h|7d|30d (default 7d), optional user_id, optional signal_type, optional limit=1..100 (default 50), and optional cursor from a previous page's response. `tenantKey` cannot be the reserved value `_unassigned`."
        ),
        parameters: [
          { name: "tenantKey", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "7d" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "signal_type", in: "query", required: false, schema: { type: "string", enum: ["event", "error", "trace", "llm"] } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Opaque base64url-encoded JSON timeline cursor `{timestamp, type, id}` returned by a previous page."
          }
        ],
        responses: {
          "200": {
            description: "Tenant activity detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "scope", "range", "tenant", "topUsers", "timeline"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } }
                        },
                        tenant: { $ref: "#/components/schemas/EntityTenantSummary" },
                        topUsers: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["userId", "events", "errors", "traces", "llmCalls", "llmCostUsd", "lastSeenAt"],
                            properties: {
                              userId: { type: "string" },
                              events: { type: "integer", minimum: 0 },
                              errors: { type: "integer", minimum: 0 },
                              traces: { type: "integer", minimum: 0 },
                              llmCalls: { type: "integer", minimum: 0 },
                              llmCostUsd: { type: "string" },
                              lastSeenAt: { type: "string", format: "date-time" }
                            }
                          }
                        },
                        timeline: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["type", "id", "timestamp", "label"],
                            properties: {
                              type: { type: "string", enum: ["event", "error", "trace", "llm"] },
                              id: { type: "string" },
                              timestamp: { type: "string", format: "date-time" },
                              label: { type: "string" },
                              userId: { type: ["string", "null"] },
                              sessionId: { type: ["string", "null"] },
                              traceId: { type: ["string", "null"] }
                            },
                            additionalProperties: true,
                            description: "Additional fields vary by `type`: events carry eventName; errors carry severity/status/message; traces carry status/durationMs/name; LLM calls carry provider/model/promptName/status/costUsd."
                          }
                        },
                        cursor: { type: "string", description: "Present when another timeline page is available." }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Tenant activity query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/users": {
      get: {
        ...queryReadRoute(
          "List user activity",
          "List users observed in a project environment, ranked and keyset-paginated by an activity sort. Query with project_id, environment_id, optional window=24h|7d|30d (default 7d), optional search (matches user id/traits), optional tenant_id, optional limit=1..100 (default 50), optional sort, and optional cursor from a previous page's response. The cursor is an opaque base64url-encoded JSON object minted for a specific `sort`; reusing it with a different `sort` value is rejected."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "7d" } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          {
            name: "sort",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["impact", "usage", "errors", "llm_cost", "recent"], default: "impact" },
            description: "Ranking used for both ordering and keyset pagination."
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Opaque base64url-encoded JSON keyset cursor `{sort, value, actorId}` returned by a previous page. Must match the request's `sort`."
          }
        ],
        responses: {
          "200": {
            description: "Ranked, paginated user activity",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "scope", "range", "users"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } }
                        },
                        users: { type: "array", items: { $ref: "#/components/schemas/EntityUserSummary" } },
                        cursor: { type: "string", description: "Present when another page is available." }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "User activity query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/users/{userKey}": {
      get: {
        ...queryReadRoute(
          "Query user activity detail",
          "Read one user's activity summary, recent sessions, and time-ordered signal timeline for a project environment. Query with project_id, environment_id, optional window=24h|7d|30d (default 7d), optional tenant_id, optional signal_type, optional limit=1..100 (default 50), and optional cursor from a previous page's response. `userKey` cannot be the reserved value `_anonymous`."
        ),
        parameters: [
          { name: "userKey", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "7d" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "signal_type", in: "query", required: false, schema: { type: "string", enum: ["event", "error", "trace", "llm"] } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Opaque base64url-encoded JSON timeline cursor `{timestamp, type, id}` returned by a previous page."
          }
        ],
        responses: {
          "200": {
            description: "User activity detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["window", "generatedAt", "scope", "range", "user", "recentSessions", "timeline"],
                      properties: {
                        window: { type: "string", enum: ["24h", "7d", "30d"] },
                        generatedAt: { type: "string", format: "date-time" },
                        scope: {
                          type: "object",
                          properties: { projectId: { type: "string" }, environmentId: { type: "string" } }
                        },
                        range: {
                          type: "object",
                          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } }
                        },
                        user: { $ref: "#/components/schemas/EntityUserSummary" },
                        recentSessions: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["sessionId", "tenantId", "events", "errors", "traces", "llmCalls", "llmCostUsd", "firstSeenAt", "lastSeenAt"],
                            properties: {
                              sessionId: { type: "string" },
                              tenantId: { type: ["string", "null"] },
                              events: { type: "integer", minimum: 0 },
                              errors: { type: "integer", minimum: 0 },
                              traces: { type: "integer", minimum: 0 },
                              llmCalls: { type: "integer", minimum: 0 },
                              llmCostUsd: { type: "string" },
                              firstSeenAt: { type: "string", format: "date-time" },
                              lastSeenAt: { type: "string", format: "date-time" }
                            }
                          }
                        },
                        timeline: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["type", "id", "timestamp", "label"],
                            properties: {
                              type: { type: "string", enum: ["event", "error", "trace", "llm"] },
                              id: { type: "string" },
                              timestamp: { type: "string", format: "date-time" },
                              label: { type: "string" },
                              tenantId: { type: ["string", "null"] },
                              sessionId: { type: ["string", "null"] },
                              traceId: { type: ["string", "null"] }
                            },
                            additionalProperties: true,
                            description: "Additional fields vary by `type`: events carry eventName; errors carry severity/status/message; traces carry status/durationMs/name; LLM calls carry provider/model/promptName/status/costUsd."
                          }
                        },
                        cursor: { type: "string", description: "Present when another timeline page is available." }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "User activity query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/errors": {
      get: queryReadRoute("Query errors", "Read project/environment scoped raw error telemetry.")
    },
    "/query/errors/{id}/source-map-resolution": {
      get: {
        ...queryReadRoute(
          "Query error source-map resolution",
          "Resolve one error's stack frames against uploaded source maps for its release, using strict project/environment/release/minified-file matching. Query with project_id and environment_id. The console does not display original source content; this response returns resolved file/line/column locations only."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Source-map resolution result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["errorId", "release", "status", "frames", "unresolvedFrameCount"],
                      properties: {
                        errorId: { type: "string" },
                        release: { type: ["string", "null"] },
                        status: { type: "string", enum: ["resolved", "partially_resolved", "unresolved", "unavailable"] },
                        frames: {
                          type: "array",
                          items: {
                            type: "object",
                            required: [
                              "frameIndex",
                              "minifiedFile",
                              "minifiedLine",
                              "minifiedColumn",
                              "originalSource",
                              "originalLine",
                              "originalColumn",
                              "originalName",
                              "sourceMapArtifactId"
                            ],
                            properties: {
                              frameIndex: { type: "integer", minimum: 0 },
                              minifiedFile: { type: "string" },
                              minifiedLine: { type: "integer" },
                              minifiedColumn: { type: "integer" },
                              originalSource: { type: "string", description: "Original source file path, not file content." },
                              originalLine: { type: "integer" },
                              originalColumn: { type: "integer" },
                              originalName: { type: ["string", "null"] },
                              sourceMapArtifactId: { type: "string" }
                            }
                          }
                        },
                        unresolvedFrameCount: { type: "integer", minimum: 0 }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Error not found" },
          "501": { description: "Source-map resolution query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/incidents/error-groups/{id}": {
      get: {
        ...queryReadRoute(
          "Query error-group incident detail",
          "Read the full incident workspace for one error group: the group record, primary occurrence, priority, source-map resolution status, strongly-related and nearby telemetry context, a linked privacy-safe replay when available, related actor/release ids, assignment, silence state, triage notes, deploy/code context, and linked external issues. Query with project_id, environment_id, and optional error_id to pin the primary occurrence to a specific error instead of the group's latest."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "error_id", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Incident workspace detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: [
                        "group",
                        "primaryOccurrence",
                        "priority",
                        "suggestedPriority",
                        "sourceMapResolution",
                        "stronglyRelated",
                        "nearbyContext",
                        "replay",
                        "related",
                        "incidentNumber",
                        "assignedTo",
                        "silencedUntil",
                        "notes",
                        "codeContext",
                        "externalIssues"
                      ],
                      properties: {
                        group: { $ref: "#/components/schemas/ErrorGroupRecord" },
                        primaryOccurrence: {
                          type: "object",
                          additionalProperties: true,
                          description: "Raw error occurrence backing this incident (the group's latest error, or `error_id` when given)."
                        },
                        priority: { type: ["string", "null"], enum: ["urgent", "high", "normal", "low", null] },
                        suggestedPriority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
                        sourceMapResolution: {
                          type: "object",
                          required: ["status"],
                          properties: {
                            status: { type: "string", enum: ["cached", "none"] },
                            frameCount: { type: "integer", minimum: 0 }
                          }
                        },
                        stronglyRelated: {
                          type: "object",
                          required: ["items", "truncated"],
                          properties: {
                            items: { type: "array", items: { type: "object", additionalProperties: true } },
                            truncated: { type: "boolean" }
                          },
                          description: "Breadcrumbs, events, errors, traces, and LLM calls tightly correlated to the primary occurrence (same session/trace)."
                        },
                        nearbyContext: {
                          type: "object",
                          required: ["items", "truncated"],
                          properties: {
                            items: { type: "array", items: { type: "object", additionalProperties: true } },
                            truncated: { type: "boolean" }
                          },
                          description: "Telemetry near the primary occurrence in time but without a direct session/trace link."
                        },
                        replay: {
                          type: ["object", "null"],
                          additionalProperties: true,
                          description: "Linked privacy-safe session replay for the primary occurrence, when one exists."
                        },
                        related: {
                          type: "object",
                          properties: {
                            traceId: { type: ["string", "null"] },
                            sessionId: { type: ["string", "null"] },
                            userId: { type: ["string", "null"] },
                            tenantId: { type: ["string", "null"] },
                            release: { type: ["string", "null"] }
                          }
                        },
                        incidentNumber: { type: ["string", "null"] },
                        assignedTo: {
                          type: ["object", "null"],
                          properties: { id: { type: "string" }, email: { type: "string" } }
                        },
                        silencedUntil: { type: ["string", "null"], format: "date-time" },
                        notes: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["id", "authorEmail", "body", "createdAt"],
                            properties: {
                              id: { type: "string" },
                              authorEmail: { type: "string" },
                              body: { type: "string" },
                              createdAt: { type: "string", format: "date-time" }
                            }
                          }
                        },
                        codeContext: {
                          type: "object",
                          additionalProperties: true,
                          description: "Deploy/repository code context: status, linked repository, release commit metadata, and suspected files."
                        },
                        externalIssues: {
                          type: "array",
                          items: { $ref: "#/components/schemas/IncidentExternalLink" }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Incident not found" },
          "501": { description: "Incident query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/incidents/error-groups/{id}/notes": {
      post: {
        ...sessionRoute(
          "Add an incident triage note",
          "Append an author-attributed triage note to one error-group incident. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: jsonBody("TriageNoteInput", { body: "Rolled back release web@1.4.2, monitoring error rate." }),
        responses: {
          "200": {
            description: "Triage note created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/TriageNoteRecord" } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token cannot perform mutations (`read_token_is_read_only`)" },
          "404": { description: "Error group not found" },
          "501": { description: "Triage note mutation is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/incidents/error-groups/{id}/silence": {
      post: {
        ...sessionRoute(
          "Silence an incident",
          "Silence or unsilence one error-group incident. Send `minutes` as a positive integer to silence for that many minutes from now, or `0`/`null` to clear an existing silence. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: jsonBody("SilenceIncidentInput", { minutes: 60 }),
        responses: {
          "200": {
            description: "Updated error group with new silence state",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/ErrorGroupRecord" } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token cannot perform mutations (`read_token_is_read_only`)" },
          "404": { description: "Error group not found" },
          "501": { description: "Silence mutation is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/incidents/mttr": {
      get: {
        ...queryReadRoute(
          "Query incident MTTR",
          "Read mean-time-to-resolution for error groups resolved within the window, plus the count of groups that resolution was computed from. Query with project_id, environment_id, and optional window=7d|30d (default 7d). Note this route's window enum is narrower than other query routes: only 7d and 30d are accepted, not 24h."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d"], default: "7d" } }
        ],
        responses: {
          "200": {
            description: "MTTR rollup",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["mttrMs", "resolvedCount", "windowDays"],
                      properties: {
                        mttrMs: { type: ["number", "null"] },
                        resolvedCount: { type: "integer", minimum: 0 },
                        windowDays: { type: "integer", enum: [7, 30] }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "MTTR query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/incidents/error-groups/{id}/external-issues": {
      post: {
        ...sessionRoute(
          "Link an external issue to an incident",
          "Attach a GitHub/GitLab issue URL to a Sigmon error-group incident. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider", "externalKey", "title", "url"],
                properties: {
                  integrationId: { type: ["string", "null"] },
                  provider: { type: "string", enum: ["github", "gitlab"] },
                  externalKey: { type: "string" },
                  title: { type: "string" },
                  url: { type: "string", format: "uri" },
                  state: { type: "string", default: "open" }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "External issue linked",
            content: { "application/json": { schema: { type: "object", properties: { link: { $ref: "#/components/schemas/IncidentExternalLink" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token cannot perform mutations (`read_token_is_read_only`)" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/incidents/error-groups/{id}/external-issues/draft": {
      post: {
        ...sessionRoute(
          "Create an external issue draft URL",
          "Build a prefilled GitHub/GitLab new-issue URL from a Sigmon incident. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["integrationId"],
                properties: {
                  integrationId: { type: "string" },
                  incidentUrl: { type: "string", format: "uri" }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Issue draft URL",
            content: { "application/json": { schema: { type: "object", properties: { draft: { $ref: "#/components/schemas/IncidentIssueDraft" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { description: "Read token cannot perform mutations (`read_token_is_read_only`)" },
          "404": { description: "Code integration not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/llm-calls": {
      get: queryReadRoute("Query LLM calls", "Read project/environment scoped LLM call telemetry.")
    },
    "/query/llm/summary": {
      get: {
        ...queryReadRoute(
          "Query LLM summary",
          "Read a single-window LLM rollup for a project environment: call count, failed-call count, total cost, average token count, average latency, and p95 latency. Query with project_id, environment_id, and optional window=24h|7d|30d (default 24h)."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" } }
        ],
        responses: {
          "200": {
            description: "LLM summary rollup",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["calls", "failedCalls", "costUsd", "avgTokens", "avgLatencyMs", "p95LatencyMs"],
                      properties: {
                        calls: { type: "integer", minimum: 0 },
                        failedCalls: { type: "integer", minimum: 0 },
                        costUsd: { type: "string", description: "Decimal string, e.g. \"1.2345\"." },
                        avgTokens: { type: ["number", "null"] },
                        avgLatencyMs: { type: ["number", "null"] },
                        p95LatencyMs: { type: ["number", "null"] }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "LLM summary query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/llm/by-tenant": {
      get: {
        ...queryReadRoute(
          "Query LLM usage by tenant",
          "Read per-tenant LLM rollups for a project environment: call count, failed-call count, cost, average token count, average latency, and p95 latency per tenant. Query with project_id, environment_id, and optional window=24h|7d|30d (default 24h)."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" } }
        ],
        responses: {
          "200": {
            description: "Per-tenant LLM rollups",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["tenantId", "calls", "failedCalls", "costUsd", "avgTokens", "avgLatencyMs", "p95LatencyMs"],
                        properties: {
                          tenantId: { type: "string" },
                          calls: { type: "integer", minimum: 0 },
                          failedCalls: { type: "integer", minimum: 0 },
                          costUsd: { type: "string" },
                          avgTokens: { type: ["number", "null"] },
                          avgLatencyMs: { type: ["number", "null"] },
                          p95LatencyMs: { type: ["number", "null"] }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "LLM by-tenant query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/llm/by-prompt": {
      get: {
        ...queryReadRoute(
          "Query LLM usage by prompt",
          "Read per-prompt LLM rollups for a project environment: model, call count, failed-call count, cost, average token count, average latency, and p95 latency per prompt_name/model pair. Query with project_id, environment_id, and optional window=24h|7d|30d (default 24h)."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" } }
        ],
        responses: {
          "200": {
            description: "Per-prompt LLM rollups",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["promptName", "model", "calls", "failedCalls", "costUsd", "avgTokens", "avgLatencyMs", "p95LatencyMs"],
                        properties: {
                          promptName: { type: "string" },
                          model: { type: "string" },
                          calls: { type: "integer", minimum: 0 },
                          failedCalls: { type: "integer", minimum: 0 },
                          costUsd: { type: "string" },
                          avgTokens: { type: ["number", "null"] },
                          avgLatencyMs: { type: ["number", "null"] },
                          p95LatencyMs: { type: ["number", "null"] }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "LLM by-prompt query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/llm/cost-by-model": {
      get: {
        ...queryReadRoute(
          "Query LLM cost by model",
          "Read a time-bucketed LLM cost series broken down by model for a project environment. Query with project_id, environment_id, and optional window=24h|7d|30d (default 24h)."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" } }
        ],
        responses: {
          "200": {
            description: "Bucketed cost-by-model series",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["buckets", "series"],
                      properties: {
                        buckets: { type: "array", items: { type: "string", format: "date-time" } },
                        series: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["model", "costs"],
                            properties: {
                              model: { type: "string" },
                              costs: {
                                type: "array",
                                items: { type: "string" },
                                description: "Decimal-string costs aligned index-for-index with `buckets`."
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "LLM cost-by-model query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/traces": {
      get: queryReadRoute(
        "Query traces",
        "Read project/environment scoped trace telemetry. Supports trace drilldown filters such as trace_id, trace_name, status, tenant_id, user_id, session_id, from, to, limit, and cursor."
      )
    },
    "/query/traces/{id}/spans": {
      get: {
        ...queryReadRoute(
          "List trace spans",
          "List spans for one trace using cursor pagination. `trace_id`, if given as a query parameter, must match the `id` path parameter or the request is rejected. Query with project_id, environment_id, and optional tenant_id, user_id, session_id, trace_id, from, to, limit=1..500 (default 50), and cursor from a previous page's response."
        ),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: false, schema: { type: "string" } },
          { name: "user_id", in: "query", required: false, schema: { type: "string" } },
          { name: "session_id", in: "query", required: false, schema: { type: "string" } },
          {
            name: "trace_id",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "If given, must equal the `id` path parameter."
          },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 50 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Paginated trace spans",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: [
                          "id",
                          "projectId",
                          "environmentId",
                          "tenantId",
                          "userId",
                          "sessionId",
                          "traceId",
                          "timestamp",
                          "receivedAt",
                          "source",
                          "release",
                          "parentSpanId",
                          "name",
                          "status",
                          "startedAt",
                          "endedAt",
                          "durationMs"
                        ],
                        properties: {
                          id: { type: "string" },
                          projectId: { type: "string" },
                          environmentId: { type: "string" },
                          tenantId: { type: ["string", "null"] },
                          userId: { type: ["string", "null"] },
                          sessionId: { type: ["string", "null"] },
                          traceId: { type: "string" },
                          timestamp: { type: "string", format: "date-time" },
                          receivedAt: { type: "string", format: "date-time" },
                          source: { type: ["string", "null"] },
                          release: { type: ["string", "null"] },
                          metadata: {},
                          parentSpanId: { type: ["string", "null"] },
                          name: { type: "string" },
                          status: { type: "string" },
                          startedAt: { type: "string", format: "date-time" },
                          endedAt: { type: ["string", "null"], format: "date-time" },
                          durationMs: { type: ["number", "null"] },
                          input: {},
                          output: {},
                          error: {},
                          costUsd: { type: ["string", "null"] }
                        }
                      }
                    },
                    cursor: { type: ["string", "null"] }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Trace span query is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/apm/endpoints": {
      get: queryReadRoute(
        "Query APM endpoints",
        "Read endpoint-level APM rollups for a project environment, including throughput, errors, error rate, p50/p95/p99 latency, average latency, Apdex, and last seen timestamp. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/apm/service-map": {
      get: queryReadRoute(
        "Query APM service map",
        "Read span-derived service dependency edges for a project environment, including source, target, dependency type, span count, distinct trace count, errors, error rate, average latency, p95 latency, and last seen timestamp. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/apm/web-vitals": {
      get: queryReadRoute(
        "Query APM Web Vitals",
        "Read browser Web Vital rollups for a project environment, including p75 by metric and route, sample counts, rating counts, latest release p75, previous release p75, and regression percent. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/apm/profiles": {
      get: queryReadRoute(
        "Query APM runtime profiles",
        "Read runtime CPU and memory profile rollups for a project environment, including profile counts, CPU/memory totals, recent profiles, and hot functions. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/alerts/events": {
      get: {
        ...sessionRoute(
          "List alert events",
          "List triggered alert events for a project environment, most recent first. Query with project_id, environment_id, and optional limit."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
        ],
        responses: {
          "200": {
            description: "Alert events",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { type: "array", items: { $ref: "#/components/schemas/AlertEventRecord" } } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Alert repository is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/alerts/events/{id}": {
      get: {
        ...sessionRoute("Read an alert event", "Read one alert event by id."),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Alert event",
            content: {
              "application/json": {
                schema: { type: "object", required: ["data"], properties: { data: { $ref: "#/components/schemas/AlertEventRecord" } } }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Alert event not found" },
          "501": { description: "Alert repository is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/alerts/events/{id}/triage": {
      patch: {
        ...sessionRoute(
          "Triage an alert event",
          "Update an alert event's status (acknowledge, snooze, or resolve) and optionally attach a triage note. `snoozedUntil` is required when `status` is `snoozed`."
        ),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody("AlertEventTriagePatch", { status: "acknowledged" }),
        responses: {
          "200": {
            description: "Updated alert event",
            content: {
              "application/json": {
                schema: { type: "object", required: ["data"], properties: { data: { $ref: "#/components/schemas/AlertEventRecord" } } }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Alert event not found" },
          "501": { description: "Alert repository is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/alerts/suggestions": {
      get: {
        ...sessionRoute(
          "List alert rule suggestions",
          "Return heuristic alert rule suggestions for a project environment based on recent critical errors, error counts, error rate, trace p95 latency, LLM cost, and dead-letter activity. Suggestions with an already-active matching rule are omitted. Query with project_id and environment_id."
        ),
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "environment_id", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Alert rule suggestions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["suggestions"],
                  properties: { suggestions: { type: "array", items: { $ref: "#/components/schemas/AlertSuggestion" } } }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "Alert repository is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/system/health": {
      get: sessionRoute("Read system health", "Read API, worker, Postgres, Redis, queue, freshness, retention, and backup status.")
    },
    "/system/health/history": {
      get: {
        ...sessionRoute(
          "Read system health history",
          "Read recent system health samples (Postgres/Redis latency and telemetry queue depth) captured on an interval, most recent first. Query with optional limit (1-480, default 60)."
        ),
        parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 480, default: 60 } }],
        responses: {
          "200": {
            description: "System health samples",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { type: "array", items: { $ref: "#/components/schemas/SystemHealthSample" } } }
                }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": { description: "System health history is not available" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/system/actions/doctor": {
      post: systemActionOperation(
        "Run system doctor",
        "Admin-only read-only self-check that evaluates the current SignalMonitor installation health and returns an operator summary."
      )
    },
    "/system/actions/backup": {
      post: backupActionOperation(
        "Trigger manual backup",
        "Admin-only action that queues the same backup workflow used by the scheduler. The worker runs it asynchronously under the backup advisory lock."
      )
    },
    "/system/actions/retention": {
      post: systemActionOperation(
        "Trigger manual retention",
        "Admin-only action that runs the same telemetry, dead-letter, and source-map retention workflow used by the scheduler."
      )
    }
  }
} satisfies OpenApiDocument;
