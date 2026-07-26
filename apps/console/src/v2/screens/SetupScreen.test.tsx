// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, FeedbackItem, FeedbackWidgetSettings, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { SetupScreen } from "./SetupScreen";
import type { ScreenCtx } from "./registry";

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
    createApiKey: vi.fn().mockResolvedValue({ apiKey: { id: "key_1", projectId: "prj_1", environmentId: "env_1", name: "k", prefix: "sh_live_ab", createdAt: "x", revokedAt: null, secret: "sh_live_browser_secret_value" } }),
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

describe("SetupScreen", () => {
  it("renders the page head and onboarding stepper", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();
    expect(screen.getByText("Send first signal")).toBeInTheDocument();
  });

  it("shows the active project with the selected tag", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("selected")).toBeInTheDocument();
    expect(screen.getAllByText("Acme").length).toBeGreaterThanOrEqual(1);
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
    expect(screen.getByText(/pip install sigmon-sdk/)).toBeInTheDocument();
  });

  it("generates an API key and reveals the one-time secret", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const generate = await screen.findByRole("button", { name: /Generate API key/ });
    fireEvent.click(generate);
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1", name: "console-production" }));
    expect(await screen.findByText(/Copy/)).toBeInTheDocument();
  });

  it("creates a project from the inline input", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    await screen.findByText("Projects");
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const input = screen.getByLabelText("New project name");
    fireEvent.change(input, { target: { value: "New API" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.createProject).toHaveBeenCalledWith({ name: "New API" }));
  });

  it("archives a project", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const archive = await screen.findByRole("button", { name: "Archive Acme" });
    fireEvent.click(archive);
    await waitFor(() => expect(client.archiveProject).toHaveBeenCalledWith("prj_1"));
  });

  it("renames a project from the inline editor", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const rename = await screen.findByRole("button", { name: "Rename Acme" });
    fireEvent.click(rename);
    const input = screen.getByLabelText("Rename project");
    fireEvent.change(input, { target: { value: "Acme Corp" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.updateProject).toHaveBeenCalledWith("prj_1", { name: "Acme Corp" }));
  });

  it("stubs the test ping with a toast", async () => {
    const ctx = makeCtx();
    render(<SetupScreen ctx={ctx} />);
    const ping = await screen.findByRole("button", { name: "Send ping" });
    fireEvent.click(ping);
    expect(ctx.pushToast).toHaveBeenCalledWith("Test ping is not yet available");
  });

  it("mounts the artifacts section", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Source map artifacts")).toBeInTheDocument();
    expect(screen.getByText("CI upload tokens")).toBeInTheDocument();
  });

  it("hides the feedback section when the client does not expose the feedback API", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
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
    render(<SetupScreen ctx={makeCtx({ client })} />);
    expect(await screen.findByText("Widget settings")).toBeInTheDocument();
    expect(screen.getByText("Broke on save")).toBeInTheDocument();
  });
});
