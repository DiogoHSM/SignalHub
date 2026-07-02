// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AggregateResponse,
  ErrorGroupIncident,
  ErrorGroupRecord,
  ErrorRecord,
  TriageNoteRecord,
  User
} from "../../api/types";
import { useIncident } from "./useIncident";

// ---------------------------------------------------------------------------
// Canned data helpers
// ---------------------------------------------------------------------------

const NOW_ISO = "2026-06-22T12:00:00.000Z";
const FIRST_ISO = "2026-06-20T10:00:00.000Z";
const LAST_ISO = "2026-06-22T11:50:00.000Z";

function makeGroup(overrides: Partial<ErrorGroupRecord> = {}): ErrorGroupRecord {
  return {
    id: "eg_1",
    projectId: "prj_1",
    environmentId: "env_1",
    groupingFingerprint: "fp1",
    message: "TypeError: cannot read 'x'",
    type: "TypeError",
    topStackFrame: "at foo (main.js:10:5)",
    severity: "error",
    status: "open",
    priority: "urgent",
    firstSeenAt: FIRST_ISO,
    lastSeenAt: LAST_ISO,
    lastRegressedAt: null,
    occurrenceCount: 42,
    affectedUsersCount: 7,
    affectedTenantsCount: 3,
    latestErrorId: "err_1",
    latestRelease: "v1.2.0",
    resolvedAt: null,
    ignoredAt: null,
    assignedToUserId: null,
    incidentNumber: null,
    silencedUntil: null,
    createdAt: FIRST_ISO,
    updatedAt: LAST_ISO,
    ...overrides
  };
}

function makeErrorRecord(overrides: Partial<ErrorRecord> = {}): ErrorRecord {
  return {
    id: "err_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: null,
    userId: null,
    sessionId: null,
    traceId: null,
    timestamp: NOW_ISO,
    receivedAt: NOW_ISO,
    source: "browser",
    release: "v1.2.0",
    metadata: {},
    message: "TypeError: cannot read 'x'",
    type: "TypeError",
    severity: "error",
    stack: "TypeError: cannot read 'x'\n  at foo (main.js:10:5)",
    status: "open",
    fingerprint: null,
    errorGroupId: "eg_1",
    groupingFingerprint: null,
    context: {},
    ...overrides
  };
}

function makeIncident(overrides: Partial<ErrorGroupIncident> = {}): ErrorGroupIncident {
  return {
    group: makeGroup(),
    primaryOccurrence: makeErrorRecord(),
    priority: "urgent",
    suggestedPriority: "high",
    sourceMapResolution: { status: "cached", frameCount: 5 },
    replay: null,
    stronglyRelated: {
      items: [
        {
          id: "item_1",
          kind: "breadcrumb",
          confidence: "strong",
          timestamp: NOW_ISO,
          tenantId: null,
          userId: null,
          sessionId: null,
          traceId: null,
          release: null,
          title: "User clicked button",
          level: "info",
          data: {}
        }
      ],
      truncated: false
    },
    nearbyContext: { items: [], truncated: false },
    related: {
      traceId: "trace_1",
      sessionId: "sess_1",
      userId: "user_1",
      tenantId: "tenant_1",
      release: "v1.2.0"
    },
    incidentNumber: "#42",
    assignedTo: { id: "u_1", email: "alice@example.com" },
    silencedUntil: null,
    notes: [
      {
        id: "note_1",
        authorEmail: "bob@example.com",
        body: "Investigating now",
        createdAt: NOW_ISO
      }
    ],
    ...overrides
  };
}

const INCIDENT_RESPONSE: AggregateResponse<ErrorGroupIncident> = {
  data: makeIncident()
};

const USERS: User[] = [
  { id: "u_1", email: "alice@example.com", isAdmin: true },
  { id: "u_2", email: "bob@example.com", isAdmin: false }
];

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    getErrorGroupIncident: vi.fn().mockResolvedValue(INCIDENT_RESPONSE),
    updateErrorGroupTriage: vi
      .fn()
      .mockResolvedValue({ data: makeGroup() }),
    silenceIncident: vi
      .fn()
      .mockResolvedValue({ data: makeGroup() }),
    addTriageNote: vi.fn().mockResolvedValue({
      data: { id: "note_2", errorGroupId: "eg_1", authorUserId: null, authorEmail: "test@example.com", body: "test", createdAt: NOW_ISO } as TriageNoteRecord
    }),
    listUsers: vi.fn().mockResolvedValue({ users: USERS }),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIncident", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  it("starts in loading state", () => {
    const client = makeClient();
    client.getErrorGroupIncident = vi.fn().mockReturnValue(new Promise(() => {}));
    client.listUsers = vi.fn().mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
  });

  it("transitions to ready after successful fetch", async () => {
    const client = makeClient();

    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).not.toBeNull();
  });

  it("transitions to error state on fetch failure", async () => {
    const client = makeClient({
      getErrorGroupIncident: vi.fn().mockRejectedValue(new Error("network error"))
    });

    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  // -------------------------------------------------------------------------
  // VM mapping
  // -------------------------------------------------------------------------

  it("maps severity to severityColor correctly", async () => {
    const cases: Array<[string, string]> = [
      ["critical", "var(--sev-critical)"],
      ["fatal", "var(--sev-critical)"],
      ["error", "var(--sev-error)"],
      ["warning", "var(--sev-warning)"]
    ];

    for (const [severity, expectedColor] of cases) {
      const client = makeClient({
        getErrorGroupIncident: vi.fn().mockResolvedValue({
          data: makeIncident({ group: makeGroup({ severity }) }),
          meta: {}
        })
      });

      const { result, unmount } = renderHook(() =>
        useIncident({
          client,
          projectId: "prj_1",
          environmentId: "env_1",
          groupId: "eg_1",
          onResolved: vi.fn()
        })
      );

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.data?.severityColor).toBe(expectedColor);
      unmount();
    }
  });

  it("maps priority to P1/P2/P3/P4/null", async () => {
    const cases: Array<[string | null, string | null]> = [
      ["urgent", "P1"],
      ["high", "P2"],
      ["normal", "P3"],
      ["low", "P4"],
      [null, null]
    ];

    for (const [priority, expected] of cases) {
      const client = makeClient({
        getErrorGroupIncident: vi.fn().mockResolvedValue({
          data: makeIncident({ priority: priority as ErrorGroupIncident["priority"] }),
          meta: {}
        })
      });

      const { result, unmount } = renderHook(() =>
        useIncident({
          client,
          projectId: "prj_1",
          environmentId: "env_1",
          groupId: "eg_1",
          onResolved: vi.fn()
        })
      );

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.data?.priority).toBe(expected);
      unmount();
    }
  });

  it("maps assignedTo email, null when unassigned", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.assigneeEmail).toBe("alice@example.com");

    const client2 = makeClient({
      getErrorGroupIncident: vi.fn().mockResolvedValue({
        data: makeIncident({ assignedTo: null }),
        meta: {}
      })
    });
    const { result: result2 } = renderHook(() =>
      useIncident({
        client: client2,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result2.current.status).toBe("ready"));
    expect(result2.current.data?.assigneeEmail).toBeNull();
  });

  it("maps incidentNumber correctly", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.incidentNumber).toBe("#42");
  });

  it("maps relative times for firstSeen, lastSeen, opened", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    // FIRST_ISO = 2026-06-20T10:00:00Z, NOW = 2026-06-22T12:00:00Z → ~50h → 2d ago
    expect(result.current.data?.firstSeenRelative).toMatch(/\d+[dhms] ago/);
    // LAST_ISO = 2026-06-22T11:50:00Z, NOW = 2026-06-22T12:00:00Z → 10m ago
    expect(result.current.data?.lastSeenRelative).toMatch(/\d+[dhms] ago/);
    // openedRelative uses group.firstSeenAt = FIRST_ISO → ~50h → 2d ago
    expect(result.current.data?.openedRelative).toMatch(/\d+[dhms] ago/);
  });

  it("maps sourceMapBadge from sourceMapResolution", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.sourceMapBadge).toEqual({ resolved: true, frameCount: 5 });

    const client2 = makeClient({
      getErrorGroupIncident: vi.fn().mockResolvedValue({
        data: makeIncident({ sourceMapResolution: { status: "none" } }),
        meta: {}
      })
    });
    const { result: r2 } = renderHook(() =>
      useIncident({
        client: client2,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(r2.current.status).toBe("ready"));
    expect(r2.current.data?.sourceMapBadge).toEqual({ resolved: false, frameCount: 0 });
  });

  it("maps cached source-map diagnostic from incident resolution", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.data?.sourceMapDiagnostic).toMatchObject({
      status: "resolved",
      label: "Source maps resolved",
      frameCount: 5,
      unresolvedFrameCount: 0
    });
  });

  it("explains unresolved source maps when release is missing", async () => {
    const client = makeClient({
      getErrorGroupIncident: vi.fn().mockResolvedValue({
        data: makeIncident({
          sourceMapResolution: { status: "none" },
          group: makeGroup({ latestRelease: null }),
          primaryOccurrence: makeErrorRecord({ release: null })
        }),
        meta: {}
      })
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.data?.sourceMapDiagnostic).toMatchObject({
      status: "unresolved",
      label: "Source maps not applied",
      release: null
    });
    expect(result.current.data?.sourceMapDiagnostic.detail).toMatch(/Configure the SDK release/i);
  });

  it("fetches detailed source-map resolution for the primary occurrence", async () => {
    const getErrorSourceMapResolution = vi.fn().mockResolvedValue({
      errorId: "err_1",
      release: "v1.2.0",
      status: "partially_resolved",
      frames: [
        {
          frameIndex: 0,
          minifiedFile: "main.js",
          minifiedLine: 10,
          minifiedColumn: 5,
          originalSource: "src/main.ts",
          originalLine: 25,
          originalColumn: 10,
          originalName: "foo",
          sourceMapArtifactId: "smap_1"
        }
      ],
      unresolvedFrameCount: 2
    });
    const client = makeClient({ getErrorSourceMapResolution });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(getErrorSourceMapResolution).toHaveBeenCalledWith("err_1", {
      projectId: "prj_1",
      environmentId: "env_1"
    });
    expect(result.current.data?.sourceMapDiagnostic).toMatchObject({
      status: "partially_resolved",
      frameCount: 1,
      unresolvedFrameCount: 2
    });
  });

  it("maps breadcrumbs from stronglyRelated items", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.breadcrumbs).toHaveLength(1);
    expect(result.current.data?.breadcrumbs[0]).toMatchObject({
      kind: "breadcrumb",
      title: "User clicked button",
      timeRelative: expect.any(String)
    });
  });

  it("maps notes with initials derived from email", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.notes).toHaveLength(1);
    expect(result.current.data?.notes[0]).toMatchObject({
      initials: "B",
      authorEmail: "bob@example.com",
      body: "Investigating now",
      timeRelative: expect.any(String)
    });
  });

  it("maps related rows only when destination ids exist", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    // All 4 related fields are present (traceId, sessionId, userId, tenantId)
    expect(result.current.data?.related.length).toBeGreaterThan(0);
    // Each has a target when id exists
    for (const rel of result.current.data!.related) {
      expect(rel.target).toBeDefined();
    }
  });

  it("does not set target on related rows when id is null", async () => {
    const client = makeClient({
      getErrorGroupIncident: vi.fn().mockResolvedValue({
        data: makeIncident({
          related: { traceId: null, sessionId: null, userId: null, tenantId: null, release: null }
        }),
        meta: {}
      })
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    // With no ids, related rows still exist but have no target, or there are no related rows
    for (const rel of result.current.data!.related) {
      expect(rel.target).toBeUndefined();
    }
  });

  it("maps groupId, title, origin, occurrenceCount, affectedUsers, affectedTenants, release, status", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const vm = result.current.data!;
    expect(vm.groupId).toBe("eg_1");
    expect(vm.title).toBe("TypeError: cannot read 'x'");
    expect(vm.occurrenceCount).toBe(42);
    expect(vm.affectedUsers).toBe(7);
    expect(vm.affectedTenants).toBe(3);
    expect(vm.release).toBe("v1.2.0");
    expect(vm.status).toBe("open");
    expect(vm.silencedUntil).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  it("resolve() calls updateErrorGroupTriage with status:resolved then onResolved", async () => {
    const onResolved = vi.fn();
    const client = makeClient();

    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.resolve();
    });

    expect(client.updateErrorGroupTriage).toHaveBeenCalledWith(
      "eg_1",
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        status: "resolved"
      })
    );
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("reassign(userId) calls updateErrorGroupTriage with assignedToUserId then reload", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const initialCallCount = client.getErrorGroupIncident.mock.calls.length;

    await act(async () => {
      await result.current.reassign("u_2");
    });

    expect(client.updateErrorGroupTriage).toHaveBeenCalledWith(
      "eg_1",
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        assignedToUserId: "u_2"
      })
    );
    // reload triggered
    expect(client.getErrorGroupIncident.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("silence(60) calls silenceIncident with minutes:60 then reload", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const initialCallCount = client.getErrorGroupIncident.mock.calls.length;

    await act(async () => {
      await result.current.silence(60);
    });

    expect(client.silenceIncident).toHaveBeenCalledWith(
      "eg_1",
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        minutes: 60
      })
    );
    expect(client.getErrorGroupIncident.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("silence(null) calls silenceIncident with minutes:null then reload", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.silence(null);
    });

    expect(client.silenceIncident).toHaveBeenCalledWith(
      "eg_1",
      expect.objectContaining({ minutes: null })
    );
  });

  it("addNote() calls addTriageNote then reload", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const initialCallCount = client.getErrorGroupIncident.mock.calls.length;

    await act(async () => {
      await result.current.addNote("A new note");
    });

    expect(client.addTriageNote).toHaveBeenCalledWith(
      "eg_1",
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        body: "A new note"
      })
    );
    expect(client.getErrorGroupIncident.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  // -------------------------------------------------------------------------
  // listUsers — admin-gated
  // -------------------------------------------------------------------------

  it("sets users and canReassign:true when listUsers succeeds", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.users).toEqual(USERS);
    expect(result.current.canReassign).toBe(true);
  });

  it("sets users:null and canReassign:false when listUsers returns 403", async () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    const client = makeClient({
      listUsers: vi.fn().mockRejectedValue(err)
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.users).toBeNull();
    expect(result.current.canReassign).toBe(false);
  });

  it("sets users:null and canReassign:false when listUsers returns 401", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    const client = makeClient({
      listUsers: vi.fn().mockRejectedValue(err)
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.users).toBeNull();
    expect(result.current.canReassign).toBe(false);
  });

  it("sets users:null and canReassign:false on non-auth error AND calls console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("Internal Server Error"), { status: 500 });
    const client = makeClient({
      listUsers: vi.fn().mockRejectedValue(err)
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.users).toBeNull();
    expect(result.current.canReassign).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/listUsers failed with non-auth error/);
  });

  it("does NOT call console.warn when listUsers returns 401", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    const client = makeClient({
      listUsers: vi.fn().mockRejectedValue(err)
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.canReassign).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT call console.warn when listUsers returns 403", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    const client = makeClient({
      listUsers: vi.fn().mockRejectedValue(err)
    });
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.canReassign).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Stale-fetch guard
  // -------------------------------------------------------------------------

  it("ignores stale responses when reload fires before first fetch completes", async () => {
    let resolveFirst!: (v: AggregateResponse<ErrorGroupIncident>) => void;
    let resolveSecond!: (v: AggregateResponse<ErrorGroupIncident>) => void;

    const staleData = makeIncident({ group: makeGroup({ message: "stale" }) });
    const freshData = makeIncident({ group: makeGroup({ message: "fresh" }) });

    const firstPromise = new Promise<AggregateResponse<ErrorGroupIncident>>(
      (r) => (resolveFirst = r)
    );
    const secondPromise = new Promise<AggregateResponse<ErrorGroupIncident>>(
      (r) => (resolveSecond = r)
    );

    let callCount = 0;
    const client = makeClient({
      getErrorGroupIncident: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return firstPromise;
        return secondPromise;
      })
    });

    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );

    // Trigger reload immediately (stale gen)
    act(() => {
      result.current.reload();
    });

    // Resolve second (fresh) before first (stale)
    await act(async () => {
      resolveSecond({ data: freshData });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.title).toBe("fresh");

    // Now resolve stale — should be ignored
    await act(async () => {
      resolveFirst({ data: staleData });
    });

    // Still fresh
    expect(result.current.data?.title).toBe("fresh");
  });

  // -------------------------------------------------------------------------
  // reload()
  // -------------------------------------------------------------------------

  it("reload() re-fetches the incident", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        onResolved: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const initialCount = client.getErrorGroupIncident.mock.calls.length;

    act(() => {
      result.current.reload();
    });

    await waitFor(() =>
      expect(client.getErrorGroupIncident.mock.calls.length).toBeGreaterThan(initialCount)
    );
  });

  // -------------------------------------------------------------------------
  // errorId optional param
  // -------------------------------------------------------------------------

  it("passes errorId to getErrorGroupIncident when provided", async () => {
    const client = makeClient();
    renderHook(() =>
      useIncident({
        client,
        projectId: "prj_1",
        environmentId: "env_1",
        groupId: "eg_1",
        errorId: "err_specific",
        onResolved: vi.fn()
      })
    );
    await waitFor(() =>
      expect(client.getErrorGroupIncident).toHaveBeenCalledWith(
        "eg_1",
        expect.objectContaining({ errorId: "err_specific" })
      )
    );
  });
});
