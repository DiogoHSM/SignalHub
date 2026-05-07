# Project Summary

SignalHub is a self-hosted telemetry core for product analytics, errors, LLM calls, traces, and spans. It gives operators one installable service for capturing standardized signals from multiple projects and environments.

## Current Phase

Phase 4C: Operational Safety, Backups, and Restore.

Implemented capabilities:

- Bootstrap admin seed and local email/password login.
- Admin APIs for users, projects, environments, and ingestion API keys.
- Admin Integration Console for setup and API key generation.
- API-key authenticated ingestion for events, errors, LLM calls, traces, and spans.
- Redis/BullMQ queueing between API acceptance and worker persistence.
- Worker-side sanitization and typed Postgres writes.
- Human-session query endpoints for raw records and aggregates.
- Read-only Overview dashboard for project/environment KPIs, trends, top lists, and recent important signals.
- Read-only Events investigation workspace with exact event-name filtering.
- Read-only Errors investigation workspace with exact severity, status, and fingerprint filtering.
- Read-only Traces investigation workspace with lazy ordered span details.
- Read-only LLM investigation workspace with exact provider, model, prompt, and status filtering plus aggregate totals.
- Read-only Entities investigation workspace with impact-ranked tenant summaries, selected tenant top users, and cross-signal timeline drilldowns.
- Read-only Users investigation workspace with impact-ranked user summaries, selected user recent sessions, and cross-signal timeline drilldowns.
- Worker-owned telemetry retention with per-table windows, bounded batches, and recorded retention runs.
- Worker-owned scheduled Postgres logical backups, manual backup/restore scripts, local backup retention, optional S3-compatible upload, and recorded backup run metadata.
- Worker heartbeats and logged-in system health snapshots for API, worker, Postgres, Redis, queue depth, ingestion freshness, retention status, and backup status.
- Worker-owned simple alert evaluation for critical error count, total error count, trace p95 latency, and LLM cost thresholds over rolling windows.
- Internal alert history with optional generic webhook notification channels and recorded delivery attempts.
- Health and readiness endpoints.
- JavaScript SDK and raw HTTP ingestion guide for product integration.

## Out of Scope for Current Phase

- SaaS workspaces, organizations, invites, billing, and enterprise SSO.
- Full RBAC or per-project permissions.
- End-user product UI outside the operational console.
- Batch ingestion.
- ClickHouse and object storage adapters beyond optional backup upload.
- Stored log telemetry.
- Retention for operational metadata, projects, environments, users, or API keys.
- Native email, Telegram, Discord, escalation, silencing, acknowledgement, and alert retry workflows.

## Primary Operator Flow

1. Configure `.env`.
2. Start Postgres and Redis.
3. Run migrations and seed the bootstrap admin.
4. Log in as an admin.
5. Create project, environment, and API key.
6. Ingest telemetry with the API key.
7. Query telemetry with a logged-in human session.
