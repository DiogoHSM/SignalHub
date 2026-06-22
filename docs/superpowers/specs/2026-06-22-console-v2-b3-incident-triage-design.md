# B3 · Console v2 — Incident triage backend

**Epic:** SignalMonitor Console v2 — dark redesign
**Issue:** PER-346
**Date:** 2026-06-22
**Status:** Draft for review
**Feeds:** S3 (Incident detail), S4 (Incidents list). Branch `feat/console-v2-b3-incident-triage` off main.

## Goal

Add incident-triage capabilities the v2 Incident screens need but the backend lacks today: **assignee**, **persisted triage notes**, a **stable incident number (INC-####)**, an **MTTR metric (7d)**, and **silence/mute** (silenced_until). Error groups already carry status/priority/resolvedAt; B3 extends them. Out of scope: external GitHub-issue creation (the S3 button stays a stub/toast).

Current state (from the B3 inventory): migrations are raw SQL in `packages/db/migrations/` registered in `migrate.ts` (tracked in `_migrations` w/ SHA256); `schema.ts` is hand-written Kysely types; `error_groups` has `first_seen_at`/`resolved_at`/`status`/`priority`; session user is `{ id, email, isAdmin }` via `requireHumanUser()`; `PATCH /query/error-groups/:id` updates status/priority; alerts evaluate per-rule in `apps/worker/src/alerts.ts`.

## Schema (new migration — next sequential file, e.g. `00NN_incident_triage.sql`; add matching Kysely types to `schema.ts`)

1. **`error_groups` add columns:**
   - `assigned_to_user_id text NULL REFERENCES users(id)` (ON DELETE SET NULL — users soft-delete via archived_at; never cascade).
   - `silenced_until timestamptz NULL`.
   - `incident_number text NULL UNIQUE` (format `INC-####`, ≥4 digits, monotonic).
2. **`incident_number_seq`** — a Postgres `SEQUENCE` (global). Numbers are assigned at **error-group creation** (in the existing upsert path) so every group has a stable INC# (groups are deduped, not per-occurrence — volume is bounded). The migration **backfills** existing groups: assign sequential numbers ordered by `created_at`, then set the sequence start above the max.
3. **`triage_notes` table:**
   - `id text PK` (prefixed `note_…` via `createId`), `error_group_id text NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE`, `author_user_id text NULL REFERENCES users(id) ON DELETE SET NULL`, `author_email text NOT NULL` (denormalized snapshot, survives user deletion), `body text NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. Index `(error_group_id, created_at)`.

Format helper: `INC-` + zero-padded sequence (`INC-0001`, `INC-4821`).

## Repository (`packages/db/src/repositories/incident-triage.ts` — new; reuse `error-groups.ts`/`incidents.ts` patterns)

- `assignIncident(db, { errorGroupId, assignedToUserId | null })` → updated group; validates the user exists + not archived (or null to unassign).
- `addTriageNote(db, { errorGroupId, authorUserId, authorEmail, body })` → created note. `listTriageNotes(db, errorGroupId)` → notes asc by created_at.
- `silenceIncident(db, { errorGroupId, until: Date | null })` → sets `silenced_until` (null clears). A convenience for "silence N minutes": route computes `until = now + minutes`.
- `getIncidentMttr(db, { projectId, environmentId, windowDays })` → `{ mttrMs: number | null, resolvedCount: number }` = avg(`resolved_at - first_seen_at`) over groups where `status='resolved' AND resolved_at IS NOT NULL AND resolved_at >= now()-window`. null when none.
- `assignIncidentNumberOnCreate` — fold into the existing error-group upsert: when inserting a new group, `nextval('incident_number_seq')` → `INC-####`. Idempotent (only when `incident_number IS NULL`).

Extend `incidents.ts` `getErrorGroupIncident` (or the incident detail shape) to include: `incidentNumber: string | null`, `assignedTo: { id: string; email: string } | null`, `silencedUntil: string | null`, `notes: { id; authorEmail; body; createdAt }[]`.

## API (extend `query.ts`; auth `requireHumanUser`, scope by project_id/environment_id like siblings)

- **Assign:** extend `PATCH /query/error-groups/:id` body to also accept `assignedToUserId: string | null` (alongside status/priority). Author/actor = `request.currentUser`. (Keeps one triage-mutation endpoint.)
- **Notes:** `POST /query/incidents/error-groups/:id/notes` `{ body: string (1..5000) }` → creates a note with author = `currentUser` (id + email snapshot); returns the note. Notes are also returned inline in `GET /query/incidents/error-groups/:id` (no separate list route needed; add one only if the detail payload gets heavy → not now).
- **Silence:** `POST /query/incidents/error-groups/:id/silence` `{ minutes: number | null }` → `minutes>0` sets `silenced_until = now + minutes`; `minutes === null` or `0` clears. Returns the updated group.
- **MTTR:** `GET /query/incidents/mttr?project_id&environment_id&window=7d` → `{ data: { mttrMs, resolvedCount, windowDays } }`. (S2/S4 KPI tiles consume it; format client-side, e.g. "42 min".)
- **Incident detail** already exists (`GET /query/incidents/error-groups/:id`) — now returns the extended shape above.

Zod validation + 400/401/404 per existing route conventions. `assignedToUserId` must reference an existing non-archived user (else 400/404).

## Worker — silence suppression (`apps/worker/src/alerts.ts`)

The alert engine evaluates **rules** (critical_errors / error_count / error_rate / …) per project+env, not per group. Scope silence pragmatically:
- Where an alert is **attributable to a specific error group** (e.g. a `critical_errors` rule firing that cites a group / latest error), check that group's `silenced_until`; if `> now`, **suppress the alert_event/notification** for it.
- Where a rule is purely aggregate (error_rate over the env) with no single group attribution, silence does **not** suppress it — document this. (A per-group mute can't sensibly silence an env-wide rate alert.)
- The screen-facing silence state (set + display "silenced until X") is fully delivered regardless; the suppression wiring is best-effort where attribution exists. If the alert model has no group attribution at all, ship silence state + display and file the suppression as a follow-up (note in the report).

## Testing (Vitest; repo tests use a real Postgres testcontainer via `withDb`)

- **Migration:** applies cleanly; backfills existing groups with sequential INC#; sequence continues above max; columns/constraints present; checksum registered in `migrate.ts`.
- **incident-triage repo:** assign/unassign (validates user, SET NULL on unassign); addTriageNote + listTriageNotes order + author snapshot; silence set/clear; MTTR math (avg over resolved-in-window, null when none, ignores unresolved); incident number assigned on create + idempotent + unique.
- **incidents detail:** returns incidentNumber/assignedTo/silencedUntil/notes.
- **routes:** PATCH assign (valid/invalid user → 400/404; unauth → 401); POST notes (creates w/ currentUser; validation); POST silence (minutes→until; clear); GET mttr (shape; window). Mock auth currentUser.
- **worker:** a silenced group's group-attributable alert is suppressed while `silenced_until > now`; not suppressed after expiry; aggregate rules unaffected (document).
- No regression: existing error-group/incident/alert tests stay green.

## Verification
```sh
pnpm test            # repo (incl. migration applied in db tests, branding)
pnpm build
```
Manual: apply migration on a dev DB; `curl` assign/notes/silence/mttr with a session cookie.

## Out of scope / follow-ups (PER-364)
- GitHub-issue creation (S3 stub).
- Silence suppression for purely-aggregate alert rules (only group-attributable alerts are suppressed in v1).
- Per-project incident numbering (v1 uses a single global sequence — `INC-####` is global, matching the design's `INC-4821`).
