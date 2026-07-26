// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project, UserTimelineRow } from "../../api/types";
import { UsersScreen, timelineNavTarget } from "./UsersScreen";
import type { ScreenCtx } from "./registry";
import * as useUsersModule from "./useUsers";
import type { UsersVM } from "./useUsers";
import * as useUserDetailModule from "./useUserDetail";
import type { UseUserDetailResult } from "./useUserDetail";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(), navigate: vi.fn(), back: vi.fn(),
    drill: vi.fn(), pushToast: vi.fn(), pendingFilters: null, clearPendingFilters: vi.fn(),
    ...over,
  } as ScreenCtx;
}

const USERS_VM: UsersVM = {
  hasMore: false,
  rows: [
    {
      key: "user_8420", userId: "user_8420", label: "Jane Doe", isAnonymous: false,
      impactScore: 92, events: 1842, errors: 2, failedTraces: 1, llmCalls: 120, llmCostUsd: 24.18,
      activeTenants: 2, activeSessions: 3, lastSeenAt: "2026-06-23T12:50:00.000Z", lastSeenLabel: "5m ago",
      keyTraits: { plan: "Enterprise" },
    },
    {
      key: "_anonymous", userId: null, label: "Anonymous", isAnonymous: true,
      impactScore: 4, events: 12, errors: 0, failedTraces: 0, llmCalls: 0, llmCostUsd: 0,
      activeTenants: 0, activeSessions: 1, lastSeenAt: null, lastSeenLabel: "—",
      keyTraits: {},
    },
  ],
};

const TIMELINE: UserTimelineRow[] = [
  { type: "error", id: "err1", timestamp: "2026-06-23T12:00:00.000Z", label: "TypeError", tenantId: "tenant_acme", sessionId: null, traceId: null, severity: "critical", status: "open", message: "TypeError: x" },
  { type: "trace", id: "tr1", timestamp: "2026-06-23T12:10:00.000Z", label: "GET /x", tenantId: "tenant_acme", sessionId: "sess_1", traceId: "trace_1", status: "success", durationMs: 120, name: "GET /x" },
  { type: "llm", id: "ll1", timestamp: "2026-06-23T12:20:00.000Z", label: "fraud_check", tenantId: "tenant_acme", sessionId: null, traceId: null, provider: "anthropic", model: "claude-3.7", promptName: "fraud_check", status: "success", costUsd: "0.02" },
  { type: "event", id: "ev1", timestamp: "2026-06-23T12:30:00.000Z", label: "page_view", tenantId: null, sessionId: null, traceId: null, eventName: "page_view" },
];

function detailResult(over: Partial<UseUserDetailResult> = {}): UseUserDetailResult {
  return {
    data: {
      window: "7d", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" },
      user: {
        userId: "user_8420", label: "Jane Doe", traits: { plan: "gold" }, keyTraits: { plan: "Enterprise" }, isAnonymous: false,
        impactScore: 92, firstSeenAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-06-23T12:50:00.000Z", profileUpdatedAt: "2026-05-01T00:00:00Z",
        events: 1842, errors: 2, openErrors: 1, severeErrors: 1, traces: 90, failedTraces: 1,
        llmCalls: 120, failedLlmCalls: 0, llmCostUsd: "24.18", activeTenants: 2, activeSessions: 3,
      },
      recentSessions: [],
      timeline: TIMELINE,
    },
    status: "ok",
    loadingMore: false,
    loadMoreError: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
    ...over,
  };
}

function mockUseUsers(
  data: UsersVM | null,
  status: "loading" | "ok" | "error" = "ok",
  over: Partial<useUsersModule.UseUsersResult> = {}
) {
  vi.spyOn(useUsersModule, "useUsers").mockReturnValue({
    data,
    status,
    reload: vi.fn(),
    loadMore: vi.fn(),
    loadingMore: false,
    ...over,
  });
}

function mockUseUserDetail(result: UseUserDetailResult) {
  vi.spyOn(useUserDetailModule, "useUserDetail").mockReturnValue(result);
}

describe("UsersScreen", () => {
  it("guards missing project/env", () => {
    mockUseUsers(null, "loading");
    render(<UsersScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockUseUsers(null, "loading");
    const { rerender } = render(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseUsers(null, "error");
    rerender(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load users/i)).toBeInTheDocument();
  });

  it("renders the user list and disables the anonymous row", () => {
    mockUseUsers(USERS_VM);
    mockUseUserDetail(detailResult({ data: null, status: "ok" }));
    render(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    const anonRow = screen.getByText("Anonymous").closest("button") as HTMLButtonElement;
    expect(anonRow).toBeDisabled();
  });

  it("shows a 'select a user' hint before any row is selected", () => {
    mockUseUsers(USERS_VM);
    render(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByText(/select a user/i)).toBeInTheDocument();
  });

  it("selecting a user renders the identity profile, KPIs, and timeline", async () => {
    mockUseUsers(USERS_VM);
    mockUseUserDetail(detailResult());
    render(<UsersScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText(/identity profile/i)).toBeInTheDocument();
    // "LLM cost" labels both the sort control option and the KPI tile.
    expect(screen.getAllByText("LLM cost").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("fraud_check")).toBeInTheDocument();
  });

  it("clicking an error timeline row navigates to investigate, already filtered", async () => {
    mockUseUsers(USERS_VM);
    mockUseUserDetail(detailResult());
    const ctx = makeCtx();
    render(<UsersScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    await userEvent.click(screen.getByText("TypeError"));
    expect(ctx.navigate).toHaveBeenCalledWith("investigate", { userId: "user_8420", tenantId: "tenant_acme", severity: "critical", status: "open" });
  });

  it("clicking a trace timeline row navigates to traces, already filtered", async () => {
    mockUseUsers(USERS_VM);
    mockUseUserDetail(detailResult());
    const ctx = makeCtx();
    render(<UsersScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    await userEvent.click(screen.getByText("GET /x"));
    expect(ctx.navigate).toHaveBeenCalledWith("traces", { userId: "user_8420", tenantId: "tenant_acme", sessionId: "sess_1", traceId: "trace_1" });
  });

  it("clicking an llm timeline row navigates to llm, already filtered", async () => {
    mockUseUsers(USERS_VM);
    mockUseUserDetail(detailResult());
    const ctx = makeCtx();
    render(<UsersScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    await userEvent.click(screen.getByText("fraud_check"));
    expect(ctx.navigate).toHaveBeenCalledWith("llm", { userId: "user_8420", tenantId: "tenant_acme", provider: "anthropic", model: "claude-3.7", status: "success", promptName: "fraud_check" });
  });

  it("event timeline rows are not clickable", async () => {
    mockUseUsers(USERS_VM);
    mockUseUserDetail(detailResult());
    const ctx = makeCtx();
    render(<UsersScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    // "page_view" appears both as the row title and the (context-free) meta line.
    const eventRow = screen.getAllByText("page_view")[0].closest("button") as HTMLButtonElement;
    expect(eventRow).toBeDisabled();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it("applies search and tenant draft filters on demand", async () => {
    const spy = vi.spyOn(useUsersModule, "useUsers").mockReturnValue({
      data: USERS_VM, status: "ok", reload: vi.fn(), loadMore: vi.fn(), loadingMore: false,
    });
    render(<UsersScreen ctx={makeCtx()} />);
    await userEvent.type(screen.getByLabelText("Search"), "acme");
    await userEvent.type(screen.getByLabelText("Tenant"), "tenant_acme");
    await userEvent.click(screen.getByText("Apply filters"));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ search: "acme", tenantId: "tenant_acme" }));
  });

  it("changing sort re-invokes useUsers with the new sort", async () => {
    const spy = vi.spyOn(useUsersModule, "useUsers").mockReturnValue({
      data: USERS_VM, status: "ok", reload: vi.fn(), loadMore: vi.fn(), loadingMore: false,
    });
    render(<UsersScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByRole("button", { name: "LLM cost" }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "llmCost" }));
  });

  it("shows Load more when hasMore is true and wires loadMore", async () => {
    const loadMore = vi.fn();
    mockUseUsers({ ...USERS_VM, hasMore: true }, "ok", { loadMore });
    mockUseUserDetail(detailResult({ data: null, status: "ok" }));
    render(<UsersScreen ctx={makeCtx()} />);
    const btn = screen.getByText("Load more");
    await userEvent.click(btn);
    expect(loadMore).toHaveBeenCalled();
  });

  it("shows Loading more… and disables the button while loadingMore", () => {
    mockUseUsers({ ...USERS_VM, hasMore: true }, "ok", { loadingMore: true });
    mockUseUserDetail(detailResult({ data: null, status: "ok" }));
    render(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByText("Loading more…")).toBeDisabled();
  });

  it("empty list shows a hint", () => {
    mockUseUsers({ rows: [], hasMore: false });
    render(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByText("No user activity")).toBeInTheDocument();
  });

  it("gives each row an accessible name via aria-label instead of a noisy content-derived name", () => {
    mockUseUsers(USERS_VM);
    render(<UsersScreen ctx={makeCtx()} />);
    expect(screen.getByRole("button", { name: "Jane Doe" })).toBeInTheDocument();
  });

  it("renders non-selected rows with a transparent background, not the browser default button chrome", () => {
    mockUseUsers(USERS_VM);
    render(<UsersScreen ctx={makeCtx()} />);
    const row = screen.getByRole("button", { name: "Jane Doe" });
    expect(row.style.background).toBe("transparent");
  });
});

describe("timelineNavTarget", () => {
  it("maps error rows to the investigate section", () => {
    expect(timelineNavTarget(TIMELINE[0], "user_8420")).toEqual({
      section: "investigate",
      filters: { userId: "user_8420", tenantId: "tenant_acme", severity: "critical", status: "open" },
    });
  });

  it("maps trace rows to the traces section", () => {
    expect(timelineNavTarget(TIMELINE[1], "user_8420")).toEqual({
      section: "traces",
      filters: { userId: "user_8420", tenantId: "tenant_acme", sessionId: "sess_1", traceId: "trace_1" },
    });
  });

  it("maps llm rows to the llm section and drops an 'Unspecified' promptName", () => {
    expect(timelineNavTarget(TIMELINE[2], "user_8420")).toEqual({
      section: "llm",
      filters: { userId: "user_8420", tenantId: "tenant_acme", provider: "anthropic", model: "claude-3.7", status: "success", promptName: "fraud_check" },
    });

    const llmRow = TIMELINE[2] as Extract<UserTimelineRow, { type: "llm" }>;
    const unspecified: UserTimelineRow = { ...llmRow, promptName: "Unspecified" };
    const target = timelineNavTarget(unspecified, "user_8420");
    expect(target?.section).toBe("llm");
    expect(target && "promptName" in target.filters).toBe(false);
  });

  it("returns null for event rows (no v2 section yet)", () => {
    expect(timelineNavTarget(TIMELINE[3], "user_8420")).toBeNull();
  });
});
