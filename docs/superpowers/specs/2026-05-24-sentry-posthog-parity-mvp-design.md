# Sentry/PostHog Parity MVP Design

Date: 2026-05-24
Status: Approved for planning

## Goal

Close the practical MVP gaps that keep SignalMonitor from replacing the essential Sentry and PostHog surface for Diogo's projects, starting with MicroERP and then applying the same setup to the rest of the portfolio.

This phase intentionally focuses on the six missing capabilities that unlock real use:

1. HTTP uptime and heartbeat monitors.
2. SMTP email notification channels.
3. Error rate alert rules.
4. Trace p95 latency alerts scoped by route or trace name.
5. Next.js SDK wrapper with automatic capture.
6. Lightweight identify and traits for users and tenants.

The work ships in three sequential blocks so each block can be reviewed, deployed, and validated independently.

## Current Baseline

SignalMonitor already has:

- Error, event, breadcrumb, trace, span, and LLM ingestion.
- Project/environment API keys.
- Error grouping, group status workflow, priority triage, and Incident view on the active incident branch.
- Source-map upload and on-demand stack frame resolution.
- Overview trends, raw investigation views, Entities and Users investigation.
- Worker-owned simple alert rules for critical errors, error count, trace p95 latency, and LLM cost.
- Generic webhook notification channels with SSRF hardening.
- Worker heartbeat, retention, backups, and System health.
- JavaScript/TypeScript SDK with browser and node entrypoints.

The remaining gap is not raw telemetry ingestion. The gap is operational completeness: reliable alert delivery, uptime monitoring, route-scoped thresholds, framework-friendly instrumentation, and persistent identity metadata.

## Block 1: Alerting And Monitors

### Scope

Block 1 makes SignalMonitor useful as the first-line operational monitor for MicroERP.

It adds:

- HTTP uptime monitors for public endpoints.
- Heartbeat monitors for expected periodic check-ins, such as background jobs or queues.
- SMTP-backed email notification channels.
- Error rate alert rules.
- Trace p95 latency rules scoped by trace name or route pattern.
- Alert/monitor UI and API updates.

### HTTP Uptime Monitors

Uptime monitors are project/environment-scoped records owned by the worker scheduler.

Each monitor supports:

- `name`
- `projectId`
- `environmentId`
- `url`
- `method`: `GET` or `HEAD`
- `intervalMinutes`
- `timeoutMs`
- `expectedStatus`: `2xx`, `3xx`, exact status, or inclusive range
- optional body contains check for `GET`, reading a bounded response size
- `failureThreshold`
- `recoveryThreshold`
- `enabled`

The worker records every check in a bounded history table and maintains a current monitor state:

- `up`
- `down`
- `degraded`
- `paused`

The first implementation does not run arbitrary request bodies, arbitrary methods, scripts, or multi-step browser flows.

### Heartbeat Monitors

Heartbeat monitors represent "something should check in by this deadline."

Each heartbeat monitor supports:

- `name`
- `projectId`
- `environmentId`
- `expectedIntervalMinutes`
- `graceMinutes`
- `secret`
- `enabled`

Clients call a lightweight heartbeat endpoint with the monitor secret. The worker evaluates stale heartbeats and emits alert events when the last check-in exceeds the expected interval plus grace window.

This covers "fila parada > 5min sem job" without requiring SignalMonitor to execute arbitrary cron jobs.

### SMTP Email Channels

Notification channels gain an `email` type in addition to existing `webhook`.

SMTP delivery uses installation-level environment config:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `SMTP_SECURE`

Email channels store:

- `name`
- recipient list
- enabled flag

Provider-specific APIs are out of scope. Resend, SES, Postmark, Mailgun, Brevo, Workspace, Zoho, and other providers can be used through SMTP without code changes.

### Error Rate Alerts

Error rate rules compare errors against request/trace volume in a rolling window.

Rule inputs:

- window minutes
- threshold percentage
- minimum sample size
- optional trace name or route pattern
- cooldown minutes

The denominator is trace count in the selected scope. This means applications must emit traces for API/request paths where error-rate alerts matter. If no denominator is available or sample size is below the configured minimum, the rule is not triggered.

### Route-Scoped Trace P95 Alerts

Existing trace p95 latency alerts become optionally scoped by trace name or route pattern.

Rule inputs:

- window minutes
- p95 latency threshold in milliseconds
- minimum sample size
- optional trace name or route pattern
- cooldown minutes

This keeps the current aggregate p95 rule working while enabling MicroERP criteria like "checkout route p95 > 800ms for 10 minutes."

### Safety

HTTP monitor targets reuse the shared network safety boundary used for webhook targets:

- reject local, loopback, private, link-local, multicast, and cloud metadata addresses
- reject URL credentials
- defend against DNS rebinding at connection time
- limit redirects or treat redirects as status outcomes
- cap response body reads
- enforce worker-level concurrency and per-installation monitor limits

Email delivery redacts SMTP credentials from logs and records delivery metadata without storing message bodies.

### UI

The Alerts mode becomes the home for:

- notification channels: webhook and email
- alert rules
- uptime monitors
- heartbeat monitors
- recent alert events and delivery status

The System mode can show an operational summary:

- monitors healthy/down count
- stale heartbeat count
- latest monitor scheduler run

## Block 2: Next.js SDK Wrapper

### Scope

Block 2 makes instrumentation natural for MicroERP and similar Next.js apps.

It adds an official Next.js entrypoint under the SDK package, for example `@sigmon/sdk/next`.

The wrapper provides:

- server-side client factory for API routes, route handlers, server actions, and background workers
- browser client helper for client-side `track` and breadcrumbs
- helper to capture exceptions with request context
- optional helpers for wrapping route handlers and server actions
- documented setup for App Router

### Automatic Capture

The wrapper should support:

- explicit `captureError(error, context)` for server code
- `withSignalMonitorRoute(handler, options)` for route handlers
- `withSignalMonitorAction(action, options)` for server actions
- browser global error and unhandled rejection capture when explicitly enabled

The first implementation avoids invasive framework internals. It prefers small wrappers and documented integration points over hidden magic.

### Context

The SDK should make it easy to attach:

- `tenantId`
- `userId`
- `correlationId`
- `module`
- `release`
- `environment`
- request path or route name

The wrapper should not require a Next.js plugin or build-time compiler integration.

### Documentation

Docs include a MicroERP-style recipe:

- server env vars
- browser env vars
- API route wrapper
- server action wrapper
- browser tracking provider
- source-map upload guidance with release matching

## Block 3: Identify And Traits

### Scope

Block 3 adds persistent user and tenant identity metadata without turning SignalMonitor into full product analytics yet.

It adds:

- `identifyUser`
- `identifyTenant`
- user profile records
- tenant profile records
- traits JSON with sanitization
- last seen timestamps
- UI display in Users and Entities investigation

### API And SDK

Ingestion endpoints:

- `POST /v1/identify/user`
- `POST /v1/identify/tenant`

SDK methods:

- `identifyUser(userId, traits, context?)`
- `identifyTenant(tenantId, traits, context?)`

Traits are sanitized with the existing telemetry sanitization rules. The payload should accept common values such as plan, role, operation mode, account status, and display name.

### Data Model

Profiles are project/environment scoped:

- `user_profiles`
- `tenant_profiles`

Each profile stores:

- stable id
- traits JSON
- first seen
- last seen
- updated at

Telemetry ingestion may opportunistically update last-seen timestamps when `user_id` or `tenant_id` is present, but traits are updated only through identify calls.

### UI

Entities and Users panels show:

- label from traits when available
- key traits such as plan, role, and operation mode
- raw user or tenant id
- last seen

The first implementation does not add arbitrary trait filter builders to every query. It prepares the storage and displays traits so later product analytics work can add property/trait filtering cleanly.

## Non-Goals

This phase does not include:

- funnels
- retention/cohort analysis
- custom dashboards
- CSV export
- session replay
- heatmaps
- feature flags
- A/B tests
- on-call rotations
- PagerDuty
- escalation chains
- Slack/Discord native integrations
- arbitrary cron jobs
- arbitrary scripts
- browser-based synthetic transactions

## Delivery Plan Shape

The implementation should be split into three PRs:

1. `Alerting And Monitors`
2. `Next.js SDK Wrapper`
3. `Identify And Traits`

Each PR should update:

- database migrations and repositories
- API routes and OpenAPI docs where applicable
- worker scheduling or SDK entrypoints as needed
- console UI
- README and `.claude/docs`
- focused tests plus full build/test verification

## Success Criteria

SignalMonitor is ready to replace the essential Sentry/PostHog surface for MicroERP when:

- MicroERP can send errors, events, traces, breadcrumbs, source maps, and identify calls through the official SDK path.
- A public MicroERP endpoint can be monitored with an uptime monitor.
- A MicroERP queue/job can send heartbeat check-ins.
- Email and webhook notification channels can receive alert events.
- Error rate alerts can trigger from trace denominator data.
- Route-scoped p95 latency alerts can trigger for named traces/routes.
- Users and tenants show persisted traits in the console.
- The docs explain exactly how to configure MicroERP and reuse the same setup for other projects.

