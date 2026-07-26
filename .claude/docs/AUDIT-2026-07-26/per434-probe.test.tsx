// @vitest-environment jsdom
// Adversarial probes for PER-434 F1/F2. Temporary file — delete after the run.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project, UserTimelineRow } from "../../../apps/console/src/api/types";
import { LlmScreen } from "../../../apps/console/src/v2/screens/LlmScreen";
import { UsersScreen } from "../../../apps/console/src/v2/screens/UsersScreen";
import type { ScreenCtx } from "../../../apps/console/src/v2/screens/registry";
import * as useUsersModule from "../../../apps/console/src/v2/screens/useUsers";
import type { UsersVM } from "../../../apps/console/src/v2/screens/useUsers";
import * as useUserDetailModule from "../../../apps/console/src/v2/screens/useUserDetail";
import type { UseUserDetailResult } from "../../../apps/console/src/v2/screens/useUserDetail";

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
  } as unknown as ScreenCtx;
}

// ---------------------------------------------------------------------------
// F1 — real useLlm, stub client: what reaches listLlmCalls after "clear"?
// ---------------------------------------------------------------------------

describe("F1 probe — LlmScreen clear-filters chip vs listLlmCalls args", () => {
  it("records listLlmCalls args before and after clicking the chip", async () => {
    const calls: unknown[] = [];
    const client = {
      getLlmSummary: vi.fn().mockResolvedValue({
        data: { calls: 10, costUsd: "1", avgLatencyMs: 100, p95LatencyMs: 200, failedCalls: 0 },
      }),
      getLlmByTenant: vi.fn().mockResolvedValue({ data: [] }),
      getLlmByPrompt: vi.fn().mockResolvedValue({ data: [] }),
      getLlmCostByModel: vi.fn().mockResolvedValue({ data: { buckets: [], series: [] } }),
      listLlmCalls: vi.fn((q: unknown) => {
        calls.push(q);
        return Promise.resolve({ data: [] });
      }),
    };

    const ctx = makeCtx({
      client: client as never,
      pendingFilters: {
        section: "llm",
        filters: {
          userId: "user_8420",
          tenantId: "tenant_acme",
          provider: "anthropic",
          model: "claude-3.7",
          status: "success",
          promptName: "fraud_check",
        },
      } as never,
    });

    render(<LlmScreen ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("LLM observability")).toBeTruthy());
    await waitFor(() => expect(calls.length).toBe(1));

    const chip = screen.getByRole("button", { name: /user: user_8420/i });
    // eslint-disable-next-line no-console
    console.log("F1 CHIP TEXT:", JSON.stringify(chip.textContent));
    await userEvent.click(chip);

    await waitFor(() => expect(calls.length).toBe(2));
    // eslint-disable-next-line no-console
    console.log("F1 CALL#1 (after seed):", JSON.stringify(calls[0]));
    // eslint-disable-next-line no-console
    console.log("F1 CALL#2 (after clear):", JSON.stringify(calls[1]));
    // eslint-disable-next-line no-console
    console.log(
      "F1 CHIP STILL PRESENT AFTER CLEAR:",
      screen.queryAllByRole("button", { name: /user:|tenant:/i }).length,
    );
  });
});

// ---------------------------------------------------------------------------
// F2 — switching selected user: does the detail tenant/signal filter persist?
// ---------------------------------------------------------------------------

const USERS_VM: UsersVM = {
  rows: [
    {
      key: "user_A", userId: "user_A", label: "Alice", isAnonymous: false,
      impactScore: 92, events: 1842, errors: 2, failedTraces: 1, llmCalls: 120, llmCostUsd: 24.18,
      activeTenants: 2, activeSessions: 3, lastSeenAt: "2026-06-23T12:50:00.000Z", lastSeenLabel: "5m ago",
      keyTraits: {},
    },
    {
      key: "user_B", userId: "user_B", label: "Bob", isAnonymous: false,
      impactScore: 40, events: 12, errors: 0, failedTraces: 0, llmCalls: 1, llmCostUsd: 1,
      activeTenants: 1, activeSessions: 1, lastSeenAt: "2026-06-23T11:50:00.000Z", lastSeenLabel: "1h ago",
      keyTraits: {},
    },
  ],
} as unknown as UsersVM;

const TIMELINE: UserTimelineRow[] = [];

function detailResult(userId: string): UseUserDetailResult {
  return {
    data: {
      window: "7d", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" },
      user: {
        userId, label: userId, traits: {}, keyTraits: {}, isAnonymous: false,
        impactScore: 1, firstSeenAt: null, lastSeenAt: null, profileUpdatedAt: null,
        events: 1, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0,
        llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0,
      },
      recentSessions: [],
      timeline: TIMELINE,
    },
    status: "ok", loadingMore: false, loadMoreError: false, loadMore: vi.fn(), reload: vi.fn(),
  } as unknown as UseUserDetailResult;
}

describe("F2 probe — UserDetailPanel state across selected users", () => {
  it("records useUserDetail args when switching from Alice to Bob after applying a tenant filter", async () => {
    vi.spyOn(useUsersModule, "useUsers").mockReturnValue({
      data: USERS_VM, status: "ok", reload: vi.fn(),
    } as never);

    const seen: Array<{ userId: unknown; tenantId: unknown; signalType: unknown }> = [];
    vi.spyOn(useUserDetailModule, "useUserDetail").mockImplementation(((args: {
      userId: string | null; tenantId?: string; signalType?: string;
    }) => {
      seen.push({ userId: args.userId, tenantId: args.tenantId, signalType: args.signalType });
      return detailResult(args.userId ?? "none");
    }) as never);

    render(<UsersScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByRole("button", { name: /Alice/ }));

    // Apply a tenant filter + signal filter inside the detail panel.
    const inputs = Array.from(document.querySelectorAll("input.sh-input")) as HTMLInputElement[];
    // eslint-disable-next-line no-console
    console.log("F2 INPUT COUNT AFTER SELECTING ALICE:", inputs.length);
    const detailTenantInput = inputs[inputs.length - 1];
    await userEvent.type(detailTenantInput, "tenant_acme");
    await userEvent.click(screen.getByRole("button", { name: /^Apply$/ }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await userEvent.selectOptions(select, "error");

    // eslint-disable-next-line no-console
    console.log("F2 ARGS AFTER APPLY ON ALICE:", JSON.stringify(seen[seen.length - 1]));

    // Now select Bob.
    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));

    // eslint-disable-next-line no-console
    console.log("F2 ARGS AFTER SELECTING BOB:", JSON.stringify(seen[seen.length - 1]));
    // eslint-disable-next-line no-console
    console.log(
      "F2 VISIBLE CHIP TEXTS:",
      JSON.stringify(screen.queryAllByText(/tenant: /).map((n) => n.textContent)),
    );
    // eslint-disable-next-line no-console
    console.log("F2 SELECT VALUE ON BOB:", (screen.getByRole("combobox") as HTMLSelectElement).value);
    // eslint-disable-next-line no-console
    console.log(
      "F2 DETAIL TENANT INPUT VALUE ON BOB:",
      JSON.stringify(
        (Array.from(document.querySelectorAll("input.sh-input")) as HTMLInputElement[]).map((i) => i.value),
      ),
    );
    // eslint-disable-next-line no-console
    console.log("F2 PANEL HEADING:", within(document.body).getAllByText(/user_A|user_B|Alice|Bob/).map((n) => n.textContent).join(" | "));
  });
});
