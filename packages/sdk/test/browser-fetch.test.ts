import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignalMonitorClient } from "../src/browser.js";

describe("browser fetch transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("delivers signals with a global fetch that requires its global receiver", async () => {
    vi.stubGlobal("fetch", function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(null, { status: 202 }));
    });
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      maxRetries: 0
    });

    client.track("browser_event");
    client.captureError(new Error("browser_error"));

    await expect(client.flush()).resolves.toEqual({ sent: 2, failed: 0, retained: 0, dropped: 0 });
    await expect(client.flush()).resolves.toEqual({ sent: 0, failed: 0, retained: 0, dropped: 0 });
  });

  it("uses a custom transport when global fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const client = createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key",
      maxRetries: 0,
      fetch: async () => new Response(null, { status: 202 })
    });
    client.track("custom_transport");
    await expect(client.flush()).resolves.toEqual({ sent: 1, failed: 0, retained: 0, dropped: 0 });
  });

  it("reports missing fetch at construction", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => createSignalMonitorClient({
      endpoint: "https://api.sigmon.test",
      apiKey: "test_api_key"
    })).toThrow("fetch is required");
  });
});
