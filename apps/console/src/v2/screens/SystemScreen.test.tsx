// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdministrationScreen } from "./AdministrationScreen";
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
    client: {
      listProjects: vi.fn().mockResolvedValue({ projects: [] }),
      runSystemDoctor: vi.fn().mockResolvedValue({ message: "Doctor completed: system is operational." }),
      runSystemBackup: vi.fn().mockResolvedValue({ message: "Backup queued." }),
      runSystemRetention: vi.fn().mockResolvedValue({ message: "Retention completed." }),
    } as never,
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
  dlq: { status: "ok", jobs: [] },
};

function mockHook(over: Partial<hookModule.UseSystemHealthResult>) {
  vi.spyOn(hookModule, "useSystemHealth").mockReturnValue({
    data: null,
    status: "loading",
    reload: vi.fn(),
    replayDeadLetterJob: vi.fn().mockResolvedValue({ ok: true }),
    deleteDeadLetterJob: vi.fn().mockResolvedValue({ ok: true }),
    loadDeadLetterJobDetail: vi.fn().mockResolvedValue(null),
    ...over,
  });
}

describe("SystemScreen", () => {
  it("manages installation console users for administrators", async () => {
    const api = {
      ...makeCtx().client,
      listUsers: vi.fn().mockResolvedValue({
        users: [{ id: "usr_2", email: "administrator@example.com", isAdmin: true }],
      }),
      createUser: vi.fn().mockResolvedValue({
        user: { id: "usr_3", email: "new@example.com", isAdmin: true },
      }),
      updateUser: vi.fn().mockResolvedValue({
        user: { id: "usr_2", email: "lead@example.com", isAdmin: true },
      }),
      archiveUser: vi.fn().mockResolvedValue(undefined),
    };
    mockHook({ status: "ok", data: vm });
    render(
      <AdministrationScreen
        ctx={makeCtx({
          client: api as never,
          user: { id: "usr_admin", email: "admin@example.com", isAdmin: true },
        })}
      />
    );

    expect(await screen.findByRole("heading", { name: "Console access" })).toBeInTheDocument();
    expect(screen.getByText("administrator@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Administrator access")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("New user email"), " new@example.com ");
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Create console user" }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "temporary-password",
      isAdmin: true,
    }));
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit administrator@example.com" }));
    await userEvent.clear(screen.getByLabelText("User email"));
    await userEvent.type(screen.getByLabelText("User email"), "lead@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save console user" }));
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("usr_2", {
      email: "lead@example.com",
    }));
    expect(await screen.findByText("lead@example.com")).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Archive new@example.com" }));
    await waitFor(() => expect(api.archiveUser).toHaveBeenCalledWith("usr_3"));
    expect(screen.queryByText("new@example.com")).not.toBeInTheDocument();
  });

  it("does not expose installation user management to non-admin users", () => {
    const listUsers = vi.fn();
    mockHook({ status: "ok", data: vm });
    render(
      <AdministrationScreen
        ctx={makeCtx({
          client: { ...makeCtx().client, listUsers } as never,
          user: { id: "usr_operator", email: "operator@example.com", isAdmin: false },
        })}
      />
    );

    expect(screen.queryByRole("heading", { name: "Console access" })).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("keeps the user editor recoverable when creation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const api = {
      ...makeCtx().client,
      listUsers: vi.fn().mockResolvedValue({ users: [] }),
      createUser: vi.fn().mockRejectedValue(new Error("duplicate email")),
      updateUser: vi.fn(),
      archiveUser: vi.fn(),
    };
    mockHook({ status: "ok", data: vm });
    render(
      <AdministrationScreen
        ctx={makeCtx({
          client: api as never,
          user: { id: "usr_admin", email: "admin@example.com", isAdmin: true },
        })}
      />
    );

    await userEvent.type(await screen.findByLabelText("New user email"), "duplicate@example.com");
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Create console user" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create console user.");
    expect(screen.getByLabelText("New user email")).toHaveValue("duplicate@example.com");
    expect(screen.getByLabelText("Temporary password")).toHaveValue("");
  });

  it("keeps console access off the health page even for administrators", () => {
    const listUsers = vi.fn();
    mockHook({ status: "ok", data: vm });
    render(<SystemScreen ctx={makeCtx({ client: { ...makeCtx().client, listUsers } as never, user: { id: "admin", email: "admin@example.com", isAdmin: true } })} />);
    expect(screen.queryByRole("heading", { name: "Console access" })).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("retries failed health data locally", async () => {
    const reload = vi.fn();
    mockHook({ status: "error", data: null, reload });
    render(<SystemScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry health" }));
    expect(reload).toHaveBeenCalledOnce();
  });

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

  it("keeps the successful doctor result visible in the page", async () => {
    const reload = vi.fn();
    mockHook({ status: "ok", data: vm, reload });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    expect(screen.getByText("Sigmon health")).toBeTruthy();
    expect(screen.getAllByText(/Operational/).length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole("button", { name: /Run doctor/i }));
    expect(ctx.client.runSystemDoctor).toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith("Doctor completed: system is operational.");
    expect(await screen.findByRole("status", { name: "Latest doctor result" })).toHaveTextContent(
      "Doctor completed: system is operational."
    );
    expect(reload).toHaveBeenCalled();
  });

  it("keeps the failed doctor result visible in the page", async () => {
    const runSystemDoctor = vi.fn().mockRejectedValue(new Error("doctor failed"));
    mockHook({ status: "ok", data: vm });
    const ctx = makeCtx({ client: { ...makeCtx().client, runSystemDoctor } as never });
    render(<SystemScreen ctx={ctx} />);

    await userEvent.click(screen.getByRole("button", { name: /Run doctor/i }));

    expect(await screen.findByRole("alert", { name: "Latest doctor result" })).toHaveTextContent(
      "System action failed. Check server logs and try again."
    );
    expect(ctx.pushToast).toHaveBeenCalledWith("System action failed. Check server logs and try again.");
  });

  it("lets the operator dismiss the latest doctor result", async () => {
    mockHook({ status: "ok", data: vm });
    render(<SystemScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByRole("button", { name: /Run doctor/i }));
    expect(await screen.findByRole("status", { name: "Latest doctor result" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss latest doctor result" }));

    expect(screen.queryByRole("status", { name: "Latest doctor result" })).not.toBeInTheDocument();
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

  it("runs backup via ConfirmButton (arm then confirm)", async () => {
    const reload = vi.fn();
    mockHook({ status: "ok", data: vm, reload });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    const btn = screen.getByRole("button", { name: /Run backup now/i });
    await userEvent.click(btn); // arms
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i })); // confirms
    expect(ctx.client.runSystemBackup).toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith("Backup queued.");
    expect(reload).toHaveBeenCalled();
  });

  it("runs retention via ConfirmButton (arm then confirm)", async () => {
    const reload = vi.fn();
    mockHook({ status: "ok", data: vm, reload });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    await userEvent.click(screen.getByRole("button", { name: /Run retention/i }));
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    expect(ctx.client.runSystemRetention).toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith("Retention completed.");
    expect(reload).toHaveBeenCalled();
  });

  it("shows an empty hint when there are no backups", () => {
    mockHook({ status: "ok", data: { ...vm, backups: { ...vm.backups, latest: null, failure: null } } });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/No backups yet/i)).toBeTruthy();
  });

  describe("dead-letter queue section", () => {
    const dlqJob = { id: "dlj_1", queueName: "telemetry", jobName: "event", errorMessage: "boom failed", ageLabel: "2h ago" };

    it("shows the clean-queue empty state when there are no jobs", () => {
      mockHook({ status: "ok", data: vm });
      render(<SystemScreen ctx={makeCtx()} />);
      expect(screen.getByText("Dead-letter queue")).toBeTruthy();
      expect(screen.getByText(/Queue is clean/i)).toBeTruthy();
    });

    it("shows an error hint when the dlq list failed to load", () => {
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "error", jobs: [] } } });
      render(<SystemScreen ctx={makeCtx()} />);
      expect(screen.getByText(/Could not load dead-letter jobs/i)).toBeTruthy();
    });

    it("renders a dead-letter job row with queue, job, reason and age", () => {
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } } });
      render(<SystemScreen ctx={makeCtx()} />);
      const section = screen.getByText("Dead-letter queue").closest(".sh-card") as HTMLElement;
      expect(within(section).getByText("telemetry")).toBeTruthy();
      expect(within(section).getByText("event")).toBeTruthy();
      expect(within(section).getByText("boom failed")).toBeTruthy();
      expect(within(section).getByText("2h ago")).toBeTruthy();
    });

    it("gives the row an accessible name identifying the job, queue, and age", () => {
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } } });
      render(<SystemScreen ctx={makeCtx()} />);
      expect(
        screen.getByRole("button", { name: "Expand dead-letter job event in telemetry (2h ago)" })
      ).toBeInTheDocument();
    });

    it("toggles the row via keyboard (Enter), not just click — matches the accessible role=button pattern", async () => {
      const loadDeadLetterJobDetail = vi.fn().mockResolvedValue({ payload: { a: 1 }, actions: [] });
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, loadDeadLetterJobDetail });
      render(<SystemScreen ctx={makeCtx()} />);

      const row = screen.getByRole("button", { name: "Expand dead-letter job event in telemetry (2h ago)" });
      row.focus();
      await userEvent.keyboard("{Enter}");

      expect(loadDeadLetterJobDetail).toHaveBeenCalledWith("dlj_1");
      expect(await screen.findByText(/"a": 1/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Collapse dead-letter job event in telemetry (2h ago)" })).toBeInTheDocument();
    });

    it("expands a row and loads payload + action history on demand", async () => {
      const loadDeadLetterJobDetail = vi.fn().mockResolvedValue({
        payload: { hello: "world" },
        actions: [{ id: "act_1", action: "replayed", actorEmail: "ops@example.com", ageLabel: "1h ago" }],
      });
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, loadDeadLetterJobDetail });
      render(<SystemScreen ctx={makeCtx()} />);

      await userEvent.click(screen.getByText("boom failed"));

      expect(loadDeadLetterJobDetail).toHaveBeenCalledWith("dlj_1");
      expect(await screen.findByText(/"hello": "world"/)).toBeTruthy();
      expect(await screen.findByText(/replayed by ops@example.com/)).toBeTruthy();
    });

    it("does not refetch detail on a second expand of the same row", async () => {
      const loadDeadLetterJobDetail = vi.fn().mockResolvedValue({ payload: { a: 1 }, actions: [] });
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, loadDeadLetterJobDetail });
      render(<SystemScreen ctx={makeCtx()} />);

      await userEvent.click(screen.getByText("boom failed"));
      await screen.findByText(/"a": 1/);
      await userEvent.click(screen.getByText("boom failed")); // collapse
      await userEvent.click(screen.getByText("boom failed")); // expand again

      expect(loadDeadLetterJobDetail).toHaveBeenCalledTimes(1);
    });

    it("replays a dead-letter job via ConfirmButton and shows a toast", async () => {
      const replayDeadLetterJob = vi.fn().mockResolvedValue({ ok: true });
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, replayDeadLetterJob });
      const ctx = makeCtx();
      render(<SystemScreen ctx={ctx} />);

      await userEvent.click(screen.getByRole("button", { name: /^Replay$/i }));
      await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));

      expect(replayDeadLetterJob).toHaveBeenCalledWith("dlj_1");
      expect(ctx.pushToast).toHaveBeenCalledWith("Dead-letter job re-enqueued for replay.");
    });

    it("deletes a dead-letter job via ConfirmButton and shows a toast", async () => {
      const deleteDeadLetterJob = vi.fn().mockResolvedValue({ ok: true });
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, deleteDeadLetterJob });
      const ctx = makeCtx();
      render(<SystemScreen ctx={ctx} />);

      await userEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
      await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));

      expect(deleteDeadLetterJob).toHaveBeenCalledWith("dlj_1");
      expect(ctx.pushToast).toHaveBeenCalledWith("Dead-letter job deleted.");
    });

    it("shows a failure toast when replay is rejected by the hook", async () => {
      const replayDeadLetterJob = vi.fn().mockResolvedValue({ ok: false, error: "Failed to replay the dead-letter job." });
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, replayDeadLetterJob });
      const ctx = makeCtx();
      render(<SystemScreen ctx={ctx} />);

      await userEvent.click(screen.getByRole("button", { name: /^Replay$/i }));
      await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));

      expect(ctx.pushToast).toHaveBeenCalledWith("Failed to replay the dead-letter job.");
    });

    it("guards against a double-click firing the mutation twice while pending", async () => {
      let resolveReplay: (v: { ok: true }) => void = () => {};
      const pending = new Promise<{ ok: true }>((resolve) => {
        resolveReplay = resolve;
      });
      const replayDeadLetterJob = vi.fn().mockReturnValue(pending);
      mockHook({ status: "ok", data: { ...vm, dlq: { status: "ok", jobs: [dlqJob] } }, replayDeadLetterJob });
      render(<SystemScreen ctx={makeCtx()} />);

      await userEvent.click(screen.getByRole("button", { name: /^Replay$/i }));
      await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));
      // While the first call is still pending, arm + confirm again.
      await userEvent.click(screen.getByRole("button", { name: /Replaying/i }));
      await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));

      expect(replayDeadLetterJob).toHaveBeenCalledTimes(1);
      resolveReplay({ ok: true });
    });
  });
});
