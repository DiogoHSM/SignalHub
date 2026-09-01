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

  it("rejects metadata before Zod traverses more than eight containers", () => {
    let value: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 9; depth += 1) value = { child: value };
    const result = eventPayloadSchema.safeParse({ name: "deep", metadata: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("8 container levels");
    }
  });

  it("rejects arrays wider than 512 items", () => {
    const result = eventPayloadSchema.safeParse({ name: "wide", metadata: { values: Array(513).fill(1) } });
    expect(result.success).toBe(false);
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

  it.each([
    "person@example.com entered the checkout form",
    "Cookie: session=raw-cookie-value",
    "Authorization: Bearer raw-access-token",
    "The customer typed private free-form text"
  ])("redacts replay event message text instead of preserving %s", (message) => {
    const parsed = sessionReplayPayloadSchema.parse({
      replay_id: "rpl_redacted_message",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [{ offset_ms: 0, type: "console", message }]
    });

    expect(parsed.events[0]?.message).toBe("[REDACTED]");
    expect(JSON.stringify(parsed)).not.toContain(message);
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

  it("rejects replay payloads above the 64 KiB UTF-8 budget", () => {
    const multibyteChunk = "é".repeat(9_000);

    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_oversized",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [
        {
          offset_ms: 0,
          type: "custom",
          data: {
            first: multibyteChunk,
            second: multibyteChunk,
            third: multibyteChunk,
            fourth: multibyteChunk
          }
        }
      ]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: [],
            message: "Session replay payload must not exceed 64 KiB"
          })
        ])
      );
    }
  });

  it("measures the replay HTTP payload before unknown fields are stripped", () => {
    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_unknown_oversized",
      started_at: "2026-05-02T12:00:00.000Z",
      ignored_blob: "x".repeat(66_000)
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: [],
            message: "Session replay payload must not exceed 64 KiB"
          })
        ])
      );
    }
  });

  it("accepts multibyte replay payloads within the 64 KiB UTF-8 budget", () => {
    const multibyteChunk = "é".repeat(7_000);

    expect(() =>
      sessionReplayPayloadSchema.parse({
        replay_id: "rpl_within_budget",
        started_at: "2026-05-02T12:00:00.000Z",
        events: [
          {
            offset_ms: 0,
            type: "custom",
            data: {
              first: multibyteChunk,
              second: multibyteChunk,
              third: multibyteChunk,
              fourth: multibyteChunk
            }
          }
        ]
      })
    ).not.toThrow();
  });

  it("preserves the existing 300-event replay limit", () => {
    expect(() =>
      sessionReplayPayloadSchema.parse({
        replay_id: "rpl_too_many_events",
        started_at: "2026-05-02T12:00:00.000Z",
        events: Array.from({ length: 301 }, (_, offset_ms) => ({
          offset_ms,
          type: "custom"
        }))
      })
    ).toThrow();
  });

  it("rejects replay event data deeper than five container levels", () => {
    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_deep",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [
        {
          offset_ms: 0,
          type: "custom",
          data: { one: { two: { three: { four: { five: { six: true } } } } } }
        }
      ]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["events", 0, "data"],
            message: "Replay event data must not exceed 5 container levels"
          })
        ])
      );
    }
  });

  it("rejects extremely deep replay data without overflowing the parser stack", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 6_000; depth += 1) {
      const nested: Record<string, unknown> = {};
      cursor.next = nested;
      cursor = nested;
    }

    expect(() =>
      sessionReplayPayloadSchema.safeParse({
        replay_id: "rpl_extremely_deep",
        started_at: "2026-05-02T12:00:00.000Z",
        events: [{ offset_ms: 0, type: "custom", data: root }]
      })
    ).not.toThrow();

    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_extremely_deep",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [{ offset_ms: 0, type: "custom", data: root }]
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["events", 0, "data"],
            message: "Replay event data must not exceed 5 container levels"
          })
        ])
      );
    }
  });

  it.each([
    {
      name: "object",
      createData: () => {
        const data: Record<string, unknown> = {};
        data.self = data;
        return data;
      },
      path: ["events", 0, "data", "self"]
    },
    {
      name: "array",
      createData: () => {
        const items: unknown[] = [];
        items.push(items);
        return { items };
      },
      path: ["events", 0, "data", "items", 0]
    }
  ])("rejects cyclic replay $name data deterministically without hanging", ({ createData, path }) => {
    const parse = () =>
      sessionReplayPayloadSchema.safeParse({
        replay_id: "rpl_cyclic",
        started_at: "2026-05-02T12:00:00.000Z",
        events: [{ offset_ms: 0, type: "custom", data: createData() }]
      });

    expect(parse).not.toThrow();
    const first = parse();
    const second = parse();
    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
    if (!first.success && !second.success) {
      const expectedIssue = expect.objectContaining({
        path,
        message: "Replay event data must not contain cyclic references"
      });
      expect(first.error.issues).toEqual(expect.arrayContaining([expectedIssue]));
      expect(second.error.issues).toEqual(expect.arrayContaining([expectedIssue]));
    }
  });

  it("rejects replay event data with more than 64 object keys", () => {
    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_wide",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [
        {
          offset_ms: 0,
          type: "custom",
          data: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key_${index}`, index]))
        }
      ]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["events", 0, "data"],
            message: "Replay event data must not exceed 64 object keys"
          })
        ])
      );
    }
  });

  it.each(["password", "Password", "INNERHTML"])("rejects nested sensitive replay key %s", (key) => {
    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_nested_secret",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [{ offset_ms: 0, type: "custom", data: { nested: { [key]: "secret" } } }]
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown replay event fields instead of letting them bypass data bounds", () => {
    const result = sessionReplayPayloadSchema.safeParse({
      replay_id: "rpl_extra_deep",
      started_at: "2026-05-02T12:00:00.000Z",
      events: [{ offset_ms: 0, type: "custom", extra: { one: { two: { three: { four: { five: { six: true } } } } } } }]
    });

    expect(result.success).toBe(false);
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
