import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, SourceMapApiClient } from "../api/client";
import type { SourceMapArtifact } from "../api/types";
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
    updateErrorGroupStatus: vi.fn(),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    uploadSourceMap: vi.fn().mockResolvedValue([]),
    uploadSourceMapBundle: vi.fn().mockResolvedValue([]),
    deleteSourceMapArtifact: vi.fn().mockResolvedValue(undefined),
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
    await userEvent.type(within(mapForm).getByLabelText("Release"), "2026.05.11");
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
    await userEvent.type(within(bundleForm).getByLabelText("Release"), "2026.05.11");
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
    await userEvent.click(screen.getByRole("button", { name: "Delete app.min.js.map" }));

    await waitFor(() =>
      expect(deleteSourceMapArtifact).toHaveBeenCalledWith("smap_1", { projectId: "prj_1", environmentId: "env_1" })
    );
  });
});
