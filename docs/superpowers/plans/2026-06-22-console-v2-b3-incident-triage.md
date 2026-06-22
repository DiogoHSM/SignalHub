# Console v2 — B3 Incident Triage Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Add incident-triage backend — assignee, triage notes, stable INC-#### number, MTTR(7d), silence — for the S3/S4 screens.

**Architecture:** A raw-SQL migration extends `error_groups` + adds `triage_notes` + an `incident_number_seq`; a new `incident-triage.ts` repo provides assign/notes/silence/MTTR; incident numbers are assigned at error-group creation; the incident detail shape gains the new fields; new/extended `query.ts` routes expose it; the worker suppresses group-attributable alerts while silenced.

**Tech:** Kysely + Postgres (raw SQL migrations registered in `migrate.ts`, `_migrations`+SHA256), Fastify, Vitest (db tests use a real PG testcontainer via `withDb`). schema.ts = hand-written Kysely types.

## Global Constraints
- Packages `@sigmon/db`, `@sigmon/api`, `@sigmon/worker`. Repo gate `pnpm test` + `pnpm build`.
- Migration is **`packages/db/migrations/0015_incident_triage.sql`** (next number; 0014 is highest). Register it in `packages/db/src/migrate.ts` (append to the array). After writing it, the migrate framework computes the SHA256 — don't hand-author a checksum; just register name+url like the others. Mirror an existing migration (`0012_alerting_monitors.sql`) for table/index/constraint style.
- Update `packages/db/src/schema.ts` Kysely types to match (new columns on `ErrorGroupsTable`, new `TriageNotesTable`).
- Response/money/date conventions match existing query routes (`{ data }` envelope, ISO date strings).
- Auth `requireHumanUser`; actor = `request.currentUser` ({id,email,isAdmin}).
- No fabrication; tests are real (testcontainer for db, mock auth for routes).
- Out of scope: GitHub-issue creation; aggregate-rule silence suppression (only group-attributable).

## File Structure
```
packages/db/migrations/0015_incident_triage.sql        # NEW
packages/db/src/migrate.ts                              # MODIFY (register 0015)
packages/db/src/schema.ts                               # MODIFY (types)
packages/db/src/repositories/incident-triage.ts        # NEW + .test
packages/db/src/repositories/error-groups.ts           # MODIFY (assign INC# on create)
packages/db/src/repositories/incidents.ts              # MODIFY (extend detail shape)
apps/api/src/routes/query.ts                            # MODIFY (routes) + test
apps/worker/src/alerts.ts                               # MODIFY (silence suppression) + test
```

---

### Task 1: migration + schema types
**Files:** Create `packages/db/migrations/0015_incident_triage.sql`; Modify `migrate.ts`, `schema.ts`; Test in `packages/db/test/` (migration/repository test).

- [ ] Step 1: Read `0012_alerting_monitors.sql` (table/index/constraint style), `migrate.ts` (registration array), `schema.ts` (`ErrorGroupsTable`, `UsersTable` types, `createId`).
- [ ] Step 2: Write a failing db test — after `migrate(db)`, assert: `error_groups` has `assigned_to_user_id`, `silenced_until`, `incident_number`; `triage_notes` table exists; an inserted error-group gets a non-null `incident_number` like `INC-####`; backfill gave existing groups numbers. (Mirror `packages/db/test/repositories.test.ts` withDb setup.)
- [ ] Step 3: Run → FAIL.
- [ ] Step 4: Write `0015_incident_triage.sql`:
  - `alter table error_groups add column assigned_to_user_id text references users(id) on delete set null;`
  - `alter table error_groups add column silenced_until timestamptz;`
  - `alter table error_groups add column incident_number text;`
  - `create sequence if not exists incident_number_seq;`
  - backfill: `update error_groups set incident_number = 'INC-' || lpad(nextval('incident_number_seq')::text, 4, '0') where incident_number is null;` (ordered — wrap in a `do` block iterating by `created_at` if strict ordering matters; else a single update is acceptable).
  - `alter table error_groups add constraint error_groups_incident_number_unique unique (incident_number);`
  - `create table triage_notes ( id text primary key, error_group_id text not null references error_groups(id) on delete cascade, author_user_id text references users(id) on delete set null, author_email text not null, body text not null, created_at timestamptz not null default now() );`
  - `create index triage_notes_group_created_idx on triage_notes (error_group_id, created_at);`
  Register in `migrate.ts`; add `TriageNotesTable` + the 3 new `ErrorGroupsTable` columns to `schema.ts`.
- [ ] Step 5: Run → PASS.
- [ ] Step 6: Commit `feat(db): incident-triage migration 0015 + schema types (PER-346)`.

---

### Task 2: incident-triage repo + INC# on create + MTTR
**Files:** Create `packages/db/src/repositories/incident-triage.ts` + `.test`; Modify `error-groups.ts` (assign INC# in the upsert/create path).

**Interfaces:** `assignIncident(db,{errorGroupId,assignedToUserId|null})`, `addTriageNote(db,{errorGroupId,authorUserId,authorEmail,body})`, `listTriageNotes(db,errorGroupId)`, `silenceIncident(db,{errorGroupId,until:Date|null})`, `getIncidentMttr(db,{projectId,environmentId,windowDays})→{mttrMs:number|null,resolvedCount:number}`. INC# assignment folded into the new-group insert in `error-groups.ts` (`incident_number = 'INC-'||lpad(nextval('incident_number_seq')...)` only when inserting).
- [ ] Step 1: failing tests (withDb) — assign sets/clears + validates user exists/non-archived; addTriageNote + listTriageNotes order + author_email snapshot; silence set/clear; MTTR avg over resolved-in-window (null when none, ignores unresolved/out-of-window); a newly upserted group has a fresh unique INC#.
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement repo + the create-path INC# assignment.
- [ ] Step 4: → PASS.
- [ ] Step 5: Commit `feat(db): incident-triage repo + MTTR + INC# on create (PER-346)`.

---

### Task 3: extend incident detail shape
**Files:** Modify `incidents.ts` (`getErrorGroupIncident` + `ErrorGroupIncident` type) + its test.
- [ ] Step 1: failing test — incident detail includes `incidentNumber`, `assignedTo: {id,email}|null`, `silencedUntil: string|null`, `notes: {id,authorEmail,body,createdAt}[]`.
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement — join assignee user (id,email), include silenced_until + incident_number, fetch notes via `listTriageNotes`.
- [ ] Step 4: → PASS.
- [ ] Step 5: Commit `feat(db): extend incident detail with triage fields (PER-346)`.

---

### Task 4: routes
**Files:** Modify `apps/api/src/routes/query.ts` + route test.
- [ ] Step 1: Read the existing `PATCH /query/error-groups/:id` handler + `registerQueryRoutes` + zod patterns. Write failing route tests (mock auth currentUser): PATCH accepts `assignedToUserId` (valid→assigns; unknown→400/404; null→unassign; unauth→401); `POST /query/incidents/error-groups/:id/notes` `{body}` creates note w/ currentUser (validation 400 on empty/too-long); `POST /query/incidents/error-groups/:id/silence` `{minutes}` sets silenced_until (minutes>0) / clears (null|0); `GET /query/incidents/mttr?project_id&environment_id&window=7d` → `{data:{mttrMs,resolvedCount,windowDays}}`.
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement handlers + zod + wire to the repo (inject via the route deps pattern). Extend the triage body schema with `assignedToUserId: z.string().nullable().optional()`.
- [ ] Step 4: → PASS.
- [ ] Step 5: Commit `feat(api): incident-triage routes (assign/notes/silence/mttr) (PER-346)`.

---

### Task 5: worker silence suppression
**Files:** Modify `apps/worker/src/alerts.ts` + test.
- [ ] Step 1: Read `alerts.ts` evaluation. Where an alert is **attributable to a specific error group** (e.g. critical_errors citing a group/latest error), add a check: skip emitting the alert_event/notification if that group's `silenced_until > now`. Write a failing test: a silenced group's group-attributable alert is suppressed; not suppressed after expiry; aggregate-only rules unaffected.
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement the suppression check. If the alert model has NO group attribution at all, STOP and report DONE_WITH_CONCERNS — ship silence state (Tasks 1-4) and file suppression as a follow-up rather than forcing it.
- [ ] Step 4: → PASS.
- [ ] Step 5: Commit `feat(worker): suppress alerts for silenced incidents (PER-346)`.

---

### Task 6: Full B3 verification
- [ ] `pnpm --filter @sigmon/db test && pnpm --filter @sigmon/api test && pnpm --filter @sigmon/worker test` → pass.
- [ ] `pnpm build` → clean.
- [ ] `pnpm test` repo-wide → green (migration applied in db tests; branding; no regression to existing error-group/incident/alert tests).

## Notes
- Migration ordering for backfill: a single `update … nextval()` assigns numbers in an unspecified row order; if deterministic ordering by `created_at` is desired, use a `do $$` loop or a CTE with `row_number() over (order by created_at)`. Either is acceptable; note which you used.
- `createId("note")` for triage_notes ids (match repo id-prefix convention).
- Keep `getIncidentMttr` pure SQL aggregation (avg of `extract(epoch from resolved_at - first_seen_at)*1000`).
