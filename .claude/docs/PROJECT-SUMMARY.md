# Project Summary

SignalHub is a self-hosted telemetry core for product analytics, errors, LLM calls, traces, and spans. It gives operators one installable service for capturing standardized signals from multiple projects and environments.

## Current Phase

Phase 1: Telemetry Core.

Implemented capabilities:

- Bootstrap admin seed and local email/password login.
- Admin APIs for users, projects, environments, and ingestion API keys.
- API-key authenticated ingestion for events, errors, LLM calls, traces, and spans.
- Redis/BullMQ queueing between API acceptance and worker persistence.
- Worker-side sanitization and typed Postgres writes.
- Human-session query endpoints for raw records and aggregates.
- Health and readiness endpoints.

## Out of Scope for Phase 1

- SaaS workspaces, organizations, invites, billing, and enterprise SSO.
- Full RBAC or per-project permissions.
- Dashboards and frontend product UI.
- SDKs.
- ClickHouse and object storage adapters.
- Stored log telemetry.
- Automated retention deletion.

## Primary Operator Flow

1. Configure `.env`.
2. Start Postgres and Redis.
3. Run migrations and seed the bootstrap admin.
4. Log in as an admin.
5. Create project, environment, and API key.
6. Ingest telemetry with the API key.
7. Query telemetry with a logged-in human session.
