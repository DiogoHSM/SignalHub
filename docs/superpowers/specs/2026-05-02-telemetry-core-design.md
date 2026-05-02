# Phase 1 Telemetry Core Design

## Source

This design is based on `PRD.md` v0.2 and covers Phase 1: Telemetry Core.

## Product Boundary

Phase 1 builds a self-hosted telemetry core for one installation monitoring multiple projects. Projects and environments are the operational boundaries for telemetry. API keys are scoped to one project and one environment and are used only for ingestion.

The product includes simple human access control for operating the installation: one bootstrap admin, additional users, local email/password login, and optional Google OAuth/OIDC. Admins manage users, projects, environments, and API keys. Regular users can access and query telemetry but cannot manage installation settings.

The system does not include SaaS organizations, workspaces, billing, invites, enterprise SSO, per-project permissions, or a full RBAC matrix in Phase 1.

## Recommended Approach

Use a self-hosted operational core:

- Fastify API.
- Zod request validation.
- Postgres as the Phase 1 source of truth.
- Redis and BullMQ for durable ingestion buffering.
- Worker process for sanitization, normalization, and persistence.
- Docker Compose as the primary installation path.
- Storage interfaces for future ClickHouse and object storage adapters.

This gives the project a real installable foundation without requiring ClickHouse, object storage, SaaS auth, or advanced governance before the telemetry core is proven.

## Architecture

Phase 1 has four runtime components:

- API service: exposes health, auth, admin, ingestion, query, and aggregate endpoints.
- Worker service: consumes queued telemetry jobs and persists sanitized typed records.
- Postgres: stores operational data, users, and typed telemetry records.
- Redis: stores BullMQ queues with persistence enabled for durable ingestion handoff.

The ingestion request path validates payloads, authenticates the project-environment API key, attaches server-side metadata, enqueues the normalized job, and returns `202 Accepted`. Workers run sanitization before persistence, normalize records into typed tables, and handle bounded retries.

ClickHouse and object storage are deferred but represented by internal adapter boundaries so analytical storage and large payload storage can be added without rewriting ingestion contracts.

## Data Model

Core operational tables:

- `users`: local human users, admin flag, password hash, optional Google identity.
- `projects`: monitored applications and systems.
- `environments`: project-scoped environments such as production, staging, and development.
- `api_keys`: hashed ingestion keys scoped to one project and one environment.

Telemetry tables:

- `events`
- `errors`
- `llm_calls`
- `traces`
- `spans`

All telemetry tables share a common envelope:

- `id`
- `project_id`
- `environment_id`
- `tenant_id`
- `user_id`
- `session_id`
- `trace_id`
- `timestamp`
- `received_at`
- `source`
- `release`
- `metadata JSONB`

Typed tables add query-critical fields:

- `events`: `name`, `properties`
- `errors`: `message`, `type`, `severity`, `stack`, `status`, `fingerprint`, `context`
- `llm_calls`: `provider`, `model`, `prompt_name`, `input_tokens`, `output_tokens`, `cost_usd`, `latency_ms`, `status`, `error`, `input_preview`, `output_preview`
- `traces`: `name`, `status`, `started_at`, `ended_at`, `duration_ms`
- `spans`: `trace_id`, `parent_span_id`, `name`, `status`, `started_at`, `ended_at`, `duration_ms`, `input`, `output`, `error`, `cost_usd`

Logs are reserved but not implemented as a full stored signal type in Phase 1.

## API Design

Health:

- `GET /health`
- `GET /ready`

Auth and users:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/google`
- `GET /auth/google/callback` when Google OAuth is enabled.
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id`
- `DELETE /admin/users/:id`

Admin:

- `GET /admin/projects`
- `POST /admin/projects`
- `GET /admin/projects/:id`
- `PATCH /admin/projects/:id`
- `DELETE /admin/projects/:id`
- `GET /admin/projects/:projectId/environments`
- `POST /admin/projects/:projectId/environments`
- `PATCH /admin/environments/:id`
- `DELETE /admin/environments/:id`
- `GET /admin/projects/:projectId/api-keys`
- `POST /admin/projects/:projectId/api-keys`
- `DELETE /admin/api-keys/:id`

Project and environment deletes are soft archives in Phase 1. API key deletes revoke the key and keep the hashed record for auditability.

Ingestion:

- `POST /v1/events`
- `POST /v1/errors`
- `POST /v1/llm`
- `POST /v1/traces`
- `POST /v1/spans`

Successful ingestion returns:

```json
{ "accepted": true, "id": "..." }
```

Query and aggregates:

- `GET /query/events`
- `GET /query/errors`
- `GET /query/llm-calls`
- `GET /query/traces`
- `GET /query/traces/:id/spans`
- `GET /query/aggregates/events`
- `GET /query/aggregates/errors`
- `GET /query/aggregates/llm`
- `GET /query/aggregates/traces`

Query endpoints support filters by `project_id`, `environment_id`, `tenant_id`, `user_id`, `session_id`, `trace_id`, and time range where relevant. Aggregate endpoints cover event counts, errors by severity and status, LLM cost/tokens/latency, and trace latency/status.

## Error Handling and Safety

Ingestion API behavior:

- Invalid payloads return `400` with structured validation errors.
- Missing or invalid API keys return `401`.
- Detectable scope mismatches return `403`.
- Queue unavailability returns `503`.
- Accepted payloads return `202 Accepted` with the generated signal id.

Worker behavior:

- Sanitization runs before persistence.
- Failed jobs retry with bounded backoff.
- Permanently failed jobs move to a dead-letter queue or table with sanitized error details.
- Workers never persist unsanitized raw payloads.

Safety defaults:

- API keys are stored hashed, with only a prefix shown for identification.
- Passwords use a modern password hash.
- Admin and user sessions use secure cookie defaults.
- Google OAuth is optional and disabled unless configured.
- Sensitive keys are recursively masked in `metadata`, `properties`, `context`, `input`, `output`, and previews.
- Default retention policies are documented as operator guidance. Automated retention deletion is out of scope for Phase 1.

Operational safety:

- Docker Compose enables Redis persistence.
- `/ready` fails if Postgres or Redis is unavailable.
- Startup checks fail clearly for missing secrets or weak default values.
- Telemetry endpoints do not report success unless Redis durably accepts the queued job.

## Testing

Core test coverage:

- Unit tests for Zod payload schemas.
- Unit tests for recursive sanitization.
- Unit tests for API key hashing, verification, and scope checks.
- Integration tests for project, environment, and API key admin flows.
- Integration tests for each ingestion endpoint returning `202` and enqueueing a valid job.
- Worker integration tests proving jobs persist sanitized records into the correct typed tables.
- Query tests for filters and basic aggregates.
- Auth tests for local login, admin-only management operations, and regular-user read access.
- Startup/config tests for missing required secrets.

## Acceptance Criteria

- A fresh self-hosted install starts through Docker Compose.
- An admin can create a project, environment, and project-environment API key.
- A client can ingest events, errors, LLM calls, traces, and spans through API keys.
- Workers persist sanitized telemetry into typed Postgres tables.
- Query endpoints list raw telemetry and return basic aggregates.
- A regular user can read telemetry but cannot manage users, projects, environments, or API keys.
- Google OAuth works when configured and is inert when not configured.
- No ingestion success is returned when Redis cannot durably accept the job.
