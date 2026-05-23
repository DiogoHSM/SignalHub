import { describe, expect, it } from "vitest";
import { runShutdownSteps } from "../src/runtime.js";

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
});
