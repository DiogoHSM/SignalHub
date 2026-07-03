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
          error: { type: "string" },
          hint: {
            type: "string",
            description: "Optional actionable setup guidance returned by ingestion endpoints for common integration failures."
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
            description: "Optional per-project retention windows in days. Scoped windows can shorten installation-level retention.",
            additionalProperties: { type: "integer", minimum: 1, maximum: 3650 },
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
          datasets: { type: "array", items: { type: "string", enum: ["events", "errors", "traces", "llmCalls"] } },
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
          "Privacy-safe browser session timeline linked to errors through replay_id. This is not video replay and must not include screenshots, DOM snapshots, raw text, input values, passwords, cookies, or HTML.",
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
            items: {
              type: "object",
              required: ["offset_ms", "type"],
              properties: {
                offset_ms: { type: "integer", minimum: 0 },
                type: { type: "string", enum: ["navigation", "click", "submit", "error", "custom"] },
                route: { type: "string" },
                selector: { type: "string", description: "Stable safe selector, preferably based on data-sigmon-id." },
                message: { type: "string", description: "Short sanitized message." },
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                data: { type: "object", additionalProperties: true }
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
          action: { type: "string", enum: ["doctor", "backup", "retention"] },
          status: { type: "string", enum: ["success", "skipped"] },
          message: { type: "string" },
          ran: { type: "boolean" },
          skipped: { type: "boolean" },
          generatedAt: { type: "string", format: "date-time" }
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
        replay_id: "rpl_browser_123",
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
        description: "Read retention windows and sensitive property rules for a project/environment.",
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
        description: "Configure project/environment retention windows and property mask/block rules.",
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
                    additionalProperties: { type: "integer", minimum: 1, maximum: 3650 },
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
                  datasets: { type: "array", items: { type: "string", enum: ["events", "errors", "traces", "llmCalls"] } },
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
                  datasets: { type: "array", items: { type: "string", enum: ["events", "errors", "traces", "llmCalls"] } },
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
    "/query/overview": {
      get: sessionRoute(
        "Query project overview",
        "Read operational overview rollups for one project environment. Query with project_id, environment_id, window=24h|7d|30d, and optional release for exact deploy-version filtering."
      )
    },
    "/query/releases": {
      get: sessionRoute(
        "Query releases",
        "List recently observed release values for one project environment, derived from events, errors, traces, and LLM calls. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/events/properties": {
      get: sessionRoute(
        "Query event property catalog",
        "Read observed custom event properties for a project environment, including frequency, event coverage, inferred JSON types, safe sample values, type conflicts, and similar property-name groups. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/events/funnel": {
      get: sessionRoute(
        "Query event conversion funnel",
        "Analyze ordered event-step conversion for a project environment. Query with project_id, environment_id, window=24h|7d|30d, steps as a comma-separated list of 2+ event names, and optional limit for sample actors."
      )
    },
    "/query/experiments/{id}/results": {
      get: sessionRoute(
        "Query experiment results",
        "Read A/B experiment conversion results by variant. Query with project_id, environment_id, window=24h|7d|30d, and optional limit. Results are derived from exposure and conversion events that include experiment_key and variant properties."
      )
    },
    "/query/events/retention": {
      get: sessionRoute(
        "Query event retention curves",
        "Analyze retention cohorts for a project environment. Query with project_id, environment_id, window=24h|7d|30d, entry_event, return_event, optional period=daily|weekly|monthly, and optional intervals=2..12."
      )
    },
    "/query/events/click-map": {
      get: sessionRoute(
        "Query event click maps",
        "Aggregate opt-in browser click samples by route, safe selector, and grid bucket. Query with project_id, environment_id, route, window=24h|7d|30d, optional selector, tenant_id, user_id, session_id, grid_size=10..100, and limit."
      )
    },
    "/query/replays": {
      get: sessionRoute(
        "Query session replay samples",
        "List privacy-safe replay samples for a project environment. Supports saved segment filtering with segment_id plus tenant_id, user_id, event_name, and limit. Results include user, tenant, route, timestamp, and linked event/error context for cohort replay investigation."
      )
    },
    "/query/replays/{replayId}": {
      get: sessionRoute(
        "Query session replay detail",
        "Read one privacy-safe replay timeline and its linked product event markers. Query with project_id and environment_id; replayId is the path parameter from event or error detail."
      )
    },
    "/query/errors": {
      get: sessionRoute("Query errors", "Read project/environment scoped raw error telemetry.")
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
          "404": { description: "Code integration not found" },
          "503": { $ref: "#/components/responses/Unavailable" }
        }
      }
    },
    "/query/llm-calls": {
      get: sessionRoute("Query LLM calls", "Read project/environment scoped LLM call telemetry.")
    },
    "/query/traces": {
      get: sessionRoute(
        "Query traces",
        "Read project/environment scoped trace telemetry. Supports trace drilldown filters such as trace_id, trace_name, status, tenant_id, user_id, session_id, from, to, limit, and cursor."
      )
    },
    "/query/apm/endpoints": {
      get: sessionRoute(
        "Query APM endpoints",
        "Read endpoint-level APM rollups for a project environment, including throughput, errors, error rate, p50/p95/p99 latency, average latency, Apdex, and last seen timestamp. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/apm/service-map": {
      get: sessionRoute(
        "Query APM service map",
        "Read span-derived service dependency edges for a project environment, including source, target, dependency type, span count, distinct trace count, errors, error rate, average latency, p95 latency, and last seen timestamp. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/apm/web-vitals": {
      get: sessionRoute(
        "Query APM Web Vitals",
        "Read browser Web Vital rollups for a project environment, including p75 by metric and route, sample counts, rating counts, latest release p75, previous release p75, and regression percent. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/query/apm/profiles": {
      get: sessionRoute(
        "Query APM runtime profiles",
        "Read runtime CPU and memory profile rollups for a project environment, including profile counts, CPU/memory totals, recent profiles, and hot functions. Query with project_id, environment_id, window=24h|7d|30d, and optional limit."
      )
    },
    "/system/health": {
      get: sessionRoute("Read system health", "Read API, worker, Postgres, Redis, queue, freshness, retention, and backup status.")
    },
    "/system/actions/doctor": {
      post: systemActionOperation(
        "Run system doctor",
        "Admin-only read-only self-check that evaluates the current SignalMonitor installation health and returns an operator summary."
      )
    },
    "/system/actions/backup": {
      post: systemActionOperation(
        "Trigger manual backup",
        "Admin-only action that runs the same backup workflow used by the scheduler, guarded by the backup advisory lock."
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
