// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_SOURCE_MAP_UPLOAD_BYTES,
  buildArtifactsVM,
  formatBytes,
  useArtifacts,
  validateSourceMapUploadFile,
} from "./useArtifacts";
import { ApiError, type ApiClient } from "../../api/client";
import type { SourceMapArtifact, SourceMapUploadToken } from "../../api/types";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

function artifact(over: Partial<SourceMapArtifact> = {}): SourceMapArtifact {
  return {
    id: "sm_1", projectId: "p", environmentId: "e", release: "1.4.0",
    minifiedFile: "app.min.js", originalFilename: "app.min.js.map", byteSize: 2048,
    sha256: "abc", createdAt: "2026-06-24T11:48:00.000Z", uploadedByUserId: "u1",
    ...over,
  };
}

function token(over: Partial<SourceMapUploadToken> = {}): SourceMapUploadToken {
  return {
    id: "tok_1", projectId: "p", environmentId: "e", name: "CI main", prefix: "shsmap_ab",
    createdAt: "2026-06-24T10:00:00.000Z", lastUsedAt: "2026-06-24T11:00:00.000Z", revokedAt: null,
    ...over,
  };
}

describe("formatBytes", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("validateSourceMapUploadFile", () => {
  it("accepts .map files and .zip bundles within the server upload limit", () => {
    expect(validateSourceMapUploadFile(new File(["{}"], "app.js.map"), "map")).toBeNull();
    expect(validateSourceMapUploadFile(new File(["zip"], "maps.ZIP"), "bundle")).toBeNull();
  });

  it("rejects mismatched extensions and files above the 50 MB server limit", () => {
    expect(validateSourceMapUploadFile(new File(["{}"], "app.json"), "map")).toMatch(/\.map/);
    expect(validateSourceMapUploadFile(new File(["zip"], "maps.tar"), "bundle")).toMatch(/\.zip/);
    const oversized = new File(["x"], "maps.zip");
    Object.defineProperty(oversized, "size", { value: MAX_SOURCE_MAP_UPLOAD_BYTES + 1 });
    expect(validateSourceMapUploadFile(oversized, "bundle")).toMatch(/50 MB/);
  });
});

describe("buildArtifactsVM", () => {
  it("builds artifact rows with byte-size and relative createdAt", () => {
    const vm = buildArtifactsVM(
      { artifacts: [artifact()], tokens: [], artifactsAvailable: true, tokensAvailable: true },
      NOW,
    );
    expect(vm.artifactCount).toBe(1);
    const row = vm.artifacts[0];
    expect(row.minifiedFile).toBe("app.min.js");
    expect(row.release).toBe("1.4.0");
    expect(row.byteSizeLabel).toBe("2.0 KB");
    expect(row.createdLabel).toBe("12m ago");
  });

  it("builds token rows with active/revoked status and lastUsed label", () => {
    const vm = buildArtifactsVM(
      {
        artifacts: [],
        tokens: [token(), token({ id: "tok_2", name: "old", lastUsedAt: null, revokedAt: "2026-06-20T00:00:00.000Z" })],
        artifactsAvailable: true,
        tokensAvailable: true,
      },
      NOW,
    );
    expect(vm.tokenCount).toBe(2);
    expect(vm.tokens[0].revoked).toBe(false);
    expect(vm.tokens[0].statusLabel).toBe("active");
    expect(vm.tokens[0].lastUsedLabel).toBe("1h ago");
    expect(vm.tokens[1].revoked).toBe(true);
    expect(vm.tokens[1].statusLabel).toBe("revoked");
    expect(vm.tokens[1].lastUsedLabel).toBe("never");
  });

  it("carries availability flags", () => {
    const vm = buildArtifactsVM(
      { artifacts: [], tokens: [], artifactsAvailable: false, tokensAvailable: true },
      NOW,
    );
    expect(vm.artifactsAvailable).toBe(false);
    expect(vm.tokensAvailable).toBe(true);
  });
});

describe("useArtifacts hook", () => {
  function makeClient(over: Partial<ApiClient> = {}): ApiClient {
    return {
      listSourceMapArtifacts: vi.fn().mockResolvedValue([artifact()]),
      listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [token()] }),
      uploadSourceMap: vi.fn().mockResolvedValue([artifact()]),
      uploadSourceMapBundle: vi.fn().mockResolvedValue([artifact({ id: "sm_bundle" })]),
      deleteSourceMapArtifact: vi.fn().mockResolvedValue(undefined),
      createSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { ...token({ id: "tok_new", name: "CI new", prefix: "shsmap_zz" }), secret: "shsmap_secret_value" } }),
      updateSourceMapUploadToken: vi.fn().mockResolvedValue({ token: token({ name: "renamed" }) }),
      revokeSourceMapUploadToken: vi.fn().mockResolvedValue(undefined),
      ...over,
    } as unknown as ApiClient;
  }

  it("loads artifacts + tokens and builds the VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.artifactCount).toBe(1);
    expect(result.current.data?.tokenCount).toBe(1);
  });

  it("reports 'unavailable' when both families are absent", async () => {
    const client = {} as unknown as ApiClient;
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.data).toBeNull();
  });

  it("creates a token and exposes the one-time secret", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let ok = false;
    await act(async () => { ok = await result.current.createToken("CI new"); });
    expect(ok).toBe(true);
    expect(client.createSourceMapUploadToken).toHaveBeenCalledWith({ projectId: "p", environmentId: "e", name: "CI new" });
    expect(result.current.latestSecret).toEqual({ name: "CI new", prefix: "shsmap_zz", secret: "shsmap_secret_value" });
  });

  it("does not expose a token secret after the scope changes", async () => {
    let finish!: (value: { token: ReturnType<typeof token> & { secret: string } }) => void;
    const pending = new Promise<{ token: ReturnType<typeof token> & { secret: string } }>((resolve) => { finish = resolve; });
    const client = makeClient({ createSourceMapUploadToken: vi.fn().mockReturnValue(pending) });
    const { result, rerender } = renderHook(
      ({ projectId }) => useArtifacts({ client, projectId, environmentId: "e" }),
      { initialProps: { projectId: "p" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let creation!: Promise<boolean>;
    act(() => { creation = result.current.createToken("CI old scope"); });
    rerender({ projectId: "p2" });
    finish({ token: { ...token({ name: "CI old scope" }), secret: "must_not_leak" } });
    await act(async () => { await creation; });

    expect(result.current.latestSecret).toBeNull();
  });

  it("revokes a token via the right client call", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await act(async () => { await result.current.revokeToken("tok_1"); });
    expect(client.revokeSourceMapUploadToken).toHaveBeenCalledWith("tok_1", { projectId: "p", environmentId: "e" });
  });

  it("uploads one source map through the scoped client", async () => {
    const client = makeClient();
    const file = new File(["{}"], "app.min.js.map", { type: "application/json" });
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok: Awaited<ReturnType<typeof result.current.uploadMap>> | undefined;
    await act(async () => {
      ok = await result.current.uploadMap({ release: "2026.07.29", minifiedFile: "assets/app.min.js", file });
    });

    expect(ok).toEqual({ ok: true });
    expect(client.uploadSourceMap).toHaveBeenCalledWith({
      projectId: "p",
      environmentId: "e",
      release: "2026.07.29",
      minifiedFile: "assets/app.min.js",
      file,
    });
  });

  it("uploads a source-map bundle through the scoped client", async () => {
    const client = makeClient();
    const bundle = new File(["zip"], "source-maps.zip", { type: "application/zip" });
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok: Awaited<ReturnType<typeof result.current.uploadBundle>> | undefined;
    await act(async () => {
      ok = await result.current.uploadBundle({ release: "2026.07.29", bundle });
    });

    expect(ok).toEqual({ ok: true });
    expect(client.uploadSourceMapBundle).toHaveBeenCalledWith({
      projectId: "p",
      environmentId: "e",
      release: "2026.07.29",
      bundle,
    });
  });

  it("uses a synchronous single-flight lock for uploads", async () => {
    let finish: ((value: SourceMapArtifact[]) => void) | undefined;
    const pending = new Promise<SourceMapArtifact[]>((resolve) => { finish = resolve; });
    const client = makeClient({ uploadSourceMap: vi.fn().mockReturnValue(pending) });
    const file = new File(["{}"], "app.min.js.map");
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let first: ReturnType<typeof result.current.uploadMap>;
    let second: Awaited<ReturnType<typeof result.current.uploadMap>> | undefined;
    act(() => {
      first = result.current.uploadMap({ release: "r1", minifiedFile: "app.js", file });
      void result.current.uploadMap({ release: "r1", minifiedFile: "app.js", file }).then((value) => { second = value; });
    });
    await waitFor(() => expect(second).toEqual({ ok: false, reason: "busy" }));
    expect(client.uploadSourceMap).toHaveBeenCalledTimes(1);
    finish?.([artifact()]);
    await act(async () => { await first!; });
  });

  it("ignores a mutation completion from a previous project scope", async () => {
    let finish: ((value: SourceMapArtifact[]) => void) | undefined;
    const pending = new Promise<SourceMapArtifact[]>((resolve) => { finish = resolve; });
    const client = makeClient({ uploadSourceMap: vi.fn().mockReturnValue(pending) });
    const file = new File(["{}"], "app.min.js.map");
    const { result, rerender } = renderHook(
      ({ projectId }) => useArtifacts({ client, projectId, environmentId: "e" }),
      { initialProps: { projectId: "p" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let uploadResult: Awaited<ReturnType<typeof result.current.uploadMap>> | undefined;
    act(() => {
      void result.current.uploadMap({ release: "r1", minifiedFile: "app.js", file }).then((value) => { uploadResult = value; });
    });
    rerender({ projectId: "p2" });
    finish?.([artifact()]);

    await waitFor(() => expect(uploadResult).toEqual({ ok: false, reason: "stale" }));
  });

  it.each([
    [400, "invalid_source_map_request", "invalid", "Check the release"],
    [401, "unauthorized", "unauthorized", "sign in again"],
    [413, "invalid_source_map_request", "too_large", "50 MB"],
    [501, "source_maps_repository_unavailable", "unavailable", "not enabled"],
  ] as const)("preserves and maps ApiError %s/%s", async (status, code, kind, message) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ uploadSourceMap: vi.fn().mockRejectedValue(new ApiError(status, code)) });
    const file = new File(["{}"], "app.min.js.map");
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let uploadResult: Awaited<ReturnType<typeof result.current.uploadMap>> | undefined;
    await act(async () => {
      uploadResult = await result.current.uploadMap({ release: "r1", minifiedFile: "app.js", file });
    });

    expect(uploadResult).toMatchObject({
      ok: false,
      reason: "error",
      error: { kind, status, code, message: expect.stringMatching(new RegExp(message, "i")) },
    });
    if (status === 501) expect(result.current.canUploadMap).toBe(false);
    consoleError.mockRestore();
  });

  it("maps browser network failures without losing the actionable state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ uploadSourceMapBundle: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    const bundle = new File(["zip"], "maps.zip");
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let uploadResult: Awaited<ReturnType<typeof result.current.uploadBundle>> | undefined;
    await act(async () => { uploadResult = await result.current.uploadBundle({ release: "r1", bundle }); });

    expect(uploadResult).toMatchObject({ ok: false, reason: "error", error: { kind: "network", status: null, code: null } });
    consoleError.mockRestore();
  });
});
