import { useCallback, useEffect, useRef, useState } from "react";
import { formatCompact } from "../../components/ui/v2";
import type { Status } from "../../components/ui/v2";
import type {
  ApiKey,
  Environment,
  OperationsResponse,
  Project,
} from "../../api/types";
import type { ScreenCtx } from "./registry";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SetupStepVM = { label: string; done: boolean };
export type SetupProjectVM = { id: string; name: string; isActive: boolean };
export type SetupEnvVM = { id: string; name: string; detail: string; status: Status; isActive: boolean };
export type SetupBannerVM = { connected: boolean; title: string; detail: string };

export type SetupVM = {
  steps: SetupStepVM[];
  projects: SetupProjectVM[];
  environments: SetupEnvVM[];
  banner: SetupBannerVM;
  /** Scope label shown above the key field, e.g. "Acme / production". */
  keyScopeLabel: string;
  /** Endpoint shown in snippets (origin of the console). */
  endpoint: string;
};

export type UseSetupResult = {
  data: SetupVM | null;
  status: "loading" | "ok" | "error";
  /** A key value is only available for one freshly created this session. */
  latestSecret: string | null;
  busy: boolean;
  reload: () => void;
  createProject: (name: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  createEnvironment: (name: string) => Promise<void>;
  renameEnvironment: (id: string, name: string) => Promise<void>;
  archiveEnvironment: (id: string) => Promise<void>;
  generateApiKey: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Builder input + pure helpers
// ---------------------------------------------------------------------------

export type BuildSetupInput = {
  projects: Project[];
  activeProjectId: string | undefined;
  activeProjectName: string | undefined;
  environments: Environment[];
  activeEnvId: string | undefined;
  activeEnvName: string | undefined;
  apiKeys: ApiKey[];
  ops: OperationsResponse | null;
  endpoint: string;
  nowMs: number;
};

function relativeTimeFrom(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildSetupVM(input: BuildSetupInput): SetupVM {
  const {
    projects,
    activeProjectId,
    activeProjectName,
    environments,
    activeEnvId,
    activeEnvName,
    apiKeys,
    ops,
    endpoint,
    nowMs,
  } = input;

  const activeEnvKeys = apiKeys.filter(
    (k) => k.environmentId === activeEnvId && k.revokedAt == null,
  );
  const hasKey = activeEnvKeys.length > 0;
  const lastEventAt = ops?.summary.telemetry.lastEventAt ?? null;
  const hasSignal = lastEventAt != null;

  const steps: SetupStepVM[] = [
    { label: "Create project", done: projects.length > 0 },
    { label: "Create environment", done: environments.length > 0 },
    { label: "Generate API key", done: hasKey },
    { label: "Install SDK", done: hasSignal },
    { label: "Send first signal", done: hasSignal },
  ];

  const projectsVM: SetupProjectVM[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.id === activeProjectId,
  }));

  const environmentsVM: SetupEnvVM[] = environments.map((e) => {
    const isActive = e.id === activeEnvId;
    if (isActive) {
      const keyWord = activeEnvKeys.length === 1 ? "key" : "keys";
      return {
        id: e.id,
        name: e.name,
        isActive,
        status: hasSignal ? "ok" : "idle",
        detail: `${activeEnvKeys.length} API ${keyWord} · ${hasSignal ? "receiving" : "no signal yet"}`,
      };
    }
    return { id: e.id, name: e.name, isActive, status: "idle", detail: "active" };
  });

  const banner: SetupBannerVM = hasSignal
    ? {
        connected: true,
        title: "SDK connected",
        detail: `Last signal ${relativeTimeFrom(lastEventAt, nowMs)} · ${formatCompact(ops?.summary.telemetry.events ?? 0)} events / ${ops?.window ?? "24h"}`,
      }
    : {
        connected: false,
        title: "Waiting for first signal",
        detail: "No telemetry received yet for this environment.",
      };

  return {
    steps,
    projects: projectsVM,
    environments: environmentsVM,
    banner,
    keyScopeLabel: `${activeProjectName ?? "—"} / ${activeEnvName ?? "—"}`,
    endpoint,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function originEndpoint(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://your-instance.example.com";
}

export function useSetup({ ctx }: { ctx: ScreenCtx }): UseSetupResult {
  const { client, project, environment } = ctx;
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<SetupVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);
  const scopeKey = `${project?.id ?? ""}:${environment?.id ?? ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Clearing on scope change is the shell's job — it owns the secret, and this
  // hook remounts on every reload, so a reset effect here would wipe the secret
  // it had just stored.

  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");

    const projectId = project?.id;
    const envId = environment?.id;

    const projectsP = client.listProjects();
    const keysP = projectId
      ? client.listApiKeys(projectId)
      : Promise.resolve({ apiKeys: [] as ApiKey[] });
    const opsP =
      client.getOperations && projectId && envId
        ? client.getOperations({ projectId, environmentId: envId, window: "24h" }).then((r) => r.data)
        : Promise.resolve(null);

    Promise.all([projectsP, keysP, opsP])
      .then(([projectsRes, keysRes, ops]) => {
        if (gen !== genRef.current) return;
        setData(
          buildSetupVM({
            projects: projectsRes.projects,
            activeProjectId: project?.id,
            activeProjectName: project?.name,
            environments: ctx.environments,
            activeEnvId: environment?.id,
            activeEnvName: environment?.name,
            apiKeys: keysRes.apiKeys,
            ops,
            endpoint: ctx.apiEndpoint || originEndpoint(),
            nowMs: Date.now(),
          }),
        );
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, project?.id, environment?.id, ctx.environments]);

  const run = useCallback(
    async (fn: () => Promise<void>, errorMessage: string) => {
      setBusy(true);
      try {
        await fn();
        reload();
        ctx.reload?.();
      } catch (err) {
        console.error(err);
        ctx.pushToast(errorMessage);
      } finally {
        setBusy(false);
      }
    },
    [ctx, reload],
  );

  const createProject = useCallback(
    (name: string) => run(async () => { await client.createProject({ name }); }, "Could not create project"),
    [client, run],
  );

  const renameProject = useCallback(
    (id: string, name: string) => run(async () => { await client.updateProject(id, { name }); }, "Could not rename project"),
    [client, run],
  );

  const archiveProject = useCallback(
    (id: string) => run(async () => { await client.archiveProject(id); }, "Could not archive project"),
    [client, run],
  );

  const createEnvironment = useCallback(
    (name: string) => run(async () => {
      if (!project?.id) return;
      await client.createEnvironment(project.id, { name });
    }, "Could not create environment"),
    [client, project?.id, run],
  );

  const renameEnvironment = useCallback(
    (id: string, name: string) => run(
      async () => { await client.updateEnvironment(id, { name }); },
      "Could not rename environment",
    ),
    [client, run],
  );

  const archiveEnvironment = useCallback(
    (id: string) => run(
      async () => { await client.archiveEnvironment(id); },
      "Could not archive environment",
    ),
    [client, run],
  );

  const generateApiKey = useCallback(
    () => run(async () => {
      if (!project?.id || !environment?.id) return;
      const operationScope = scopeKey;
      const { apiKey } = await client.createApiKey(project.id, {
        environmentId: environment.id,
        name: `console-${environment.name}`,
      });
      if (scopeRef.current !== operationScope) return;
      ctx.onSecretCreated(apiKey.secret, "apiKey");
      ctx.pushToast("API key created — copy it now, it is shown only once");
    }, "Could not create API key"),
    [client, ctx, environment?.id, environment?.name, project?.id, run, scopeKey],
  );

  return {
    data,
    status,
    latestSecret: ctx.createdSecret?.kind === "apiKey" ? ctx.createdSecret.value : null,
    busy,
    reload,
    createProject,
    renameProject,
    archiveProject,
    createEnvironment,
    renameEnvironment,
    archiveEnvironment,
    generateApiKey,
  };
}
