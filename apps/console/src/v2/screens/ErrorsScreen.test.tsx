// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorsVM } from "./useErrors";
import * as useErrorsModule from "./useErrors";
import { ErrorsScreen } from "./ErrorsScreen";
import type { ScreenCtx } from "./registry";

// ---------------------------------------------------------------------------
// Canned VM
// ---------------------------------------------------------------------------

const ERRORS_VM: ErrorsVM = {
  tabs: {
    events: 4820000,
    // Distinct from summary.errors24h (2481) so tab badge vs. strip can be
    // asserted independently.  formatCompact(3500) → "3,500"
    errors: 3500,
    traces: 31000,
    llm: 184000,
    tenants: 287,
    users: 14000,
  },
  summary: {
    errors24h: 2481,
    openGroups: 14,
    crashes: 3,
    critical: 2,
    mttr: 42 * 60_000,
    topRelease: "v2026.05.14",
  },
  volume: [12, 18, 22, 28, 32, 38, 46, 52, 68, 82, 124, 168, 142, 98, 72, 58, 42, 32, 28, 24],
  rows: [
    {
      id: "err_grp_fatal",
      message: "RuntimeCrash: worker process exited unexpectedly",
      severity: "fatal",
      isCrash: true,
      status: "open",
      priority: "P1",
      events: 3,
      users: 1,
      tenants: 1,
      last: "2s ago",
      trend: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
    },
    {
      id: "err_grp_8a2f",
      message: "PaymentTimeoutError: provider timeout after 12000ms",
      severity: "critical",
      isCrash: false,
      status: "investigating",
      priority: "P1",
      events: 412,
      users: 38,
      tenants: 2,
      last: "8s ago",
      trend: [4, 8, 13, 21, 34, 55, 89, 144, 112, 76, 52, 33],
    },
    {
      id: "err_grp_4c1d",
      message: "StripeAPIError: rate_limited",
      severity: "critical",
      isCrash: false,
      status: "open",
      priority: "P1",
      events: 184,
      users: 22,
      tenants: 1,
      last: "32s ago",
      trend: [0, 3, 5, 8, 13, 21, 34, 55, 34, 21, 13, 8],
    },
    {
      id: "err_grp_2a8c",
      message: "Worker job dlq_telemetry timed out (max_attempts reached)",
      severity: "error",
      isCrash: false,
      status: "investigating",
      priority: "P2",
      events: 28,
      users: null,
      tenants: null,
      last: "12m ago",
      trend: [0, 0, 1, 1, 2, 3, 5, 8, 5, 2, 1, 0],
    },
    {
      id: "err_grp_0e91",
      message: "AbortError: signal timeout in /llm/generate",
      severity: "warning",
      isCrash: false,
      status: "ignored",
      priority: "P4",
      events: 12,
      users: 8,
      tenants: 2,
      last: "4h ago",
      trend: [1, 0, 0, 2, 0, 1, 0, 3, 0, 2, 1, 2],
    },
  ],
};

const EMPTY_VM: ErrorsVM = {
  tabs: { events: 0, errors: 0, traces: 0, llm: 0, tenants: 0, users: 0 },
  summary: { errors24h: 0, openGroups: 0, crashes: 0, critical: 0, mttr: null, topRelease: null },
  volume: [],
  rows: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCtx(): ScreenCtx {
  return {
    client: {} as ScreenCtx["client"],
    project: { id: "prj_1", name: "Acme Prod", createdAt: "", updatedAt: "", archivedAt: null },
    environment: {
      id: "env_1",
      projectId: "prj_1",
      name: "production",
      createdAt: "",
      updatedAt: "",
      archivedAt: null,
    },
    environments: [],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
  };
}

function mockUseErrors(vm: ErrorsVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useErrorsModule, "useErrors").mockReturnValue({
    data: vm,
    status,
    reload: vi.fn(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorsScreen", () => {
  describe("no project guard", () => {
    it("shows 'No project selected' hint when project is undefined", () => {
      mockUseErrors(null, "loading");
      const ctx = { ...makeMockCtx(), project: undefined };
      render(<ErrorsScreen ctx={ctx} navigate={vi.fn()} />);
      expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
    });

    it("shows 'No project selected' hint when environment is undefined", () => {
      mockUseErrors(null, "loading");
      const ctx = { ...makeMockCtx(), environment: undefined };
      render(<ErrorsScreen ctx={ctx} navigate={vi.fn()} />);
      expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows loading hint while data is loading", () => {
      mockUseErrors(null, "loading");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows 'No error groups' when rows are empty", () => {
      mockUseErrors(EMPTY_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/no error groups/i)).toBeInTheDocument();
    });
  });

  describe("tab bar", () => {
    it("renders Errors tab as active", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      const errorsTab = screen.getByRole("button", { name: "Errors" });
      expect(errorsTab).toHaveClass("is-active");
    });

    it("renders all 6 tabs: Events, Errors, Traces, LLM, Entities, Users", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Events" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Errors" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Traces" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "LLM" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Entities" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Users" })).toBeInTheDocument();
    });

    it("displays tab counts from VM using formatCompact", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // tabs.errors = 3500 → formatCompact → "3,500" (tab badge only; summary strip shows "2,481")
      expect(screen.getByText("3,500")).toBeInTheDocument();
      // tabs.tenants = 287 → formatCompact → "287"
      expect(screen.getByText("287")).toBeInTheDocument();
      // tabs.events = 4820000 → formatCompact → "4.82M"
      expect(screen.getByText("4.82M")).toBeInTheDocument();
      // tabs.traces = 31000 → formatCompact → "31K"
      expect(screen.getByText("31K")).toBeInTheDocument();
    });

    it("navigates to overview when Events tab is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const navigate = vi.fn();
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={navigate} />);
      await userEvent.click(screen.getByRole("button", { name: "Events" }));
      expect(navigate).toHaveBeenCalledWith("overview");
    });

    it("navigates to traces when Traces tab is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const navigate = vi.fn();
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={navigate} />);
      await userEvent.click(screen.getByRole("button", { name: "Traces" }));
      expect(navigate).toHaveBeenCalledWith("traces");
    });

    it("navigates to llm when LLM tab is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const navigate = vi.fn();
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={navigate} />);
      await userEvent.click(screen.getByRole("button", { name: "LLM" }));
      expect(navigate).toHaveBeenCalledWith("llm");
    });

    it("navigates to entities when Entities tab is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const navigate = vi.fn();
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={navigate} />);
      await userEvent.click(screen.getByRole("button", { name: "Entities" }));
      expect(navigate).toHaveBeenCalledWith("entities");
    });

    it("navigates to users when Users tab is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const navigate = vi.fn();
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={navigate} />);
      await userEvent.click(screen.getByRole("button", { name: "Users" }));
      expect(navigate).toHaveBeenCalledWith("users");
    });
  });

  describe("severity filter", () => {
    it("renders severity segmented options: all, crashes, critical, error, warning", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // using aria-pressed to find segmented options
      const allBtn = screen.getByRole("button", { name: /severity: all/i });
      expect(allBtn).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /crashes/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^critical$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^error$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^warning$/i })).toBeInTheDocument();
    });

    it("starts with 'all' as default severity", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      const allBtn = screen.getByRole("button", { name: /severity: all/i });
      expect(allBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("calls useErrors with new severity when filter changes", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^critical$/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.severity).toBe("critical");
      });
    });

    it("calls useErrors with fatal severity when crash filter changes", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /crashes/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.severity).toBe("fatal");
      });
    });

    it("calls useErrors with 'error' severity filter", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /^error$/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.severity).toBe("error");
      });
    });
  });

  describe("status filter", () => {
    it("renders a status filter control defaulting to 'all'", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByRole("button", { name: /status: all/i })).toBeInTheDocument();
    });

    it("does not pass a status filter to useErrors by default", () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(spy.mock.calls[0][0].status).toBeUndefined();
    });

    it("opens a menu with All/Open/Investigating/Resolved/Ignored options", async () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /status: all/i }));
      expect(screen.getByRole("button", { name: /^all statuses$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^investigating$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^resolved$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^ignored$/i })).toBeInTheDocument();
    });

    it("calls useErrors with status:'open' when Open is chosen", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /status: all/i }));
      await userEvent.click(screen.getByRole("button", { name: /^open$/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.status).toBe("open");
      });
    });

    it("clears the status filter (status:undefined) when 'All statuses' is chosen again", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /status: all/i }));
      await userEvent.click(screen.getByRole("button", { name: /^resolved$/i }));
      await userEvent.click(screen.getByRole("button", { name: /status: resolved/i }));
      await userEvent.click(screen.getByRole("button", { name: /^all statuses$/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.status).toBeUndefined();
      });
    });
  });

  describe("release filter", () => {
    it("renders a 'Filter by release' input defaulting to no filter", () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByPlaceholderText(/filter by release/i)).toBeInTheDocument();
      expect(spy.mock.calls[0][0].release).toBeUndefined();
    });

    it("calls useErrors with the typed release when Apply is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      await userEvent.type(screen.getByPlaceholderText(/filter by release/i), "v2026.05.14");
      await userEvent.click(screen.getByRole("button", { name: /^apply$/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.release).toBe("v2026.05.14");
      });
    });

    it("calls useErrors with the typed release when Enter is pressed", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      await userEvent.type(screen.getByPlaceholderText(/filter by release/i), "v1.2.0{enter}");

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.release).toBe("v1.2.0");
      });
    });

    it("clears the release filter (release:undefined) when the filter text is emptied and applied", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      const input = screen.getByPlaceholderText(/filter by release/i);
      await userEvent.type(input, "v1.2.0{enter}");
      await userEvent.clear(input);
      await userEvent.click(screen.getByRole("button", { name: /^apply$/i }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.release).toBeUndefined();
      });
    });
  });

  describe("summary strip", () => {
    it("renders Errors (24h) count", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/errors.*24h/i)).toBeInTheDocument();
      // summary.errors24h = 2481 → toLocaleString → "2,481" (summary strip only)
      expect(screen.getByText("2,481")).toBeInTheDocument();
    });

    it("renders Open groups count", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/open groups/i)).toBeInTheDocument();
      expect(screen.getByText("14")).toBeInTheDocument();
    });

    it("renders Crashes count", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getAllByText(/crashes/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    });

    it("renders Critical count", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // summary strip "Critical" label
      const criticalLabels = screen.getAllByText(/critical/i);
      expect(criticalLabels.length).toBeGreaterThan(0);
    });

    it("renders formatted MTTR when available", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/mttr/i)).toBeInTheDocument();
      expect(screen.getByText("42 min")).toBeInTheDocument();
    });

    it("renders Top release label and value", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/top release/i)).toBeInTheDocument();
      expect(screen.getByText("v2026.05.14")).toBeInTheDocument();
    });

    it("renders volume bars (aria-hidden chart present)", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // Bars renders aria-hidden="true" divs
      const volumeSection = document.querySelector('[aria-hidden="true"]');
      expect(volumeSection).toBeInTheDocument();
    });
  });

  describe("error table", () => {
    it("renders table header with expected columns including trend", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // Use getAllByText for headers that may appear multiple times (tab bar + column)
      const errorTexts = screen.getAllByText(/^error$/i);
      expect(errorTexts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/^status$/i)).toBeInTheDocument();
      expect(screen.getByText(/^priority$/i)).toBeInTheDocument();
      // "Events" appears in tab bar AND table header; both are valid
      const eventsTexts = screen.getAllByText(/^events$/i);
      expect(eventsTexts.length).toBeGreaterThanOrEqual(1);
      const usersTexts = screen.getAllByText(/^users$/i);
      expect(usersTexts.length).toBeGreaterThanOrEqual(1);
      const tenantsTexts = screen.getAllByText(/^tenants$/i);
      expect(tenantsTexts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/^trend$/i)).toBeInTheDocument();
      expect(screen.getByText(/^last$/i)).toBeInTheDocument();
    });

    it("renders error row messages", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(
        screen.getByText(/PaymentTimeoutError: provider timeout after 12000ms/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/StripeAPIError: rate_limited/i)).toBeInTheDocument();
    });

    it("renders group id tags", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText("err_grp_8a2f")).toBeInTheDocument();
    });

    it("renders StatusPill for each row", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // rows have status "investigating", "open", "investigating", "ignored"
      expect(screen.getAllByText("Investigating").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Open").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Ignored").length).toBeGreaterThanOrEqual(1);
    });

    it("renders PriorityPill for rows with non-null priority", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getAllByText("P1").length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("P2").length).toBeGreaterThanOrEqual(1);
    });

    it("renders no PriorityPill for rows with null priority (none displayed)", () => {
      const vmWithNull: ErrorsVM = {
        ...ERRORS_VM,
        rows: [
          {
            id: "err_null_prio",
            message: "SomeError: null priority row",
            severity: "error",
            isCrash: false,
            status: "open",
            priority: null,
            events: 5,
            users: null,
            tenants: null,
            last: "1h ago",
            trend: [],
          },
        ],
      };
      mockUseErrors(vmWithNull);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // P-pill should not be present
      expect(screen.queryByText(/^P[1234]$/)).not.toBeInTheDocument();
    });

    it("renders '—' for null users", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // row with users=null should show "—"
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });

    it("renders '—' for null tenants", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      // row with tenants=null should show "—"
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });

    it("renders a sparkline/trend cell in table rows", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getAllByTestId("error-group-trend-sparkline")).toHaveLength(ERRORS_VM.rows.length);
    });

    it("calls ctx.drill('incident', {groupId}) when a row is clicked", async () => {
      mockUseErrors(ERRORS_VM);
      const ctx = makeMockCtx();
      render(<ErrorsScreen ctx={ctx} navigate={vi.fn()} />);

      // Click the first error row
      const rows = screen.getAllByRole("button", { name: /PaymentTimeoutError/i });
      await userEvent.click(rows[0]);
      expect(ctx.drill).toHaveBeenCalledWith("incident", expect.objectContaining({ groupId: "err_grp_8a2f" }));
    });

    it("renders last seen time", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText("8s ago")).toBeInTheDocument();
    });

    it("marks fatal rows as crashes", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByText(/RuntimeCrash/i)).toBeInTheDocument();
      expect(screen.getByText("Crash")).toBeInTheDocument();
    });
  });

  describe("window filter", () => {
    it("renders window segmented options: 24h, 7d", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
    });

    it("defaults to 24h window", () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      expect(spy.mock.calls[0][0].window).toBe("24h");
    });

    it("calls useErrors with 7d when window changes", async () => {
      mockUseErrors(ERRORS_VM);
      const spy = vi.spyOn(useErrorsModule, "useErrors");
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "7d" }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.window).toBe("7d");
      });
    });
  });

  describe("grouped/raw segmented", () => {
    it("renders Grouped and Raw options, with Grouped active", () => {
      mockUseErrors(ERRORS_VM);
      render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      const grouped = screen.getByRole("button", { name: "Grouped" });
      const raw = screen.getByRole("button", { name: "Raw" });
      expect(grouped).toBeInTheDocument();
      expect(raw).toBeInTheDocument();
      expect(grouped).toHaveAttribute("aria-pressed", "true");
      expect(raw).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("English copy / no legacy branding", () => {
    it("contains no Portuguese text in visible labels", () => {
      mockUseErrors(ERRORS_VM);
      const { container } = render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      const text = container.textContent ?? "";
      // Common pt-BR patterns that should not appear
      expect(text).not.toMatch(/grupos abertos/i);
      expect(text).not.toMatch(/erros.*24h.*pt/i);
      expect(text).not.toMatch(/volume.*hora/i);
    });

    it("does not render legacy brand string", () => {
      mockUseErrors(ERRORS_VM);
      const { container } = render(<ErrorsScreen ctx={makeMockCtx()} navigate={vi.fn()} />);
      const text = container.textContent ?? "";
      const needle = "Signal" + "Hub";
      expect(text).not.toContain(needle);
    });
  });

  describe("pendingFilters seed", () => {
    it("seeds tenantId/userId/severity/status from ctx.pendingFilters, forwards them, and clears the payload", () => {
      const spy = vi.spyOn(useErrorsModule, "useErrors").mockReturnValue({ data: ERRORS_VM, status: "ok", reload: vi.fn() });
      const ctx = makeMockCtx();
      ctx.pendingFilters = { section: "investigate", filters: { tenantId: "tenant_acme", userId: "user_1", severity: "critical", status: "open" } };
      render(<ErrorsScreen ctx={ctx} navigate={vi.fn()} />);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_acme", userId: "user_1", severity: "critical", status: "open" }));
      expect(ctx.clearPendingFilters).toHaveBeenCalled();
      expect(screen.getByText(/tenant: tenant_acme/i)).toBeInTheDocument();
      expect(screen.getByText(/user: user_1/i)).toBeInTheDocument();
      // Exact match — the disabled TODO placeholder button also contains the "status: open" substring.
      expect(screen.getByText("status: open")).toBeInTheDocument();
    });

    it("clearing the tenant/user chip drops the filter from the next call", async () => {
      const spy = vi.spyOn(useErrorsModule, "useErrors").mockReturnValue({ data: ERRORS_VM, status: "ok", reload: vi.fn() });
      const ctx = makeMockCtx();
      ctx.pendingFilters = { section: "investigate", filters: { tenantId: "tenant_acme" } };
      render(<ErrorsScreen ctx={ctx} navigate={vi.fn()} />);
      await userEvent.click(screen.getByText(/tenant: tenant_acme/i));
      expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: undefined }));
    });
  });
});
