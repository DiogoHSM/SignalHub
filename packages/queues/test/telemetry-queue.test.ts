import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTelemetryQueue, enqueueTelemetryJob } from "../src/telemetry-queue.js";
import type { TelemetryJobPayload } from "../src/telemetry-queue.js";

let container: Awaited<ReturnType<GenericContainer["start"]>>;
let redisUrl: string;

describe("telemetry queue", () => {
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

  it("enqueues a telemetry event job", async () => {
    const queue = createTelemetryQueue(redisUrl);
    const client = await queue.client;
    const payload: TelemetryJobPayload = {
      kind: "event",
      id: "evt_1",
      projectId: "project_1",
      environmentId: "environment_1",
      payload: { name: "dashboard_created" }
    };

    try {
      const job = await enqueueTelemetryJob(queue, payload);

      expect(job.id).toBeDefined();
      expect(job.name).toBe("event");
    } finally {
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }

    expect(client.status).toBe("end");
  });
});
