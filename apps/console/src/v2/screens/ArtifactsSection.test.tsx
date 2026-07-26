// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, Project, SourceMapArtifact, SourceMapUploadToken } from "../../api/types";
import type { NavSection } from "../nav";
import { ArtifactsSection } from "./ArtifactsSection";
import type { ScreenCtx } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "x", updatedAt: "x", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "x", updatedAt: "x", archivedAt: null };

const artifact: SourceMapArtifact = {
  id: "sm_1", projectId: "prj_1", environmentId: "env_1", release: "1.4.0",
  minifiedFile: "app.min.js", originalFilename: "app.min.js.map", byteSize: 2048,
  sha256: "abc", createdAt: "2026-06-24T11:48:00.000Z", uploadedByUserId: "u1",
};
const tokenRow: SourceMapUploadToken = {
  id: "tok_1", projectId: "prj_1", environmentId: "env_1", name: "CI main", prefix: "shsmap_ab",
  createdAt: "2026-06-24T10:00:00.000Z", lastUsedAt: "2026-06-24T11:00:00.000Z", revokedAt: null,
};

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listSourceMapArtifacts: vi.fn().mockResolvedValue([artifact]),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [tokenRow] }),
    deleteSourceMapArtifact: vi.fn().mockResolvedValue(undefined),
    createSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { ...tokenRow, id: "tok_new", name: "CI new", prefix: "shsmap_zz", secret: "shsmap_secret_value" } }),
    updateSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { ...tokenRow, name: "renamed" } }),
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
    onCreateEnvironment: vi.fn(),
    onArchiveEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    onUpdateEnvironment: vi.fn(),
    navigate: vi.fn() as (s: NavSection) => void,
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  };
}

describe("ArtifactsSection", () => {
  it("renders both cards with artifact and token rows", async () => {
    render(<ArtifactsSection ctx={makeCtx()} />);
    expect(await screen.findByText("Source map artifacts")).toBeInTheDocument();
    expect(screen.getByText("CI upload tokens")).toBeInTheDocument();
    expect(screen.getByText("app.min.js")).toBeInTheDocument();
    expect(screen.getByText("CI main")).toBeInTheDocument();
  });

  it("deletes an artifact after confirm", async () => {
    const client = makeClient();
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const del = await screen.findByRole("button", { name: "Delete app.min.js.map" });
    fireEvent.click(del); // arm
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); // confirm
    await waitFor(() => expect(client.deleteSourceMapArtifact).toHaveBeenCalledWith("sm_1", { projectId: "prj_1", environmentId: "env_1" }));
  });

  it("creates a token and reveals the one-time secret", async () => {
    const client = makeClient();
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    fireEvent.click(await screen.findByRole("button", { name: "New token" }));
    const input = screen.getByLabelText("New token name");
    fireEvent.change(input, { target: { value: "CI new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.createSourceMapUploadToken).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", name: "CI new" }));
    expect(await screen.findByText(/shown only once/i)).toBeInTheDocument();
  });

  it("renames a token from the inline editor", async () => {
    const client = makeClient();
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const rename = await screen.findByRole("button", { name: "Rename CI main" });
    fireEvent.click(rename);
    const input = screen.getByLabelText("Rename token");
    fireEvent.change(input, { target: { value: "CI prod" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.updateSourceMapUploadToken).toHaveBeenCalledWith("tok_1", { projectId: "prj_1", environmentId: "env_1" }, { name: "CI prod" }));
  });

  it("revokes a token after confirm", async () => {
    const client = makeClient();
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const revoke = await screen.findByRole("button", { name: "Revoke CI main" });
    fireEvent.click(revoke); // arm
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); // confirm
    await waitFor(() => expect(client.revokeSourceMapUploadToken).toHaveBeenCalledWith("tok_1", { projectId: "prj_1", environmentId: "env_1" }));
  });

  it("shows an unavailable hint when the artifacts API is absent", async () => {
    render(<ArtifactsSection ctx={makeCtx({ client: {} as unknown as ApiClient })} />);
    expect(await screen.findByText(/Artifacts API unavailable/i)).toBeInTheDocument();
  });
});
