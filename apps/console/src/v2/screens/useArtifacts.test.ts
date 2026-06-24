// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildArtifactsVM, formatBytes, useArtifacts } from "./useArtifacts";
import type { ApiClient } from "../../api/client";
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
    await waitFor(async () => { ok = await result.current.createToken("CI new"); });
    expect(ok).toBe(true);
    expect(client.createSourceMapUploadToken).toHaveBeenCalledWith({ projectId: "p", environmentId: "e", name: "CI new" });
    expect(result.current.latestSecret).toEqual({ name: "CI new", prefix: "shsmap_zz", secret: "shsmap_secret_value" });
  });

  it("revokes a token via the right client call", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useArtifacts({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(async () => { await result.current.revokeToken("tok_1"); });
    expect(client.revokeSourceMapUploadToken).toHaveBeenCalledWith("tok_1", { projectId: "p", environmentId: "e" });
  });
});
