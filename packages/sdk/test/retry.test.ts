import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStatus, createRetryDelay, sendSignal } from "../src/retry.js";
import type { QueuedSignal } from "../src/types.js";

const signal: QueuedSignal = {
  kind: "event",
  endpointPath: "/v1/events",
  payload: { name: "dashboard_created", properties: { charts_count: 3 } }
};

const response = (status: number): Response => new Response(null, { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retry status classification", () => {
  it("classifies 2xx statuses as success", () => {
    expect(classifyStatus(200)).toBe("success");
    expect(classifyStatus(202)).toBe("success");
    expect(classifyStatus(299)).toBe("success");
  });

  it("classifies transient statuses as retryable", () => {
    expect(classifyStatus(408)).toBe("retryable");
    expect(classifyStatus(429)).toBe("retryable");
    expect(classifyStatus(500)).toBe("retryable");
    expect(classifyStatus(503)).toBe("retryable");
  });

  it("classifies non-retryable 4xx statuses as permanent", () => {
    expect(classifyStatus(400)).toBe("permanent");
    expect(classifyStatus(401)).toBe("permanent");
    expect(classifyStatus(403)).toBe("permanent");
    expect(classifyStatus(404)).toBe("permanent");
    expect(classifyStatus(422)).toBe("permanent");
  });
});

describe("createRetryDelay", () => {
  it("uses exponential backoff for normal attempts", () => {
    expect(createRetryDelay(0, 250)).toBe(250);
    expect(createRetryDelay(1, 250)).toBe(500);
    expect(createRetryDelay(2, 250)).toBe(1000);
  });

  it("caps extreme delays and normalizes invalid input", () => {
    expect(createRetryDelay(20, 250)).toBe(30_000);
    expect(createRetryDelay(-1, 250)).toBe(250);
    expect(createRetryDelay(1.9, 250)).toBe(500);
    expect(createRetryDelay(Number.NaN, 250)).toBe(250);
    expect(createRetryDelay(Number.POSITIVE_INFINITY, 250)).toBe(250);
    expect(createRetryDelay(2, -250)).toBe(0);
    expect(createRetryDelay(2, Number.NaN)).toBe(0);
    expect(createRetryDelay(2, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("sendSignal", () => {
  it("sends a POST request to the normalized endpoint with JSON payload and abort signal", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test/",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: true, status: 202 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.signalhub.test/v1/events", {
      method: "POST",
      headers: {
        authorization: "Bearer test_api_key",
        "content-type": "application/json"
      },
      body: JSON.stringify(signal.payload),
      signal: expect.any(AbortSignal)
    });
  });

  it("sends without a signal when AbortController is unavailable", async () => {
    vi.stubGlobal("AbortController", undefined);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(202));

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: true, status: 202 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("signal");
  });

  it("retries transient failures and returns success when a later attempt succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(503))
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce(response(202));

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: true, status: 202 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(401));

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: false, retryable: false, status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats infinite max retries as zero and attempts once", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(503));

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: Number.POSITIVE_INFINITY,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: false, retryable: true, status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats negative max retries as zero and attempts once", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(503));

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: -1,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: false, retryable: true, status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("clamps large finite max retries to a hard cap", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => {
      attempts += 1;
      return Promise.resolve(attempts > 11 ? response(400) : response(503));
    });

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1000,
      maxRetries: 1_000_000,
      retryBaseDelayMs: 0,
      signal
    });

    expect(result).toEqual({ ok: false, retryable: true, status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  it("treats timeout-triggered abort as retryable", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError), { once: true });
      });
    });

    const result = await sendSignal({
      endpoint: "https://api.signalhub.test",
      apiKey: "test_api_key",
      fetchImpl,
      requestTimeoutMs: 1,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      signal
    });

    expect(result).toEqual({ ok: false, retryable: true, error: abortError });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
