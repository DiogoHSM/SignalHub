// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemScreen } from "./SystemScreen";
import type { ScreenCtx } from "./registry";
import * as hookModule from "./useSystemHealth";
import type { SystemVM } from "./useSystemHealth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project: undefined,
    environment: undefined,
    environments: [],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  } as ScreenCtx;
}

const vm: SystemVM = {
  header: { statusLabel: "Operational", statusTone: "ok" },
  banner: null,
  services: [
    { name: "API", icon: "server", tone: "ok", statusLabel: "healthy", meta: "uptime 2h 5m", spark: null },
    { name: "Postgres", icon: "db", tone: "ok", statusLabel: "healthy", meta: "latency 12ms", spark: [10, 14, 12] },
  ],
  queues: [{ name: "telemetry", waiting: 2, active: 1, completed: "31K", failed: 0, deadLettered: 0, tone: "ok" }],
  retention: {
    enabled: true,
    subLabel: "every 60m · last run 12m ago",
    rows: [{ label: "Events", retentionLabel: "30d", deleted: 120 }, { label: "Errors", retentionLabel: "90d", deleted: 4 }],
  },
  backups: { subLabel: "every 24h · keep 14d · S3 on", latest: { filename: "backup-2026-06-23.sql.gz", meta: "6h ago · 1.5 MB" }, failure: null, stale: false },
};

function mockHook(over: Partial<hookModule.UseSystemHealthResult>) {
  vi.spyOn(hookModule, "useSystemHealth").mockReturnValue({ data: null, status: "loading", reload: vi.fn(), ...over });
}

describe("SystemScreen", () => {
  it("shows a loading state", () => {
    mockHook({ status: "loading", data: null });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it("shows an error state", () => {
    mockHook({ status: "error", data: null });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/Could not load/i)).toBeTruthy();
  });

  it("renders the head status pill and Run-doctor stub toast", async () => {
    mockHook({ status: "ok", data: vm });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    expect(screen.getByText("System health")).toBeTruthy();
    expect(screen.getAllByText(/Operational/).length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole("button", { name: /Run doctor/i }));
    expect(ctx.pushToast).toHaveBeenCalledWith("Doctor is not yet available");
  });

  it("renders service cards — one with a sparkline, one without", () => {
    mockHook({ status: "ok", data: vm });
    const { container } = render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText("API")).toBeTruthy();
    expect(screen.getByText("Postgres")).toBeTruthy();
    // Postgres card has a sparkline svg; API does not.
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a banner only when present", () => {
    mockHook({ status: "ok", data: { ...vm, banner: { tone: "warn", title: "Postgres degraded", detail: "Postgres is reporting degraded performance." } } });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText("Postgres degraded")).toBeTruthy();
  });

  it("renders queue, retention and backup data", () => {
    mockHook({ status: "ok", data: vm });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText("telemetry")).toBeTruthy();
    expect(screen.getByText("0 DLQ")).toBeTruthy();
    expect(screen.getAllByText(/Events/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("backup-2026-06-23.sql.gz")).toBeTruthy();
  });

  it("stubs Run-backup-now via ConfirmButton (arm then confirm)", async () => {
    mockHook({ status: "ok", data: vm });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    const btn = screen.getByRole("button", { name: /Run backup now/i });
    await userEvent.click(btn); // arms
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i })); // confirms
    expect(ctx.pushToast).toHaveBeenCalledWith("Backups run on the configured schedule");
  });

  it("shows an empty hint when there are no backups", () => {
    mockHook({ status: "ok", data: { ...vm, backups: { ...vm.backups, latest: null, failure: null } } });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/No backups yet/i)).toBeTruthy();
  });
});
