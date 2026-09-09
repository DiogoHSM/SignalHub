// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, FeedbackItem, FeedbackWidgetSettings, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { SettingsScreen } from "./SettingsScreen";
import { AdministrationScreen } from "./AdministrationScreen";
import { SetupScreen } from "./SetupScreen";
import type { CreatedSecret, ScreenCtx, SecretKind } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
    createProject: vi.fn().mockResolvedValue({ project }),
    updateProject: vi.fn().mockResolvedValue({ project }),
    archiveProject: vi.fn().mockResolvedValue(undefined),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [environment] }),
    createEnvironment: vi.fn().mockResolvedValue({ environment }),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
    createApiKey: vi.fn().mockResolvedValue({ apiKey: { id: "key_1", projectId: "prj_1", environmentId: "env_1", name: "k", prefix: "sh_live_ab", capability: "browser", createdAt: "x", revokedAt: null, secret: "sh_live_browser_secret_value" } }),
    getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", summary: { telemetry: { events: 184, lastEventAt: "2026-06-24T11:59:56.000Z", errors: 0, traces: 0, failedTraces: 0, errorRatePercent: null, p95TraceDurationMs: null, lastErrorAt: null, lastTraceAt: null } } } }),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
    deleteSourceMapArtifact: vi.fn().mockResolvedValue(undefined),
    createSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { id: "tok_1", projectId: "prj_1", environmentId: "env_1", name: "n", prefix: "shsmap_ab", createdAt: "x", lastUsedAt: null, revokedAt: null, secret: "shsmap_secret" } }),
    updateSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { id: "tok_1", projectId: "prj_1", environmentId: "env_1", name: "n", prefix: "shsmap_ab", createdAt: "x", lastUsedAt: null, revokedAt: null } }),
    revokeSourceMapUploadToken: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn().mockResolvedValue(undefined),
    onArchiveEnvironment: vi.fn().mockResolvedValue(undefined),
    onArchiveProject: vi.fn().mockResolvedValue(undefined),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn().mockResolvedValue(undefined),
    onUpdateEnvironment: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn() as (s: NavSection) => void,
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  };
}

// Mirrors ConsoleShellV2: screens render inside <div className="page" key={seq}>
// and ctx.reload bumps seq, so every reload remounts the subtree. The one-time
// secret lives above that boundary, in the shell.
function renderInShell(client: ApiClient) {
  function Host() {
    const [seq, setSeq] = useState(0);
    const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(null);
    const ctx = makeCtx({
      client,
      createdSecret,
      onSecretCreated: (secret: string | null, kind: SecretKind) => setCreatedSecret(secret ? { value: secret, kind } : null),
      reload: () => setSeq((s) => s + 1),
    });
    return <div key={seq}><SetupScreen ctx={ctx} /></div>;
  }
  return render(<Host />);
}

describe("SetupScreen", () => {
  it("starts settings with project identity and mounts only the chosen task", async () => {
    const ctx = makeCtx();
    render(<SettingsScreen ctx={ctx} />);
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New API key" })).not.toBeInTheDocument();
    expect(ctx.client.listSourceMapArtifacts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Data & retention" }));
    await screen.findByRole("button", { name: "Save retention" });
    expect(screen.queryByRole("button", { name: "New API key" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Installation & SDK" }));
    expect(ctx.navigate).toHaveBeenCalledWith("installation");
  });

  it("preserves a project name draft when switching settings tasks", () => {
    render(<SettingsScreen ctx={makeCtx()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Acme" }));
    fireEvent.change(screen.getByLabelText("Rename project"), { target: { value: "Draft project name" } });
    fireEvent.click(screen.getByRole("button", { name: "Environments" }));
    expect(screen.queryByRole("textbox", { name: "Rename project" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("textbox", { name: "Rename project" })).toHaveValue("Draft project name");
  });

  it("preserves an unrelated draft after a successful environment rename with shell refresh", async () => {
    const client = makeClient({ updateEnvironment: vi.fn().mockResolvedValue({ environment: { ...environment, name: "Production EU" } }) });
    const refreshProjects = vi.fn();
    function Host() {
      const [seq, setSeq] = useState(0);
      return <div key={seq}><SettingsScreen ctx={makeCtx({ client, refreshProjects, reload: () => setSeq((value) => value + 1) })} /></div>;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Acme" }));
    fireEvent.change(screen.getByLabelText("Rename project"), { target: { value: "Unsaved project name" } });
    fireEvent.click(screen.getByRole("button", { name: "Environments" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename production" }));
    fireEvent.change(screen.getByLabelText("Rename environment"), { target: { value: "Production EU" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(client.updateEnvironment).toHaveBeenCalledWith("env_1", { name: "Production EU" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Rename environment" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("textbox", { name: "Rename project" })).toHaveValue("Unsaved project name");
    expect(refreshProjects).toHaveBeenCalledOnce();
  });

  it("shows a newly created browser key in credentials without mounting installation", async () => {
    render(<SettingsScreen ctx={makeCtx({ createdSecret: { kind: "browserApiKey", value: "browser-settings-secret" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Credentials & origins" }));
    fireEvent.click(await screen.findByTitle("Reveal"));
    expect(await screen.findByText("browser-settings-secret")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Install SDK" })).not.toBeInTheDocument();
  });

  it("keeps environment creation available before the first environment exists", () => {
    render(<SettingsScreen ctx={makeCtx({ environment: undefined, environments: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Environments" }));
    expect(screen.getByRole("button", { name: "New environment" })).toBeInTheDocument();
  });

  it("preserves a failed project creation draft", async () => {
    const client = makeClient({ createProject: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<AdministrationScreen ctx={makeCtx({ client })} />);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("New project name")).toHaveValue("Keep my draft");
  });

  it("renders the page head and onboarding stepper", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Installation & SDK")).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();
    expect(screen.getByText("Send first signal")).toBeInTheDocument();
  });

  it("keeps project management out of installation", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    await screen.findByRole("heading", { name: "Install SDK" });
    expect(screen.queryByRole("heading", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project settings" })).not.toBeInTheDocument();
  });

  it("renders a connected SDK banner from operations data", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("SDK connected")).toBeInTheDocument();
    expect(screen.getByText(/184 events \/ 24h/)).toBeInTheDocument();
  });

  it("shows a waiting banner when no signal has been received", async () => {
    const client = makeClient({ getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", summary: { telemetry: { events: 0, lastEventAt: null, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: null, p95TraceDurationMs: null, lastErrorAt: null, lastTraceAt: null } } } }) });
    render(<SetupScreen ctx={makeCtx({ client })} />);
    expect(await screen.findByText("Waiting for first signal")).toBeInTheDocument();
  });

  it("switches install snippets when a tab is selected", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    await screen.findByText(/@sigmon\/sdk\/browser/);
    expect(screen.getByText(/@sigmon\/sdk\/browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Python" }));
    expect(screen.getByText(/No Python SDK yet/)).toBeInTheDocument();
  });

  it("gives the Node snippet the endpoint the SDK requires", async () => {
    render(<SetupScreen ctx={makeCtx({ apiEndpoint: "https://sigmon.example.com" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Node" }));
    // createSignalMonitorClient throws "endpoint is required" without it, so a
    // snippet missing it cannot be copy-pasted.
    const code = screen.getByText(/@sigmon\/sdk\/node/).closest(".sh-code");
    expect(code?.textContent).toContain("endpoint");
    expect(code?.textContent).toContain("https://sigmon.example.com");
  });

  it("does not advertise a Python package that is not published", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Python" }));
    expect(screen.queryByText(/pip install sigmon-sdk/)).not.toBeInTheDocument();
  });

  it("generates an API key and reveals the one-time secret", async () => {
    const client = makeClient();
    renderInShell(client);
    const generate = await screen.findByRole("button", { name: /Generate API key/ });
    fireEvent.click(generate);
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1", name: "console-production", capability: "browser" }));
    expect(await screen.findByText(/Copy/)).toBeInTheDocument();
  });

  it("keeps the one-time secret readable after ctx.reload remounts the screen", async () => {
    const client = makeClient();
    renderInShell(client);
    fireEvent.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledTimes(1));

    // The value itself, not just the block: masked by default, so unmask it.
    fireEvent.click(await screen.findByTitle("Reveal"));
    expect(await screen.findByText("sh_live_browser_secret_value")).toBeInTheDocument();
  });

  it("does not reveal an API key secret after the environment changes", async () => {
    let finish!: (value: Awaited<ReturnType<ApiClient["createApiKey"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<ApiClient["createApiKey"]>>>((resolve) => { finish = resolve; });
    const client = makeClient({ createApiKey: vi.fn().mockReturnValue(pending) });
    const nextEnvironment = { ...environment, id: "env_2", name: "preview" };
    const { rerender } = render(<SetupScreen ctx={makeCtx({ client })} />);

    fireEvent.click(await screen.findByRole("button", { name: /Generate API key/ }));
    rerender(<SetupScreen ctx={makeCtx({ client, environment: nextEnvironment, environments: [nextEnvironment] })} />);
    finish({
      apiKey: {
        id: "key_old", projectId: "prj_1", environmentId: "env_1", name: "old",
        prefix: "sh_live_old", capability: "browser", createdAt: "x", revokedAt: null, secret: "must_not_leak",
      },
    });

    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledTimes(1));
    expect(screen.queryByDisplayValue("must_not_leak")).not.toBeInTheDocument();
  });

  it("ignores a secret minted by another credential surface (e.g. a freshly created read token)", async () => {
    render(<SetupScreen ctx={makeCtx({ createdSecret: { value: "shread_visible_once", kind: "readToken" } })} />);
    // The install snippets still need something in place of the key — that
    // placeholder, not the read-only token, is what must appear.
    await screen.findByText(/@sigmon\/sdk\/browser/);
    expect(await screen.findByRole("button", { name: /Generate API key/ })).toBeInTheDocument();
    expect(screen.queryByText("shread_visible_once")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("shread_visible_once");
  });

  it("never interpolates a settings-created server key into the browser snippet", async () => {
    const serverSecret = "sh_live_server_secret_must_not_reach_browser";
    render(<SetupScreen ctx={makeCtx({ createdSecret: { value: serverSecret, kind: "serverApiKey" } })} />);

    await screen.findByText(/@sigmon\/sdk\/browser/);
    expect(screen.queryByDisplayValue(serverSecret)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(serverSecret);
  });

  it("creates a project from the inline input", async () => {
    const client = makeClient();
    render(<AdministrationScreen ctx={makeCtx({ client, onArchiveProject: client.archiveProject, onUpdateProject: async (id, input) => { await client.updateProject(id, input); } })} />);
    await screen.findByText("Projects");
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const input = screen.getByLabelText("New project name");
    fireEvent.change(input, { target: { value: "New API" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(client.createProject).toHaveBeenCalledWith({ name: "New API" }));
  });

  it("archives a project", async () => {
    const client = makeClient();
    render(<AdministrationScreen ctx={makeCtx({ client, onArchiveProject: client.archiveProject, onUpdateProject: async (id, input) => { await client.updateProject(id, input); } })} />);
    const archive = await screen.findByRole("button", { name: "Archive Acme" });
    fireEvent.click(archive);
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive Acme" }));
    await waitFor(() => expect(client.archiveProject).toHaveBeenCalledWith("prj_1"));
  });

  it("renames a project from the inline editor", async () => {
    const client = makeClient();
    render(<AdministrationScreen ctx={makeCtx({ client, onArchiveProject: client.archiveProject, onUpdateProject: async (id, input) => { await client.updateProject(id, input); } })} />);
    const rename = await screen.findByRole("button", { name: "Rename Acme" });
    fireEvent.click(rename);
    const input = screen.getByLabelText("Rename project");
    fireEvent.change(input, { target: { value: "Acme Corp" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(client.updateProject).toHaveBeenCalledWith("prj_1", { name: "Acme Corp" }));
  });

  it("renames an environment from the inline editor", async () => {
    const client = makeClient({ updateEnvironment: vi.fn().mockResolvedValue({ environment }) });
    render(<SettingsScreen ctx={makeCtx({ client })} />);
    fireEvent.click(screen.getByRole("button", { name: "Environments" }));

    fireEvent.click(await screen.findByRole("button", { name: "Rename production" }));
    const input = screen.getByLabelText("Rename environment");
    fireEvent.change(input, { target: { value: "Production EU" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(client.updateEnvironment).toHaveBeenCalledWith("env_1", { name: "Production EU" }));
  });

  it("archives an environment", async () => {
    const client = makeClient({ archiveEnvironment: vi.fn().mockResolvedValue(undefined) });
    render(<SettingsScreen ctx={makeCtx({ client })} />);
    fireEvent.click(screen.getByRole("button", { name: "Environments" }));

    fireEvent.click(await screen.findByRole("button", { name: "Archive production" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive production" }));

    await waitFor(() => expect(client.archiveEnvironment).toHaveBeenCalledWith("env_1"));
  });

  it("checks telemetry with a scoped read after the user runs the snippet", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const check = await screen.findByRole("button", { name: "Check for telemetry" });
    const previousCalls = vi.mocked(client.getOperations!).mock.calls.length;
    fireEvent.click(check);
    await waitFor(() => expect(client.getOperations).toHaveBeenCalledTimes(previousCalls + 1));
    expect(client.getOperations).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "24h" });
    expect(client.createApiKey).not.toHaveBeenCalled();
  });

  it("flushes browser and Node events and keeps browser credentials out of server examples", async () => {
    render(<SetupScreen ctx={makeCtx({ createdSecret: { kind: "browserApiKey", value: "browser-only-key" } })} />);
    const browser = (await screen.findByText(/@sigmon\/sdk\/browser/)).closest(".sh-code");
    expect(browser?.textContent).toContain("await signal.flush()");
    for (const tab of ["Node", "Python", "HTTP"]) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(screen.queryByText(/browser-only-key/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Generate API key/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manage server credentials" })).toBeInTheDocument();
    }
    expect(screen.getByText(/content-type: application\/json/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Node" }));
    const node = screen.getByText(/@sigmon\/sdk\/node/).closest(".sh-code");
    expect(node?.textContent).toContain("await signal.flush()");
    expect(node?.textContent).not.toContain("captureError(err)");
    fireEvent.click(screen.getByRole("button", { name: "Python" }));
    expect(screen.getByText(/python -m pip install requests/)).toBeInTheDocument();
  });

  it("mounts the artifacts section", async () => {
    render(<SettingsScreen ctx={makeCtx()} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    expect(await screen.findByText("Source map artifacts")).toBeInTheDocument();
    expect(screen.getByText("CI upload tokens")).toBeInTheDocument();
  });

  it("hides the feedback section when the client does not expose the feedback API", async () => {
    render(<SettingsScreen ctx={makeCtx()} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    await screen.findByText("Source map artifacts");
    expect(screen.queryByText("Widget settings")).not.toBeInTheDocument();
  });

  it("mounts the feedback section when the client exposes the feedback API", async () => {
    const settings: FeedbackWidgetSettings = {
      projectId: "prj_1", environmentId: "env_1", enabled: true, title: "Send feedback",
      prompt: "Tell us what happened.", placeholder: "Write your feedback...", buttonLabel: "Feedback",
      accentColor: "#66e38a", allowScreenshot: false, privacyNote: null,
      createdAt: "2026-06-24T09:00:00.000Z", updatedAt: "2026-06-24T09:00:00.000Z",
    };
    const feedbackItem: FeedbackItem = {
      id: "fb_1", projectId: "prj_1", environmentId: "env_1", status: "open", message: "Broke on save",
      category: null, pageUrl: "https://app.example.com/settings", path: "/settings",
      tenantId: null, userId: null, sessionId: null, traceId: null,
      release: "1.4.0", source: "widget", userAgent: null, metadata: {},
      submittedAt: "2026-06-24T11:48:00.000Z", receivedAt: "2026-06-24T11:48:01.000Z", updatedAt: "2026-06-24T11:48:01.000Z",
    };
    const client = makeClient({
      getFeedbackWidgetSettings: vi.fn().mockResolvedValue({ settings }),
      updateFeedbackWidgetSettings: vi.fn().mockResolvedValue({ settings }),
      listFeedbackItems: vi.fn().mockResolvedValue({ feedback: [feedbackItem] }),
      updateFeedbackStatus: vi.fn().mockResolvedValue({ feedback: { ...feedbackItem, status: "reviewed" } }),
    });
    render(<SettingsScreen ctx={makeCtx({ client })} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    expect(await screen.findByText("Widget settings")).toBeInTheDocument();
    expect(screen.queryByText("Broke on save")).not.toBeInTheDocument();
  });
});
