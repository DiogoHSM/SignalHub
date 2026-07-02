import { describe, expect, it } from "vitest";
import {
  breadcrumbPayloadSchema,
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  profilePayloadSchema,
  sessionReplayPayloadSchema,
  spanPayloadSchema,
  tenantIdentifyPayloadSchema,
  tracePayloadSchema,
  userIdentifyPayloadSchema,
  webVitalPayloadSchema
} from "../src/ingestion-schemas.js";

describe("ingestion schemas", () => {
  it("accepts a product event payload with shared metadata", () => {
    const parsed = eventPayloadSchema.parse({
      name: "dashboard_created",
      timestamp: "2026-05-02T12:00:00.000Z",
      tenant_id: "tenant_1",
      user_id: "user_1",
      session_id: "session_1",
      trace_id: "trace_1",
      replay_id: "rpl_checkout_1",
      source: "web",
      release: "1.2.3",
      properties: { charts_count: 6 },
      metadata: { plan: "pro" }
    });

    expect(parsed.name).toBe("dashboard_created");
    expect(parsed.replay_id).toBe("rpl_checkout_1");
    expect(parsed.properties.charts_count).toBe(6);
  });

  it("rejects an LLM call without provider", () => {
    expect(() =>
      llmCallPayloadSchema.parse({
        model: "gpt-5.5",
        prompt_name: "generate_sql",
        input_tokens: 1200,
        output_tokens: 300,
        cost_usd: 0.03,
        latency_ms: 8400,
        status: "success"
      })
    ).toThrow();
  });

  it("accepts spans with parent span references", () => {
    const parsed = spanPayloadSchema.parse({
      trace_id: "trace_1",
      parent_span_id: "span_parent",
      name: "ai.generate_sql",
      status: "success",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:02.000Z",
      duration_ms: 2000
    });

    expect(parsed.parent_span_id).toBe("span_parent");
  });

  it("accepts web vitals with route and rating context", () => {
    const parsed = webVitalPayloadSchema.parse({
      name: "LCP",
      value: 2450.5,
      rating: "needs-improvement",
      route: "/dashboard",
      navigation_type: "navigate",
      timestamp: "2026-05-02T12:00:00.000Z",
      source: "browser",
      release: "1.2.3",
      metadata: { browser: "Chrome" }
    });

    expect(parsed.name).toBe("LCP");
    expect(parsed.route).toBe("/dashboard");
    expect(parsed.value).toBe(2450.5);
  });

  it("accepts bounded runtime profile summaries", () => {
    const parsed = profilePayloadSchema.parse({
      name: "POST /api/checkout",
      kind: "cpu",
      runtime: "node",
      service: "api",
      route: "POST /api/checkout",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:01.000Z",
      duration_ms: 1000,
      sample_count: 3,
      top_functions: [
        {
          function_name: "checkout",
          url: "file:///app/checkout.ts",
          line_number: 12,
          self_time_ms: 38,
          sample_count: 3
        }
      ],
      metadata: { service: "api" }
    });

    expect(parsed.kind).toBe("cpu");
    expect(parsed.top_functions[0]?.function_name).toBe("checkout");
  });

  it("rejects runtime profiles without matching measurements", () => {
    expect(() =>
      profilePayloadSchema.parse({
        name: "empty cpu",
        kind: "cpu",
        started_at: "2026-05-02T12:00:00.000Z"
      })
    ).toThrow();

    expect(() =>
      profilePayloadSchema.parse({
        name: "empty memory",
        kind: "memory",
        started_at: "2026-05-02T12:00:00.000Z"
      })
    ).toThrow();
  });

  it("rejects direct high-risk strings that exceed schema limits", () => {
    expect(() =>
      llmCallPayloadSchema.parse({
        provider: "openai",
        model: "gpt-5.5",
        input_preview: "x".repeat(2001)
      })
    ).toThrow();

    expect(() =>
      errorPayloadSchema.parse({
        message: "Database connection failed",
        stack: "x".repeat(20001)
      })
    ).toThrow();
  });

  it("rejects oversized nested JSON strings", () => {
    expect(() =>
      eventPayloadSchema.parse({
        name: "x",
        properties: { huge: "x".repeat(20001) }
      })
    ).toThrow();

    expect(() =>
      errorPayloadSchema.parse({
        message: "m",
        context: { huge: "x".repeat(20001) }
      })
    ).toThrow();

    expect(() =>
      spanPayloadSchema.parse({
        trace_id: "t",
        name: "n",
        started_at: "2026-05-02T12:00:00.000Z",
        input: { huge: "x".repeat(20001) }
      })
    ).toThrow();
  });

  it("rejects negative numeric metrics", () => {
    expect(() =>
      llmCallPayloadSchema.parse({
        provider: "openai",
        model: "gpt-5.5",
        input_tokens: -1
      })
    ).toThrow();

    expect(() =>
      llmCallPayloadSchema.parse({
        provider: "openai",
        model: "gpt-5.5",
        output_tokens: -1
      })
    ).toThrow();

    expect(() =>
      llmCallPayloadSchema.parse({
        provider: "openai",
        model: "gpt-5.5",
        cost_usd: -0.01
      })
    ).toThrow();

    expect(() =>
      llmCallPayloadSchema.parse({
        provider: "openai",
        model: "gpt-5.5",
        latency_ms: -1
      })
    ).toThrow();

    expect(() =>
      spanPayloadSchema.parse({
        trace_id: "trace_1",
        name: "ai.generate_sql",
        started_at: "2026-05-02T12:00:00.000Z",
        cost_usd: -0.01
      })
    ).toThrow();
  });

  it("requires object values for metadata, properties, and context", () => {
    expect(() =>
      eventPayloadSchema.parse({
        name: "dashboard_created",
        metadata: ["not", "an", "object"]
      })
    ).toThrow();

    expect(() =>
      eventPayloadSchema.parse({
        name: "dashboard_created",
        metadata: "not an object"
      })
    ).toThrow();

    expect(() =>
      eventPayloadSchema.parse({
        name: "dashboard_created",
        properties: "not an object"
      })
    ).toThrow();

    expect(() =>
      eventPayloadSchema.parse({
        name: "dashboard_created",
        properties: ["not", "an", "object"]
      })
    ).toThrow();

    expect(() =>
      errorPayloadSchema.parse({
        message: "Database connection failed",
        context: ["not", "an", "object"]
      })
    ).toThrow();

    expect(() =>
      errorPayloadSchema.parse({
        message: "Database connection failed",
        context: "not an object"
      })
    ).toThrow();
  });

  it("applies defaults for optional objects and statuses", () => {
    const event = eventPayloadSchema.parse({ name: "dashboard_created" });
    const error = errorPayloadSchema.parse({ message: "Database connection failed" });
    const llmCall = llmCallPayloadSchema.parse({ provider: "openai", model: "gpt-5.5" });
    const span = spanPayloadSchema.parse({
      trace_id: "trace_1",
      name: "ai.generate_sql",
      started_at: "2026-05-02T12:00:00.000Z"
    });
    const trace = tracePayloadSchema.parse({
      name: "ai.generate_sql",
      started_at: "2026-05-02T12:00:00.000Z"
    });

    expect(event.metadata).toEqual({});
    expect(event.properties).toEqual({});
    expect(error.metadata).toEqual({});
    expect(error.context).toEqual({});
    expect(error.severity).toBe("error");
    expect(llmCall.metadata).toEqual({});
    expect(llmCall.status).toBe("success");
    expect(span.metadata).toEqual({});
    expect(span.status).toBe("pending");
    expect(trace.metadata).toEqual({});
    expect(trace.status).toBe("pending");
  });

  it("accepts fatal error severity", () => {
    const error = errorPayloadSchema.parse({
      message: "Process crashed",
      severity: "fatal"
    });

    expect(error.severity).toBe("fatal");
  });

  it("validates breadcrumb payloads", () => {
    const parsed = breadcrumbPayloadSchema.parse({
      timestamp: "2026-05-11T12:00:00.000Z",
      session_id: "sess_1",
      type: "navigation",
      category: "route",
      message: "Navigated to /checkout",
      data: { from: "/cart", to: "/checkout" }
    });

    expect(parsed.level).toBe("info");
    expect(parsed.metadata).toEqual({});
    expect(parsed.data).toEqual({ from: "/cart", to: "/checkout" });
  });

  it("rejects unsupported breadcrumb types and oversized messages", () => {
    expect(() => breadcrumbPayloadSchema.parse({ type: "dom", message: "bad" })).toThrow();
    expect(() => breadcrumbPayloadSchema.parse({ type: "custom", message: "x".repeat(2001) })).toThrow();
  });

  it("validates privacy-safe session replay payloads", () => {
    const parsed = sessionReplayPayloadSchema.parse({
      replay_id: "rpl_session_1",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:05.000Z",
      duration_ms: 5000,
      route: "/checkout",
      error_id: "err_1",
      events: [
        {
          offset_ms: 250,
          type: "click",
          route: "/checkout",
          selector: '[data-sigmon-id="pay"]',
          x: 0.5,
          y: 0.25,
          data: { masked: true }
        }
      ]
    });

    expect(parsed.masked).toBe(true);
    expect(parsed.events[0]?.message).toBeUndefined();
  });

  it("rejects replay events that include raw input values", () => {
    expect(() =>
      sessionReplayPayloadSchema.parse({
        replay_id: "rpl_session_1",
        started_at: "2026-05-02T12:00:00.000Z",
        events: [
          {
            offset_ms: 0,
            type: "input",
            selector: "input[name=email]",
            value: "person@example.com"
          }
        ]
      })
    ).toThrow();
  });

  it("accepts a user identify payload with traits and envelope fields", () => {
    const parsed = userIdentifyPayloadSchema.parse({
      user_id: "usr_ana",
      tenant_id: "tenant_acme",
      traits: { name: "Ana", plan: "pro" },
      timestamp: "2026-05-25T10:00:00.000Z",
      metadata: { source: "sdk" }
    });

    expect(parsed).toEqual({
      user_id: "usr_ana",
      tenant_id: "tenant_acme",
      traits: { name: "Ana", plan: "pro" },
      timestamp: "2026-05-25T10:00:00.000Z",
      metadata: { source: "sdk" }
    });
  });

  it("accepts a tenant identify payload with traits and timestamp", () => {
    const parsed = tenantIdentifyPayloadSchema.parse({
      tenant_id: "tenant_acme",
      traits: { plan: "enterprise" },
      timestamp: "2026-05-25T10:01:00.000Z"
    });

    expect(parsed).toEqual({
      tenant_id: "tenant_acme",
      traits: { plan: "enterprise" },
      timestamp: "2026-05-25T10:01:00.000Z",
      metadata: {}
    });
  });
});
