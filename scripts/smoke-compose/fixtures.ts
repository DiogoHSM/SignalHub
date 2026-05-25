export type SmokePayloads = ReturnType<typeof createSmokePayloads>;

function offsetIso(base: Date, offsetMs: number): string {
  return new Date(base.getTime() + offsetMs).toISOString();
}

export function createSmokePayloads(runId: string, createdAt = new Date()) {
  return {
    event: {
      timestamp: offsetIso(createdAt, -80_000),
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      metadata: { smoke: runId },
      name: `${runId}.account.created`,
      properties: { plan: "trial" }
    },
    error: {
      timestamp: offsetIso(createdAt, -20_000),
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "browser",
      release: `web@${runId}`,
      metadata: { smoke: runId },
      message: "Phase 6B checkout failed",
      type: "Phase6BCheckoutError",
      severity: "error",
      stack: "Phase6BCheckoutError: checkout failed\n    at checkout (https://cdn.example.com/assets/app.min.js:1:5)",
      fingerprint: `${runId}-checkout-error`,
      context: { route: "/checkout" }
    },
    trace: {
      timestamp: offsetIso(createdAt, -50_000),
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      name: `${runId}.checkout`,
      started_at: offsetIso(createdAt, -51_000),
      duration_ms: 2400,
      status: "success"
    },
    span: {
      timestamp: offsetIso(createdAt, -49_000),
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      span_id: `span_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      name: `${runId}.db.query`,
      started_at: offsetIso(createdAt, -49_000),
      duration_ms: 120,
      status: "success"
    },
    llm: {
      timestamp: offsetIso(createdAt, -10_000),
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      provider: "openai",
      model: "gpt-5-mini",
      prompt_name: `${runId}_summary`,
      status: "success",
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
      cost_usd: 0.0042,
      latency_ms: 840
    },
    breadcrumb: {
      timestamp: offsetIso(createdAt, -1_000),
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "browser",
      release: `web@${runId}`,
      type: "custom",
      category: "checkout",
      level: "info",
      message: "Phase 6B selected shipping method",
      data: { method: "standard" }
    }
  };
}

export function sourceMapFixtureContent(): string {
  return JSON.stringify({
    version: 3,
    file: "app.min.js",
    sources: ["src/app.ts"],
    sourcesContent: ["export function checkout() {\n  throw new Error('checkout failed');\n}\n"],
    names: ["checkout"],
    mappings: "AAAA,SAASA,WAAW"
  });
}
