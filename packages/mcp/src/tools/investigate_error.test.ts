import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { investigateErrorHandler } from "./investigate_error.js";

function fakeClient(overrides: Partial<Record<keyof SigmonClient, unknown>> = {}) {
  return {
    getErrorGroupIncident: vi.fn(async () => ({
      group: { id: "grp_1", latestErrorId: "err_1", status: "open" },
      primaryOccurrence: { id: "err_1" },
      priority: "high",
      suggestedPriority: "high",
      sourceMapResolution: { status: "cached", frameCount: 3 },
      stronglyRelated: { items: [{ id: "grp_2" }], truncated: false },
      nearbyContext: { items: [{ id: "grp_3" }], truncated: false },
      replay: { id: "replay_1" },
      related: { traceId: "trace_1", sessionId: "session_1", userId: "user_1", tenantId: "tenant_1", release: "v1.0.0" },
      incidentNumber: "INC-1",
      assignedTo: null,
      silencedUntil: null,
      notes: [{ id: "note_1", authorEmail: "a@b.com", body: "looked into it", createdAt: "2026-08-24T00:00:00.000Z" }],
      codeContext: {},
      externalIssues: []
    })),
    getErrorGroupOccurrences: vi.fn(async () => ({ data: [{ id: "err_1", stack: "at foo" }], cursor: null })),
    getErrorSourceMapResolution: vi.fn(async () => ({
      errorId: "err_1",
      release: "v1.0.0",
      status: "resolved",
      frames: [{ frameIndex: 0, minifiedFile: "a.js", minifiedLine: 1, minifiedColumn: 1, originalSource: "a.ts", originalLine: 1, originalColumn: 1, originalName: null, sourceMapArtifactId: "sm_1" }],
      unresolvedFrameCount: 0
    })),
    getIncidentMttr: vi.fn(async () => ({ mttrMs: 3600000, resolvedCount: 4, windowDays: 7 })),
    listReplays: vi.fn(async () => ({ data: [{ id: "replay_2" }] })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("investigateErrorHandler", () => {
  it("composes the incident, occurrences, source-map resolution, mttr, and replays with the right params", async () => {
    const client = fakeClient();

    const result = await investigateErrorHandler(client, { errorGroupId: "grp_1" });

    expect(client.getErrorGroupIncident).toHaveBeenCalledWith("grp_1", { errorId: undefined });
    expect(client.getErrorGroupOccurrences).toHaveBeenCalledWith("grp_1", { limit: undefined, cursor: undefined });
    // Falls back to the incident's group.latestErrorId when no errorId is supplied.
    expect(client.getErrorSourceMapResolution).toHaveBeenCalledWith("err_1");
    expect(client.getIncidentMttr).toHaveBeenCalledWith({ window: undefined });
    expect(client.listReplays).toHaveBeenCalledWith({ tenantId: "tenant_1", userId: "user_1", limit: undefined });

    expect(result.group).toEqual({ id: "grp_1", latestErrorId: "err_1", status: "open" });
    expect(result.notes).toEqual([{ id: "note_1", authorEmail: "a@b.com", body: "looked into it", createdAt: "2026-08-24T00:00:00.000Z" }]);
    expect(result.sourceMapResolution).toMatchObject({ status: "resolved" });
    expect(result.truncated).toBeUndefined();
  });

  it("uses an explicit errorId for the incident scope and source-map resolution instead of the group's latest", async () => {
    const client = fakeClient();

    await investigateErrorHandler(client, { errorGroupId: "grp_1", errorId: "err_9" });

    expect(client.getErrorGroupIncident).toHaveBeenCalledWith("grp_1", { errorId: "err_9" });
    expect(client.getErrorSourceMapResolution).toHaveBeenCalledWith("err_9");
  });

  it("drops the stack field on occurrences by default and keeps it when includeRawDetail opts in", async () => {
    const client = fakeClient();

    const pruned = await investigateErrorHandler(client, { errorGroupId: "grp_1" });
    expect(pruned.occurrences.items[0]).not.toHaveProperty("stack");

    const raw = await investigateErrorHandler(client, { errorGroupId: "grp_1", includeRawDetail: true });
    expect(raw.occurrences.items[0]).toMatchObject({ stack: "at foo" });
  });

  it("marks the occurrences section as truncated when the list is oversized", async () => {
    const bigOccurrences = Array.from({ length: 21 }, (_, index) => ({ id: `err_${index}` }));
    const client = fakeClient({
      getErrorGroupOccurrences: vi.fn(async () => ({ data: bigOccurrences, cursor: "next" }))
    });

    const result = await investigateErrorHandler(client, { errorGroupId: "grp_1" });

    expect(result.occurrences.items).toHaveLength(20);
    expect(result.occurrences.cursor).toBe("next");
    expect(result.truncated).toBeDefined();
    expect(result.truncated!.some((entry) => entry.section === "investigate_error.occurrences")).toBe(true);
  });
});
