# Deep Audit: Security & End-to-End Data Flows

> Scope: `apps/api`, `apps/worker`, `apps/console`, `packages/sdk`, `packages/db`, `packages/telemetry`, `packages/queues`.
> Method: parallel focused sub-agents + parent verification of critical findings against current source.
> Convention: severity `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `INFO`. Paths are relative to repo root, line numbers from current `main`.

---

## 1. Executive Summary

This audit focused on two questions: **(a) is the product secure enough to run in production?** and **(b) does data flow correctly end-to-end through every handoff (SDK → API → queue → worker → Postgres → query → console)?**

The codebase has improved materially since earlier audits: SSRF validation now runs in every environment, Fastify logging and a global error handler are enabled, archived users cannot authenticate, the container runs as a non-root user, and all telemetry inserts use `ON CONFLICT (id) DO NOTHING`. The core ingestion pipeline is structurally coherent for all 12 signal kinds.

However, several **user-visible flows are broken** and a handful of **security gaps remain** that should block a broader production rollout:

1. **CRITICAL — API key onboarding wipes the secret** before the user can copy it.
2. **CRITICAL — Trace span waterfalls are empty** for traces created with `startTrace()` because the console queries by row id instead of W3C trace id.
3. **HIGH — Query endpoints do not enforce project membership**; any authenticated user who knows/guesses a project/environment id can read telemetry, including archived scopes.
4. **HIGH — Aggregate KPIs silently ignore filters** and miscount `pending` LLM calls as failures, so dashboards disagree with the filtered lists beneath them.
5. **HIGH — Alert rule evaluators ignore stored fields** (`error_count` ignores `routePattern`; `dead_letter_count` ignores the time window).
6. **HIGH — Single-file source-map uploads never resolve** because the stored `minified_file` path is not normalized to the basename used for frame lookup.
7. **HIGH — Browser SDK exposes a full server ingestion key**; there is no data-model distinction for "browser-scoped keys" despite documentation claiming otherwise.
8. **HIGH — Webhook secrets and warehouse connection URLs are stored plaintext-equivalent** in Postgres.

The rest of this report lists every verified finding, grouped by severity, with file:line references and concrete remediation steps.

---

## 2. Verified Positives

These controls are working as intended and should be preserved:

- **SSRF is environment-independent.** `validateWebhookUrl` / `validateWebhookTarget` now ignore the `_nodeEnv` parameter and validate in all environments (`apps/api/src/routes/admin.ts:1596`, `apps/worker/src/alerts.ts:255`).
- **SQL injection is effectively absent.** All DB access uses Kysely with bound parameters.
- **Password hashing uses Argon2id** (`packages/telemetry/src/auth.ts`).
- **Archived users are rejected** at login (`packages/db/src/repositories/users.ts:114-123`).
- **API-key scope rejection works.** `findApiKeyByPrefix` inner-joins active projects/environments and rejects archived scopes (`packages/db/src/repositories/admin.ts:359-376`).
- **Telemetry inserts are idempotent on exact id matches** (`packages/db/src/repositories/telemetry-writes.ts` — `ON CONFLICT (id) DO NOTHING`).
- **Source-map path traversal / ZipSlip are mitigated** via `validateStoragePath`, `assertInsideLocalDir`, and `safeSegment` (`apps/api/src/source-maps/storage.ts:34-56`).
- **Security headers and HSTS** are emitted on every response (`apps/api/src/app.ts:143-154`).
- **Fastify logger is enabled** with redaction of auth/cookie/source-map-token headers (`apps/api/src/app.ts:124-139`).
- **Docker image runs as non-root `sigmon` user** (`Dockerfile:8,13`).
- **SDK field naming is internally consistent** — every public method maps camelCase inputs to the snake_case fields expected by `packages/telemetry/src/ingestion-schemas.ts`.

---

## 3. CRITICAL Findings

### C1 — Created API key secret disappears before the user can copy it

- **Files:** `apps/console/src/v2/screens/useSetup.ts:232-247`, `ConsoleShellV2.tsx:621-624,676`, `ConsoleShellV2.tsx:527`
- **Verified:** yes.
- **Description:** `useSetup.run()` calls both `reload()` and `ctx.reload()`. `ctx.reload()` increments `seq`, and the page container is keyed on `seq`, so the entire screen remounts. `latestSecret` lives inside `useSetup` state and is reset. The `onSecretCreated` hook in `ScreenCtx` exists but is a no-op.
- **Impact:** Users cannot copy the one-time API key. Onboarding is effectively broken.
- **Fix:** Lift `latestSecret` into `ConsoleShellV2` and wire `onSecretCreated`, or special-case `generateApiKey` so it does not trigger `ctx.reload()`.

### C2 — Trace waterfall queries spans by row id instead of W3C trace id

- **Files:** `apps/console/src/v2/screens/TracesScreen.tsx:696`, `useTraces.ts:304-306`, `apps/api/src/routes/query.ts:1769-1775`, `packages/db/src/repositories/telemetry-query.ts:3666`
- **Verified:** yes.
- **Description:** `TraceListItemVM.traceId` correctly preserves `t.traceId ?? t.id`, but `TraceDetailView` passes `trace.id` to `useTraceSpans`. The API route `/query/traces/:id/spans` filters `spans.trace_id`, which stores the user-supplied W3C trace id, not the `traces` row id.
- **Impact:** Any trace created via `startTrace()` shows an empty span waterfall.
- **Fix:** Change `TracesScreen.tsx:696` to `traceId: trace.traceId`. Consider renaming the route param to `:traceId`.

---

## 4. HIGH Findings

### H1 — Node.js setup snippet omits required `endpoint`

- **Files:** `apps/console/src/v2/screens/SetupScreen.tsx:141-148`, `packages/sdk/src/client.ts:63-65`
- **Verified:** yes.
- **Impact:** Copy-pasting the snippet throws "endpoint is required" at runtime.
- **Fix:** Add `endpoint: "{endpoint}"` to the Node snippet.

### H2 — LLM aggregate KPIs ignore filters and count pending as failure

- **Files:** `apps/console/src/v2/screens/useLlm.ts:169-197`, `packages/db/src/repositories/telemetry-query.ts:3780-3802`
- **Impact:** KPI cards/charts disagree with the filtered recent-calls table. Pending calls inflate the error rate because `failed_calls` counts `status <> 'success'`.
- **Fix:** Pass seeded filters to aggregate queries and count only `status = 'error'` as failed.

### H3 — Query endpoints do not enforce project membership or archived-scope exclusion

- **Files:** `apps/api/src/routes/query.ts:1687-1701`, `packages/db/src/repositories/telemetry-query.ts:1598-1635`
- **Verified:** yes.
- **Impact:** Any authenticated user who knows/guesses project/env ids can read telemetry. Archived scopes are writable-rejected but still readable.
- **Fix:** Add project-membership and archived-scope checks in `handleListRoute` / `handleAggregateRoute`, mirroring the write path.

### H4 — `error_count` alert ignores `routePattern`

- **Files:** `packages/db/src/repositories/alerts.ts:683-697`
- **Verified:** yes.
- **Impact:** An alert rule scoped to a specific route fires on all errors.
- **Fix:** Apply the same `routePattern` filter used by `trace_p95_latency` and `error_rate`.

### H5 — `dead_letter_count` alert ignores the time window

- **Files:** `packages/db/src/repositories/alerts.ts:778-786`
- **Verified:** yes.
- **Impact:** Once any dead-letter row exists, the rule fires permanently.
- **Fix:** Apply `windowStart`/`windowEnd` filters to the count query.

### H6 — Single-file source-map uploads store an unnormalized path

- **Files:** `apps/api/src/source-maps/storage.ts:131-140`, `apps/api/src/source-maps/parser.ts:64-75`, `apps/api/src/source-maps/resolver.ts:151-155`
- **Verified:** yes.
- **Description:** When the caller supplies `minifiedFile` (e.g. `assets/app.min.js`), it is stored verbatim. The resolver normalizes stack frames to basenames (`app.min.js`), so the lookup fails.
- **Impact:** Single-file source maps never resolve production stacks.
- **Fix:** Call `normalizeMinifiedFile()` on the provided `minifiedFile` before storage.

### H7 — Resolved source-map frames are not rendered in the incident screen

- **Files:** `apps/console/src/v2/screens/useIncident.ts:51-58`, `IncidentScreen.tsx:858-870`
- **Impact:** Even when resolution succeeds, the user still sees the raw minified stack.
- **Fix:** Pipe resolved `frames[]` through the incident VM and render them.

### H8 — Aggregate endpoints silently ignore filters

- **Files:** `packages/db/src/repositories/telemetry-query.ts:3679-3724` (events), `3726-3745` (errors), `apps/api/src/routes/query.ts:519-632,3262-3291`
- **Verified:** yes (event aggregates).
- **Impact:** `/query/aggregates/events` ignores `event_name`, `event_id`, `segment_id`; error aggregates ignore `severity`, `status`, `fingerprint`, `error_group_id`; trace aggregates ignore `trace_name`/`status`. Dashboards show wrong numbers when filters are active.
- **Fix:** Mirror the `where` clauses from `listEvents`/`listErrors`/`listTraces` in their aggregate counterparts.

### H9 — Browser SDK exposes a full ingestion key; no browser-scoped key model exists

- **Files:** `packages/sdk/src/retry.ts:54`, `apps/api/src/routes/api-key-auth.ts:15-16`, `packages/db/src/schema.ts:480-489`
- **Impact:** Any key embedded in a browser bundle is a full server key for that environment. Documentation says "use a browser-scoped ingestion key" but `api_keys` has no scope/type column.
- **Fix:** Add `scope`/`type`/`allowed_origins` to `api_keys`, generate browser keys separately, and enforce capability limits in `requireApiKeyScope`.

### H10 — Webhook secret headers stored in plaintext

- **Files:** `apps/api/src/routes/admin.ts:762-769`, `apps/worker/src/alerts.ts:336-342`
- **Impact:** Database compromise yields webhook signing secrets, allowing impersonation of Sigmon to customer endpoints.
- **Fix:** Encrypt `secretHeaderValue` at rest (e.g. AES-256-GCM with a KEK) and decrypt only at delivery time.

### H11 — Warehouse destination connection URLs stored in plaintext

- **Files:** `apps/api/src/main.ts:792-815`, `apps/worker/src/warehouse-exports.ts:267-289`
- **Impact:** DB leak exposes external Postgres credentials.
- **Fix:** Encrypt the full URL at rest; never return it in API responses.

### H12 — Feedback widget sends empty strings for optional-but-`.min(1)` fields

- **Files:** `apps/console/src/v2/screens/useFeedback.ts:183-194`, `FeedbackSection.tsx:82-125`, `apps/api/src/routes/admin.ts:1311-1322`
- **Impact:** Clearing title/prompt/placeholder/buttonLabel causes `400 invalid_feedback_widget_request`.
- **Fix:** Omit empty optional text fields from the PUT body or validate them client-side.

### H13 — Alert channel update can send a secret header value without a name

- **Files:** `apps/console/src/v2/screens/AlertsScreen.tsx:581-588`, `apps/api/src/routes/admin.ts:794-807`
- **Impact:** Save fails with `400 invalid_notification_channel_request` when the user fills the value but leaves the name blank.
- **Fix:** Only include `secretHeaderValue` when `secretHeaderName.trim()` is truthy; add client-side validation.

### H14 — Stateless 7-day session cookies with no revocation

- **Files:** `apps/api/src/main.ts:298-332`, `apps/api/src/routes/auth.ts:63-71`
- **Impact:** Stolen session cookies remain valid until expiry even after password change or user archival.
- **Fix:** Maintain a server-side session store with revocation; store a session id in the cookie.

### H15 — Global IP-based rate limiting

- **Files:** `apps/api/src/app.ts:197`
- **Impact:** Behind a reverse proxy, all traffic may share one IP, allowing one tenant to starve others. Ingestion cannot be throttled per API key.
- **Fix:** Provide a `keyGenerator` that uses the API key for ingestion routes and user id for console routes; set lower limits for expensive endpoints.

### H16 — API keys hashed with fast SHA-256

- **Files:** `packages/telemetry/src/api-keys.ts:28-41`
- **Impact:** A leaked database allows fast brute-force of API keys.
- **Fix:** Use Argon2id for API keys (consistent with passwords) or separate slow KDF; ensure high entropy and rotation.

---

## 5. MEDIUM Findings

### M1 — No client idempotency key → duplicates on retry

- **Files:** `apps/api/src/routes/ingestion.ts:79`, `packages/queues/src/telemetry-queue.ts:50`, `packages/sdk/src/retry.ts:42-93`
- **Impact:** SDK retries and network replays create duplicate rows because each request mints a new server-side id.
- **Fix:** Accept an `Idempotency-Key` header (or envelope field), validate it, and derive the queue job id from `kind|project|env|key`.

### M2 — Session replay list is not paginated

- **Files:** `packages/db/src/repositories/telemetry-query.ts:1672-1760`, `apps/api/src/routes/query.ts:2560-2580`
- **Impact:** Large replay lists cannot be loaded incrementally and may time out.
- **Fix:** Implement cursor pagination consistent with other list endpoints.

### M3 — Error ingestion schema missing `status`

- **Files:** `packages/telemetry/src/ingestion-schemas.ts:199-207`, `packages/db/src/repositories/telemetry-writes.ts:280`
- **Impact:** Every ingested error is stored as `status = 'open'` even though the DB and writer support other statuses.
- **Fix:** Add `status` to `errorPayloadSchema` or document that status is console-managed only.

### M4 — Feedback status route reuses experiment params schema

- **Files:** `apps/api/src/routes/query.ts:2368-2383`, `packages/db/src/repositories/feedback-widget.ts:286-300`
- **Impact:** Misleading naming; tenant/user filters are silently ignored.
- **Fix:** Introduce `feedbackParamsSchema` and drop unused filters from the status update call.

### M5 — Retention category inconsistencies

- **Files:** `packages/db/src/repositories/system.ts:33-45,336-362,393-430`
- **Impact:** `web_vitals` retention is coupled to `eventsDays`; `session_replays` is targeted twice by governance retention.
- **Fix:** Add `webVitalsDays` to `RetentionPolicy`; remove `session_replays` from the governance `events` branch.

### M6 — `identifyUser` / `identifyTenant` drop default context

- **Files:** `packages/sdk/src/mapping.ts:109-148`
- **Impact:** Default metadata, source, release, session, trace fields are silently dropped for identify calls, even though the API route stores metadata.
- **Fix:** Route identify signals through `mergeContext` like every other signal.

### M7 — Browser error `filename` may leak URL secrets

- **Files:** `packages/sdk/src/browser-errors.ts:97-105`, `packages/sdk/src/sanitize.ts:70-148`
- **Impact:** Query strings in `event.filename` (e.g. `?token=SECRET`) are persisted in `errors.context`.
- **Fix:** Sanitize `filename` with `sanitizeBreadcrumbUrl` before enqueue.

### M8 — Feedback widget `pageUrl` leaks full URL

- **Files:** `packages/sdk/src/browser-feedback-widget.ts:103`
- **Impact:** Query-string secrets in `pageUrl` can persist.
- **Fix:** Apply `sanitizeBreadcrumbUrl` to `pageUrl`.

### M9 — SDK does not validate payloads against ingestion schemas before sending

- **Files:** `packages/sdk/src/client.ts:101-126`, all `mapping.ts` functions
- **Impact:** Empty event names/messages only fail after a network round-trip as permanent 400s.
- **Fix:** Run lightweight client-side validation (at least required non-empty fields), optionally tree-shaken in browser builds.

### M10 — `errors.status` not updated when parent error group triage changes

- **Files:** `packages/db/src/repositories/telemetry-writes.ts:280`, `packages/db/src/repositories/error-groups.ts:618-657`
- **Impact:** Occurrence-level status is always `open`, making aggregate "open" counts identical to total counts.
- **Fix:** Update `errors.status` when group triage changes, or stop exposing occurrence-level status as a triage signal.

### M11 — `traces.trace_id` nullable while `spans.trace_id` is NOT NULL

- **Files:** `packages/db/src/schema.ts:655,675`, `packages/sdk/src/client.ts:318-320`
- **Impact:** A trace created without explicit `traceId` stores `NULL`; spans cannot be associated with it.
- **Fix:** Make `traces.trace_id` non-nullable or require `traceId` for traces meant to have spans.

### M12 — Notification channels not scoped to project/environment

- **Files:** `apps/api/src/routes/admin.ts:4043-4060`, `packages/db/src/schema.ts:870-882`
- **Impact:** Any project can reference any channel, including channels from other tenants.
- **Fix:** Scope channels to `project_id`/`environment_id` or validate channel ownership in rule creation.

### M13 — Console routing/state degrades deep-linking and history

- **Files:** `apps/console/src/v2/ConsoleShellV2.tsx:396-415,427-455,468-485,529-541`
- **Impact:** Filters are not URL-encoded, environment id can be dropped on project switch, and `replaceState` breaks Back/Forward.
- **Fix:** Persist filters in the URL, use `pushState` consistently, and disable nav interactions while scope is restoring.

### M14 — Backup process exposes Postgres password via environment

- **Files:** `apps/worker/src/backups.ts:115-161`
- **Impact:** `PGPASSWORD` is visible in `/proc/*/environ` to other processes in the same container.
- **Fix:** Use a temporary `PGPASSFILE` with `0600` permissions.

---

## 6. LOW / INFO Findings

| ID | Severity | Files | Description | Recommendation |
|---|---|---|---|---|
| L1 | LOW | `packages/sdk/src/mapping.ts:53` | `mergeContext` ignores `defaultContext.timestamp`. | Honor `defaultContext.timestamp` as fallback. |
| L2 | LOW | `packages/db/src/repositories/telemetry-query.ts:3654` | `listTraceSpans(db, filters)` declares an unused `traceId` parameter. | Remove the dead parameter. |
| L3 | LOW | `apps/console/src/v2/screens/LlmScreen.tsx:195-196` | `hasSeededFilters` omits `callStatus`. | Include `callStatus` in the check. |
| L4 | LOW | `apps/api/src/source-maps/resolver.ts:18`, `apps/console/src/v2/screens/useIncident.ts:197-206` | `SourceMapResolutionStatus` includes `"unavailable"` but resolver never returns it. | Remove the dead status or produce it from the resolver. |
| L5 | LOW | `apps/console/src/v2/screens/ErrorsScreen.tsx:447`, `useErrors.ts:192-199` | Summary label always says "Errors (24h)" regardless of selected window. | Derive label from selected window. |
| L6 | LOW | `apps/console/src/v2/ConsoleShellV2.tsx:651-675` | Nav rail/top bar remain interactive while scope is restoring. | Disable interactions during restore. |
| L7 | LOW | `apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx:231` | PR number input converts to `Number`, producing `NaN` for non-numeric input. | Validate a finite positive integer or send `null`. |
| L8 | LOW | `apps/console/src/v2/screens/SetupScreen.tsx:396` | "Send ping" button shows a hard-coded "not yet available" toast. | Disable/hide the button until implemented. |
| L9 | INFO | `apps/api/src/main.ts:1047-1053` | API hardcodes `apiBasePath: "/"`; console requests are relative. | Use `apiEndpoint` as request origin for cross-origin deployments or rename the field. |
| L10 | INFO | `packages/sdk/src/retry.ts:35-40` | Exponential backoff has no jitter. | Add bounded random jitter to avoid thundering herd. |
| L11 | INFO | `apps/api/src/app.ts:143-154` | Security headers emitted manually; `@fastify/helmet` not used. | Consider helmet for additional headers. |

---

## 7. Security-Focused Remediation Plan (Prioritized)

| Priority | Finding | Effort | Blast Radius |
|---|---|---|---|
| 1 | H3 — query authorization / archived-scope checks | Medium | High (data boundary) |
| 2 | H10 / H11 — encrypt webhook secrets and warehouse URLs at rest | Medium | High (secret storage) |
| 3 | H9 — implement real browser-scoped API keys | Medium-High | High (SDK/API/DB) |
| 4 | H16 — slow-hash API keys | Medium | High (all key verification) |
| 5 | H14 — revocable server-side sessions | Medium-High | High (auth) |
| 6 | H15 — per-key/user rate limiting | Medium | Medium |
| 7 | H6 / H7 — source-map path normalization + rendering | Low | Medium (UX) |
| 8 | H4 / H5 — alert evaluator field fixes | Low | Medium (alert correctness) |

## 8. Functionality-Focused Remediation Plan (Prioritized)

| Priority | Finding | Effort | Blast Radius |
|---|---|---|---|
| 1 | C1 — persist API key secret across remount | Low | Critical (onboarding) |
| 2 | C2 — trace waterfall uses correct trace id | Low | Critical (traces UX) |
| 3 | H1 — Node snippet includes endpoint | Trivial | High (onboarding) |
| 4 | H2 — LLM aggregates honor filters and status | Medium | High (LLM UX) |
| 5 | H8 — aggregate endpoints honor filters | Medium | High (dashboards) |
| 6 | M1 — idempotency key for ingestion | Medium | High (data correctness) |
| 7 | M3 — error ingestion status field | Low | Low |
| 8 | M10 — update occurrence status on group triage | Low | Medium |
| 9 | M11 — trace_id nullability | Low | Medium |
| 10 | M6 — SDK identify context merge | Low | Low |

---

## 9. How to Verify Fixes

Suggested commands and checks for the highest-impact items:

```bash
# 1. Run the existing test suites to establish baseline
pnpm test

# 2. Trace waterfall fix: create a trace without explicit traceId and assert spans appear
curl -s -b cookies.txt "http://localhost:3000/query/traces?project_id=...&environment_id=..." | jq '.data[0] | {id, traceId}'
curl -s -b cookies.txt "http://localhost:3000/query/traces/<traceId>/spans?project_id=...&environment_id=..." | jq '.data | length'

# 3. Query authorization: attempt to read a project with a different user's session
curl -s -b other-user-cookies.txt "http://localhost:3000/query/events?project_id=...&environment_id=..."

# 4. Aggregate filters: compare list total with aggregate total while event_name filter is active
curl -s -b cookies.txt "http://localhost:3000/query/events?project_id=...&event_name=checkout.started" | jq '.data | length'
curl -s -b cookies.txt "http://localhost:3000/query/aggregates/events?project_id=...&event_name=checkout.started" | jq '.total'

# 5. Idempotency: send the same payload twice with the same Idempotency-Key header
curl -i -H "Authorization: Bearer ..." -H "Idempotency-Key: abc-123" -d '{...}' http://localhost:3000/v1/events
```

---

## 10. Bottom Line

SignalMonitor's ingestion core is sound, but the product currently ships with several **broken user-facing flows** (API key onboarding, trace waterfall, source-map resolution for single-file uploads, LLM dashboard accuracy, alert rule correctness) and **security gaps around authorization granularity and secret storage**.

The fixes are localized and most are small. Tackling the CRITICAL and HIGH items above will transform the codebase from "structurally coherent but buggy in practice" to a credible self-hosted observability release.
