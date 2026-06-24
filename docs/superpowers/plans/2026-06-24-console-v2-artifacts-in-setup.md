# Console v2 — Artifacts in Setup (PER-369) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold source-map artifact management and CI upload-token lifecycle into the v2 Setup screen as a new full-width section, reusing the established v2 design system.

**Architecture:** A pure VM builder + race-guarded data hook (`useArtifacts.ts`) mirroring `useMonitors`/`useSetup`, a flat presentational section (`ArtifactsSection.tsx`) rendering two `sh-card`s (artifacts + tokens), and a one-line mount in `SetupScreen.tsx` below its existing two-column grid. No new nav section, no new CSS, no new dependencies.

**Tech Stack:** React 19 + TypeScript (strict), Vitest + @testing-library/react (jsdom), existing `ui/v2` primitives and `.sh-*` CSS.

## Global Constraints

- **Dark-only, `.sh-v2`-scoped, English UI**, maximum fidelity to the established v2 design language.
- The console shows source-map **metadata only**, never original source content.
- Upload tokens are **CI-only secrets, separate from browser ingestion API keys**; label them as such. The token secret is shown **once at creation** and never re-revealed.
- All `SourceMapApiClient` methods are **optional** on `ApiClient` (`& Partial<SourceMapApiClient>`). Guard every call; if both `listSourceMapArtifacts` and `listSourceMapUploadTokens` are absent, render an unavailable hint instead of calling them.
- Determinism: only the hook reads `Date.now()` (once per load); the pure builder takes `nowMs`.
- New console DOM `*.test.ts(x)` files MUST carry `// @vitest-environment jsdom` as line 1.
- No dependency changes → no `pnpm-lock.yaml` change.
- **Defer browser upload** (`uploadSourceMap`/`uploadSourceMapBundle`) — not in scope; v1 `ArtifactsPanel` retains it (controller decision, flagged on PER-369).

### Verbatim backend contract (from `api/client.ts:184-206`, `api/types.ts`)

```ts
// types.ts
type SourceMapArtifact = { id: string; projectId: string; environmentId: string; release: string;
  minifiedFile: string; originalFilename: string; byteSize: number; sha256: string; createdAt: string; uploadedByUserId: string };
type SourceMapUploadToken = { id: string; projectId: string; environmentId: string; name: string;
  prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type CreatedSourceMapUploadToken = SourceMapUploadToken & { secret: string };
type SourceMapArtifactQuery = { projectId: string; environmentId: string; release?: string };

// client.ts SourceMapApiClient (ALL optional on ApiClient)
listSourceMapArtifacts: (query: SourceMapArtifactQuery) => Promise<SourceMapArtifact[]>;
deleteSourceMapArtifact: (id: string, query: Pick<SourceMapArtifactQuery,"projectId"|"environmentId">) => Promise<void>;
listSourceMapUploadTokens: (query: Pick<SourceMapArtifactQuery,"projectId"|"environmentId">) => Promise<{ tokens: SourceMapUploadToken[] }>;
createSourceMapUploadToken: (input: { projectId: string; environmentId: string; name: string }) => Promise<{ token: CreatedSourceMapUploadToken }>;
updateSourceMapUploadToken: (id: string, query: Pick<SourceMapArtifactQuery,"projectId"|"environmentId">, patch: { name?: string }) => Promise<{ token: SourceMapUploadToken }>;
revokeSourceMapUploadToken: (id: string, query: Pick<SourceMapArtifactQuery,"projectId"|"environmentId">) => Promise<void>;
```

### Project notes (gate strictness, verified)

- Console tsconfig: `strict: true`, but **no** `noUnusedLocals`/`noUnusedParameters`, and **no** eslint config in the gate — unused vars won't fail the gate (still clean for quality).
- `ScreenCtx` (registry.tsx) carries `client`, `project`, `environment`, `pushToast` — all the section needs.
- `ui/v2` exports (verified): `PageHead`, `Segmented`, `Icon` (names include `file`, `key`, `edit`, `archive`, `x`, `check`, `alert`, `plus`, `refresh`), `StatusDot`, `SecretField`, `ConfirmButton` (`{ label, confirmLabel?, icon?, kind?, onConfirm }`), `EmptyHint` (`{ icon?, title, sub?, cta? }`), `Card`, `formatCompact`.
- `.sh-*` CSS (verified present): `sh-card`/`sh-card__head`/`sh-card__body`(`.flush`), `sh-row`(`.is-active`), `sh-tag`(`ok`/`solid`/`mono`), `sh-stripe`(`ok`), `sh-input`, `sh-btn`(`.primary`/`.ghost`/`.danger`), `sh-iconbtn-sm`, `sh-h2`, `sh-eyebrow`, `sh-faint`, `sh-muted`, `sh-mono`. **No new CSS.**

---

### Task 1: `useArtifacts.ts` — VM types, pure builder, race-guard hook, actions

**Files:**
- Create: `apps/console/src/v2/screens/useArtifacts.ts`
- Test: `apps/console/src/v2/screens/useArtifacts.test.ts`

**Interfaces:**
- Consumes: `ApiClient` (from `../../api/client`), `SourceMapArtifact`/`SourceMapUploadToken` (from `../../api/types`).
- Produces (consumed by Task 2):
  - `buildArtifactsVM(input: BuildArtifactsInput, nowMs: number): ArtifactsVM`
  - `formatBytes(value: number): string`
  - `useArtifacts({ client, projectId, environmentId }): UseArtifactsResult`
  - Types `ArtifactRowVM`, `TokenRowVM`, `ArtifactsVM`, `LatestTokenSecret`, `UseArtifactsResult`.

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/useArtifacts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/console && pnpm vitest run src/v2/screens/useArtifacts.test.ts`
Expected: FAIL — `useArtifacts`/`buildArtifactsVM`/`formatBytes` not found (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `apps/console/src/v2/screens/useArtifacts.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { SourceMapArtifact, SourceMapUploadToken } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ArtifactRowVM = {
  id: string;
  minifiedFile: string;
  release: string;
  originalFilename: string;
  byteSizeLabel: string;
  createdLabel: string;
};

export type TokenRowVM = {
  id: string;
  name: string;
  prefix: string;
  createdLabel: string;
  lastUsedLabel: string;
  revoked: boolean;
  statusLabel: string;
};

export type ArtifactsVM = {
  artifacts: ArtifactRowVM[];
  tokens: TokenRowVM[];
  artifactCount: number;
  tokenCount: number;
  artifactsAvailable: boolean;
  tokensAvailable: boolean;
};

export type LatestTokenSecret = {
  name: string;
  prefix: string;
  secret: string;
};

export type BuildArtifactsInput = {
  artifacts: SourceMapArtifact[];
  tokens: SourceMapUploadToken[];
  artifactsAvailable: boolean;
  tokensAvailable: boolean;
};

export type UseArtifactsResult = {
  data: ArtifactsVM | null;
  status: "loading" | "ok" | "error" | "unavailable";
  latestSecret: LatestTokenSecret | null;
  busy: boolean;
  releaseFilter: string;
  applyFilter: (release: string) => void;
  reload: () => void;
  clearSecret: () => void;
  deleteArtifact: (id: string) => Promise<boolean>;
  createToken: (name: string) => Promise<boolean>;
  renameToken: (id: string, name: string) => Promise<boolean>;
  revokeToken: (id: string) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTimeFrom(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
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

export function buildArtifactsVM(input: BuildArtifactsInput, nowMs: number): ArtifactsVM {
  const { artifacts, tokens, artifactsAvailable, tokensAvailable } = input;

  const artifactRows: ArtifactRowVM[] = artifacts.map((a) => ({
    id: a.id,
    minifiedFile: a.minifiedFile,
    release: a.release,
    originalFilename: a.originalFilename,
    byteSizeLabel: formatBytes(a.byteSize),
    createdLabel: relativeTimeFrom(a.createdAt, nowMs),
  }));

  const tokenRows: TokenRowVM[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdLabel: relativeTimeFrom(t.createdAt, nowMs),
    lastUsedLabel: relativeTimeFrom(t.lastUsedAt, nowMs),
    revoked: t.revokedAt != null,
    statusLabel: t.revokedAt != null ? "revoked" : "active",
  }));

  return {
    artifacts: artifactRows,
    tokens: tokenRows,
    artifactCount: artifactRows.length,
    tokenCount: tokenRows.length,
    artifactsAvailable,
    tokensAvailable,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseArtifactsArgs = {
  client: ApiClient;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useArtifacts({ client, projectId, environmentId }: UseArtifactsArgs): UseArtifactsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<ArtifactsVM | null>(null);
  const [latestSecret, setLatestSecret] = useState<LatestTokenSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [releaseFilter, setReleaseFilter] = useState("");
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const clearSecret = useCallback(() => setLatestSecret(null), []);
  const applyFilter = useCallback((release: string) => {
    setReleaseFilter(release);
    setTick((t) => t + 1);
  }, []);

  // Reset the shown secret and the filter when the scope changes.
  useEffect(() => {
    setLatestSecret(null);
    setReleaseFilter("");
  }, [projectId, environmentId]);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    const hasArtifacts = typeof client.listSourceMapArtifacts === "function";
    const hasTokens = typeof client.listSourceMapUploadTokens === "function";
    if (!hasArtifacts && !hasTokens) {
      setStatus("unavailable");
      setData(null);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    const release = releaseFilter.trim();
    const artifactsP =
      hasArtifacts && client.listSourceMapArtifacts
        ? client.listSourceMapArtifacts({ projectId, environmentId, ...(release ? { release } : {}) })
        : Promise.resolve([] as SourceMapArtifact[]);
    const tokensP =
      hasTokens && client.listSourceMapUploadTokens
        ? client.listSourceMapUploadTokens({ projectId, environmentId }).then((r) => r.tokens)
        : Promise.resolve([] as SourceMapUploadToken[]);

    Promise.all([artifactsP, tokensP])
      .then(([artifacts, tokens]) => {
        if (gen !== genRef.current) return;
        setData(
          buildArtifactsVM(
            { artifacts, tokens, artifactsAvailable: hasArtifacts, tokensAvailable: hasTokens },
            Date.now(),
          ),
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
  }, [client, projectId, environmentId, tick]);

  // Returns true on success, false on failure. The caller surfaces the
  // user-facing message via pushToast when this resolves false.
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const deleteArtifact = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.deleteSourceMapArtifact) return;
        await client.deleteSourceMapArtifact(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  const createToken = useCallback(
    (name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createSourceMapUploadToken) return;
        const { token } = await client.createSourceMapUploadToken({ projectId, environmentId, name });
        setLatestSecret({ name: token.name, prefix: token.prefix, secret: token.secret });
      }),
    [client, environmentId, projectId, run],
  );

  const renameToken = useCallback(
    (id: string, name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateSourceMapUploadToken) return;
        await client.updateSourceMapUploadToken(id, { projectId, environmentId }, { name });
      }),
    [client, environmentId, projectId, run],
  );

  const revokeToken = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.revokeSourceMapUploadToken) return;
        await client.revokeSourceMapUploadToken(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  return {
    data,
    status,
    latestSecret,
    busy,
    releaseFilter,
    applyFilter,
    reload,
    clearSecret,
    deleteArtifact,
    createToken,
    renameToken,
    revokeToken,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/console && pnpm vitest run src/v2/screens/useArtifacts.test.ts`
Expected: PASS — all `formatBytes`, `buildArtifactsVM`, and `useArtifacts` cases green.

- [ ] **Step 5: Type-check**

Run: `cd apps/console && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/useArtifacts.ts apps/console/src/v2/screens/useArtifacts.test.ts
git commit -m "feat(console): add useArtifacts hook + VM for v2 Setup"
```

---

### Task 2: `ArtifactsSection.tsx` — two-card presentational section

**Files:**
- Create: `apps/console/src/v2/screens/ArtifactsSection.tsx`
- Test: `apps/console/src/v2/screens/ArtifactsSection.test.tsx`

**Interfaces:**
- Consumes: `useArtifacts` + its VM types (Task 1); `ScreenCtx` (from `./registry`); `ui/v2` primitives.
- Produces (consumed by Task 3): `ArtifactsSection({ ctx }: { ctx: ScreenCtx })` — a default-exported-style named React component.

**Behavior:**
- Full-width block titled **Source maps & CI upload tokens** containing two `sh-card`s.
- Artifacts card: a release filter input (Enter or Apply calls `applyFilter`) + artifact count; rows show `minifiedFile` (mono), `release` (`sh-tag`), `originalFilename` (faint), byte size, relative created, and a delete `ConfirmButton`. Empty state notes maps are uploaded by CI via `pnpm source-maps:upload`.
- Tokens card: `New token` button revealing an inline name input; a hint distinguishing CI tokens from ingestion keys; on create the one-time secret renders in a `sh-stripe ok` banner with `SecretField`; rows show `name`, `prefix` (mono), created, last used, an active/revoked `sh-tag`, inline rename, and a revoke `ConfirmButton`. Revoked tokens render muted and without rename/revoke.
- States: when `status === "unavailable"` render an `EmptyHint`; on `error` render an error `EmptyHint`; per-card availability honored when one family is absent.
- Mutation failures call `ctx.pushToast` with a per-action message.

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/ArtifactsSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/console && pnpm vitest run src/v2/screens/ArtifactsSection.test.tsx`
Expected: FAIL — `ArtifactsSection` module does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/console/src/v2/screens/ArtifactsSection.tsx`:

```tsx
import { useState } from "react";
import { ConfirmButton, EmptyHint, Icon, SecretField } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useArtifacts, type ArtifactRowVM, type TokenRowVM } from "./useArtifacts";

export function ArtifactsSection({ ctx }: { ctx: ScreenCtx }) {
  const art = useArtifacts({
    client: ctx.client,
    projectId: ctx.project?.id,
    environmentId: ctx.environment?.id,
  });

  const [filterText, setFilterText] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (art.status === "unavailable") {
    return (
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Source maps &amp; CI upload tokens</h2>
        </div>
        <div className="sh-card__body">
          <EmptyHint icon="file" title="Artifacts API unavailable" sub="This deployment does not expose the source-map admin API." />
        </div>
      </div>
    );
  }

  const vm = art.data;

  async function submitNewToken() {
    const name = newTokenName.trim();
    if (!name) return;
    const ok = await art.createToken(name);
    if (!ok) { ctx.pushToast("Could not create upload token"); return; }
    setNewTokenName("");
    setCreatingToken(false);
  }
  async function submitRename(id: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    const ok = await art.renameToken(id, name);
    if (!ok) ctx.pushToast("Could not rename upload token");
    setRenamingId(null);
  }
  async function doDelete(row: ArtifactRowVM) {
    const ok = await art.deleteArtifact(row.id);
    if (!ok) ctx.pushToast("Could not delete source map");
  }
  async function doRevoke(row: TokenRowVM) {
    const ok = await art.revokeToken(row.id);
    if (!ok) ctx.pushToast("Could not revoke upload token");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="sh-eyebrow">Source maps &amp; CI upload tokens</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Source-map artifacts */}
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Source map artifacts</h2>
            {vm ? <span className="sh-tag">{vm.artifactCount}</span> : null}
          </div>
          <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="sh-input"
                aria-label="Filter by release"
                placeholder="Filter by release"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") art.applyFilter(filterText); }}
              />
              <button className="sh-btn" type="button" disabled={art.busy} onClick={() => art.applyFilter(filterText)}>Apply</button>
            </div>
            <div className="sh-card flush">
              {!vm || !vm.artifactsAvailable ? (
                <EmptyHint icon="file" title="Source maps unavailable" sub="This deployment does not expose the source-map artifacts API." />
              ) : vm.artifacts.length === 0 ? (
                <EmptyHint icon="file" title="No source maps uploaded yet" sub="Maps are uploaded by CI via pnpm source-maps:upload." />
              ) : (
                vm.artifacts.map((row) => (
                  <div key={row.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                    <div>
                      <strong className="sh-mono" style={{ fontSize: 12.5 }}>{row.minifiedFile}</strong>
                      <div className="sh-faint" style={{ fontSize: 10.5 }}>{row.originalFilename}</div>
                    </div>
                    <span className="sh-tag">{row.release}</span>
                    <span className="sh-faint" style={{ fontSize: 11 }}>{row.byteSizeLabel}</span>
                    <span className="sh-faint" style={{ fontSize: 11 }}>{row.createdLabel}</span>
                    <ConfirmButton label={`Delete ${row.originalFilename}`} confirmLabel="Confirm delete" icon="x" kind="ghost" onConfirm={() => void doDelete(row)} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* CI upload tokens */}
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">CI upload tokens</h2>
            <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New token" onClick={() => setCreatingToken((v) => !v)}>
              <Icon name="plus" size={13} />New token
            </button>
          </div>
          <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
            <div className="sh-faint" style={{ fontSize: 11 }}>
              CI-only secrets for <code style={{ color: "var(--fg)" }}>pnpm source-maps:upload</code> — separate from your SDK ingestion key.
            </div>

            {creatingToken ? (
              <div className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <input
                  autoFocus
                  className="sh-input"
                  aria-label="New token name"
                  placeholder="Token name"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitNewToken(); if (e.key === "Escape") setCreatingToken(false); }}
                />
                <button className="sh-btn primary" type="button" disabled={art.busy} onClick={() => void submitNewToken()}>Create</button>
              </div>
            ) : null}

            {art.latestSecret ? (
              <div className="sh-stripe ok" style={{ display: "grid", gap: 6, padding: 12, borderRadius: 8 }}>
                <strong style={{ fontSize: 12.5 }}>Token “{art.latestSecret.name}” created — copy it now, it is shown only once.</strong>
                <SecretField value={art.latestSecret.secret} />
              </div>
            ) : null}

            <div className="sh-card flush">
              {!vm || !vm.tokensAvailable ? (
                <EmptyHint icon="key" title="Upload tokens unavailable" sub="This deployment does not expose the upload-token API." />
              ) : vm.tokens.length === 0 ? (
                <EmptyHint icon="key" title="No upload tokens yet" sub="Create one to authenticate CI source-map uploads." />
              ) : (
                vm.tokens.map((row) => (
                  <div key={row.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto auto auto", opacity: row.revoked ? 0.55 : 1 }}>
                    {renamingId === row.id ? (
                      <input
                        autoFocus
                        className="sh-input"
                        aria-label="Rename token"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void submitRename(row.id); if (e.key === "Escape") setRenamingId(null); }}
                        onBlur={() => setRenamingId(null)}
                      />
                    ) : (
                      <div>
                        <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
                        <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{row.prefix} · used {row.lastUsedLabel}</div>
                      </div>
                    )}
                    <span className={`sh-tag ${row.revoked ? "" : "ok"}`}>{row.statusLabel}</span>
                    {row.revoked ? (
                      <span />
                    ) : (
                      <button className="sh-iconbtn-sm" type="button" title="Rename" aria-label={`Rename ${row.name}`} onClick={() => { setRenamingId(row.id); setRenameValue(row.name); }}>
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                    {row.revoked ? (
                      <span />
                    ) : (
                      <ConfirmButton label={`Revoke ${row.name}`} confirmLabel="Confirm revoke" icon="x" kind="ghost" onConfirm={() => void doRevoke(row)} />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

> **Note for the implementer:** the delete `ConfirmButton` for an artifact must have an accessible name `Delete {originalFilename}` in its armed-OR-unarmed state so the test can target it. `ConfirmButton` renders `label` then flips to `confirmLabel` when armed. The test arms with `name: "Delete app.min.js.map"` — therefore the **label** must read `Delete {originalFilename}` (not just "Delete"). Adjust the artifact delete button to `label={\`Delete ${row.originalFilename}\`}` and keep `confirmLabel="Confirm delete"`. Likewise the revoke button label is `Revoke ${row.name}` with `confirmLabel="Confirm revoke"`. Verify both against the test before finishing.

- [ ] **Step 4: Reconcile the delete button label with the test**

The test targets the delete control by `name: "Delete app.min.js.map"`. Set the artifact delete button to:

```tsx
<ConfirmButton label={`Delete ${row.originalFilename}`} confirmLabel="Confirm delete" icon="x" kind="ghost" onConfirm={() => void doDelete(row)} />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/console && pnpm vitest run src/v2/screens/ArtifactsSection.test.tsx`
Expected: PASS — all six cases green.

- [ ] **Step 6: Type-check**

Run: `cd apps/console && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/v2/screens/ArtifactsSection.tsx apps/console/src/v2/screens/ArtifactsSection.test.tsx
git commit -m "feat(console): add ArtifactsSection two-card surface"
```

---

### Task 3: Mount `ArtifactsSection` in `SetupScreen` + extend Setup test

**Files:**
- Modify: `apps/console/src/v2/screens/SetupScreen.tsx`
- Modify: `apps/console/src/v2/screens/SetupScreen.test.tsx`

**Interfaces:**
- Consumes: `ArtifactsSection` (Task 2).

- [ ] **Step 1: Extend the Setup test (failing)**

Add to the existing source-map-less `makeClient` in `SetupScreen.test.tsx` the four source-map methods so the section can render, and add an assertion that both card headings mount. Apply these two edits:

In `makeClient` (after `getOperations: ...,`), add:

```ts
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
    deleteSourceMapArtifact: vi.fn().mockResolvedValue(undefined),
    createSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { id: "tok_1", projectId: "prj_1", environmentId: "env_1", name: "n", prefix: "shsmap_ab", createdAt: "x", lastUsedAt: null, revokedAt: null, secret: "shsmap_secret" } }),
    updateSourceMapUploadToken: vi.fn().mockResolvedValue({ token: { id: "tok_1", projectId: "prj_1", environmentId: "env_1", name: "n", prefix: "shsmap_ab", createdAt: "x", lastUsedAt: null, revokedAt: null } }),
    revokeSourceMapUploadToken: vi.fn().mockResolvedValue(undefined),
```

Add this test inside the `describe("SetupScreen", ...)` block:

```tsx
  it("mounts the artifacts section", async () => {
    render(<SetupScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Source map artifacts")).toBeInTheDocument();
    expect(screen.getByText("CI upload tokens")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the Setup test to verify the new case fails**

Run: `cd apps/console && pnpm vitest run src/v2/screens/SetupScreen.test.tsx`
Expected: the new "mounts the artifacts section" case FAILS (`Source map artifacts` not found); existing cases still pass.

- [ ] **Step 3: Mount the section in `SetupScreen.tsx`**

Add the import after the existing `useSetup` import (line 4):

```tsx
import { ArtifactsSection } from "./ArtifactsSection";
```

Mount the section as a new full-width block immediately before the closing `</>` of the main return (after the two-column grid `</div>` that closes at line ~243):

```tsx
      <ArtifactsSection ctx={ctx} />
    </>
  );
}
```

The full tail of the component becomes:

```tsx
        </div>
      </div>

      <ArtifactsSection ctx={ctx} />
    </>
  );
}
```

- [ ] **Step 4: Run the Setup test to verify it passes**

Run: `cd apps/console && pnpm vitest run src/v2/screens/SetupScreen.test.tsx`
Expected: PASS — all existing cases plus "mounts the artifacts section" green. Confirm no existing Setup assertion broke (they assert on text, so the new block is additive).

- [ ] **Step 5: Type-check**

Run: `cd apps/console && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/SetupScreen.tsx apps/console/src/v2/screens/SetupScreen.test.tsx
git commit -m "feat(console): mount ArtifactsSection in v2 Setup (PER-369)"
```

---

## Final verification (whole branch)

Run from repo root:

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

Expected: all green; no regression vs the prior `main` count. No dependency change → `pnpm-lock.yaml` unchanged.

## Cross-file impact (final-review watch list)

- `SetupScreen.tsx` gains one import + one mounted block. The existing Setup tests assert on text, so risk is low — but verify no sibling test asserts the screen's exact child count/structure (S10 lesson: a section change once broke a sibling test).
- No `NavSection`/registry change — folded into the existing `settings` section. No exhaustive-map churn.
- `ArtifactsSection` reuses only existing `ui/v2` exports and `.sh-*` classes — no new CSS, no new deps.

## Out of scope (follow-ups → PER-364)

- Browser upload of single maps + `.zip` bundles (`uploadSourceMap`/`uploadSourceMapBundle`) — deferred; v1 `ArtifactsPanel` retains it.
- The Operations-only setup-gaps hint — deferred.
- Removing the v1 `ArtifactsPanel` mount from `ConsoleShell.tsx`/`ProjectSettingsWorkspace.tsx` at epic-exit cleanup.
- A regenerate/rotate-token affordance beyond create+revoke.
