import { describe, expect, it, vi } from "vitest";
import { createSignalMonitorClient, installNodeErrorCapture } from "../src/node.js";

type Listener = (...args: unknown[]) => void;

function createProcessMock() {
  const listeners: Partial<Record<"uncaughtException" | "unhandledRejection", Listener>> = {};
  const on = vi.fn((event: "uncaughtException" | "unhandledRejection", listener: Listener) => {
    listeners[event] = listener;
  });
  const off = vi.fn((event: "uncaughtException" | "unhandledRejection", listener: Listener) => {
    if (listeners[event] === listener) {
      delete listeners[event];
    }
  });

  return { listeners, process: { on, off } };
}

describe("Node.js SDK helpers", () => {
  it("captures uncaught exceptions and unhandled rejections with runtime mechanism context", async () => {
    const { listeners, process } = createProcessMock();
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl
    });
    const stop = installNodeErrorCapture(client, {
      flush: true,
      process,
      context: {
        tenantId: "tenant_1",
        metadata: { service: "worker" }
      }
    });

    listeners.uncaughtException?.(new Error("worker exploded"));
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    listeners.unhandledRejection?.(new Error("job rejected"));
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    expect(calls[0].body).toMatchObject({
      message: "worker exploded",
      severity: "fatal",
      source: "node",
      tenant_id: "tenant_1",
      metadata: { service: "worker" },
      context: {
        service: "worker",
        mechanism: "node.uncaughtException",
        handled: false
      }
    });
    expect(calls[1].body).toMatchObject({
      message: "job rejected",
      severity: "fatal",
      context: {
        mechanism: "node.unhandledRejection",
        handled: false
      }
    });

    stop();

    expect(process.off).toHaveBeenCalledWith("uncaughtException", expect.any(Function));
    expect(process.off).toHaveBeenCalledWith("unhandledRejection", expect.any(Function));
  });

  it("can install only unhandled rejection capture", () => {
    const { listeners, process } = createProcessMock();
    const client = createSignalMonitorClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: vi.fn()
    });

    installNodeErrorCapture(client, {
      process,
      captureUncaughtExceptions: false,
      captureUnhandledRejections: true
    });

    expect(listeners.uncaughtException).toBeUndefined();
    expect(listeners.unhandledRejection).toBeTypeOf("function");
  });
});
