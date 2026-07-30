import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserWebVitals } from "../src/browser-web-vitals.js";
import type { SignalMonitorClient } from "../src/types.js";

function makeClient(): SignalMonitorClient {
  return {
    track: vi.fn(),
    assignExperiment: vi.fn(),
    evaluateFlag: vi.fn(),
    click: vi.fn(),
    captureError: vi.fn(),
    breadcrumb: vi.fn(),
    llm: vi.fn(),
    trace: vi.fn(),
    startTrace: vi.fn(),
    span: vi.fn(),
    webVital: vi.fn(),
    replay: vi.fn(),
    profile: vi.fn(),
    submitSurvey: vi.fn(),
    feedback: vi.fn(),
    identify: vi.fn(),
    identifyUser: vi.fn(),
    identifyTenant: vi.fn(),
    flush: vi.fn(async () => ({ sent: 0, failed: 0, retained: 0, dropped: 0 })),
    shutdown: vi.fn(async () => ({ sent: 0, failed: 0, retained: 0, dropped: 0 }))
  };
}

describe("installBrowserWebVitals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "PerformanceObserver");
    Reflect.deleteProperty(globalThis, "location");
  });

  it("reports observed paint and layout metrics with route context", () => {
    const observe = vi.fn();
    const callbacks = new Map<string, (list: { getEntries: () => Array<Record<string, unknown>> }) => void>();
    class FakePerformanceObserver {
      private readonly input: (list: { getEntries: () => Array<Record<string, unknown>> }) => void;
      constructor(input: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.input = input;
      }
      observe(options: { type?: string }) {
        observe(options);
        if (options.type) callbacks.set(options.type, this.input);
      }
      disconnect = vi.fn();
    }
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: FakePerformanceObserver
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { pathname: "/dashboard" }
    });

    const client = makeClient();
    const stop = installBrowserWebVitals(client, { flush: true });

    callbacks.get("paint")?.({
      getEntries: () => [{ entryType: "paint", name: "first-contentful-paint", startTime: 1200 }]
    });
    callbacks.get("largest-contentful-paint")?.({
      getEntries: () => [{ entryType: "largest-contentful-paint", startTime: 2400 }]
    });
    callbacks.get("layout-shift")?.({
      getEntries: () => [
        { entryType: "layout-shift", value: 0.08, hadRecentInput: false }
      ]
    });

    expect(client.webVital).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FCP", value: 1200, rating: "good", route: "/dashboard" }),
      undefined
    );
    expect(client.webVital).toHaveBeenCalledWith(
      expect.objectContaining({ name: "LCP", value: 2400, rating: "good", route: "/dashboard" }),
      undefined
    );
    expect(client.webVital).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CLS", value: 0.08, rating: "good", route: "/dashboard" }),
      undefined
    );
    expect(client.flush).toHaveBeenCalled();

    stop();
    callbacks.get("paint")?.({ getEntries: () => [{ entryType: "paint", name: "first-contentful-paint", startTime: 1300 }] });
    expect(client.webVital).toHaveBeenCalledTimes(3);
  });

  it("returns a noop cleanup when PerformanceObserver is unavailable", () => {
    const client = makeClient();
    const stop = installBrowserWebVitals(client);

    expect(stop()).toBeUndefined();
    expect(client.webVital).not.toHaveBeenCalled();
  });
});
