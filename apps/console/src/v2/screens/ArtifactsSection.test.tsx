// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../api/client";
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
    uploadSourceMap: vi.fn().mockResolvedValue([artifact]),
    uploadSourceMapBundle: vi.fn().mockResolvedValue([artifact]),
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

  it("uploads a single source map and clears the completed form", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const file = new File(["{}"], "app.min.js.map", { type: "application/json" });
    render(<ArtifactsSection ctx={ctx} />);

    const form = await screen.findByRole("form", { name: "Upload source map" });
    fireEvent.change(within(form).getByLabelText("Release"), { target: { value: "2026.07.29" } });
    fireEvent.change(within(form).getByLabelText("Minified file path"), { target: { value: "assets/app.min.js" } });
    fireEvent.change(within(form).getByLabelText("Source map file"), { target: { files: [file] } });
    fireEvent.submit(form);

    await waitFor(() => expect(client.uploadSourceMap).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.07.29",
      minifiedFile: "assets/app.min.js",
      file,
    }));
    expect(ctx.pushToast).toHaveBeenCalledWith("Source map uploaded");
    expect(within(form).getByLabelText("Release")).toHaveValue("");
    expect(within(form).getByLabelText("Minified file path")).toHaveValue("");
  });

  it("uploads a source-map bundle", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const bundle = new File(["zip"], "source-maps.zip", { type: "application/zip" });
    render(<ArtifactsSection ctx={ctx} />);

    const form = await screen.findByRole("form", { name: "Upload source map bundle" });
    fireEvent.change(within(form).getByLabelText("Bundle release"), { target: { value: "2026.07.29" } });
    fireEvent.change(within(form).getByLabelText("Source map bundle"), { target: { files: [bundle] } });
    fireEvent.submit(form);

    await waitFor(() => expect(client.uploadSourceMapBundle).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.07.29",
      bundle,
    }));
    expect(ctx.pushToast).toHaveBeenCalledWith("Source map bundle uploaded");
  });

  it("validates required upload fields before calling the API", async () => {
    const client = makeClient();
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const form = await screen.findByRole("form", { name: "Upload source map" });

    fireEvent.submit(form);

    expect(await within(form).findByRole("alert")).toHaveTextContent("Release, minified file path, and source map file are required");
    expect(client.uploadSourceMap).not.toHaveBeenCalled();
  });

  it("keeps the bundle form populated and reports an upload failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ uploadSourceMapBundle: vi.fn().mockRejectedValue(new Error("offline")) });
    const ctx = makeCtx({ client });
    const bundle = new File(["zip"], "source-maps.zip", { type: "application/zip" });
    render(<ArtifactsSection ctx={ctx} />);
    const form = await screen.findByRole("form", { name: "Upload source map bundle" });
    const release = within(form).getByLabelText("Bundle release");
    fireEvent.change(release, { target: { value: "2026.07.29" } });
    fireEvent.change(within(form).getByLabelText("Source map bundle"), { target: { files: [bundle] } });

    fireEvent.submit(form);

    expect(await within(form).findByRole("alert")).toHaveTextContent("Could not upload source map bundle");
    expect(release).toHaveValue("2026.07.29");
    expect(ctx.pushToast).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("disables upload actions while a map is being sent", async () => {
    let finishUpload: ((value: SourceMapArtifact[]) => void) | undefined;
    const pendingUpload = new Promise<SourceMapArtifact[]>((resolve) => { finishUpload = resolve; });
    const client = makeClient({ uploadSourceMap: vi.fn().mockReturnValue(pendingUpload) });
    const file = new File(["{}"], "app.min.js.map", { type: "application/json" });
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const form = await screen.findByRole("form", { name: "Upload source map" });
    fireEvent.change(within(form).getByLabelText("Release"), { target: { value: "2026.07.29" } });
    fireEvent.change(within(form).getByLabelText("Minified file path"), { target: { value: "assets/app.min.js" } });
    fireEvent.change(within(form).getByLabelText("Source map file"), { target: { files: [file] } });

    fireEvent.submit(form);

    expect(await within(form).findByRole("button", { name: "Uploading map…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload bundle" })).toBeDisabled();
    finishUpload?.([artifact]);
    await waitFor(() => expect(within(form).getByRole("button", { name: "Upload map" })).toBeEnabled());
  });

  it("resets upload forms when the project or environment changes", async () => {
    const client = makeClient();
    const firstCtx = makeCtx({ client });
    const nextProject = { ...project, id: "prj_2", name: "Other" };
    const nextEnvironment = { ...environment, id: "env_2", projectId: "prj_2" };
    const { rerender } = render(<ArtifactsSection ctx={firstCtx} />);
    const mapForm = await screen.findByRole("form", { name: "Upload source map" });
    const bundleForm = screen.getByRole("form", { name: "Upload source map bundle" });
    fireEvent.change(within(mapForm).getByLabelText("Release"), { target: { value: "old-release" } });
    fireEvent.change(within(mapForm).getByLabelText("Minified file path"), { target: { value: "old.js" } });
    fireEvent.change(within(bundleForm).getByLabelText("Bundle release"), { target: { value: "old-release" } });

    rerender(<ArtifactsSection ctx={makeCtx({ client, project: nextProject, environment: nextEnvironment })} />);

    await waitFor(() => expect(within(mapForm).getByLabelText("Release")).toHaveValue(""));
    expect(within(mapForm).getByLabelText("Minified file path")).toHaveValue("");
    expect(within(bundleForm).getByLabelText("Bundle release")).toHaveValue("");
  });

  it("does not show stale success or errors after the active scope changes", async () => {
    let failUpload: ((error: Error) => void) | undefined;
    const pendingUpload = new Promise<SourceMapArtifact[]>((_resolve, reject) => { failUpload = reject; });
    const client = makeClient({ uploadSourceMap: vi.fn().mockReturnValue(pendingUpload) });
    const ctx = makeCtx({ client });
    const file = new File(["{}"], "app.min.js.map");
    const { rerender } = render(<ArtifactsSection ctx={ctx} />);
    const form = await screen.findByRole("form", { name: "Upload source map" });
    fireEvent.change(within(form).getByLabelText("Release"), { target: { value: "r1" } });
    fireEvent.change(within(form).getByLabelText("Minified file path"), { target: { value: "app.js" } });
    fireEvent.change(within(form).getByLabelText("Source map file"), { target: { files: [file] } });
    fireEvent.submit(form);
    await within(form).findByRole("button", { name: "Uploading map…" });

    rerender(<ArtifactsSection ctx={makeCtx({ client, environment: { ...environment, id: "env_2" } })} />);
    failUpload?.(new TypeError("Failed to fetch"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Uploading map…" })).not.toBeInTheDocument());
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
    expect(ctx.pushToast).not.toHaveBeenCalled();
  });

  it("rejects wrong file types and oversized bundles before upload", async () => {
    const client = makeClient();
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const mapForm = await screen.findByRole("form", { name: "Upload source map" });
    fireEvent.change(within(mapForm).getByLabelText("Release"), { target: { value: "r1" } });
    fireEvent.change(within(mapForm).getByLabelText("Minified file path"), { target: { value: "app.js" } });
    fireEvent.change(within(mapForm).getByLabelText("Source map file"), { target: { files: [new File(["{}"], "app.json")] } });
    fireEvent.submit(mapForm);
    expect(await within(mapForm).findByRole("alert")).toHaveTextContent(".map");

    const bundleForm = screen.getByRole("form", { name: "Upload source map bundle" });
    const oversized = new File(["x"], "maps.zip");
    Object.defineProperty(oversized, "size", { value: 50 * 1024 * 1024 + 1 });
    fireEvent.change(within(bundleForm).getByLabelText("Bundle release"), { target: { value: "r1" } });
    fireEvent.change(within(bundleForm).getByLabelText("Source map bundle"), { target: { files: [oversized] } });
    fireEvent.submit(bundleForm);
    expect(await within(bundleForm).findByRole("alert")).toHaveTextContent("50 MB");
    expect(client.uploadSourceMap).not.toHaveBeenCalled();
    expect(client.uploadSourceMapBundle).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_source_map_request", "Check the release"],
    [401, "unauthorized", "sign in again"],
    [413, "invalid_source_map_request", "50 MB"],
    [501, "source_maps_repository_unavailable", "not enabled"],
  ] as const)("shows actionable upload guidance for API %s", async (status, code, message) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ uploadSourceMap: vi.fn().mockRejectedValue(new ApiError(status, code)) });
    const file = new File(["{}"], "app.min.js.map");
    render(<ArtifactsSection ctx={makeCtx({ client })} />);
    const form = await screen.findByRole("form", { name: "Upload source map" });
    fireEvent.change(within(form).getByLabelText("Release"), { target: { value: "r1" } });
    fireEvent.change(within(form).getByLabelText("Minified file path"), { target: { value: "app.js" } });
    fireEvent.change(within(form).getByLabelText("Source map file"), { target: { files: [file] } });
    fireEvent.submit(form);

    expect(await within(form).findByRole("alert")).toHaveTextContent(new RegExp(message, "i"));
    if (status === 501) expect(within(form).getByRole("button", { name: "Upload map" })).toBeDisabled();
    consoleError.mockRestore();
  });
});
