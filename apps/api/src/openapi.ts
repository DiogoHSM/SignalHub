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

const apiDescription = `Self-hosted telemetry API for product events, errors, breadcrumbs, LLM calls, traces, spans, source maps, and operator workflows.

## Integration guide

For TypeScript, Node.js, browser, and Next.js projects, use the official \`@sigmon/sdk\` package when it is available in your package registry or vendored workspace. The SDK is the recommended path for complete integrations because it keeps browser and server entrypoints separate, maps payloads consistently, provides Next.js route/action wrappers, and exposes identify helpers for user and tenant traits.

Raw HTTP remains the stable contract for other languages, automation, and direct integrations. All ingestion requests use project/environment-scoped API keys created in the SignalMonitor console.

## Recommended rollout

1. Create one SignalMonitor project and one environment per deployed app environment.
2. Create separate ingestion keys for server and browser telemetry.
3. Use server-only variables such as \`SIGMON_ENDPOINT\` and \`SIGMON_API_KEY\` for API routes, workers, server actions, and scheduled jobs.
4. Use browser variables such as \`NEXT_PUBLIC_SIGMON_ENDPOINT\` and \`NEXT_PUBLIC_SIGMON_BROWSER_KEY\` only with a browser-scoped ingestion key.
5. Send \`identifyUser\` / \`POST /v1/identify/user\` after login or session load, and \`identifyTenant\` / \`POST /v1/identify/tenant\` after tenant/workspace selection.
6. Send events, errors, breadcrumbs, traces, spans, and LLM calls with stable \`tenant_id\`, \`user_id\`, \`session_id\`, \`trace_id\`, \`source\`, and \`release\` fields when available.
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
      }
    },
    schemas: {
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
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" }
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
          severity: { type: "string", enum: ["info", "warning", "error", "critical", "fatal"], description: "Severity used by filters and alerting." },
          fingerprint: { type: "string", description: "Optional grouping key. Events with the same fingerprint are grouped together." },
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
        required: ["type", "category", "message"],
        properties: {
          type: { type: "string", enum: ["navigation", "ui", "console", "network", "custom"] },
          category: { type: "string" },
          message: { type: "string" },
          level: { type: "string", enum: ["debug", "info", "warning", "error"] },
          data: { type: "object", additionalProperties: true },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
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
          status: { type: "string", enum: ["success", "error"] },
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
      TracePayload: {
        type: "object",
        required: ["name", "status"],
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["success", "error"] },
          started_at: { type: "string", format: "date-time" },
          ended_at: { type: "string", format: "date-time" },
          duration_ms: { type: "integer", minimum: 0 },
          trace_id: { type: "string" },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          metadata: { type: "object", additionalProperties: true }
        }
      },
      SpanPayload: {
        type: "object",
        required: ["trace_id", "name", "status"],
        properties: {
          trace_id: { type: "string" },
          parent_span_id: { type: "string" },
          name: { type: "string" },
          status: { type: "string", enum: ["success", "error"] },
          started_at: { type: "string", format: "date-time" },
          ended_at: { type: "string", format: "date-time" },
          duration_ms: { type: "integer", minimum: 0 },
          input: { type: "object", additionalProperties: true },
          output: { type: "object", additionalProperties: true },
          cost_usd: { type: "number", minimum: 0 },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          metadata: { type: "object", additionalProperties: true }
        }
      },
      UserIdentifyPayload: {
        type: "object",
        required: ["user_id", "traits"],
        description:
          "Upserts a project/environment-scoped user profile. Telemetry with matching user_id updates last_seen_at, but only identify calls update stored traits.",
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
          "Upserts a project/environment-scoped tenant profile used by Entities investigation views and tenant-level filters.",
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
        responses: {
          "200": {
            description: "API is alive",
            content: { "application/json": { example: { ok: true } } }
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
        source: "web",
        release: "2026.05.24",
        properties: { plan: "team", checkout_id: "chk_123" },
        metadata: { request_id: "req_abc" }
      })
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
    "/v1/llm": {
      post: ingestionOperation("Ingest an LLM call", "Track AI provider calls, latency, status, tokens, and cost.", "LlmPayload", {
        provider: "openai",
        model: "gpt-5-mini",
        prompt_name: "dashboard_summary",
        status: "success"
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
      post: identifyOperation("Identify a user", "Upsert user profile traits scoped to the ingestion API key. Call this after login/session load or whenever durable user traits change.", "UserIdentifyPayload", {
        user_id: "user_456",
        tenant_id: "tenant_123",
        traits: { name: "Ana Souza", email: "ana@example.com", role: "admin", plan: "pro" }
      })
    },
    "/v1/identify/tenant": {
      post: identifyOperation("Identify a tenant", "Upsert tenant profile traits scoped to the ingestion API key. Call this after tenant/workspace selection or whenever durable tenant traits change.", "TenantIdentifyPayload", {
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
                required: ["project_id", "environment_id", "release", "minified_file", "file"],
                properties: {
                  project_id: { type: "string" },
                  environment_id: { type: "string" },
                  release: { type: "string" },
                  minified_file: { type: "string" },
                  file: { type: "string", format: "binary" }
                }
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
    "/admin/projects": {
      get: sessionRoute("List projects", "Admin route for listing projects visible to the current operator."),
      post: sessionRoute("Create a project", "Admin route for creating a SignalMonitor project.")
    },
    "/admin/projects/{projectId}/environments": {
      get: sessionRoute("List environments", "Admin route for listing environments under a project."),
      post: sessionRoute("Create an environment", "Admin route for creating an environment under a project.")
    },
    "/admin/projects/{projectId}/api-keys": {
      get: sessionRoute("List ingestion API keys", "Admin route for listing ingestion API key records."),
      post: sessionRoute("Create an ingestion API key", "Admin route that returns the full API key secret one time.")
    },
    "/admin/source-map-upload-tokens": {
      get: sessionRoute("List source-map upload tokens", "Admin route for CI source-map upload tokens."),
      post: sessionRoute("Create a source-map upload token", "Admin route that returns a CI source-map upload token one time.")
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
    "/query/events": {
      get: sessionRoute("Query events", "Read project/environment scoped raw event telemetry.")
    },
    "/query/errors": {
      get: sessionRoute("Query errors", "Read project/environment scoped raw error telemetry.")
    },
    "/query/llm-calls": {
      get: sessionRoute("Query LLM calls", "Read project/environment scoped LLM call telemetry.")
    },
    "/query/traces": {
      get: sessionRoute("Query traces", "Read project/environment scoped trace telemetry.")
    },
    "/system/health": {
      get: sessionRoute("Read system health", "Read API, worker, Postgres, Redis, queue, freshness, retention, and backup status.")
    }
  }
} satisfies OpenApiDocument;
