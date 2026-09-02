import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { Redis } from "ioredis";
import {
  createMaintenanceQueue,
  enqueueBackupCreation,
  type MaintenanceJob
} from "../src/maintenance-queue.js";

let container: Awaited<ReturnType<GenericContainer["start"]>>;
let redisUrl: string;

describe("maintenance queue", () => {
  beforeAll(async () => {
    container = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start();
    redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  }, 60_000);

  afterAll(async () => {
    await container?.stop();
  }, 30_000);

  it("deduplicates backup requests within one UTC minute and keeps the job payload minimal", async () => {
    const queue = createMaintenanceQueue(redisUrl);
    const firstPayload: MaintenanceJob = {
      kind: "backup.create",
      requestedBy: "usr_1",
      requestedAt: "2026-09-01T12:34:01.000Z"
    };

    try {
      const first = await enqueueBackupCreation(queue, firstPayload);
      const duplicate = await enqueueBackupCreation(queue, {
        ...firstPayload,
        requestedAt: "2026-09-01T12:34:59.999Z"
      });
      const nextMinute = await enqueueBackupCreation(queue, {
        ...firstPayload,
        requestedAt: "2026-09-01T12:35:00.000Z"
      });

      expect(first.id).toBe("backup-create-20260901T1234Z");
      expect(duplicate.id).toBe("backup-create-20260901T1234Z");
      expect(nextMinute.id).toBe("backup-create-20260901T1235Z");
      expect(first.id).not.toContain(":");
      expect(await queue.count()).toBe(2);
      expect(first.data).toEqual(firstPayload);
      expect(first.opts).toMatchObject({
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000
      });
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it("fails a disconnected request finitely and reconnects for a later request", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address) {
          server.close((error) => (error ? reject(error) : resolve(address.port)));
        } else {
          reject(new Error("test_port_unavailable"));
        }
      });
    });
    const queue = createMaintenanceQueue(`redis://127.0.0.1:${port}`);
    queue.on("error", () => undefined);
    const startedAt = Date.now();
    let recoveryContainer: Awaited<ReturnType<GenericContainer["start"]>> | undefined;

    try {
      await expect(
        enqueueBackupCreation(queue, {
          kind: "backup.create",
          requestedBy: "usr_1",
          requestedAt: "2026-09-01T12:34:01.000Z"
        })
      ).rejects.toBeInstanceOf(Error);
      expect(Date.now() - startedAt).toBeLessThan(3_000);

      recoveryContainer = await new GenericContainer("redis:7-alpine")
        .withExposedPorts({ container: 6379, host: port })
        .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
        .start();

      let recovered: Awaited<ReturnType<typeof enqueueBackupCreation>> | undefined;
      const deadline = Date.now() + 5_000;
      while (!recovered && Date.now() < deadline) {
        try {
          recovered = await enqueueBackupCreation(queue, {
            kind: "backup.create",
            requestedBy: "usr_1",
            requestedAt: "2026-09-01T12:35:01.000Z"
          });
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(recovered?.id).toBe("backup-create-20260901T1235Z");
    } finally {
      await queue.close();
      await recoveryContainer?.stop();
      consoleError.mockRestore();
    }
  });

  it("bounds a command stalled after readiness and preserves same-id recovery", async () => {
    const queue = createMaintenanceQueue(redisUrl);
    const controller = new Redis(redisUrl);
    queue.on("error", () => undefined);

    try {
      await enqueueBackupCreation(queue, {
        kind: "backup.create",
        requestedBy: "usr_1",
        requestedAt: "2026-09-01T12:34:01.000Z"
      });
      await controller.call("CLIENT", "PAUSE", "2500", "ALL");

      const startedAt = Date.now();
      const timedPayload: MaintenanceJob = {
        kind: "backup.create",
        requestedBy: "usr_1",
        requestedAt: "2026-09-01T12:35:01.000Z"
      };
      await expect(enqueueBackupCreation(queue, timedPayload)).rejects.toThrow("Command timed out");
      expect(Date.now() - startedAt).toBeLessThan(1_800);

      let recovered: Awaited<ReturnType<typeof enqueueBackupCreation>> | undefined;
      const deadline = Date.now() + 5_000;
      while (!recovered && Date.now() < deadline) {
        try {
          recovered = await enqueueBackupCreation(queue, timedPayload);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(recovered?.id).toBe("backup-create-20260901T1235Z");
      expect(await queue.count()).toBe(2);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await controller.quit();
    }
  });
});
