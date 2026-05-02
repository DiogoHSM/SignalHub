import { describe, expect, it } from "vitest";
import {
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
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
      source: "web",
      release: "1.2.3",
      properties: { charts_count: 6 },
      metadata: { plan: "pro" }
    });

    expect(parsed.name).toBe("dashboard_created");
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
});
