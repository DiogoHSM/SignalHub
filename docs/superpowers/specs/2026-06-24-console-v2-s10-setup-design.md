# Console v2 — S10 Setup screen (PER-357) — design spec

**Status:** approved (autonomous epic loop — controller decision)
**Design source:** `.claude/design-v2/app-screens-c.jsx` → `SetupScreen`
**Linear:** PER-357 (epic "SignalMonitor Console v2 — dark redesign")
**Depends on:** F1 (design system), F2 (app shell) — both done.

---

## Goal

Replace the last remaining legacy island in the v2 shell — the `settings` section
(`ProjectSettingsWorkspace`) — with a dark-redesign **Setup** screen that onboards an
operator and connects their app: onboarding stepper, projects list (create / rename /
archive), environments list, an SDK-connected banner, and an install panel with a scoped
API key, install command, multi-language init snippets, and a send-test-ping action.

After this screen, **every** v2 nav section renders a native v2 screen — no legacy islands
remain in the v2 registry.

## Architecture

Same shape as every prior v2 screen (S1–S9):

- **`useSetup.ts`** — a pure VM builder `buildSetupVM(...)` + a race-guarded data hook
  `useSetup({ ctx })`. The hook loads three things in parallel for the active
  project/environment and exposes mutation actions. The builder is pure and deterministic
  (takes `nowMs`) so it is unit-testable.
- **`SetupScreen.tsx`** — a flat `SetupScreen({ ctx }: { ctx: ScreenCtx })` that consumes
  the hook's VM and renders the design, reusing existing `ui/v2` primitives and CSS. No new
  CSS, no new shared components (recon confirmed every class and component already exists).
- **registry flip** — `settings` entry flips `kind: "legacy"` → `kind: "v2"` rendering
  `<SetupScreen ctx={ctx} />`, dropping the `ProjectSettingsWorkspace` import from the
  registry. One **optional** `ScreenCtx.reload?` field is added so Setup mutations refresh
  the shell's project/environment state; `ConsoleShellV2` provides it via a new `reload` on
  `useConsoleProjects`.

### Why replacing `settings` is safe (no regression)

- The v2 shell is **flag-gated** (`?v2=1`) and pre-release. The legacy v1 `ConsoleShell`
  still renders the full `ProjectSettingsWorkspace` (with API-key list/revoke, browser
  origins, etc.) at `ConsoleShell.tsx` for `activeMode` `project-settings`/`configure`.
  Flipping the **v2** registry entry does not touch v1, so the default experience keeps
  every capability.
- Setup is the epic's **explicit mutation screen**. The project constraint "keep Overview
  and investigation views read-only unless a design explicitly introduces a mutation
  workflow" is satisfied: this design explicitly introduces create/rename/archive/generate
  flows.

## Real-backend wiring vs. stubs

Recon (`ConsoleShellV2.tsx`, `client.ts`, `types.ts`) established exactly what is wireable:

| Design element | Backend | Decision |
|---|---|---|
| Projects list | `client.listProjects()` | **Real** |
| Create project (`+`) | `client.createProject({ name })` | **Real** (inline input) |
| Rename project (edit icon) | `client.updateProject(id, { name })` | **Real** (inline edit) |
| Archive project (archive icon) | `client.archiveProject(id)` | **Real** (ConfirmButton 2-click) |
| Environments list | `ctx.environments` | **Real** |
| Create environment | `client.createEnvironment(projectId, { name })` | **Real** (inline input) |
| Env status dot | `Environment` has **no** status field | **Derive**: active env that has received a signal → `ok`; otherwise `idle` |
| API key (SecretField) | `client.createApiKey` returns full `secret` **once** | **Real**: generate-on-demand; show freshly created secret; never show an existing key's value |
| API key existence (stepper) | `client.listApiKeys(projectId)` → `prefix` only | **Real** (non-revoked key for active env) |
| SDK-connected banner | `getOperations({...}).summary.telemetry.lastEventAt` + `.events` | **Real** recency + window count |
| Onboarding stepper done-states | derived from the above | **Real** |
| Install command / init snippets | client-side, from endpoint + project/env + key prefix | **Real** (generated) |
| "Send test ping" | **No** console-side ingestion endpoint exists | **Stub** (`pushToast`), follow-up filed |
| API-key list / revoke management | exists in legacy only; not in this design | **Deferred** to follow-up (legacy retains it) |

`client.getOperations` is **optional** on `ApiClient` (`getOperations?`). The hook must guard
for its absence (treat as "no telemetry data": banner shows "waiting for first signal",
signal-dependent steps pending).

## Screen layout (faithful to design)

1. **PageHead** — title `Setup`, sub `Connect your application in ~2 minutes. Each project +
   environment has isolated keys.` (English; design copy is pt-BR — translate, never ship pt-BR).
2. **Onboarding stepper card** — 5 steps in order with done/pending styling and connector
   lines (accent when both ends done):
   - `Create project` — done when a project is selected (always, if rendering).
   - `Create environment` — done when the active project has ≥1 environment.
   - `Generate API key` — done when ≥1 non-revoked key exists for the active environment.
   - `Install SDK` — done when a first signal has been received (`lastEventAt != null`)
     (install cannot be detected independently; a received signal implies it).
   - `Send first signal` — done when `lastEventAt != null`.
3. **Two-column body** `grid 1fr 1.4fr`:
   - **Left column** (stacked, scroll):
     - **Projects** card — header `+` reveals an inline name input (Enter commits → create).
       Each row: name + id (mono), `selected` tag for active project, edit + archive icon
       buttons. Edit turns the name into an inline input (Enter commits → rename). Archive is
       a 2-click confirm.
     - **Environments** card — rows for the active project's environments: name + detail
       (active env → "N API keys · receiving" / others → "active"), `StatusDot`. A header `+`
       reveals an inline input to create an environment.
     - **SDK-connected banner** (`sh-stripe ok`) — when `lastEventAt != null`: check icon +
       "SDK connected" + "Last signal {relative} · {events} events / {window}". When no signal
       yet: a neutral "Waiting for first signal" hint (still `sh-card`, no false "connected").
   - **Right column** — **Install SDK** card:
     - Header `Segmented` tabs `["Browser", "Node", "Python", "HTTP"]`.
     - `1 · Your key (scoped to {project} / {env})` — `SecretField`. If a key was generated
       this session, show its secret; otherwise show a "Generate API key" button (create on
       click). A shield hint: "Treat like a password. The browser key is public; use a
       server-side key for Node/Python."
     - `2 · Install` — `sh-code`: `$ pnpm add @sigmon/sdk`.
     - `3 · Initialize ({tab})` — `sh-code` with the syntax-highlighted snippet for the tab,
       generated from the endpoint (`window.location.origin`), project/env, and key
       placeholder. Snippets ported verbatim from the design's token markup.
     - **Send test event** dashed panel — "Send a `setup.ping` to validate." → button →
       **stub** `pushToast("Test ping is not yet available")` (no backend).

## States

- **Loading** — `EmptyHint` (`icon="activity"`) while initial data loads, matching prior screens.
- **No project / environment** — the shell already guards this (renders a "Loading project…"
  empty state before `renderSection`), so the screen can assume `ctx.project` and
  `ctx.environment` are defined, consistent with other screens.
- **Mutation errors** — caught and surfaced via `ctx.pushToast` with a readable message; the
  inline input stays open on failure.

## Testing

- `useSetup.test.ts` — pure `buildSetupVM` cases: stepper done-states across the 5
  permutations (no env / no key / no signal / fully connected); banner connected vs. waiting;
  env status derivation; relative-time formatting (deterministic `nowMs`); `getOperations`
  absent. Hook race-guard behavior mirrors `useAlerts`/`useSystemHealth` tests.
- `SetupScreen.test.tsx` — renders stepper, projects (with selected tag), environments,
  install panel tabs switch snippets, generate-key flow shows secret, archive 2-click,
  inline create/rename commit calls the right client method, test-ping is a stubbed toast.
- `registry.test.tsx` — `settings` is now `kind: "v2"`; renders the v2 screen **not** wrapped
  in `.console-legacy-island`.
- All new DOM test files carry `// @vitest-environment jsdom` as line 1.

## Out of scope (follow-ups → PER-364)

- Real "send test ping" backend (console-side synthetic ingestion). Likely B4/PER-347 territory.
- API-key **list/revoke** management inside v2 Setup (legacy ProjectSettingsWorkspace retains it).
- Real per-environment "receiving / events-per-minute" rate (backend exposes only `lastEventAt`
  + windowed counts).
- Removing the now-unused legacy `settings`/`configure` mounts from v1 `ConsoleShell` once v2
  becomes the default shell (epic-exit cleanup, not this screen).

## Constraints honored

- Dark-only, `.sh-v2`-scoped, English UI, maximum visual fidelity to the design.
- API keys shown once at creation; existing keys never reveal their value (prefix only).
- No new dependencies → no `pnpm-lock.yaml` change.
- Verification gate: `pnpm test`, `pnpm build`, `pnpm --filter @sigmon/sdk build`,
  `docker compose config` all green; no regression.
