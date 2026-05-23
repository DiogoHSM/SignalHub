import { describe, expect, it, vi } from "vitest";
import { runShutdownSteps, runSignalShutdown } from "../src/runtime.js";

describe("worker runtime", () => {
  it("runs shutdown steps sequentially", async () => {
    const order: string[] = [];
    await runShutdownSteps(
      [
        { name: "stopBackups", run: async () => order.push("stopBackups") },
        { name: "stopAlerts", run: async () => order.push("stopAlerts") },
        { name: "stopRetention", run: async () => order.push("stopRetention") },
        { name: "stopHeartbeat", run: async () => order.push("stopHeartbeat") },
        { name: "worker.close", run: async () => order.push("worker.close") },
        { name: "connection.quit", run: async () => order.push("connection.quit") },
        { name: "db.destroy", run: async () => order.push("db.destroy") }
      ],
      1000
    );

    expect(order).toEqual([
      "stopBackups",
      "stopAlerts",
      "stopRetention",
      "stopHeartbeat",
      "worker.close",
      "connection.quit",
      "db.destroy"
    ]);
  });

  it("logs signal shutdown failures and exits zero", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const exit = vi.fn();

    await runSignalShutdown({
      shutdown: async () => {
        throw new Error("shutdown failed");
      },
      logger,
      failureMessage: "Telemetry worker shutdown failed",
      exit
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
