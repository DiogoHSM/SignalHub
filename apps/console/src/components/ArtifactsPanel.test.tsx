import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, SourceMapApiClient } from "../api/client";
import type { SourceMapArtifact, SourceMapUploadToken } from "../api/types";
import { ArtifactsPanel } from "./ArtifactsPanel";

function client(overrides: Partial<ApiClient & SourceMapApiClient> = {}): ApiClient & SourceMapApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn(),
    listTraceSpans: vi.fn(),
    listLlmCalls: vi.fn(),
    getLlmAggregates: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn(),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    listAlertEvents: vi.fn(),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn(),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    uploadSourceMap: vi.fn().mockResolvedValue([]),
    uploadSourceMapBundle: vi.fn().mockResolvedValue([]),
    deleteSourceMapArtifact: vi.fn().mockResolvedValue(undefined),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
    createSourceMapUploadToken: vi.fn(),
    updateSourceMapUploadToken: vi.fn(),
    revokeSourceMapUploadToken: vi.fn().mockResolvedValue(undefined),
    getErrorSourceMapResolution: vi.fn(),
    ...overrides
  };
}

function artifact(overrides: Partial<SourceMapArtifact> = {}): SourceMapArtifact {
  return {
    id: "smap_1",
    projectId: "prj_1",
    environmentId: "env_1",
    release: "2026.05.11",
    minifiedFile: "assets/app.min.js",
    originalFilename: "app.min.js.map",
    byteSize: 1234,
    sha256: "sha",
    createdAt: "2026-05-11T12:00:00.000Z",
    uploadedByUserId: "usr_1",
    ...overrides
  };
}

function uploadToken(overrides: Partial<SourceMapUploadToken> = {}): SourceMapUploadToken {
  return {
    id: "smtok_1",
    projectId: "prj_1",
    environmentId: "env_1",
    name: "GitHub Actions",
    prefix: "shsmap_test",
    createdAt: "2026-05-11T12:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("ArtifactsPanel", () => {
  it("uploads a source map file for the active project and environment", async () => {
    const uploadSourceMap = vi.fn().mockResolvedValue([artifact()]);
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      uploadSourceMap
    });
    const file = new File(["{}"], "app.min.js.map", { type: "application/json" });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No source maps uploaded.");
    const mapForm = screen.getByRole("form", { name: "Upload source map" });
    await userEvent.type(within(mapForm).getByLabelText("Single map release"), "2026.05.11");
    await userEvent.type(within(mapForm).getByLabelText("Minified file"), "assets/app.min.js");
    await userEvent.upload(within(mapForm).getByLabelText("Source map file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload map" }));

    await waitFor(() =>
      expect(uploadSourceMap).toHaveBeenCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        release: "2026.05.11",
        minifiedFile: "assets/app.min.js",
        file
      })
    );
  });

  it("uploads a source map bundle", async () => {
    const uploadSourceMapBundle = vi.fn().mockResolvedValue([artifact({ id: "smap_2" })]);
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      uploadSourceMapBundle
    });
    const file = new File(["zip"], "maps.zip", { type: "application/zip" });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No source maps uploaded.");
    const bundleForm = screen.getByRole("form", { name: "Upload source map bundle" });
    await userEvent.type(within(bundleForm).getByLabelText("Bundle release"), "2026.05.11");
    await userEvent.upload(screen.getByLabelText("Source map bundle"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload bundle" }));

    await waitFor(() =>
      expect(uploadSourceMapBundle).toHaveBeenCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        release: "2026.05.11",
        bundle: file
      })
    );
  });

  it("deletes an uploaded source map artifact", async () => {
    const deleteSourceMapArtifact = vi.fn().mockResolvedValue(undefined);
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([artifact()]),
      deleteSourceMapArtifact
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("assets/app.min.js")).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", { name: "Delete app.min.js.map" });
    expect(deleteButton).toHaveTextContent("Delete");
    await userEvent.click(deleteButton);

    await waitFor(() =>
      expect(deleteSourceMapArtifact).toHaveBeenCalledWith("smap_1", { projectId: "prj_1", environmentId: "env_1" })
    );
  });

  it("keeps the latest same-scope artifact load when earlier requests resolve later", async () => {
    const firstLoad = deferred<SourceMapArtifact[]>();
    const secondLoad = deferred<SourceMapArtifact[]>();
    const listSourceMapArtifacts = vi
      .fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);
    const api = client({ listSourceMapArtifacts });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await waitFor(() => expect(listSourceMapArtifacts).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByLabelText("Filter by release"), "release-b{Enter}");
    await waitFor(() => expect(listSourceMapArtifacts).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondLoad.resolve([artifact({ id: "smap_b", minifiedFile: "assets/release-b.min.js", release: "release-b" })]);
      await secondLoad.promise;
    });

    expect(await screen.findByText("assets/release-b.min.js")).toBeInTheDocument();

    await act(async () => {
      firstLoad.resolve([artifact({ id: "smap_a", minifiedFile: "assets/release-a.min.js", release: "release-a" })]);
      await firstLoad.promise;
    });

    expect(screen.getByText("assets/release-b.min.js")).toBeInTheDocument();
    expect(screen.queryByText("assets/release-a.min.js")).not.toBeInTheDocument();
  });

  it("does not render or delete artifacts outside the current scope", async () => {
    const deleteSourceMapArtifact = vi.fn().mockResolvedValue(undefined);
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([
        artifact({
          id: "smap_old",
          projectId: "prj_old",
          environmentId: "env_old",
          minifiedFile: "assets/old-scope.min.js",
          originalFilename: "old-scope.min.js.map"
        })
      ]),
      deleteSourceMapArtifact
    });

    render(<ArtifactsPanel client={api} environmentId="env_new" projectId="prj_new" />);

    await waitFor(() => expect(api.listSourceMapArtifacts).toHaveBeenCalledWith({ projectId: "prj_new", environmentId: "env_new" }));
    expect(screen.queryByText("assets/old-scope.min.js")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete old-scope.min.js.map" })).not.toBeInTheDocument();
    expect(deleteSourceMapArtifact).not.toHaveBeenCalled();
  });

  it("keeps visible release labels while exposing distinct accessible names", async () => {
    const api = client({ listSourceMapArtifacts: vi.fn().mockResolvedValue([]) });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No source maps uploaded.");
    expect(screen.getAllByText("Release")).toHaveLength(2);
    expect(screen.getByLabelText("Single map release")).toBeInTheDocument();
    expect(screen.getByLabelText("Bundle release")).toBeInTheDocument();
  });

  it("loads source map upload tokens for the active project and environment", async () => {
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({
        tokens: [
          {
            id: "smtok_1",
            projectId: "prj_1",
            environmentId: "env_1",
            name: "GitHub Actions",
            prefix: "shsmap_test",
            createdAt: "2026-05-11T12:00:00.000Z",
            lastUsedAt: null,
            revokedAt: null
          }
        ]
      })
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Upload tokens")).toBeInTheDocument();
    expect(await screen.findByText("GitHub Actions")).toBeInTheDocument();
    expect(api.listSourceMapUploadTokens).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
  });

  it("creates a source map upload token and shows its secret once", async () => {
    const createSourceMapUploadToken = vi.fn().mockResolvedValue({
      token: {
        ...uploadToken(),
        secret: "shsmap_secret"
      }
    });
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
      createSourceMapUploadToken
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.type(await screen.findByLabelText("Token name"), "GitHub Actions");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("shsmap_secret")).toBeInTheDocument();
    expect(api.createSourceMapUploadToken).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions"
    });
  });

  it("revokes source map upload tokens", async () => {
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({
        tokens: [
          {
            id: "smtok_1",
            projectId: "prj_1",
            environmentId: "env_1",
            name: "GitHub Actions",
            prefix: "shsmap_test",
            createdAt: "2026-05-11T12:00:00.000Z",
            lastUsedAt: null,
            revokedAt: null
          }
        ]
      }),
      revokeSourceMapUploadToken: vi.fn().mockResolvedValue(undefined)
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Revoke GitHub Actions" }));

    expect(api.revokeSourceMapUploadToken).toHaveBeenCalledWith("smtok_1", { projectId: "prj_1", environmentId: "env_1" });
  });

  it("renames source map upload tokens", async () => {
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [uploadToken()] }),
      updateSourceMapUploadToken: vi.fn().mockResolvedValue({
        token: uploadToken({ name: "Production sourcemaps" })
      })
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit GitHub Actions" }));
    await userEvent.clear(screen.getByLabelText("Token name"));
    await userEvent.type(screen.getByLabelText("Token name"), "Production sourcemaps");
    await userEvent.click(screen.getByRole("button", { name: "Save token" }));

    await waitFor(() =>
      expect(api.updateSourceMapUploadToken).toHaveBeenCalledWith(
        "smtok_1",
        { projectId: "prj_1", environmentId: "env_1" },
        { name: "Production sourcemaps" }
      )
    );
    expect(await screen.findByText("Production sourcemaps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create token" })).toBeInTheDocument();
  });

  it("keeps a created token when an earlier same-scope token load resolves later", async () => {
    const firstTokenLoad = deferred<{ tokens: SourceMapUploadToken[] }>();
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockReturnValueOnce(firstTokenLoad.promise),
      createSourceMapUploadToken: vi.fn().mockResolvedValue({
        token: {
          ...uploadToken(),
          secret: "shsmap_secret"
        }
      })
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.type(screen.getByLabelText("Token name"), "GitHub Actions");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("button", { name: "Revoke GitHub Actions" })).toBeInTheDocument();

    await act(async () => {
      firstTokenLoad.resolve({ tokens: [] });
      await firstTokenLoad.promise;
    });

    expect(screen.getByRole("button", { name: "Revoke GitHub Actions" })).toBeInTheDocument();
  });

  it("shows an error when source map upload token creation fails", async () => {
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
      createSourceMapUploadToken: vi.fn().mockRejectedValue(new Error("failed"))
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.type(await screen.findByLabelText("Token name"), "GitHub Actions");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create source map upload token");
  });

  it("shows an error when source map upload token revocation fails", async () => {
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [uploadToken()] }),
      revokeSourceMapUploadToken: vi.fn().mockRejectedValue(new Error("failed"))
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Revoke GitHub Actions" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not revoke source map upload token");
  });

  it("keeps source map artifacts available when upload token methods are unavailable", async () => {
    const api = client({
      listSourceMapArtifacts: vi.fn().mockResolvedValue([artifact()]),
      listSourceMapUploadTokens: undefined,
      createSourceMapUploadToken: undefined,
      revokeSourceMapUploadToken: undefined
    });

    render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("assets/app.min.js")).toBeInTheDocument();
    expect(screen.getByText("Upload tokens unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Token name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
  });
});
