import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignalMonitorClient } from "../src/index.js";
import type { SignalMonitorError } from "../src/types.js";

const response = (status: number): Response => new Response(null, { status });

function decodeBody(call: Parameters<typeof fetch>): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

describe("createSignalMonitorClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects missing endpoint and missing api key", () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));

    expect(() =>
      createSignalMonitorClient({ endpoint: "", apiKey: "test_api_key", fetch: fetchImpl })
    ).toThrow("endpoint is required");

    expect(() =>
      createSignalMonitorClient({ endpoint: "https://api.sigmon.test", apiKey: "", fetch: fetchImpl })
    ).toThrow("apiKey is required");
  });

  it("track enqueues an event and flush sends it to the normalized endpoint with default context", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test///",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0,
      defaultContext: {
        tenantId: "tenant_1",
        userId: "user_1",
        metadata: { plan: "pro" }
      }
    });

    client.track("dashboard_created", { charts_count: 3 });

    await expect(client.flush()).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 0
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.sigmon.test/v1/events", {
      method: "POST",
      headers: {
        authorization: "Bearer test_api_key",
        "content-type": "application/json"
      },
      body: expect.any(String),
      signal: expect.any(AbortSignal)
    });
    expect(decodeBody(fetchImpl.mock.calls[0])).toEqual({
      name: "dashboard_created",
      properties: { charts_count: 3 },
      tenant_id: "tenant_1",
      user_id: "user_1",
      metadata: { plan: "pro" }
    });
  });

  it("retains retryable failures by default and discards them when requested", async () => {
    const onError = vi.fn<(error: SignalMonitorError) => void>();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(503));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0,
      onError
    });

    client.track("first");

    await expect(client.flush()).resolves.toEqual({
      sent: 0,
      failed: 1,
      retained: 1,
      dropped: 0
    });

    await expect(client.flush({ discardOnFailure: true })).resolves.toEqual({
      sent: 0,
      failed: 1,
      retained: 0,
      dropped: 0
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith({
      code: "transient_failure",
      message: "Signal delivery failed with a retryable error",
      status: 503,
      endpoint: "https://api.sigmon.test/v1/events"
    });
  });

  it("removes permanent failures and reports status and endpoint", async () => {
    const onError = vi.fn<(error: SignalMonitorError) => void>();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(401));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0,
      onError
    });

    client.track("unauthorized");

    await expect(client.flush()).resolves.toEqual({
      sent: 0,
      failed: 1,
      retained: 0,
      dropped: 0
    });
    await expect(client.flush()).resolves.toEqual({
      sent: 0,
      failed: 0,
      retained: 0,
      dropped: 0
    });

    expect(onError).toHaveBeenCalledWith({
      code: "permanent_failure",
      message: "Signal delivery failed with a permanent error",
      status: 401,
      endpoint: "https://api.sigmon.test/v1/events"
    });
  });

  it("does not reject flush or lose accounting when permanent failure onError throws", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(401));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0,
      onError: () => {
        throw new Error("observer failed");
      }
    });

    client.track("unauthorized");

    await expect(client.flush()).resolves.toEqual({
      sent: 0,
      failed: 1,
      retained: 0,
      dropped: 0
    });
  });

  it("reports queue overflow and includes the dropped count in flush results", async () => {
    const onError = vi.fn<(error: SignalMonitorError) => void>();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxQueueSize: 1,
      maxRetries: 0,
      onError
    });

    client.track("first");
    client.track("second");

    expect(onError).toHaveBeenCalledWith({
      code: "queue_overflow",
      message: "Signal queue capacity exceeded"
    });
    await expect(client.flush()).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 1
    });
    expect(decodeBody(fetchImpl.mock.calls[0])).toMatchObject({ name: "second" });
  });

  it("does not throw from track when queue overflow onError throws", () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxQueueSize: 1,
      maxRetries: 0,
      onError: () => {
        throw new Error("observer failed");
      }
    });

    client.track("first");

    expect(() => client.track("second")).not.toThrow();
  });

  it("drops oversized payloads before enqueue, avoids fetch, and reports payload_too_large", async () => {
    const onError = vi.fn<(error: SignalMonitorError) => void>();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxSerializedPayloadBytes: 10,
      maxRetries: 0,
      onError
    });

    client.track("oversized", { value: "this string is too large" });

    await expect(client.flush()).resolves.toEqual({
      sent: 0,
      failed: 0,
      retained: 0,
      dropped: 1
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({
      code: "payload_too_large",
      message: "Signal payload exceeds the configured size limit"
    });
  });

  it("identify updates default context and shallow-merges metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0,
      defaultContext: {
        tenantId: "tenant_1",
        userId: "user_old",
        metadata: { plan: "free", region: "us" }
      }
    });

    client.identify({
      userId: "user_new",
      metadata: { plan: "pro", request_id: "req_1" }
    });
    client.track("identified");
    await client.flush();

    expect(decodeBody(fetchImpl.mock.calls[0])).toMatchObject({
      tenant_id: "tenant_1",
      user_id: "user_new",
      metadata: { plan: "pro", region: "us", request_id: "req_1" }
    });
  });

  it("startTrace returns a helper that enqueues a successful trace on end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0
    });

    const activeTrace = client.startTrace("ai.generate_sql", { traceId: "trace_supplied" });
    vi.setSystemTime(new Date("2026-05-02T12:00:02.500Z"));
    activeTrace.end();
    await client.flush();

    expect(activeTrace.traceId).toBe("trace_supplied");
    expect(activeTrace.startedAt).toEqual(new Date("2026-05-02T12:00:00.000Z"));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.sigmon.test/v1/traces",
      expect.objectContaining({ body: expect.any(String) })
    );
    expect(decodeBody(fetchImpl.mock.calls[0])).toMatchObject({
      name: "ai.generate_sql",
      status: "success",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:02.500Z",
      duration_ms: 2500,
      trace_id: "trace_supplied"
    });
  });

  it("startTrace end preserves typed trace defaults from start input", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0
    });

    client
      .startTrace("ai.generate_sql", {
        status: "pending",
        durationMs: 123,
        timestamp: "2026-05-02T12:00:00.000Z"
      })
      .end();
    await client.flush();

    expect(decodeBody(fetchImpl.mock.calls[0])).toMatchObject({
      name: "ai.generate_sql",
      status: "pending",
      duration_ms: 123,
      timestamp: "2026-05-02T12:00:00.000Z"
    });
  });

  it("shutdown flushes pending items directly and stops interval flushing", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      flushIntervalMs: 10,
      maxRetries: 0
    });

    client.track("shutdown_sent");

    await expect(client.shutdown()).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 0
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(decodeBody(fetchImpl.mock.calls[0])).toMatchObject({ name: "shutdown_sent" });

    client.track("after_shutdown");
    await vi.advanceTimersByTimeAsync(30);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(client.flush()).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 0
    });
  });

  it("shutdown waits for an in-flight flush and drains items queued during it", async () => {
    let resolveFirstFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          })
      )
      .mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      flushIntervalMs: 10,
      maxRetries: 0
    });

    client.track("first");
    const flushPromise = client.flush();
    client.track("second");

    const shutdownPromise = client.shutdown();
    let shutdownResolved = false;
    void shutdownPromise.then(() => {
      shutdownResolved = true;
    });

    await Promise.resolve();
    expect(shutdownResolved).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirstFetch(response(202));

    await expect(shutdownPromise).resolves.toEqual({
      sent: 2,
      failed: 0,
      retained: 0,
      dropped: 0
    });
    await expect(flushPromise).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 0
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map((call) => decodeBody(call).name)).toEqual(["first", "second"]);
  });

  it("captureError, llm, trace, and span enqueue to their endpoint paths", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0
    });

    client.captureError(new Error("broken"));
    client.llm({ provider: "openai", model: "gpt-5", status: "success" });
    client.trace({ name: "workflow", status: "success" });
    client.span({ traceId: "trace_1", name: "step", status: "success" });

    await client.flush();

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://api.sigmon.test/v1/errors",
      "https://api.sigmon.test/v1/llm",
      "https://api.sigmon.test/v1/traces",
      "https://api.sigmon.test/v1/spans"
    ]);
  });

  it("queues manual breadcrumbs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl,
      defaultContext: { sessionId: "sess_1" },
      maxRetries: 0
    });

    client.breadcrumb({ type: "custom", message: "Opened checkout" });
    await client.flush();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sigmon.example.com/v1/breadcrumbs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"session_id":"sess_1"')
      })
    );
    expect(decodeBody(fetchImpl.mock.calls[0])).toMatchObject({
      type: "custom",
      message: "Opened checkout",
      session_id: "sess_1",
      data: {}
    });
  });

  it("shares overlapping flush calls with the in-flight promise and avoids duplicate sends", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0
    });

    client.track("one");
    const firstFlush = client.flush();
    const secondFlush = client.flush();

    expect(secondFlush).toBe(firstFlush);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch(response(202));

    await expect(firstFlush).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 0
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("flush waits for an active flush and drains items queued during it", async () => {
    let resolveFirstFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          })
      )
      .mockResolvedValue(response(202));
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      fetch: fetchImpl,
      maxRetries: 0
    });

    client.track("first");
    const firstFlush = client.flush();
    client.track("second");
    const secondFlush = client.flush();

    expect(secondFlush).not.toBe(firstFlush);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirstFetch(response(202));

    await expect(secondFlush).resolves.toEqual({
      sent: 2,
      failed: 0,
      retained: 0,
      dropped: 0
    });
    await expect(firstFlush).resolves.toEqual({
      sent: 1,
      failed: 0,
      retained: 0,
      dropped: 0
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map((call) => decodeBody(call).name)).toEqual(["first", "second"]);
  });
});
