// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIncidents } from "./useIncidents";
import type { ErrorGroupRecord } from "../../api/types";
import type { User } from "../../api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGroup(overrides: Partial<ErrorGroupRecord> = {}): ErrorGroupRecord {
  return {
    id: "grp-1",
    projectId: "proj-1",
    environmentId: "env-1",
    groupingFingerprint: "fp-1",
    message: "Something broke",
    type: "Error",
    topStackFrame: null,
    severity: "error",
    status: "open",
    priority: null,
    firstSeenAt: new Date(Date.now() - 3600_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 600_000).toISOString(),
    lastRegressedAt: null,
    occurrenceCount: 5,
    affectedUsersCount: 2,
    affectedTenantsCount: 1,
    latestErrorId: null,
    latestRelease: null,
    resolvedAt: null,
    ignoredAt: null,
    assignedToUserId: null,
    incidentNumber: null,
    silencedUntil: null,
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

const USER_ALICE: User = { id: "user-alice", email: "alice@example.com", isAdmin: false };
const USER_BOB: User = { id: "user-bob", email: "bob@example.com", isAdmin: true };

function makeFakeClient(overrides: {
  openGroups?: ErrorGroupRecord[];
  investigatingGroups?: ErrorGroupRecord[];
  users?: User[] | "reject" | "reject-403";
  mttrMs?: number | null | "omit";
  resolvedCount?: number;
  getIncidentMttrMissing?: boolean;
} = {}) {
  const {
    openGroups = [],
    investigatingGroups = [],
    users = [],
    mttrMs = null,
    resolvedCount = 0,
    getIncidentMttrMissing = false
  } = overrides;

  const listErrorGroups = vi.fn().mockImplementation(
    (query: { status?: string }) => {
      const status = query.status;
      if (status === "open") {
        return Promise.resolve({ data: openGroups });
      }
      if (status === "investigating") {
        return Promise.resolve({ data: investigatingGroups });
      }
      return Promise.resolve({ data: [] });
    }
  );

  const listUsers = vi.fn().mockImplementation(() => {
    if (users === "reject") {
      return Promise.reject(new Error("Unauthorized"));
    }
    if (users === "reject-403") {
      const err = Object.assign(new Error("Forbidden"), { status: 403 });
      return Promise.reject(err);
    }
    return Promise.resolve({ users });
  });

  const getIncidentMttr = vi.fn().mockResolvedValue({
    data: { mttrMs, resolvedCount, windowDays: 7 }
  });

  const client = {
    listErrorGroups,
    listUsers,
    ...(getIncidentMttrMissing ? {} : { getIncidentMttr })
  };

  return { client, listErrorGroups, listUsers, getIncidentMttr };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIncidents", () => {
  it("returns loading initially then ok with empty rows", async () => {
    const { client } = makeFakeClient();

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    expect(result.current.status).toBe("loading");

    await act(async () => {});

    expect(result.current.status).toBe("ok");
    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.rows).toHaveLength(0);
  });

  it("merges open + investigating into one rows list", async () => {
    const open1 = makeGroup({ id: "open-1", status: "open", message: "Open error" });
    const inv1 = makeGroup({ id: "inv-1", status: "investigating", message: "Investigating error" });

    const { client, listErrorGroups } = makeFakeClient({
      openGroups: [open1],
      investigatingGroups: [inv1]
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.status).toBe("ok");
    expect(result.current.data!.rows).toHaveLength(2);

    // Both calls made with correct status
    const calls = listErrorGroups.mock.calls;
    const statuses = calls.map((c: Array<{ status?: string }>) => c[0]?.status);
    expect(statuses).toContain("open");
    expect(statuses).toContain("investigating");
  });

  it("passes limit:100 and projectId/environmentId to each listErrorGroups call", async () => {
    const { client, listErrorGroups } = makeFakeClient();

    renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    for (const call of listErrorGroups.mock.calls) {
      expect(call[0]).toMatchObject({
        projectId: "proj-1",
        environmentId: "env-1",
        limit: 100
      });
    }
  });

  it("sorts by priority rank (urgent→P1 first) then lastSeenAt desc", async () => {
    const now = Date.now();
    const groups = [
      makeGroup({ id: "g-low", priority: "low", status: "open", lastSeenAt: new Date(now - 1000).toISOString() }),
      makeGroup({ id: "g-urgent-old", priority: "urgent", status: "open", lastSeenAt: new Date(now - 5000).toISOString() }),
      makeGroup({ id: "g-urgent-new", priority: "urgent", status: "open", lastSeenAt: new Date(now - 1000).toISOString() }),
      makeGroup({ id: "g-null", priority: null, status: "open", lastSeenAt: new Date(now - 2000).toISOString() }),
      makeGroup({ id: "g-high", priority: "high", status: "open", lastSeenAt: new Date(now - 3000).toISOString() }),
    ];

    const { client } = makeFakeClient({ openGroups: groups });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    const ids = result.current.data!.rows.map((r) => r.id);
    // urgent first (newest first among urgents), then high, then low, then null
    expect(ids[0]).toBe("g-urgent-new");
    expect(ids[1]).toBe("g-urgent-old");
    expect(ids[2]).toBe("g-high");
    expect(ids[3]).toBe("g-low");
    expect(ids[4]).toBe("g-null");
  });

  it("computes kpis.active as merged length", async () => {
    const { client } = makeFakeClient({
      openGroups: [makeGroup({ id: "o1", status: "open" }), makeGroup({ id: "o2", status: "open" })],
      investigatingGroups: [makeGroup({ id: "i1", status: "investigating" })]
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.kpis.active).toBe(3);
  });

  it("computes kpis.p1 as count of priority=urgent", async () => {
    const { client } = makeFakeClient({
      openGroups: [
        makeGroup({ id: "u1", priority: "urgent", status: "open" }),
        makeGroup({ id: "u2", priority: "urgent", status: "open" }),
        makeGroup({ id: "h1", priority: "high", status: "open" })
      ],
      investigatingGroups: [
        makeGroup({ id: "u3", priority: "urgent", status: "investigating" })
      ]
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.kpis.p1).toBe(3);
  });

  it("mttrLabel from getIncidentMttr numeric ms via formatDurationShort", async () => {
    const { client } = makeFakeClient({ mttrMs: 42 * 60_000 }); // 42 minutes

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.kpis.mttrLabel).toBe("42 min");
  });

  it("mttrLabel is '—' when mttrMs is null", async () => {
    const { client } = makeFakeClient({ mttrMs: null });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.kpis.mttrLabel).toBe("—");
  });

  it("mttrLabel is '—' and resolved7d is 0 when client has no getIncidentMttr", async () => {
    const { client } = makeFakeClient({ getIncidentMttrMissing: true });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.kpis.mttrLabel).toBe("—");
    expect(result.current.data!.kpis.resolved7d).toBe(0);
  });

  it("resolved7d = resolvedCount from getIncidentMttr", async () => {
    const { client } = makeFakeClient({ resolvedCount: 7, mttrMs: 60_000 });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.kpis.resolved7d).toBe(7);
  });

  it("getIncidentMttr is called with window:'7d'", async () => {
    const { client, getIncidentMttr } = makeFakeClient();

    renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(getIncidentMttr).toHaveBeenCalledWith(
      expect.objectContaining({ window: "7d" })
    );
  });

  it("assignee: assignedToUserId matched in listUsers → {kind:'initials', initials}", async () => {
    const group = makeGroup({ id: "g1", status: "open", assignedToUserId: "user-alice" });

    const { client } = makeFakeClient({
      openGroups: [group],
      users: [USER_ALICE, USER_BOB]
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    const row = result.current.data!.rows[0];
    expect(row.assignee).toEqual({ kind: "initials", initials: "A" });
  });

  it("assignee: listUsers rejects (403) → assigned rows become {kind:'generic'}", async () => {
    const group = makeGroup({ id: "g1", status: "open", assignedToUserId: "user-alice" });

    const { client } = makeFakeClient({
      openGroups: [group],
      users: "reject-403"
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.status).toBe("ok"); // not a screen error
    const row = result.current.data!.rows[0];
    expect(row.assignee).toEqual({ kind: "generic" });
  });

  it("assignee: listUsers rejects (non-403) → assigned rows become {kind:'generic'}", async () => {
    const group = makeGroup({ id: "g1", status: "open", assignedToUserId: "user-alice" });

    const { client } = makeFakeClient({
      openGroups: [group],
      users: "reject"
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.status).toBe("ok");
    const row = result.current.data!.rows[0];
    expect(row.assignee).toEqual({ kind: "generic" });
  });

  it("assignee: assignedToUserId null → assignee:null", async () => {
    const group = makeGroup({ id: "g1", status: "open", assignedToUserId: null });

    const { client } = makeFakeClient({
      openGroups: [group],
      users: [USER_ALICE]
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    const row = result.current.data!.rows[0];
    expect(row.assignee).toBeNull();
  });

  it("row VM maps priority: urgent→P1, high→P2, normal→P3, low→P4, null→null", async () => {
    const priorities = [
      { priority: "urgent" as const, expected: "P1" },
      { priority: "high" as const, expected: "P2" },
      { priority: "normal" as const, expected: "P3" },
      { priority: "low" as const, expected: "P4" },
      { priority: null, expected: null }
    ];

    for (const { priority, expected } of priorities) {
      const group = makeGroup({ id: `g-${priority ?? "null"}`, status: "open", priority });
      const { client } = makeFakeClient({ openGroups: [group] });

      const { result } = renderHook(() =>
        useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
      );

      await act(async () => {});
      cleanup();

      expect(result.current.data!.rows[0].priority).toBe(expected);
    }
  });

  it("row VM maps status correctly", async () => {
    const group = makeGroup({ id: "g1", status: "investigating" });
    const { client } = makeFakeClient({ investigatingGroups: [group] });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.rows[0].status).toBe("investigating");
  });

  it("row VM maps incidentNumber (non-null)", async () => {
    const group = makeGroup({ id: "g1", status: "open", incidentNumber: "INC-42" });
    const { client } = makeFakeClient({ openGroups: [group] });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.rows[0].incidentNumber).toBe("INC-42");
  });

  it("row VM maps incidentNumber null", async () => {
    const group = makeGroup({ id: "g1", status: "open", incidentNumber: null });
    const { client } = makeFakeClient({ openGroups: [group] });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.rows[0].incidentNumber).toBeNull();
  });

  it("row VM openedRelative = relativeTime(firstSeenAt) — is a string ending with 'ago'", async () => {
    const group = makeGroup({ id: "g1", status: "open", firstSeenAt: new Date(Date.now() - 120_000).toISOString() });
    const { client } = makeFakeClient({ openGroups: [group] });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.data!.rows[0].openedRelative).toMatch(/ago$/);
  });

  it("row VM maps occurrenceCount, affectedUsersCount, affectedTenantsCount", async () => {
    const group = makeGroup({ id: "g1", status: "open", occurrenceCount: 42, affectedUsersCount: 3, affectedTenantsCount: 5 });
    const { client } = makeFakeClient({ openGroups: [group] });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    const row = result.current.data!.rows[0];
    expect(row.occurrenceCount).toBe(42);
    expect(row.affectedUsersCount).toBe(3);
    expect(row.affectedTenantsCount).toBe(5);
  });

  it("stale-fetch guard: second reload resolution wins; first does not overwrite", async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;

    const firstPromise = new Promise((res) => { resolveFirst = res; });
    const secondPromise = new Promise((res) => { resolveSecond = res; });

    let callCount = 0;
    const listErrorGroups = vi.fn().mockImplementation((query: { status?: string }) => {
      if (query.status !== "open") return Promise.resolve({ data: [] });
      callCount++;
      if (callCount === 1) return firstPromise.then(() => ({ data: [makeGroup({ id: "first", status: "open", message: "first" })] }));
      return secondPromise.then(() => ({ data: [makeGroup({ id: "second", status: "open", message: "second" })] }));
    });

    const listUsers = vi.fn().mockResolvedValue({ users: [] });
    const getIncidentMttr = vi.fn().mockResolvedValue({ data: { mttrMs: null, resolvedCount: 0, windowDays: 7 } });
    const client = { listErrorGroups, listUsers, getIncidentMttr };

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    // Trigger a reload (second fetch) before the first resolves
    act(() => {
      result.current.reload();
    });

    // Resolve second first
    await act(async () => {
      resolveSecond(undefined);
    });

    expect(result.current.data?.rows[0]?.message).toBe("second");

    // Now resolve first — should NOT overwrite
    await act(async () => {
      resolveFirst(undefined);
    });

    expect(result.current.data?.rows[0]?.message).toBe("second");
  });

  it("rejected listErrorGroups → status:'error'", async () => {
    const listErrorGroups = vi.fn().mockRejectedValue(new Error("Network error"));
    const listUsers = vi.fn().mockResolvedValue({ users: [] });
    const getIncidentMttr = vi.fn().mockResolvedValue({ data: { mttrMs: null, resolvedCount: 0, windowDays: 7 } });
    const client = { listErrorGroups, listUsers, getIncidentMttr };

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.status).toBe("error");
    expect(result.current.data).toBeNull();
  });

  it("does not call APIs when projectId is undefined", async () => {
    const { client, listErrorGroups } = makeFakeClient();

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: undefined, environmentId: "env-1" })
    );

    await act(async () => {});

    expect(listErrorGroups).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
  });

  it("getIncidentMttr rejects (500) → status:'ok', mttrLabel:'—', resolved7d:0", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const listErrorGroups = vi.fn().mockImplementation((query: { status?: string }) => {
      if (query.status === "open") return Promise.resolve({ data: [makeGroup({ id: "g1", status: "open" })] });
      return Promise.resolve({ data: [] });
    });
    const listUsers = vi.fn().mockResolvedValue({ users: [] });
    const getIncidentMttr = vi.fn().mockRejectedValue(Object.assign(new Error("Internal Server Error"), { status: 500 }));
    const client = { listErrorGroups, listUsers, getIncidentMttr };

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    expect(result.current.status).toBe("ok");
    expect(result.current.data!.kpis.mttrLabel).toBe("—");
    expect(result.current.data!.kpis.resolved7d).toBe(0);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call APIs when environmentId is undefined", async () => {
    const { client, listErrorGroups } = makeFakeClient();

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: undefined })
    );

    await act(async () => {});

    expect(listErrorGroups).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
  });

  it("reload() triggers a re-fetch", async () => {
    const { client, listErrorGroups } = makeFakeClient();

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});
    expect(listErrorGroups).toHaveBeenCalledTimes(2); // once for open, once for investigating

    act(() => {
      result.current.reload();
    });

    await act(async () => {});
    expect(listErrorGroups).toHaveBeenCalledTimes(4); // called again
  });

  it("initials derived from email local part (first char uppercase)", async () => {
    const group = makeGroup({ id: "g1", status: "open", assignedToUserId: "user-bob" });
    const { client } = makeFakeClient({
      openGroups: [group],
      users: [USER_BOB]
    });

    const { result } = renderHook(() =>
      useIncidents({ client, projectId: "proj-1", environmentId: "env-1" })
    );

    await act(async () => {});

    const row = result.current.data!.rows[0];
    expect(row.assignee).toEqual({ kind: "initials", initials: "B" });
  });
});
