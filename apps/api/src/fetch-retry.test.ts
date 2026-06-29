import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeoutAndRetry } from "./fetch-retry.js";

describe("fetchWithTimeoutAndRetry", () => {
  it("retries transient HTTP responses", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithTimeoutAndRetry("https://example.com", {
      attempts: 2,
      retryDelayMs: 0,
      timeoutMs: 1000,
      fetchFn
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("aborts slow requests and retries them", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithTimeoutAndRetry("https://example.com", {
      attempts: 2,
      retryDelayMs: 0,
      timeoutMs: 1,
      fetchFn
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("respects caller cancellation without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn();

    await expect(
      fetchWithTimeoutAndRetry("https://example.com", {
        attempts: 3,
        retryDelayMs: 0,
        timeoutMs: 1000,
        signal: controller.signal,
        fetchFn
      })
    ).rejects.toThrow(/aborted/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
