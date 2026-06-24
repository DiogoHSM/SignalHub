# Console v2 — S10 Setup screen (PER-357) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the last legacy island in the v2 shell (`settings` → `ProjectSettingsWorkspace`) with a native dark-redesign **Setup** screen: onboarding stepper, projects CRUD, environments, SDK-connected banner, and an install panel (scoped API key, install command, multi-language init snippets, test-ping stub).

**Architecture:** Pure `buildSetupVM(...)` + race-guarded `useSetup({ ctx })` hook (mirrors `useSystemHealth`) feeding a flat `SetupScreen({ ctx })`. Registry flips `settings` legacy→v2; one optional `ScreenCtx.reload?` is added so Setup mutations refresh the shell.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), existing `ui/v2` primitives.

## Global Constraints

- Dark-only, `.sh-v2`-scoped. **English UI** — translate the design's pt-BR copy; never ship pt-BR.
- Maximum visual fidelity to `.claude/design-v2/app-screens-c.jsx` → `SetupScreen` (sizes, classes, layout).
- **No new CSS** and **no new shared components** — recon confirmed every class (`sh-code`, `tok-key/str/fn/num/com`, `sh-eyebrow`, `sh-row.is-active`, `sh-stripe.ok`, …) and component (`PageHead`, `Segmented`, `SecretField`, `StatusDot`, `ConfirmButton`, `EmptyHint`, `Icon`) already exists.
- **No dependency changes** → do not touch `package.json`/`pnpm-lock.yaml`.
- API keys are shown once at creation; never reveal an existing key's value (only `prefix`). Setup shows a key value **only** for a key freshly created in this session.
- `client.getOperations` is **optional** (`getOperations?`) — guard for absence (treat as "no telemetry").
- Builder is pure & deterministic (takes `nowMs`); only the hook reads `Date.now()` (exactly once per load), exactly like `useSystemHealth.ts`.
- New DOM test files: `// @vitest-environment jsdom` as **line 1**.
- Pre-disambiguate assertions on strings that appear 2+ times (`getAllByText(...)` / `within(card)`); never rename design copy to make a test pass.
- Verification gate per task: `pnpm --filter @sigmon/console test` for the touched files + `pnpm --filter @sigmon/console exec tsc --noEmit`.

### Key type facts (verbatim from the codebase)

```ts
// api/types.ts
type Project = { id: string; name: string; createdAt: string; updatedAt: string; archivedAt: string | null };
type Environment = { id: string; projectId: string; name: string; createdAt: string; updatedAt: string; archivedAt: string | null };
type ApiKey = { id: string; projectId: string; environmentId: string; name: string; prefix: string; createdAt: string; revokedAt: string | null };
type CreatedApiKey = ApiKey & { secret: string };
type OperationsWindow = "24h" | "7d" | "30d";
type OperationsQuery = { projectId: string; environmentId: string; window: OperationsWindow };
// OperationsResponse.summary.telemetry: { events: number; errors: number; traces: number; ...; lastEventAt: string | null; ... }
// AggregateResponse<T> = { data: T }

// api/client.ts (ApiClient)
listProjects: () => Promise<{ projects: Project[] }>;
createProject: (input: { name: string }) => Promise<{ project: Project }>;
updateProject: (id: string, input: { name?: string }) => Promise<{ project: Project }>;
archiveProject: (id: string) => Promise<void>;
createEnvironment: (projectId: string, input: { name: string }) => Promise<{ environment: Environment }>;
listApiKeys: (projectId: string) => Promise<{ apiKeys: ApiKey[] }>;
createApiKey: (projectId: string, input: { environmentId: string; name: string }) => Promise<{ apiKey: CreatedApiKey }>;
getOperations?: (query: OperationsQuery) => Promise<AggregateResponse<OperationsResponse>>;
```

### `ScreenCtx` (registry.tsx) — current shape

`{ client, project, environment, environments, onCreateEnvironment, onArchiveEnvironment, onArchiveProject, onSecretCreated, onSelectEnvironment, onUpdateProject, onUpdateEnvironment, navigate, back, drill, pushToast }`. Task 3 adds `reload?: () => void` (optional → existing screen tests unaffected).

---

## File structure

- **Create** `apps/console/src/v2/screens/useSetup.ts` — VM types, `buildSetupVM`, `useSetup` hook (Task 1)
- **Create** `apps/console/src/v2/screens/useSetup.test.ts` — builder unit tests (Task 1)
- **Create** `apps/console/src/v2/screens/SetupScreen.tsx` — the screen (Task 2)
- **Create** `apps/console/src/v2/screens/SetupScreen.test.tsx` — screen integration tests (Task 2)
- **Modify** `apps/console/src/v2/screens/registry.tsx` — flip `settings` to v2 + add `reload?` to `ScreenCtx` (Task 3)
- **Modify** `apps/console/src/v2/useConsoleProjects.ts` — expose `reload` (Task 3)
- **Modify** `apps/console/src/v2/ConsoleShellV2.tsx` — wire `ctx.reload` (Task 3)
- **Modify** `apps/console/src/v2/screens/registry.test.tsx` — update the two `settings` tests (Task 3)

---

## Task 1: `useSetup` hook + VM builder

**Files:**
- Create: `apps/console/src/v2/screens/useSetup.ts`
- Test: `apps/console/src/v2/screens/useSetup.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `ScreenCtx` (from `./registry`), `Project`/`Environment`/`ApiKey`/`OperationsResponse` types, `formatCompact` from `ui/v2`.
- Produces: `buildSetupVM(input): SetupVM`, `useSetup({ ctx }): UseSetupResult`, and the exported VM types below.

- [ ] **Step 1: Write `useSetup.ts`**

```ts
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
  const [latestSecret, setLatestSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Reset any shown secret when the scope changes.
  useEffect(() => {
    setLatestSecret(null);
  }, [project?.id, environment?.id]);

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
            endpoint: originEndpoint(),
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

  const generateApiKey = useCallback(
    () => run(async () => {
      if (!project?.id || !environment?.id) return;
      const { apiKey } = await client.createApiKey(project.id, {
        environmentId: environment.id,
        name: `console-${environment.name}`,
      });
      setLatestSecret(apiKey.secret);
      ctx.pushToast("API key created — copy it now, it is shown only once");
    }, "Could not create API key"),
    [client, ctx, environment?.id, environment?.name, project?.id, run],
  );

  return { data, status, latestSecret, busy, reload, createProject, renameProject, archiveProject, createEnvironment, generateApiKey };
}
```

- [ ] **Step 2: Write `useSetup.test.ts`** (line 1 must be the jsdom directive)

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSetupVM, type BuildSetupInput } from "./useSetup";
import type { ApiKey, Environment, OperationsResponse, Project } from "../../api/types";

const NOW = Date.UTC(2026, 5, 24, 12, 0, 0);

function project(over: Partial<Project> = {}): Project {
  return { id: "prj_1", name: "Acme", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null, ...over };
}
function env(over: Partial<Environment> = {}): Environment {
  return { id: "env_1", projectId: "prj_1", name: "production", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null, ...over };
}
function key(over: Partial<ApiKey> = {}): ApiKey {
  return { id: "key_1", projectId: "prj_1", environmentId: "env_1", name: "k", prefix: "sh_live_ab", createdAt: "2026-01-01T00:00:00.000Z", revokedAt: null, ...over };
}
function ops(lastEventAt: string | null, events = 184): OperationsResponse {
  return {
    window: "24h",
    generatedAt: "2026-06-24T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "x", to: "y" },
    status: "ok" as OperationsResponse["status"],
    summary: {
      monitors: { total: 0, http: z(), heartbeat: z() },
      alerts: { rules: { total: 0, enabled: 0 }, events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 } },
      telemetry: { events, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: null, p95TraceDurationMs: null, lastEventAt, lastErrorAt: null, lastTraceAt: null },
      incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 },
    },
    recent: { monitors: [], alerts: [], incidents: [] },
    topLatency: [],
    setupGaps: [],
  };
}
function z() { return { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }; }

function input(over: Partial<BuildSetupInput> = {}): BuildSetupInput {
  return {
    projects: [project()],
    activeProjectId: "prj_1",
    activeProjectName: "Acme",
    environments: [env()],
    activeEnvId: "env_1",
    activeEnvName: "production",
    apiKeys: [key()],
    ops: ops("2026-06-24T11:59:56.000Z"),
    endpoint: "https://sigmon.acme.dev",
    nowMs: NOW,
    ...over,
  };
}

describe("buildSetupVM", () => {
  it("marks all five steps done when project, env, key and a signal exist", () => {
    const vm = buildSetupVM(input());
    expect(vm.steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
  });

  it("leaves key + signal steps pending when no key and no signal", () => {
    const vm = buildSetupVM(input({ apiKeys: [], ops: ops(null) }));
    expect(vm.steps.map((s) => s.done)).toEqual([true, true, false, false, false]);
  });

  it("ignores revoked keys for the active environment", () => {
    const vm = buildSetupVM(input({ apiKeys: [key({ revokedAt: "2026-02-01T00:00:00.000Z" })] }));
    expect(vm.steps[2].done).toBe(false);
  });

  it("ignores keys scoped to a different environment", () => {
    const vm = buildSetupVM(input({ apiKeys: [key({ environmentId: "env_other" })] }));
    expect(vm.steps[2].done).toBe(false);
  });

  it("flags the active project", () => {
    const vm = buildSetupVM(input({ projects: [project(), project({ id: "prj_2", name: "Other" })] }));
    expect(vm.projects.find((p) => p.isActive)?.id).toBe("prj_1");
    expect(vm.projects.find((p) => p.id === "prj_2")?.isActive).toBe(false);
  });

  it("derives a receiving status + detail for the active env with a signal", () => {
    const vm = buildSetupVM(input());
    const active = vm.environments.find((e) => e.isActive);
    expect(active?.status).toBe("ok");
    expect(active?.detail).toBe("1 API key · receiving");
  });

  it("derives an idle active env when no signal", () => {
    const vm = buildSetupVM(input({ ops: ops(null), apiKeys: [key(), key({ id: "key_2" })] }));
    const active = vm.environments.find((e) => e.isActive);
    expect(active?.status).toBe("idle");
    expect(active?.detail).toBe("2 API keys · no signal yet");
  });

  it("labels non-active environments as active/idle", () => {
    const vm = buildSetupVM(input({ environments: [env(), env({ id: "env_2", name: "staging" })] }));
    const other = vm.environments.find((e) => e.id === "env_2");
    expect(other?.isActive).toBe(false);
    expect(other?.status).toBe("idle");
    expect(other?.detail).toBe("active");
  });

  it("builds a connected banner with relative time and window", () => {
    const vm = buildSetupVM(input());
    expect(vm.banner.connected).toBe(true);
    expect(vm.banner.title).toBe("SDK connected");
    expect(vm.banner.detail).toBe("Last signal 4s ago · 184 events / 24h");
  });

  it("builds a waiting banner when ops is null", () => {
    const vm = buildSetupVM(input({ ops: null }));
    expect(vm.banner.connected).toBe(false);
    expect(vm.banner.title).toBe("Waiting for first signal");
  });

  it("exposes the scope label and endpoint", () => {
    const vm = buildSetupVM(input());
    expect(vm.keyScopeLabel).toBe("Acme / production");
    expect(vm.endpoint).toBe("https://sigmon.acme.dev");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useSetup.test.ts`
Expected: all PASS. Then `pnpm --filter @sigmon/console exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/v2/screens/useSetup.ts apps/console/src/v2/screens/useSetup.test.ts
git commit -m "feat(console): add useSetup hook and VM builder for v2 Setup screen"
```

---

## Task 2: `SetupScreen` component

**Files:**
- Create: `apps/console/src/v2/screens/SetupScreen.tsx`
- Test: `apps/console/src/v2/screens/SetupScreen.test.tsx`

**Interfaces:**
- Consumes: `useSetup`, its VM types, `ScreenCtx`, `ui/v2` (`PageHead`, `Segmented`, `SecretField`, `StatusDot`, `ConfirmButton`, `EmptyHint`, `Icon`).
- Produces: `export function SetupScreen({ ctx }: { ctx: ScreenCtx })`.

- [ ] **Step 1: Write `SetupScreen.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import { ConfirmButton, EmptyHint, Icon, PageHead, SecretField, Segmented, StatusDot } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useSetup } from "./useSetup";

const SNIPPET_TABS = ["Browser", "Node", "Python", "HTTP"] as const;
type SnippetTab = (typeof SNIPPET_TABS)[number];

const KEY_PLACEHOLDER = "sh_live_browser_…";

function snippet(tab: SnippetTab, endpoint: string, key: string): ReactNode {
  if (tab === "Node") {
    return (
      <>
        <span className="tok-key">import</span> {"{ createSignalMonitorClient }"} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/node"</span>;<br /><br />
        <span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"} <span className="tok-key">apiKey</span>: process.env.<span className="tok-num">SIGMON_KEY</span> {"}"});<br />
        <span className="tok-fn">signal</span>.<span className="tok-fn">captureError</span>(err);
      </>
    );
  }
  if (tab === "Python") {
    return (
      <>
        <span className="tok-com"># pip install sigmon-sdk</span><br />
        <span className="tok-key">from</span> sigmon <span className="tok-key">import</span> Client<br />
        signal = Client(api_key=<span className="tok-str">"{key}"</span>)<br />
        signal.track(<span className="tok-str">"checkout.started"</span>, plan=<span className="tok-str">"pro"</span>)
      </>
    );
  }
  if (tab === "HTTP") {
    return (
      <>
        <span className="tok-com">$</span> curl -X POST <span className="tok-str">{endpoint}/v1/events</span> \<br />
        {"  "}-H <span className="tok-str">"authorization: Bearer {key}"</span> \<br />
        {"  "}-d <span className="tok-str">{`'{"name":"checkout.started"}'`}</span>
      </>
    );
  }
  return (
    <>
      <span className="tok-key">import</span> {"{ createSignalMonitorClient }"} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/browser"</span>;<br /><br />
      <span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"}<br />
      {"  "}<span className="tok-key">endpoint</span>: <span className="tok-str">"{endpoint}"</span>,<br />
      {"  "}<span className="tok-key">apiKey</span>: <span className="tok-str">"{key}"</span><br />
      {"}"});<br /><br />
      <span className="tok-fn">signal</span>.<span className="tok-fn">track</span>(<span className="tok-str">"checkout.started"</span>, {"{"} <span className="tok-key">plan</span>: <span className="tok-str">"pro"</span> {"}"});
    </>
  );
}

export function SetupScreen({ ctx }: { ctx: ScreenCtx }) {
  const setup = useSetup({ ctx });
  const [tab, setTab] = useState<SnippetTab>("Browser");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState("");

  if (setup.status === "loading" && !setup.data) {
    return (
      <>
        <PageHead title="Setup" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="activity" title="Loading setup…" sub="Fetching projects, keys and ingestion status." />
        </div>
      </>
    );
  }
  if (!setup.data) {
    return (
      <>
        <PageHead title="Setup" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="alert" title="Could not load setup" sub="Try refreshing the page." />
        </div>
      </>
    );
  }

  const vm = setup.data;

  async function submitNewProject() {
    const name = newProjectName.trim();
    if (!name) return;
    await setup.createProject(name);
    setNewProjectName("");
    setCreatingProject(false);
  }
  async function submitRename(id: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    await setup.renameProject(id, name);
    setRenamingId(null);
  }
  async function submitNewEnv() {
    const name = newEnvName.trim();
    if (!name) return;
    await setup.createEnvironment(name);
    setNewEnvName("");
    setCreatingEnv(false);
  }

  const keyValue = setup.latestSecret;

  return (
    <>
      <PageHead title="Setup" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />

      {/* Onboarding stepper */}
      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 4, padding: "14px 18px", overflowX: "auto" }}>
          {vm.steps.map((step, i) => (
            <div key={step.label} style={{ display: "contents" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: step.done ? "var(--accent)" : "var(--bg-surface-2)", color: step.done ? "var(--accent-fg)" : "var(--fg-muted)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, border: step.done ? "none" : "1px solid var(--border)" }}>
                  {step.done ? <Icon name="check" size={11} stroke={3} /> : i + 1}
                </span>
                <span style={{ fontSize: 12.5, color: step.done ? "var(--fg)" : "var(--fg-muted)", whiteSpace: "nowrap" }}>{step.label}</span>
              </div>
              {i < vm.steps.length - 1 ? (
                <div style={{ flex: 1, minWidth: 20, height: 1, background: step.done && vm.steps[i + 1].done ? "var(--accent)" : "var(--border-subtle)", margin: "0 12px" }} />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
          {/* Projects */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Projects</h2>
              <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New project" onClick={() => setCreatingProject((v) => !v)}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="sh-card__body flush">
              {creatingProject ? (
                <div className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <input autoFocus className="sh-input" aria-label="New project name" value={newProjectName} placeholder="Project name" onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitNewProject(); if (e.key === "Escape") setCreatingProject(false); }} />
                  <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void submitNewProject()}>Create</button>
                </div>
              ) : null}
              {vm.projects.map((p) => (
                <div key={p.id} className={`sh-row ${p.isActive ? "is-active" : ""}`} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  {renamingId === p.id ? (
                    <input autoFocus className="sh-input" aria-label="Rename project" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitRename(p.id); if (e.key === "Escape") setRenamingId(null); }} onBlur={() => setRenamingId(null)} />
                  ) : (
                    <div><strong style={{ fontSize: 12.5 }}>{p.name}</strong><div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{p.id}</div></div>
                  )}
                  {p.isActive ? <span className="sh-tag ok">selected</span> : <span />}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="sh-iconbtn-sm" type="button" title="Rename" aria-label={`Rename ${p.name}`} onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}><Icon name="edit" size={12} /></button>
                    <button className="sh-iconbtn-sm" type="button" title="Archive" aria-label={`Archive ${p.name}`} onClick={() => void setup.archiveProject(p.id)}><Icon name="archive" size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Environments */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Environments</h2>
              <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New environment" onClick={() => setCreatingEnv((v) => !v)}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="sh-card__body flush">
              {creatingEnv ? (
                <div className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <input autoFocus className="sh-input" aria-label="New environment name" value={newEnvName} placeholder="Environment name" onChange={(e) => setNewEnvName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitNewEnv(); if (e.key === "Escape") setCreatingEnv(false); }} />
                  <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void submitNewEnv()}>Create</button>
                </div>
              ) : null}
              {vm.environments.map((e) => (
                <div key={e.id} className={`sh-row ${e.isActive ? "is-active" : ""}`} style={{ gridTemplateColumns: "1fr auto" }}>
                  <div><strong style={{ fontSize: 12.5 }}>{e.name}</strong><div className="sh-faint" style={{ fontSize: 11 }}>{e.detail}</div></div>
                  <StatusDot status={e.status} size={7} />
                </div>
              ))}
            </div>
          </div>

          {/* SDK connected banner */}
          {vm.banner.connected ? (
            <div className="sh-card sh-stripe ok" style={{ padding: 0 }}>
              <div className="sh-card__body" style={{ paddingLeft: 22, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--accent)" }}><Icon name="check" size={18} stroke={2.4} /></span>
                <div><strong style={{ fontSize: 13 }}>{vm.banner.title}</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>{vm.banner.detail}</div></div>
              </div>
            </div>
          ) : (
            <div className="sh-card">
              <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--fg-muted)" }}><Icon name="clock" size={18} /></span>
                <div><strong style={{ fontSize: 13 }}>{vm.banner.title}</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>{vm.banner.detail}</div></div>
              </div>
            </div>
          )}
        </div>

        {/* Right column — Install SDK */}
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Install SDK</h2>
            <Segmented options={[...SNIPPET_TABS]} value={tab} onChange={(v) => setTab(v as SnippetTab)} />
          </div>
          <div className="sh-card__body" style={{ overflow: "auto", flex: 1, display: "grid", gap: 16, alignContent: "start" }}>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>1 · Your key (scoped to {vm.keyScopeLabel})</div>
              {keyValue ? (
                <SecretField value={keyValue} />
              ) : (
                <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void setup.generateApiKey()}>
                  <Icon name="key" size={13} />Generate API key
                </button>
              )}
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                <Icon name="shield" size={11} /> Treat like a password. The browser key is public; use a server-side key for Node/Python.
              </div>
            </div>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>2 · Install</div>
              <div className="sh-code"><span className="tok-com">$</span> pnpm add <span className="tok-str">@sigmon/sdk</span></div>
            </div>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>3 · Initialize ({tab})</div>
              <div className="sh-code">{snippet(tab, vm.endpoint, keyValue ?? KEY_PLACEHOLDER)}</div>
            </div>
            <div style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent-bg-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="play" size={16} /></div>
              <div style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>Send a test event</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>Fires a <code style={{ color: "var(--fg)" }}>setup.ping</code> to validate.</div></div>
              <button className="sh-btn primary" type="button" onClick={() => ctx.pushToast("Test ping is not yet available")}>Send ping</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

> Note on `.sh-input`: this class already exists (`styles/v2/components.css:194`), so the inline inputs are styled. No new CSS in this task.

- [ ] **Step 2: Write `SetupScreen.test.tsx`** (line 1 = jsdom directive). This test renders the real screen + real `useSetup` against a mocked client.

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { SetupScreen } from "./SetupScreen";
import type { ScreenCtx } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
    createProject: vi.fn().mockResolvedValue({ project }),
    updateProject: vi.fn().mockResolvedValue({ project }),
    archiveProject: vi.fn().mockResolvedValue(undefined),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [environment] }),
    createEnvironment: vi.fn().mockResolvedValue({ environment }),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
    createApiKey: vi.fn().mockResolvedValue({ apiKey: { id: "key_1", projectId: "prj_1", environmentId: "env_1", name: "k", prefix: "sh_live_ab", createdAt: "x", revokedAt: null, secret: "sh_live_browser_secret_value" } }),
    getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", summary: { telemetry: { events: 184, lastEventAt: "2026-06-24T11:59:56.000Z", errors: 0, traces: 0, failedTraces: 0, errorRatePercent: null, p95TraceDurationMs: null, lastErrorAt: null, lastTraceAt: null } } } }),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
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
    navigate: vi.fn() as (s: NavSection) => void,
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    reload: vi.fn(),
    ...over,
  };
}

describe("SetupScreen", () => {
  it("renders the page head and onboarding stepper", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();
    expect(screen.getByText("Send first signal")).toBeInTheDocument();
  });

  it("shows the active project with the selected tag", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("selected")).toBeInTheDocument();
    expect(screen.getAllByText("Acme").length).toBeGreaterThanOrEqual(1);
  });

  it("renders a connected SDK banner from operations data", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("SDK connected")).toBeInTheDocument();
    expect(screen.getByText(/184 events \/ 24h/)).toBeInTheDocument();
  });

  it("shows a waiting banner when no signal has been received", async () => {
    const client = makeClient({ getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", summary: { telemetry: { events: 0, lastEventAt: null, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: null, p95TraceDurationMs: null, lastErrorAt: null, lastTraceAt: null } } } }) });
    render(<SetupScreen ctx={makeCtx({ client })} />);
    expect(await screen.findByText("Waiting for first signal")).toBeInTheDocument();
  });

  it("switches install snippets when a tab is selected", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    await screen.findByText("Install SDK");
    expect(screen.getByText(/@sigmon\/sdk\/browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Python" }));
    expect(screen.getByText(/pip install sigmon-sdk/)).toBeInTheDocument();
  });

  it("generates an API key and reveals the one-time secret", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const generate = await screen.findByRole("button", { name: /Generate API key/ });
    fireEvent.click(generate);
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1", name: "console-production" }));
    expect(await screen.findByText(/Copy/)).toBeInTheDocument();
  });

  it("creates a project from the inline input", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    await screen.findByText("Projects");
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const input = screen.getByLabelText("New project name");
    fireEvent.change(input, { target: { value: "New API" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.createProject).toHaveBeenCalledWith({ name: "New API" }));
  });

  it("archives a project", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const archive = await screen.findByRole("button", { name: "Archive Acme" });
    fireEvent.click(archive);
    await waitFor(() => expect(client.archiveProject).toHaveBeenCalledWith("prj_1"));
  });

  it("renames a project from the inline editor", async () => {
    const client = makeClient();
    render(<SetupScreen ctx={makeCtx({ client })} />);
    const rename = await screen.findByRole("button", { name: "Rename Acme" });
    fireEvent.click(rename);
    const input = screen.getByLabelText("Rename project");
    fireEvent.change(input, { target: { value: "Acme Corp" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.updateProject).toHaveBeenCalledWith("prj_1", { name: "Acme Corp" }));
  });

  it("stubs the test ping with a toast", async () => {
    const ctx = makeCtx();
    render(<SetupScreen ctx={ctx} />);
    const ping = await screen.findByRole("button", { name: "Send ping" });
    fireEvent.click(ping);
    expect(ctx.pushToast).toHaveBeenCalledWith("Test ping is not yet available");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/SetupScreen.test.ts`
(Vitest matches `.test.tsx` too.) Expected: all PASS. Then `tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/v2/screens/SetupScreen.tsx apps/console/src/v2/screens/SetupScreen.test.tsx
git commit -m "feat(console): add v2 Setup screen"
```

---

## Task 3: Registry flip + shell reload wiring

**Files:**
- Modify: `apps/console/src/v2/screens/registry.tsx`
- Modify: `apps/console/src/v2/useConsoleProjects.ts`
- Modify: `apps/console/src/v2/ConsoleShellV2.tsx`
- Modify: `apps/console/src/v2/screens/registry.test.tsx`

**Interfaces:**
- Consumes: `SetupScreen` (Task 2), `UseConsoleProjectsResult`.
- Produces: `ScreenCtx.reload?: () => void`; `settings` registry entry as `kind: "v2"`.

- [ ] **Step 1: Add `reload` to `useConsoleProjects.ts`**

Add to the result type (after `selectEnvironment`):
```ts
  reload: () => void;
```
Add a reload tick: near the other `useState` calls add
```ts
  const [reloadTick, setReloadTick] = useState(0);
```
Add `reloadTick` to the **projects** load effect deps: change `}, [client]);` (the first effect, lines ~32-55) to `}, [client, reloadTick]);`. Add the callback before the `return`:
```ts
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
```
Add `reload` to the returned object.

- [ ] **Step 2: Wire `ctx.reload` in `ConsoleShellV2.tsx`**

Destructure `reload` from `useConsoleProjects` (add `reload,` to the destructure at lines ~100-107, alias to avoid clashing with the existing `handleRefresh`):
```ts
  const {
    projects,
    environments,
    activeProject,
    activeEnvironment,
    selectProject,
    selectEnvironment,
    reload: reloadProjects,
  } = useConsoleProjects(client);
```
Add `reload` to the `screenCtx` object (after `pushToast`):
```ts
    reload: () => {
      reloadProjects();
      setSeq((s) => s + 1);
    },
```

- [ ] **Step 3: Add `reload?` to `ScreenCtx` and flip `settings` in `registry.tsx`**

In the `ScreenCtx` type, add (after `pushToast`):
```ts
  /** Reload shell-level project/environment data after a mutation. */
  reload?: () => void;
```
Replace the `ProjectSettingsWorkspace` import (line 4) — remove it and the `LegacyIsland` is still needed by `renderSection`, keep it. Add the SetupScreen import alongside the other screen imports:
```ts
import { SetupScreen } from "./SetupScreen";
```
Replace the `settings` entry (lines ~85-104) with:
```tsx
  settings: {
    kind: "v2",
    render: (ctx) => <SetupScreen ctx={ctx} />,
  },
```
Remove the now-unused `import { ProjectSettingsWorkspace } from "../../components/ProjectSettingsWorkspace";` line. (Verify nothing else in the file references it.)

- [ ] **Step 4: Update `registry.test.tsx`**

Add the `useSetup` module import near the other hook imports:
```ts
import * as useSetupModule from "./useSetup";
```
Add `getOperations: vi.fn()` is already present in `makeClient`; also ensure `listApiKeys` mock present (it is). Replace the **two** legacy `settings` tests at the bottom (the `wraps legacy entries in the legacy island` test and the `settings section renders ProjectSettingsWorkspace…` test) with:
```tsx
  it("routes settings to a v2 screen", () => {
    expect(SCREENS.settings.kind).toBe("v2");
  });

  it("renders the v2 Setup screen (not wrapped in the legacy island)", () => {
    vi.spyOn(useSetupModule, "useSetup").mockReturnValue({
      data: null,
      status: "loading",
      latestSecret: null,
      busy: false,
      reload: vi.fn(),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      archiveProject: vi.fn(),
      createEnvironment: vi.fn(),
      generateApiKey: vi.fn(),
    });
    const ctx = makeCtx();
    const node = renderSection("settings", ctx);
    const { container } = render(<>{node}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
```
> The `has an entry for every nav section` test already covers `settings` presence — leave it.

- [ ] **Step 5: Run the full console suite + typecheck**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/registry.test.tsx src/v2/screens/SetupScreen.test.tsx src/v2/screens/useSetup.test.ts`
Then: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/registry.tsx apps/console/src/v2/useConsoleProjects.ts apps/console/src/v2/ConsoleShellV2.tsx apps/console/src/v2/screens/registry.test.tsx
git commit -m "feat(console): flip settings section to v2 Setup screen with shell reload"
```

---

## Final verification (whole branch, before PR)

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```
All must be green with no regression. No `package.json`/lockfile change expected.

## Self-review notes (controller)

- Spec coverage: stepper (T1 builder + T2 render), projects CRUD (T2 + hook actions), environments (T2), SDK banner connected/waiting (T1+T2), install panel + 4 snippet tabs (T2), one-time key (T2), test-ping stub (T2), registry flip + lossless-to-v1 (T3). ✓
- Type consistency: `Status` from `ui/v2` is `"ok"|"warning"|"critical"|"idle"`; builder only emits `"ok"`/`"idle"`. `UseSetupResult` shape used identically in `SetupScreen` and the registry test mock. ✓
- No placeholders; all code complete. `.sh-input` confirmed to exist (components.css:194).
