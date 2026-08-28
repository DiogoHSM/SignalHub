import { describe, expect, it, vi } from "vitest";
import { startHeartbeatDriver } from "./heartbeat-driver.js";

describe("startHeartbeatDriver", () => {
  it("calls the heartbeat check-in endpoint with a bearer secret when not in an outage window", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    let tick: () => void = () => {};
    const setIntervalImpl = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });

    startHeartbeatDriver({
      endpoint: "https://sigmon.example.com",
      monitorId: "mon_123",
      monitorSecret: "secret_abc",
      intervalMs: 60_000,
      isInOutageWindow: () => false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: vi.fn()
    });

    tick();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sigmon.example.com/v1/heartbeats/mon_123",
      expect.objectContaining({ method: "POST", headers: { authorization: "Bearer secret_abc" } })
    );
  });

  it("skips the check-in call while inside an outage window", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    let tick: () => void = () => {};
    const setIntervalImpl = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });

    startHeartbeatDriver({
      endpoint: "https://sigmon.example.com",
      monitorId: "mon_123",
      monitorSecret: "secret_abc",
      intervalMs: 60_000,
      isInOutageWindow: () => true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: vi.fn()
    });

    tick();
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stop() clears the interval", () => {
    const clearIntervalImpl = vi.fn();
    const setIntervalImpl = vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>);

    const driver = startHeartbeatDriver({
      endpoint: "https://sigmon.example.com",
      monitorId: "mon_123",
      monitorSecret: "secret_abc",
      intervalMs: 60_000,
      isInOutageWindow: () => false,
      fetchImpl: vi.fn(async () => new Response(null)) as unknown as typeof fetch,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: clearIntervalImpl as unknown as typeof clearInterval
    });

    driver.stop();

    expect(clearIntervalImpl).toHaveBeenCalledWith(42);
  });
});
