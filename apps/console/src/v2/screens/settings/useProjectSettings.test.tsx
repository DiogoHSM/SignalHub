// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../../api/client";
import type {
  ApiKey,
  DataGovernancePolicy,
  Environment,
  Project,
  WarehouseDestination,
  WarehouseExportRun,
} from "../../../api/types";
import type { NavSection } from "../../nav";
import type { ScreenCtx } from "../registry";
import { useProjectSettings } from "./useProjectSettings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function scope(id: string): { project: Project; environment: Environment } {
  const project: Project = {
    id: `prj_${id}`,
    name: `Project ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
  return {
    project,
    environment: {
      id: `env_${id}`,
      projectId: project.id,
      name: "production",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    },
  };
}

function key(id: string): ApiKey {
  return {
    id: `key_${id}`,
    projectId: `prj_${id}`,
    environmentId: `env_${id}`,
    name: `Key ${id}`,
    prefix: `sh_${id}`,
    capability: "browser",
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  };
}

function destination(id: string): WarehouseDestination {
  return {
    id: `wh_${id}`,
    projectId: `prj_${id}`,
    environmentId: `env_${id}`,
    name: `Warehouse ${id}`,
    destinationType: "postgres",
    connectionUrlPreview: `postgres://writer:***@${id}/sigmon`,
    datasets: ["events"],
    cursor: {},
    batchSize: 500,
    enabled: true,
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}

function run(id: string): WarehouseExportRun {
  return {
    id: `run_${id}`,
    destinationId: `wh_${id}`,
    projectId: `prj_${id}`,
    environmentId: `env_${id}`,
    trigger: "manual",
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    cursorBefore: {},
    cursorAfter: {},
    exported: { events: id === "a" ? 1 : 2 },
    errorMessage: null,
    createdAt: "2026-01-01T00:00:01.000Z",
  };
}

function policy(id: string): DataGovernancePolicy {
  return {
    projectId: `prj_${id}`,
    environmentId: `env_${id}`,
    retentionPolicy: { events: 90 },
    propertyRules: [],
    updatedByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listApiKeys: vi.fn(async (projectId: string) => ({ apiKeys: [key(projectId.slice(-1))] })),
    updateApiKey: vi.fn(async (id, input) => ({ apiKey: { ...key(id.slice(-1)), name: input.name ?? "key" } })),
    revokeApiKey: vi.fn().mockResolvedValue(undefined),
    listBrowserOrigins: vi.fn().mockResolvedValue({ origins: [] }),
    createBrowserOrigin: vi.fn().mockResolvedValue({
      origin: { id: "origin_1", projectId: "prj_a", origin: "https://app.example.com", createdAt: "x", archivedAt: null },
    }),
    archiveBrowserOrigin: vi.fn().mockResolvedValue(undefined),
    getDataGovernancePolicy: vi.fn(async ({ projectId }) => ({ policy: policy(projectId.slice(-1)) })),
    updateDataGovernancePolicy: vi.fn(async (input) => ({ policy: { ...policy(input.projectId.slice(-1)), ...input } })),
    listWarehouseDestinations: vi.fn(async ({ projectId }) => ({ destinations: [destination(projectId.slice(-1))] })),
    listWarehouseExportRuns: vi.fn(async (id) => ({ runs: [run(id.slice(-1))] })),
    createWarehouseDestination: vi.fn(),
    updateWarehouseDestination: vi.fn(),
    archiveWarehouseDestination: vi.fn(),
    runWarehouseExport: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

function ctx(scopeId: string, api: ApiClient, pushToast = vi.fn()): ScreenCtx {
  const current = scope(scopeId);
  return {
    client: api,
    ...current,
    environments: [current.environment],
    onCreateEnvironment: vi.fn(),
    onArchiveEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    onUpdateEnvironment: vi.fn(),
    navigate: vi.fn() as (section: NavSection) => void,
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast,
  };
}

describe("useProjectSettings", () => {
  it("clears visible data synchronously on scope change and ignores the stale load", async () => {
    const oldKeys = deferred<{ apiKeys: ApiKey[] }>();
    const api = client({
      listApiKeys: vi.fn((projectId: string) =>
        projectId === "prj_a" ? oldKeys.promise : Promise.resolve({ apiKeys: [key("b")] }),
      ),
    });
    const { result, rerender } = renderHook(({ value }) => useProjectSettings(value), {
      initialProps: { value: ctx("a", api) },
    });

    rerender({ value: ctx("b", api) });
    expect(result.current.apiKeys).toEqual([]);
    expect(result.current.destinations).toEqual([]);

    await waitFor(() => expect(result.current.apiKeys.map((item) => item.id)).toEqual(["key_b"]));
    oldKeys.resolve({ apiKeys: [key("a")] });
    await act(async () => oldKeys.promise);
    expect(result.current.apiKeys.map((item) => item.id)).toEqual(["key_b"]);
  });

  it("generation-guards warehouse history when the environment changes", async () => {
    const oldRuns = deferred<{ runs: WarehouseExportRun[] }>();
    const api = client({
      listWarehouseExportRuns: vi.fn((id: string) =>
        id === "wh_a" ? oldRuns.promise : Promise.resolve({ runs: [run("b")] }),
      ),
    });
    const { result, rerender } = renderHook(({ value }) => useProjectSettings(value), {
      initialProps: { value: ctx("a", api) },
    });
    await waitFor(() => expect(result.current.selectedDestinationId).toBe("wh_a"));

    rerender({ value: ctx("b", api) });
    expect(result.current.runs).toEqual([]);
    await waitFor(() => expect(result.current.runs.map((item) => item.id)).toEqual(["run_b"]));

    oldRuns.resolve({ runs: [run("a")] });
    await act(async () => oldRuns.promise);
    expect(result.current.runs.map((item) => item.id)).toEqual(["run_b"]);
  });

  it("drops stale mutation results and toasts after a scope change", async () => {
    const rename = deferred<{ apiKey: ApiKey }>();
    const pushToast = vi.fn();
    const api = client({ updateApiKey: vi.fn(() => rename.promise) });
    const { result, rerender } = renderHook(({ value }) => useProjectSettings(value), {
      initialProps: { value: ctx("a", api, pushToast) },
    });
    await waitFor(() => expect(result.current.apiKeys).toHaveLength(1));

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.renameApiKey("key_a", "stale-name");
    });
    rerender({ value: ctx("b", api, pushToast) });
    rename.resolve({ apiKey: { ...key("a"), name: "stale-name" } });
    await act(async () => pending);

    await waitFor(() => expect(result.current.apiKeys.map((item) => item.id)).toEqual(["key_b"]));
    expect(pushToast).not.toHaveBeenCalledWith("API key renamed");
  });

  it("locks mutations synchronously so duplicate submissions call the API once", async () => {
    const create = deferred<{ origin: { id: string; projectId: string; origin: string; createdAt: string; archivedAt: null } }>();
    const api = client({ createBrowserOrigin: vi.fn(() => create.promise) });
    const { result } = renderHook(() => useProjectSettings(ctx("a", api)));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.createOrigin("https://app.example.com");
      second = result.current.createOrigin("https://app.example.com");
    });
    expect(api.createBrowserOrigin).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe(false);

    create.resolve({ origin: { id: "origin_1", projectId: "prj_a", origin: "https://app.example.com", createdAt: "x", archivedAt: null } });
    await act(async () => first);
  });

  it("keeps a created server secret out of list state before and after one-time presentation dismissal", async () => {
    const createdServerKey = {
      ...key("server"),
      projectId: "prj_a",
      environmentId: "env_a",
      capability: "server" as const,
      secret: "sh_live_server_secret",
    };
    const api = client({
      createApiKey: vi.fn().mockResolvedValue({ apiKey: createdServerKey }),
    });
    let presentedSecret: string | null = null;
    const onSecretCreated = vi.fn((secret: string | null) => {
      presentedSecret = secret;
    });
    const screenCtx = ctx("a", api);
    screenCtx.onSecretCreated = onSecretCreated;
    const { result } = renderHook(() => useProjectSettings(screenCtx));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createApiKey({ name: "Backend", capability: "server" });
    });

    expect(onSecretCreated).toHaveBeenCalledWith("sh_live_server_secret", "serverApiKey");
    expect(presentedSecret).toBe("sh_live_server_secret");
    expect(result.current.apiKeys[0]).not.toHaveProperty("secret");

    act(() => screenCtx.onSecretCreated(null, "serverApiKey"));
    expect(presentedSecret).toBeNull();
    expect(result.current.apiKeys[0]).not.toHaveProperty("secret");
  });

  it("loads capabilities independently and maps only the 501 panel to unavailable", async () => {
    const api = client({
      listBrowserOrigins: vi.fn().mockRejectedValue(new ApiError(501, "not_implemented")),
    });
    const { result } = renderHook(() => useProjectSettings(ctx("a", api)));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.apiKeys).toHaveLength(1);
    expect(result.current.policy?.projectId).toBe("prj_a");
    expect(result.current.destinations).toHaveLength(1);
    expect(result.current.capabilities.browserOrigins).toBe(false);
    expect(result.current.capabilities.governance).toBe(true);
    expect(result.current.capabilities.warehouse).toBe(true);
    expect(result.current.errors.browserOrigins).toBeNull();
  });

  it("exposes warehouse history failures without dropping the destination", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = client({ listWarehouseExportRuns: vi.fn().mockRejectedValue(new Error("history offline")) });
    const { result } = renderHook(() => useProjectSettings(ctx("a", api)));

    await waitFor(() => expect(result.current.selectedDestinationId).toBe("wh_a"));
    await waitFor(() => expect(result.current.errors.warehouseRuns).toBe("Could not load warehouse export history."));
    expect(result.current.destinations).toHaveLength(1);
    expect(result.current.runs).toEqual([]);
  });
});
