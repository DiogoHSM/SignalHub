import { describe, expect, it, vi } from "vitest";
import { listenWithCleanup, runShutdownSteps } from "../src/runtime.js";

describe("API runtime", () => {
  it("runs shutdown steps sequentially", async () => {
    const order: string[] = [];
    await runShutdownSteps(
      [
        { name: "app.close", run: async () => order.push("app") },
        { name: "queue.close", run: async () => order.push("queue") },
        { name: "redis.quit", run: async () => order.push("redis") },
        { name: "db.destroy", run: async () => order.push("db") }
      ],
      1000
    );

    expect(order).toEqual(["app", "queue", "redis", "db"]);
  });

  it("cleans up resources when listen fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(
      listenWithCleanup({
        listen: async () => {
          throw new Error("EADDRINUSE");
        },
        cleanup,
        logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      })
    ).rejects.toThrow("EADDRINUSE");

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("continues shutdown after a failed step and throws an aggregate error", async () => {
    const order: string[] = [];
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await expect(
      runShutdownSteps(
        [
          {
            name: "app.close",
            run: async () => {
              order.push("app");
              throw new Error("close failed");
            }
          },
          { name: "queue.close", run: async () => order.push("queue") }
        ],
        1000,
        logger
      )
    ).rejects.toThrow(AggregateError);

    expect(order).toEqual(["app", "queue"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
