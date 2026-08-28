# Project Summary

SignalMonitor is the current product identity for the self-hosted telemetry core formerly developed as SignalHub. It covers product analytics, errors, LLM calls, traces, and spans, giving operators one installable service for capturing standardized signals from multiple projects and environments.

The intended public website and domain is `sigmon.app`. The deployed application host is `my.sigmon.app`.

MicroERP is Diogo's personal project and the first real validation target for testing SignalMonitor against a production-shaped integration.

## Current Phase

Phase 6G: Product hardening and documentation reconciliation. The audit top hardening items are implemented, the Coolify VPS deployment is operational, and the current focus is keeping product/API/SDK documentation aligned with the implementation while the console evolves from MVP to product-grade operations tooling.

Implemented capabilities:

- Bootstrap admin seed and local email/password login.
- Admin APIs for users, projects, environments, and ingestion API keys.
- Admin Integration Console for setup and API key generation.
- API-key authenticated ingestion for events, errors, LLM calls, Web Vitals, traces, and spans.
- API-key authenticated identify endpoints and SDK helpers for project/environment-scoped user and tenant profile traits.
- Redis/BullMQ queueing between API acceptance and worker persistence.
- Worker-side sanitization and typed Postgres writes.
- Human-session query endpoints for raw records and aggregates.
- Deterministic error grouping with operational group status workflow.
- Error-first Incident view with shareable URLs, priority triage, primary occurrence details, paginated occurrence history, source-map status, strongly related signals, and nearby context.
- Local-first source-map artifact storage, admin `.map` / `.zip` uploads, and on-demand raw error stack resolution.
- Dedicated source-map upload tokens, CI upload API, CLI uploader, and Artifacts token management.
- Scoped, revocable read tokens for non-human `/query/*` access, with admin routes, console Setup management, and a one-time secret creation flow, alongside existing API-key ingestion and human-session query access.
- `@sigmon/mcp`, a stdio Model Context Protocol server exposing nine read-only investigation tools over `/query/*` to coding agents (Claude Code, Claude Desktop, and similar), authenticated with a read token.
- `@sigmon/loadgen`, a synthetic telemetry generator CLI for producing demo data and stress-testing the ingestion pipeline against multi-service scenarios with scripted incidents.
- A dedicated single-column mobile status view (`/console/status`) for a quick fleet health glance from a phone, separate from the desktop-only console shell.
- Worker-owned source-map artifact retention for local files, metadata, and cached stack resolutions.
- Lightweight breadcrumb ingestion, short retention, SDK manual breadcrumbs, optional safe browser breadcrumb helper, and error-detail session context timeline.
- Privacy-safe browser replay ingestion, SDK opt-in replay recorder, events-retention cleanup, Incident view replay panels linked to error occurrences, and Events detail replay panels linked to product events by `replay_id`.
- Read-only Overview dashboard for project/environment KPIs, prior-window KPI deltas, trends, top lists, and a mixed recent activity feed across events, errors, traces, and LLM calls.
- Read-only Operations cockpit for project/environment monitor health, alert state, p95 latency, error rate, ingestion freshness, and active incidents.
- Read-only Events investigation workspace with exact event-name filtering.
- Saved product trends with count or exact unique-actor metrics, event/property filters, promoted-property breakdowns, hourly rollup acceleration, live preview, and reusable dashboard widgets.
- Editable analytics dashboards composed from saved insights, with per-widget report isolation and project/environment-scoped execution.
- Errors investigation workspace with grouped triage, status updates, and raw occurrence drilldown/filtering.
- Read-only Traces investigation workspace with lazy ordered span details.
- Endpoint-level APM rollups for project/environment traces, including request volume, error count/rate, p50/p95/p99 latency, average latency, Apdex, and drilldown from an endpoint row into matching recent traces/spans.
- SDK trace propagation helpers for W3C `traceparent`, Next.js request context extraction, and a span-derived service map that highlights dependency edges by service, target, error rate, p95 latency, and volume.
- Browser Web Vitals ingestion, SDK opt-in capture helper, retention, and Traces/APM UI rollups for p75 LCP/INP/CLS, route-level rating counts, and release regressions.
- Read-only LLM investigation workspace with exact provider, model, prompt, and status filtering plus aggregate totals.
- Read-only Entities investigation workspace with impact-ranked tenant summaries, trait-derived labels and chips, selected tenant top users, and cross-signal timeline drilldowns.
- Read-only Users investigation workspace with impact-ranked user summaries, trait-derived labels and chips, selected user recent sessions, and cross-signal timeline drilldowns.
- Experiments workspace with event-derived A/B readouts, SDK assignment helpers, feature flag definitions/evaluation, beta programs, in-app survey definitions plus response reporting, and NPS campaign score/trend/segment analysis.
- Project-scoped feedback widget settings, SDK browser helper, `POST /v1/feedback` ingestion, and console triage for open/reviewed/archived feedback submissions.
- Worker-owned telemetry and dead-letter retention with per-table windows, bounded batches, retained DLQ action history, and recorded retention runs.
- Worker-owned scheduled Postgres logical backups, manual backup/restore scripts, local backup retention, optional S3-compatible upload, and recorded backup run metadata.
- Worker heartbeats and logged-in system health snapshots for API, worker, Postgres, Redis, queue depth, ingestion freshness, retention status, and backup status.
- Worker-owned simple alert evaluation for critical error count, total error count, trace p95 latency, and LLM cost thresholds over rolling windows.
- Internal alert history with email, generic webhook, and native Slack/Discord notification channels, recorded delivery attempts, event triage, and optional escalation delivery when an alert remains unacknowledged.
- Admin dead-letter job operations for permanently failed telemetry queue jobs, including sanitized inspection, deletion, controlled replay, automatic expiration, and retained replay/delete/expiration audit actions.
- Project settings for browser origins, release/commit/PR metadata, data governance, and incremental warehouse export of telemetry plus user/tenant identity profiles.
- Operations fleet drilldown with project summaries and environment health fetched only when expanded.
- Shared webhook target validation blocks local, private, link-local, multicast, loopback, and metadata network targets in every environment.
- Deterministic telemetry queue job IDs and idempotent database writes make duplicate telemetry retries safe.
- Structured API and worker logs redact secret-bearing fields, and unhandled API errors return sanitized JSON.
- API startup cleanup, ordered bounded shutdown, Docker non-root `tini` runtime, cache-friendly Docker dependency layer, Compose service healthchecks, backup SHA-256 verification, failed-dump cleanup, classified S3 backup retries, SDK browser/node entrypoints, security headers, and hardened production session cookies.
- Health and readiness endpoints.
- Read-only operator doctor command for local and Docker Compose validation.
- Docker Compose install hardening for the supported production-oriented self-hosted path.
- JavaScript SDK and raw HTTP ingestion guide for product integration.
- Next.js apps can use App Router route/action wrappers and opt-in browser global error capture through the JavaScript SDK.
- Browser SDK telemetry can post directly to public ingestion endpoints from project-scoped Browser origins configured in Project Settings, with `BROWSER_CORS_ORIGINS` as an optional global allowlist.
- Public SDK docs at `/sdk` cover Node.js, browser, Next.js, identity, event-based Experiments/A-B instrumentation, feature flags, in-app surveys, feedback widget, Web Vitals, traces, LLM calls, delivery behavior, and source-map upload; Scalar/OpenAPI API docs cover raw HTTP integration at `/docs` and `/openapi.json`, including admin/query APIs for message campaign definitions and results.
- Public npm package metadata, package README, and Trusted Publishing release workflow for publishing `@sigmon/sdk`.

## Out of Scope for Current Phase

- SaaS workspaces, organizations, invites, billing, and enterprise SSO.
- Full RBAC or per-project permissions.
- End-user product UI outside the operational console.
- Batch ingestion.
- ClickHouse and object storage adapters beyond optional backup upload.
- Object storage and source-code viewing for source-map artifacts.
- Full visual/video session replay, DOM mutation replay, and a dedicated Sessions investigation workspace.
- Automated native campaign delivery, scheduling, and outbound message rendering beyond campaign definitions, metrics, and opt-out visibility.
- Stored log telemetry.
- Retention for operational metadata, projects, environments, users, API keys, or dead-letter action history.
- Native Telegram, Discord, WhatsApp, calendar-based on-call rotation, and multi-step escalation policies.
- Additional language SDKs beyond JavaScript/TypeScript.

## Primary Operator Flow

1. Configure `.env`.
2. Start Postgres and Redis.
3. Run migrations and seed the bootstrap admin.
4. Log in as an admin.
5. Create project, environment, and API key.
6. Ingest telemetry with the API key.
7. Query telemetry with a logged-in human session.
