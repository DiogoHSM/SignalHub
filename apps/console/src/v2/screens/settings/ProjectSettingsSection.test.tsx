// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api/client";
import type {
  ApiKey,
  BrowserOrigin,
  CodeIntegration,
  DataGovernancePolicy,
  Environment,
  Project,
  ReleaseMetadata,
  WarehouseDestination,
  WarehouseExportRun,
} from "../../../api/types";
import type { NavSection } from "../../nav";
import type { ScreenCtx } from "../registry";
import { ProjectSettingsSection } from "./ProjectSettingsSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project: Project = {
  id: "prj_1",
  name: "Acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

const environment: Environment = {
  id: "env_1",
  projectId: project.id,
  name: "production",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

const apiKey: ApiKey = {
  id: "key_1",
  projectId: project.id,
  environmentId: environment.id,
  name: "browser-production",
  prefix: "sh_live_ab",
  capability: "browser",
  createdAt: "2026-01-02T00:00:00.000Z",
  revokedAt: null,
};

const browserOrigin: BrowserOrigin = {
  id: "origin_1",
  projectId: project.id,
  origin: "https://app.example.com",
  createdAt: "2026-01-03T00:00:00.000Z",
  archivedAt: null,
};

const releaseMetadata: ReleaseMetadata = {
  id: "relm_1",
  projectId: project.id,
  environmentId: environment.id,
  release: "web@1.2.3",
  integrationId: null,
  commitSha: "abcdef123456",
  commitUrl: null,
  pullRequestNumber: null,
  pullRequestUrl: null,
  deployedBy: "github-actions",
  createdAt: "2026-01-06T00:00:00.000Z",
  updatedAt: "2026-01-06T00:00:00.000Z",
};

const codeIntegration: CodeIntegration = {
  id: "cint_1",
  projectId: project.id,
  provider: "github",
  name: "Web repository",
  owner: "acme",
  repo: "web",
  webBaseUrl: "https://github.com/acme/web",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
};

const governancePolicy: DataGovernancePolicy = {
  projectId: project.id,
  environmentId: environment.id,
  retentionPolicy: { events: 45, errors: 180 },
  propertyRules: [{ target: "event.properties", path: "user.email", action: "mask" }],
  updatedByUserId: null,
  createdAt: "2026-01-04T00:00:00.000Z",
  updatedAt: "2026-01-04T00:00:00.000Z",
};

const destination: WarehouseDestination = {
  id: "wh_1",
  projectId: project.id,
  environmentId: environment.id,
  name: "Analytics Postgres",
  destinationType: "postgres",
  connectionUrlPreview: "postgres://writer:***@warehouse/sigmon",
  datasets: ["events", "errors"],
  cursor: {},
  batchSize: 500,
  enabled: true,
  lastRunAt: "2026-01-05T00:00:00.000Z",
  lastSuccessAt: "2026-01-05T00:00:00.000Z",
  lastFailureAt: null,
  lastErrorMessage: null,
  createdAt: "2026-01-04T00:00:00.000Z",
  updatedAt: "2026-01-05T00:00:00.000Z",
  archivedAt: null,
};

const run: WarehouseExportRun = {
  id: "run_1",
  destinationId: destination.id,
  projectId: project.id,
  environmentId: environment.id,
  trigger: "manual",
  status: "success",
  startedAt: "2026-01-05T00:00:00.000Z",
  finishedAt: "2026-01-05T00:00:01.000Z",
  cursorBefore: {},
  cursorAfter: {},
  exported: { events: 12, errors: 2 },
  errorMessage: null,
  createdAt: "2026-01-05T00:00:01.000Z",
};

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [apiKey] }),
    createApiKey: vi.fn().mockResolvedValue({ apiKey: { ...apiKey, id: "key_2", secret: "sh_live_new" } }),
    updateApiKey: vi.fn().mockResolvedValue({ apiKey: { ...apiKey, name: "renamed-key" } }),
    revokeApiKey: vi.fn().mockResolvedValue(undefined),
    listBrowserOrigins: vi.fn().mockResolvedValue({ origins: [browserOrigin] }),
    createBrowserOrigin: vi.fn().mockResolvedValue({
      origin: { ...browserOrigin, id: "origin_2", origin: "https://new.example.com" },
    }),
    archiveBrowserOrigin: vi.fn().mockResolvedValue(undefined),
    listCodeIntegrations: vi.fn().mockResolvedValue({ integrations: [codeIntegration] }),
    getDataGovernancePolicy: vi.fn().mockResolvedValue({ policy: governancePolicy }),
    updateDataGovernancePolicy: vi.fn().mockImplementation(async (input) => ({
      policy: { ...governancePolicy, retentionPolicy: input.retentionPolicy, propertyRules: input.propertyRules },
    })),
    listWarehouseDestinations: vi.fn().mockResolvedValue({ destinations: [destination] }),
    listWarehouseExportRuns: vi.fn().mockResolvedValue({ runs: [run] }),
    createWarehouseDestination: vi.fn().mockResolvedValue({
      destination: { ...destination, id: "wh_2", name: "Product warehouse" },
    }),
    updateWarehouseDestination: vi.fn().mockImplementation(async (_id, input) => ({
      destination: { ...destination, ...input },
    })),
    archiveWarehouseDestination: vi.fn().mockResolvedValue(undefined),
    runWarehouseExport: vi.fn().mockResolvedValue({ result: { ran: true, skipped: false, exported: 14, failed: 0 } }),
    upsertReleaseMetadata: vi.fn().mockResolvedValue({
      metadata: releaseMetadata,
    }),
    ...overrides,
  } as unknown as ApiClient;
}

function makeCtx(client = makeClient()): ScreenCtx {
  return {
    client,
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
    navigate: vi.fn() as (section: NavSection) => void,
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ProjectSettingsSection", () => {
  it("saves scoped release and code metadata from Releases & code", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    render(<ProjectSettingsSection ctx={ctx} />);

    fireEvent.click(screen.getByRole("button", { name: "Releases & code" }));
    fireEvent.change(await screen.findByLabelText("Release identifier"), { target: { value: "web@1.2.3" } });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: codeIntegration.id } });
    fireEvent.change(screen.getByLabelText("Commit SHA"), { target: { value: "abcdef123456" } });
    fireEvent.change(screen.getByLabelText("Deployed by"), { target: { value: "github-actions" } });
    fireEvent.click(screen.getByRole("button", { name: "Save release metadata" }));

    await waitFor(() => expect(client.upsertReleaseMetadata).toHaveBeenCalledWith(project.id, {
      environmentId: environment.id,
      release: "web@1.2.3",
      integrationId: codeIntegration.id,
      commitSha: "abcdef123456",
      commitUrl: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      deployedBy: "github-actions",
    }));
    expect(ctx.pushToast).toHaveBeenCalledWith("Release metadata saved");
  });

  it("does not apply a completed release mutation after the project scope changes", async () => {
    const save = deferred<{ metadata: ReleaseMetadata }>();
    const client = makeClient({ upsertReleaseMetadata: vi.fn(() => save.promise) });
    const firstCtx = makeCtx(client);
    const view = render(<ProjectSettingsSection ctx={firstCtx} />);

    fireEvent.click(screen.getByRole("button", { name: "Releases & code" }));
    fireEvent.change(await screen.findByLabelText("Release identifier"), { target: { value: "web@1.2.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save release metadata" }));

    const nextProject = { ...project, id: "prj_2", name: "Second" };
    const nextEnvironment = { ...environment, id: "env_2", projectId: nextProject.id };
    view.rerender(<ProjectSettingsSection ctx={{ ...firstCtx, project: nextProject, environment: nextEnvironment }} />);
    save.resolve({ metadata: releaseMetadata });
    await Promise.resolve();

    expect(firstCtx.pushToast).not.toHaveBeenCalledWith("Release metadata saved");
  });

  it("renames and revokes API keys in the selected environment", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    expect(await screen.findByText("browser-production")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename browser-production" }));
    fireEvent.change(screen.getByLabelText("API key name"), { target: { value: "renamed-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key name" }));

    await waitFor(() => expect(client.updateApiKey).toHaveBeenCalledWith("key_1", { name: "renamed-key" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke renamed-key" }));
    await waitFor(() => expect(client.revokeApiKey).toHaveBeenCalledWith("key_1"));
  });

  it("creates an API key with an explicit browser or server capability", async () => {
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(await screen.findByRole("button", { name: "New API key" }));
    expect(screen.getByLabelText("API key capability")).toHaveValue("browser");
    expect(screen.getByText(/Browser keys are public by design/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API key name"), { target: { value: "backend-identify" } });
    fireEvent.change(screen.getByLabelText("API key capability"), { target: { value: "server" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith(project.id, {
      environmentId: environment.id,
      name: "backend-identify",
      capability: "server",
    }));
  });

  it("adds and archives browser origins with explicit project scope", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Browser origins" }));
    expect(await screen.findByText("https://app.example.com")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Allowed browser origin"), {
      target: { value: "https://new.example.com/dashboard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add origin" }));

    await waitFor(() =>
      expect(client.createBrowserOrigin).toHaveBeenCalledWith(project.id, {
        origin: "https://new.example.com/dashboard",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive https://app.example.com" }));
    await waitFor(() => expect(client.archiveBrowserOrigin).toHaveBeenCalledWith("origin_1"));
  });

  it("updates retention and sensitive-property rules for the selected environment", async () => {
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Data governance" }));
    expect(await screen.findByLabelText("Events retention days")).toHaveValue(45);
    fireEvent.change(screen.getByLabelText("Events retention days"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() =>
      expect(client.updateDataGovernancePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: project.id, environmentId: environment.id, retentionPolicy: expect.objectContaining({ events: 60 }) }),
      ),
    );

    fireEvent.change(screen.getByLabelText("Property path"), { target: { value: "headers.authorization" } });
    fireEvent.click(screen.getByRole("button", { name: "Add masking rule" }));
    await waitFor(() =>
      expect(client.updateDataGovernancePolicy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          propertyRules: expect.arrayContaining([
            { target: "event.properties", path: "headers.authorization", action: "mask" },
          ]),
        }),
      ),
    );
  });

  it("creates, edits, runs, and archives warehouse destinations", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Warehouse sync" }));
    expect((await screen.findAllByText("Analytics Postgres")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("14 rows exported")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run Analytics Postgres now" }));
    await waitFor(() =>
      expect(client.runWarehouseExport).toHaveBeenCalledWith(destination.id, {
        projectId: project.id,
        environmentId: environment.id,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Analytics Postgres" }));
    fireEvent.change(screen.getByLabelText("Destination name"), { target: { value: "Analytics primary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
    await waitFor(() =>
      expect(client.updateWarehouseDestination).toHaveBeenCalledWith(
        destination.id,
        expect.objectContaining({ projectId: project.id, environmentId: environment.id, name: "Analytics primary" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "New destination" }));
    fireEvent.change(screen.getByLabelText("Destination name"), { target: { value: "Product warehouse" } });
    fireEvent.change(screen.getByLabelText("Postgres connection URL"), {
      target: { value: "postgres://writer:secret@warehouse/product" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create destination" }));
    await waitFor(() =>
      expect(client.createWarehouseDestination).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: project.id,
          environmentId: environment.id,
          name: "Product warehouse",
          batchSize: 500,
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Analytics primary postgres:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Archive Analytics primary" }));
    await waitFor(() =>
      expect(client.archiveWarehouseDestination).toHaveBeenCalledWith(destination.id, {
        projectId: project.id,
        environmentId: environment.id,
      }),
    );
  });

  it("uses persisted retention for rule changes and confirms rule removal", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Data governance" }));
    const events = await screen.findByLabelText("Events retention days");
    fireEvent.change(events, { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Property path"), { target: { value: "headers.authorization" } });
    fireEvent.click(screen.getByRole("button", { name: "Add masking rule" }));

    await waitFor(() => expect(client.updateDataGovernancePolicy).toHaveBeenCalled());
    expect(client.updateDataGovernancePolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({ retentionPolicy: expect.objectContaining({ events: 45 }) }),
    );
    expect(events).toHaveValue(60);

    fireEvent.click(screen.getByRole("button", { name: "Remove event.properties.user.email" }));
    expect(confirm).toHaveBeenCalledWith("Remove the sensitive-property rule event.properties.user.email?");
    await waitFor(() => expect(client.updateDataGovernancePolicy).toHaveBeenCalledTimes(2));
    expect(client.updateDataGovernancePolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({ retentionPolicy: expect.objectContaining({ events: 45 }) }),
    );
  });

  it("does not remove a governance rule when confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Data governance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove event.properties.user.email" }));
    expect(client.updateDataGovernancePolicy).not.toHaveBeenCalled();
  });

  it("rejects non-integer retention before calling the API", async () => {
    const client = makeClient();
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Data governance" }));
    fireEvent.change(await screen.findByLabelText("Events retention days"), { target: { value: "45.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Retention must be a whole number from 1 to 3650 days.");
    expect(client.updateDataGovernancePolicy).not.toHaveBeenCalled();
  });

  it("clears open editors synchronously when project scope changes", async () => {
    const client = makeClient();
    const firstCtx = makeCtx(client);
    const { rerender } = render(<ProjectSettingsSection ctx={firstCtx} />);

    fireEvent.click(await screen.findByRole("button", { name: "Rename browser-production" }));
    expect(screen.getByLabelText("API key name")).toBeInTheDocument();

    const nextProject = { ...project, id: "prj_2", name: "Second" };
    const nextEnvironment = { ...environment, id: "env_2", projectId: nextProject.id };
    rerender(<ProjectSettingsSection ctx={{ ...firstCtx, project: nextProject, environment: nextEnvironment }} />);
    expect(screen.queryByLabelText("API key name")).not.toBeInTheDocument();
  });

  it("shows warehouse history errors and failed run details without hiding the destination", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failedRun: WarehouseExportRun = {
      ...run,
      id: "run_failed",
      status: "failed",
      exported: {},
      errorMessage: "permission denied for schema analytics",
    };
    const client = makeClient({ listWarehouseExportRuns: vi.fn().mockResolvedValue({ runs: [failedRun] }) });
    const view = render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Warehouse sync" }));
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("permission denied for schema analytics")).toBeInTheDocument();

    const historyFailure = makeClient({ listWarehouseExportRuns: vi.fn().mockRejectedValue(new Error("offline")) });
    view.rerender(<ProjectSettingsSection ctx={makeCtx(historyFailure)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load warehouse export history.");
    expect(screen.getAllByText("Analytics Postgres").length).toBeGreaterThan(0);
  });

  it("disables every warehouse destructive action while a mutation is in flight", async () => {
    const pending = deferred<{ result: { ran: boolean; skipped: boolean; exported: number; failed: number } }>();
    const client = makeClient({ runWarehouseExport: vi.fn(() => pending.promise) });
    render(<ProjectSettingsSection ctx={makeCtx(client)} />);

    fireEvent.click(screen.getByRole("button", { name: "Warehouse sync" }));
    const runNow = await screen.findByRole("button", { name: "Run Analytics Postgres now" });
    fireEvent.click(runNow);
    expect(runNow).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Analytics Postgres" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive Analytics Postgres" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New destination" })).toBeDisabled();
    pending.resolve({ result: { ran: true, skipped: false, exported: 1, failed: 0 } });
  });

  it("offers user and tenant profile datasets for warehouse destinations", async () => {
    render(<ProjectSettingsSection ctx={makeCtx()} />);

    fireEvent.click(screen.getByRole("button", { name: "Warehouse sync" }));
    fireEvent.click(await screen.findByRole("button", { name: "New destination" }));

    expect(screen.getByLabelText("User profiles")).toBeInTheDocument();
    expect(screen.getByLabelText("Tenant profiles")).toBeInTheDocument();
  });
});
