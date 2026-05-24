type OpenApiDocument = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
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
    description:
      "Self-hosted telemetry API for product events, errors, breadcrumbs, LLM calls, traces, spans, source maps, and operator workflows."
  },
  servers: [{ url: "https://my.sigmon.app", description: "Production" }],
  tags: [
    { name: "Health", description: "Public service health and readiness checks." },
    { name: "Ingestion", description: "API-key authenticated telemetry ingestion endpoints." },
    { name: "Source maps", description: "CI source-map uploads with dedicated source-map upload tokens." },
    { name: "Auth", description: "Human session login and session management." },
    { name: "Session authenticated", description: "Admin, query, alert, and system routes that require a human session cookie." }
  ],
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
        properties: {
          name: { type: "string", examples: ["checkout.started"] },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string", examples: ["web"] },
          release: { type: "string", examples: ["2026.05.24"] },
          properties: { type: "object", additionalProperties: true },
          metadata: { type: "object", additionalProperties: true },
          timestamp: { type: "string", format: "date-time" }
        }
      },
      ErrorPayload: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string" },
          type: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "error", "critical", "fatal"] },
          fingerprint: { type: "string" },
          stack: { type: "string" },
          tenant_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          trace_id: { type: "string" },
          source: { type: "string" },
          release: { type: "string" },
          context: { type: "object", additionalProperties: true },
          metadata: { type: "object", additionalProperties: true },
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
      LoginPayload: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" }
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
      post: ingestionOperation("Ingest an event", "Track product or business events.", "EventPayload", {
        name: "checkout.started",
        properties: { plan: "team" }
      })
    },
    "/v1/errors": {
      post: ingestionOperation("Ingest an error", "Track exceptions, crashes, and grouped error occurrences.", "ErrorPayload", {
        message: "Payment provider timeout",
        type: "PaymentTimeoutError",
        severity: "error"
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
