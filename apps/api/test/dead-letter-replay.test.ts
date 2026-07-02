import { describe, expect, it, vi } from "vitest";
import { replayDeadLetterTelemetryJob } from "../src/dead-letter-replay.js";
import type { DeadLetterJob } from "@sigmon/db/repositories/dead-letter.js";
import type { TelemetryJobPayload } from "@sigmon/queues";

function deadLetterJob(overrides: Partial<DeadLetterJob> = {}): DeadLetterJob {
  return {
    id: "dlj_1",
    projectId: "prj_1",
    environmentId: "env_1",
    queueName: "telemetry",
    jobName: "event",
    payload: {
      kind: "event",
      id: "evt_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        name: "checkout.started",
        properties: { plan: "team" }
      }
    },
    errorMessage: "insert failed",
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    ...overrides
  };
}

describe("replayDeadLetterTelemetryJob", () => {
  it("validates, re-enqueues, and deletes a telemetry dead-letter job", async () => {
    const calls: string[] = [];
    const getDeadLetterJob = vi.fn(async () => deadLetterJob());
    const enqueueReplay = vi.fn(async () => {
      calls.push("enqueue");
    });
    const deleteDeadLetterJob = vi.fn(async () => {
      calls.push("delete");
      return true;
    });

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob,
          enqueueReplay,
          deleteDeadLetterJob,
          createReplayAttemptId: () => "rpl_1"
        },
        "dlj_1"
      )
    ).resolves.toBe("replayed");

    expect(enqueueReplay).toHaveBeenCalledWith(
      {
        kind: "event",
        id: "evt_1",
        projectId: "prj_1",
        environmentId: "env_1",
        payload: {
          name: "checkout.started",
          properties: { plan: "team" },
          metadata: {}
        }
      },
      "dlj_1|rpl_1"
    );
    expect(deleteDeadLetterJob).toHaveBeenCalledWith("dlj_1");
    expect(calls).toEqual(["enqueue", "delete"]);
  });

  it("validates click map telemetry dead-letter jobs", async () => {
    const getDeadLetterJob = vi.fn(async () =>
      deadLetterJob({
        jobName: "click",
        payload: {
          kind: "click",
          id: "clk_1",
          projectId: "prj_1",
          environmentId: "env_1",
          payload: {
            route: "/checkout",
            selector: '[data-sigmon-id="submit"]',
            x: 0.5,
            y: 0.4,
            viewport_width: 1280,
            viewport_height: 720
          }
        }
      })
    );
    const enqueueReplay = vi.fn(async () => undefined);

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob,
          enqueueReplay,
          deleteDeadLetterJob: async () => true,
          createReplayAttemptId: () => "rpl_1"
        },
        "dlj_1"
      )
    ).resolves.toBe("replayed");

    expect(enqueueReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "click",
        id: "clk_1",
        payload: expect.objectContaining({ route: "/checkout", masked: true })
      }),
      "dlj_1|rpl_1"
    );
  });

  it("uses a new replay attempt id each time the same dead-letter row is retried", async () => {
    let attempt = 0;
    const getDeadLetterJob = vi.fn(async () => deadLetterJob());
    const enqueueReplay = vi.fn(async (_payload: TelemetryJobPayload, _replayId: string) => undefined);
    const deleteDeadLetterJob = vi.fn(async () => true);

    await replayDeadLetterTelemetryJob(
      {
        getDeadLetterJob,
        enqueueReplay,
        deleteDeadLetterJob,
        createReplayAttemptId: () => `rpl_${++attempt}`
      },
      "dlj_1"
    );
    await replayDeadLetterTelemetryJob(
      {
        getDeadLetterJob,
        enqueueReplay,
        deleteDeadLetterJob,
        createReplayAttemptId: () => `rpl_${++attempt}`
      },
      "dlj_1"
    );

    expect(enqueueReplay.mock.calls.map(([, replayId]) => replayId)).toEqual(["dlj_1|rpl_1", "dlj_1|rpl_2"]);
  });

  it("does not report replay success when cleanup loses a concurrent delete race", async () => {
    const enqueueReplay = vi.fn(async () => undefined);
    const deleteDeadLetterJob = vi.fn(async () => false);

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob: async () => deadLetterJob(),
          enqueueReplay,
          deleteDeadLetterJob,
          createReplayAttemptId: () => "rpl_1"
        },
        "dlj_1"
      )
    ).resolves.toBe("not_found");

    expect(enqueueReplay).toHaveBeenCalledOnce();
    expect(deleteDeadLetterJob).toHaveBeenCalledWith("dlj_1");
  });

  it("rejects malformed inner telemetry payloads without deleting the dead-letter row", async () => {
    const enqueueReplay = vi.fn(async () => undefined);
    const deleteDeadLetterJob = vi.fn(async () => true);

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob: async () =>
            deadLetterJob({
              payload: {
                kind: "event",
                id: "evt_1",
                projectId: "prj_1",
                environmentId: "env_1",
                payload: { properties: {} }
              }
            }),
          enqueueReplay,
          deleteDeadLetterJob,
          createReplayAttemptId: () => "rpl_1"
        },
        "dlj_1"
      )
    ).resolves.toBe("invalid_payload");

    expect(enqueueReplay).not.toHaveBeenCalled();
    expect(deleteDeadLetterJob).not.toHaveBeenCalled();
  });

  it("keeps the dead-letter row when enqueueing fails", async () => {
    const deleteDeadLetterJob = vi.fn(async () => true);

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob: async () => deadLetterJob(),
          enqueueReplay: async () => {
            throw new Error("redis unavailable");
          },
          deleteDeadLetterJob,
          createReplayAttemptId: () => "rpl_1"
        },
        "dlj_1"
      )
    ).rejects.toThrow("redis unavailable");

    expect(deleteDeadLetterJob).not.toHaveBeenCalled();
  });

  it("returns not_found and unsupported_queue without enqueueing", async () => {
    const enqueueReplay = vi.fn(async () => undefined);
    const deleteDeadLetterJob = vi.fn(async () => true);

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob: async () => undefined,
          enqueueReplay,
          deleteDeadLetterJob,
          createReplayAttemptId: () => "rpl_1"
        },
        "dlj_missing"
      )
    ).resolves.toBe("not_found");

    await expect(
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob: async () => deadLetterJob({ queueName: "other" }),
          enqueueReplay,
          deleteDeadLetterJob,
          createReplayAttemptId: () => "rpl_2"
        },
        "dlj_unsupported"
      )
    ).resolves.toBe("unsupported_queue");

    expect(enqueueReplay).not.toHaveBeenCalled();
    expect(deleteDeadLetterJob).not.toHaveBeenCalled();
  });
});
