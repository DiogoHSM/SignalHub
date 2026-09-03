import { describe, expect, it, vi } from "vitest";
import { logRedactFeedbackUrlResult, redactFeedbackUrlBatch } from "./redact-feedback-urls.js";

describe("redactFeedbackUrlBatch", () => {
  it("processes bounded batches after the last processed id", async () => {
    const listBatch = vi.fn(async (afterId: string | null) => {
      if (afterId === null) {
        return [
          { id: "fbk_1", pageUrl: "https://app.test/reports?tab=exports", path: "/reports?tab=exports" },
          { id: "fbk_2", pageUrl: "https://app.test/reports", path: "/reports" }
        ];
      }
      if (afterId === "fbk_2") {
        return [{ id: "fbk_3", pageUrl: null, path: "/settings?mode=advanced#section" }];
      }
      return [];
    });
    const updates: Array<{ id: string; values: { pageUrl?: string; path?: string } }> = [];

    const result = await redactFeedbackUrlBatch({
      listBatch,
      update: async (id, values) => {
        updates.push({ id, values });
      },
      batchSize: 2
    });

    expect(result).toEqual({ scanned: 3, updated: 2 });
    expect(listBatch).toHaveBeenNthCalledWith(1, null, 2);
    expect(listBatch).toHaveBeenNthCalledWith(2, "fbk_2", 2);
    expect(updates).toEqual([
      {
        id: "fbk_1",
        values: {
          pageUrl: "https://app.test/reports?tab=%5BREDACTED%5D",
          path: "/reports?tab=%5BREDACTED%5D"
        }
      },
      { id: "fbk_3", values: { path: "/settings?mode=%5BREDACTED%5D" } }
    ]);
  });

  it("does not update rows whose URLs are already safe", async () => {
    const update = vi.fn(async () => undefined);

    const result = await redactFeedbackUrlBatch({
      listBatch: async () => [{ id: "fbk_1", pageUrl: "https://app.test/reports", path: "/reports" }],
      update,
      batchSize: 10
    });

    expect(result).toEqual({ scanned: 1, updated: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("logRedactFeedbackUrlResult", () => {
  it("writes only scan and update counts", () => {
    const log = vi.fn();

    logRedactFeedbackUrlResult({ scanned: 3, updated: 2 }, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Feedback URL redaction complete: scanned=3 updated=2");
  });
});
