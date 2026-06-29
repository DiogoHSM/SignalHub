# Project Summary

SignalMonitor is the current product identity for the self-hosted telemetry core formerly developed as SignalHub. It covers product analytics, errors, LLM calls, traces, and spans, giving operators one installable service for capturing standardized signals from multiple projects and environments.

The intended public website and domain is `sigmon.app`. The intended deployed application host is `my.sigmon.app`.

MicroERP is Diogo's personal project and the first real validation target for testing SignalMonitor against a production-shaped integration.

## Current Phase

Phase 6D: Critical Hygiene. The audit top 10 hardening items are implemented; Phase 6F EasyPanel VPS deployment is next.

Implemented capabilities:

- Bootstrap admin seed and local email/password login.
- Admin APIs for users, projects, environments, and ingestion API keys.
- Admin Integration Console for setup and API key generation.
- API-key authenticated ingestion for events, errors, LLM calls, traces, and spans.
- API-key authenticated identify endpoints and SDK helpers for project/environment-scoped user and tenant profile traits.
- Redis/BullMQ queueing between API acceptance and worker persistence.
- Worker-side sanitization and typed Postgres writes.
- Human-session query endpoints for raw records and aggregates.
- Deterministic error grouping with operational group status workflow.
- Error-first Incident view with shareable URLs, priority triage, primary occurrence details, source-map status, strongly related signals, and nearby context.
- Local-first source-map artifact storage, admin `.map` / `.zip` uploads, and on-demand raw error stack resolution.
- Dedicated source-map upload tokens, CI upload API, CLI uploader, and Artifacts token management.
- Worker-owned source-map artifact retention for local files, metadata, and cached stack resolutions.
- Lightweight breadcrumb ingestion, short retention, SDK manual breadcrumbs, optional safe browser breadcrumb helper, and error-detail session context timeline.
- Read-only Overview dashboard for project/environment KPIs, trends, top lists, and recent important signals.
- Read-only Operations cockpit for project/environment monitor health, alert state, p95 latency, error rate, ingestion freshness, and active incidents.
- Read-only Events investigation workspace with exact event-name filtering.
- Errors investigation workspace with grouped triage, status updates, and raw occurrence drilldown/filtering.
- Read-only Traces investigation workspace with lazy ordered span details.
- Read-only LLM investigation workspace with exact provider, model, prompt, and status filtering plus aggregate totals.
- Read-only Entities investigation workspace with impact-ranked tenant summaries, trait-derived labels and chips, selected tenant top users, and cross-signal timeline drilldowns.
- Read-only Users investigation workspace with impact-ranked user summaries, trait-derived labels and chips, selected user recent sessions, and cross-signal timeline drilldowns.
- Worker-owned telemetry retention with per-table windows, bounded batches, and recorded retention runs.
- Worker-owned scheduled Postgres logical backups, manual backup/restore scripts, local backup retention, optional S3-compatible upload, and recorded backup run metadata.
- Worker heartbeats and logged-in system health snapshots for API, worker, Postgres, Redis, queue depth, ingestion freshness, retention status, and backup status.
- Worker-owned simple alert evaluation for critical error count, total error count, trace p95 latency, and LLM cost thresholds over rolling windows.
- Internal alert history with optional generic webhook notification channels and recorded delivery attempts.
- Admin dead-letter job operations for permanently failed telemetry queue jobs, including sanitized inspection, deletion, and controlled replay.
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
- Public SDK docs at `/sdk` cover Node.js, browser, Next.js, identity, event-based Experiments/A-B instrumentation, traces, LLM calls, delivery behavior, and source-map upload; Scalar/OpenAPI API docs cover raw HTTP integration at `/docs` and `/openapi.json`.
- Public npm package metadata, package README, and Trusted Publishing release workflow for publishing `@sigmon/sdk`.

## Out of Scope for Current Phase

- SaaS workspaces, organizations, invites, billing, and enterprise SSO.
- Full RBAC or per-project permissions.
- End-user product UI outside the operational console.
- Batch ingestion.
- ClickHouse and object storage adapters beyond optional backup upload.
- Object storage and source-code viewing for source-map artifacts.
- Full visual session replay and a dedicated Sessions investigation workspace.
- Stored log telemetry.
- Retention for operational metadata, projects, environments, users, or API keys.
- Native email, Telegram, Discord, escalation, silencing, acknowledgement, and alert retry workflows.
- Additional language SDKs beyond JavaScript/TypeScript.

## Primary Operator Flow

1. Configure `.env`.
2. Start Postgres and Redis.
3. Run migrations and seed the bootstrap admin.
4. Log in as an admin.
5. Create project, environment, and API key.
6. Ingest telemetry with the API key.
7. Query telemetry with a logged-in human session.
