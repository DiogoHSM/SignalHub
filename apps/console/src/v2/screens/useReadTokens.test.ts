// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildReadTokensVM, useReadTokens } from "./useReadTokens";
import { ApiError, type ApiClient } from "../../api/client";
import type { Environment, Project, ReadToken } from "../../api/types";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

const project: Project = { id: "prj_1", name: "Acme", createdAt: "x", updatedAt: "x", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "x", updatedAt: "x", archivedAt: null };

function tokenFixture(over: Partial<ReadToken> = {}): ReadToken {
  return {
    id: "rt_1", projectId: "prj_1", environmentId: "env_1", name: "mcp", prefix: "shread_ab",
    createdAt: "2026-06-24T10:00:00.000Z", lastUsedAt: "2026-06-24T11:00:00.000Z", revokedAt: null,
    ...over,
  };
}

function fakeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listReadTokens: vi.fn().mockResolvedValue({ tokens: [tokenFixture()] }),
    createReadToken: vi.fn().mockResolvedValue({ token: { ...tokenFixture({ id: "rt_new", name: "mcp" }), secret: "shread_visible_once" } }),
    renameReadToken: vi.fn().mockResolvedValue({ token: tokenFixture({ name: "renamed" }) }),
    revokeReadToken: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ApiClient;
}

function fakeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: fakeClient(),
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    createdSecret: null,
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

describe("buildReadTokensVM", () => {
  it("builds token rows with active/revoked status and lastUsed label", () => {
    const vm = buildReadTokensVM(
      { tokens: [tokenFixture(), tokenFixture({ id: "rt_2", name: "old", lastUsedAt: null, revokedAt: "2026-06-20T00:00:00.000Z" })] },
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
});

describe("useReadTokens hook", () => {
  it("loads read tokens and builds the VM", async () => {
    const client = fakeClient();
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.tokenCount).toBe(1);
  });

  it("reports 'unavailable' when the read-token API is absent", async () => {
    const client = {} as unknown as ApiClient;
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.data).toBeNull();
  });

  it("surfaces the created secret once and clears it on demand", async () => {
    const client = fakeClient({
      createReadToken: async () => ({ token: { ...tokenFixture(), secret: "shread_visible_once" } }),
    });
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    await act(async () => {
      await result.current.createToken("mcp");
    });

    expect(ctx.onSecretCreated).toHaveBeenCalledWith("shread_visible_once", "readToken");

    result.current.clearSecret();
    expect(ctx.onSecretCreated).toHaveBeenCalledWith(null, "readToken");
  });

  it("ignores a secret created by another credential surface", async () => {
    const client = fakeClient();
    const ctx = fakeCtx({ client, createdSecret: { value: "sh_live_browser_secret", kind: "browserApiKey" } });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.latestSecret).toBeNull();
  });

  it("never reads a secret back from the list", async () => {
    const client = fakeClient({ listReadTokens: async () => ({ tokens: [tokenFixture()] }) });
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(JSON.stringify(result.current.data)).not.toContain("shread_visible_once");
    expect(result.current.data?.tokens.every((t) => !("secret" in t))).toBe(true);
  });

  it("does not surface a secret created in a stale scope", async () => {
    let finish!: (value: { token: ReadToken & { secret: string } }) => void;
    const pending = new Promise<{ token: ReadToken & { secret: string } }>((resolve) => { finish = resolve; });
    const client = fakeClient({ createReadToken: vi.fn().mockReturnValue(pending) });
    const ctx = fakeCtx({ client });
    const { result, rerender } = renderHook(
      ({ projectId }) => useReadTokens({ client, ctx, projectId, environmentId: "env_1" }),
      { initialProps: { projectId: "prj_1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let creation!: Promise<boolean>;
    act(() => { creation = result.current.createToken("mcp"); });
    rerender({ projectId: "prj_2" });
    finish({ token: { ...tokenFixture(), secret: "must_not_leak" } });
    await act(async () => { await creation; });

    expect(ctx.onSecretCreated).not.toHaveBeenCalledWith("must_not_leak");
  });

  it("renames a token via the right client call", async () => {
    const client = fakeClient();
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await act(async () => { await result.current.renameToken("rt_1", "renamed"); });
    expect(client.renameReadToken).toHaveBeenCalledWith("rt_1", { projectId: "prj_1", environmentId: "env_1" }, { name: "renamed" });
  });

  it("revokes a token via the right client call", async () => {
    const client = fakeClient();
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await act(async () => { await result.current.revokeToken("rt_1"); });
    expect(client.revokeReadToken).toHaveBeenCalledWith("rt_1", { projectId: "prj_1", environmentId: "env_1" });
  });

  it("reports an error status when the list call rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient({ listReadTokens: vi.fn().mockRejectedValue(new ApiError(401, "unauthorized")) });
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    consoleError.mockRestore();
  });

  it("reports 'unavailable', not 'error', when the server 501s with read_tokens_repository_unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient({ listReadTokens: vi.fn().mockRejectedValue(new ApiError(501, "read_tokens_repository_unavailable")) });
    const ctx = fakeCtx({ client });
    const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.data).toBeNull();
    consoleError.mockRestore();
  });
});
