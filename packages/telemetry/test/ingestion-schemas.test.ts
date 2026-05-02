import { describe, expect, it } from "vitest";
import {
  eventPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema
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
});
