# Console v2 — Artifacts in Setup (PER-369) — design spec

**Status:** approved (autonomous epic loop — controller decision; attached to PER-369 for user review)
**Design source:** none — Artifacts has **no v2 comp**. This folds the v1
`apps/console/src/components/ArtifactsPanel.tsx` feature into the now-shipped v2
`SetupScreen` (PER-357, done), reusing the established v2 design system.
**Linear:** PER-369 (epic "SignalMonitor Console v2 — dark redesign"), decided in PER-358 triage ("fold into Setup, not a standalone nav item").
**Depends on:** S10 Setup (PER-357) — done. Reuses the Setup + Monitors (PER-368) patterns.

---

## Goal

Fold source-map **artifact management** and **CI upload-token lifecycle** into the v2
Setup screen as a new section, so operators manage their release-debugging credentials
from the same place they connect their app — without a standalone nav item, and without
the legacy `ArtifactsPanel`.

## Scope decision (for user review)

The v1 `ArtifactsPanel` does four things: (1) list source-map artifacts, (2) **browser
upload** of single `.map` files and `.zip` bundles, (3) delete artifacts, (4) full
upload-token lifecycle (create with one-time secret, rename, revoke).

This v2 fold ships **(1) list + release filter, (3) delete, and (4) the full upload-token
lifecycle** — the operator-facing management surface. It **defers (2) browser upload** to
a follow-up (tracked in PER-364). Rationale: the designed primary path for getting maps
into the system is CI running `pnpm source-maps:upload` authenticated by an **upload token**
(a CI-only secret, per CONSTRAINTS). The console's job in v2 is to **mint/revoke those
tokens** and to **observe and prune** the artifacts CI produces — not to hand-upload maps
from a browser. The v1 `ArtifactsPanel` remains mounted in the v1 `ConsoleShell`
(flag-gated, lossless) so browser upload is not lost from the product while deferred.

> If browser upload should ship in this screen instead of being deferred, that is the one
> decision to flag before the plan — everything else is mechanical reuse.

## Architecture

Same shape as every prior v2 screen/section:

- **`useArtifacts.ts`** — a pure VM builder `buildArtifactsVM(input, nowMs)` + a
  race-guarded data hook `useArtifacts({ client, projectId, environmentId })` that loads
  artifacts + upload tokens in parallel, guards the **optional** source-map client methods
  with an `"unavailable"` state, and exposes mutation actions + a one-time `latestSecret`.
  Builder is pure/deterministic (takes `nowMs`); hook mirrors `useMonitors`/`useSetup`
  byte-for-byte (genRef race guard, `tick`/`reload`, cleanup, actions return `boolean`).
- **`ArtifactsSection.tsx`** — a flat `ArtifactsSection({ ctx }: { ctx: ScreenCtx })`
  consuming the hook's VM and rendering the design with existing `ui/v2` primitives and
  `.sh-*` CSS. **No new CSS, no new shared components** (recon confirmed every class and
  component exists).
- **`SetupScreen.tsx`** — render `<ArtifactsSection ctx={ctx} />` as a new full-width
  `sh-card`-bearing block **below the existing two-column grid** (the section carries two
  sub-cards — artifacts and tokens — so it needs the full width rather than squeezing into
  the left column). One-line change: import + mount at the bottom of the returned fragment.

### Optional-client guard (important)

All `SourceMapApiClient` methods are **optional** on `ApiClient` (`& Partial<SourceMapApiClient>`,
client.ts:265): `listSourceMapArtifacts`, `deleteSourceMapArtifact`,
`listSourceMapUploadTokens`, `createSourceMapUploadToken`, `updateSourceMapUploadToken`,
`revokeSourceMapUploadToken` (plus the deferred `uploadSourceMap`/`uploadSourceMapBundle`).
The hook must guard their absence: if `client.listSourceMapArtifacts` and
`client.listSourceMapUploadTokens` are both undefined, the section renders an `EmptyHint`
("Artifacts API unavailable") instead of calling them. Mirrors the `useMonitors`
unavailable guard and the v1 `hasSourceMapArtifactsClient`/`hasSourceMapTokenClient` checks.

## Backend contract (verbatim from recon — types.ts / client.ts)

- `SourceMapArtifact = { id, projectId, environmentId, release, minifiedFile,
  originalFilename, byteSize, sha256, createdAt, uploadedByUserId }` (types.ts:231-243).
- `SourceMapUploadToken = { id, projectId, environmentId, name, prefix, createdAt,
  lastUsedAt: string | null, revokedAt: string | null }` (types.ts:244-253).
- `CreatedSourceMapUploadToken = SourceMapUploadToken & { secret: string }` (one-time;
  types.ts:255-257).
- `SourceMapArtifactQuery = { projectId, environmentId, release? }` (types.ts:259-263).
- Client (all OPTIONAL):
  - `listSourceMapArtifacts(query) → SourceMapArtifact[]`
  - `deleteSourceMapArtifact(id, { projectId, environmentId }) → void`
  - `listSourceMapUploadTokens({ projectId, environmentId }) → { tokens: SourceMapUploadToken[] }`
  - `createSourceMapUploadToken({ projectId, environmentId, name }) → { token: CreatedSourceMapUploadToken }`
  - `updateSourceMapUploadToken(id, { projectId, environmentId }, { name? }) → { token: SourceMapUploadToken }`
  - `revokeSourceMapUploadToken(id, { projectId, environmentId }) → void`
- Routes are `/admin/source-maps*` and `/admin/source-map-upload-tokens*` (admin session;
  the console's existing admin session gates them — no new auth work).

## Section layout

A single full-width block under the Setup two-column grid, titled
**Source maps & CI upload tokens**, containing two `sh-card`s:

1. **Source-map artifacts card**
   - Header: title `Source map artifacts` + a release filter (`sh-input` text + a small
     `Apply`/clear, or a `Segmented` of recent releases if cheap; default a text filter
     matching v1) + the artifact count.
   - Rows (`sh-row`): `minifiedFile` (mono, primary) · `release` (`sh-tag`) ·
     `originalFilename` (faint) · human byte size · relative `createdAt` · a delete
     `ConfirmButton` (2-click, danger). The console shows **only metadata** — never any
     original source content (CONSTRAINT; the artifact type carries no source content).
   - States: loading / error / empty ("No source maps uploaded yet") — note in the empty
     state that maps are uploaded by CI via `pnpm source-maps:upload`.

2. **CI upload tokens card**
   - Header: title `CI upload tokens` + a `New token` button revealing an inline name input.
   - A short hint distinguishing these from browser ingestion API keys: "CI-only secrets for
     `pnpm source-maps:upload` — separate from your SDK ingestion key."
   - On create, the returned `secret` renders once in a `sh-stripe ok` banner with a
     `SecretField` (masked) + "copy it now, shown only once" (the `useSetup.generateApiKey`
     pattern). Reset on scope change.
   - Rows (`sh-row`): `name` · `prefix` (mono) · created relative · `lastUsedAt` (relative
     or "never") · an Active/Revoked `sh-tag` · rename (inline `edit`) · revoke
     `ConfirmButton` (2-click). Revoked tokens render muted and without a revoke action.

## Status / mapping

- Token state tag: `revokedAt != null` → `sh-tag` muted "revoked"; else `sh-tag ok` "active".
- No `MonitorStatus`-style mapping needed; artifacts have no status.

## Determinism / time

All relative-time formatting goes through a local `relativeTimeFrom(iso, nowMs)` (as in
Monitors/Setup); only the hook reads `Date.now()`, once per load, passed to the pure builder.

## States

- **API unavailable** — both `listSourceMapArtifacts` and `listSourceMapUploadTokens` absent
  → `EmptyHint` (`icon="file"`, "Artifacts API unavailable"). If only one family is present,
  render that card and show the unavailable hint for the other.
- **Loading / Error / Empty** — `EmptyHint` per the prior screens (icons `activity`/`alert`/`file`).
- **No project/environment** — the shell guards this before rendering Setup; the hook still
  guards `if (!projectId || !environmentId) return`, and `ArtifactsSection` renders nothing
  (or a faint hint) when scope is missing, consistent with the rest of Setup.
- **Mutation errors** — caught, surfaced via `ctx.pushToast`; inline form stays open.

## Testing

- `useArtifacts.test.ts` (jsdom line 1) — pure `buildArtifactsVM`: artifact rows (byte-size
  formatting, release tag, relative createdAt via fixed `nowMs`); token rows (active vs
  revoked, lastUsedAt "never"); both-absent → unavailable VM; one-absent → partial VM. Hook
  race-guard + actions (create sets latestSecret, revoke/delete/rename call the right client
  method) mirror the `useMonitors` tests.
- `ArtifactsSection.test.tsx` (jsdom line 1) — renders both cards; delete artifact 2-click
  calls `deleteSourceMapArtifact`; create token reveals the one-time secret and calls
  `createSourceMapUploadToken`; rename calls `updateSourceMapUploadToken`; revoke 2-click
  calls `revokeSourceMapUploadToken`; API-unavailable state. Use `getAllByText`/`within` for
  duplicated copy; never rename design copy.
- `SetupScreen.test.tsx` — extend: assert the Artifacts section mounts (e.g. "Source map
  artifacts" / "CI upload tokens" headings present) without breaking existing Setup tests.
- Full gate: `pnpm test`, `pnpm build`, `pnpm --filter @sigmon/sdk build`, `docker compose
  config` — all green; no regression.

## Cross-file impact (final-review watch list)

- `SetupScreen.tsx` gains one import + one mounted block — confirm no existing Setup test
  asserts the screen's exact child count/structure in a way the new block breaks (lesson
  from S10: a section change broke a sibling test). The Setup tests assert on text, so the
  risk is low — verify.
- No `NavSection`/registry change (this is folded into the existing `settings` section), so
  no exhaustive-map churn — unlike Monitors.

## Out of scope (follow-ups → PER-364)

- **Browser upload** of single maps + `.zip` bundles (`uploadSourceMap`/`uploadSourceMapBundle`)
  — deferred; v1 `ArtifactsPanel` retains it. Revisit if operators need hand-upload in v2.
- The Operations-only **setup-gaps** hint (PER-369 said "optionally") — deferred; keep this
  fold tight.
- Removing the v1 `ArtifactsPanel` mount from `ConsoleShell.tsx`/`ProjectSettingsWorkspace.tsx`
  at epic-exit cleanup.
- A "regenerate" / rotate-token affordance beyond create+revoke.

## Constraints honored

- Dark-only, `.sh-v2`-scoped, **English UI**, maximum fidelity to the established design language.
- The console shows source-map **metadata only**, never original source content (the artifact
  type carries none; verified no `sourcesContent`/`fileContent` anywhere).
- Upload tokens are **CI-only secrets, separate from browser ingestion API keys**, labelled as
  such; the token secret is shown **once at creation** and never re-revealed.
- No new dependencies → no `pnpm-lock.yaml` change.
- Mutation-screen exception already satisfied (Setup is the epic's explicit mutation screen).
