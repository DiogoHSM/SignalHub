# Architecture

SignalHub Phase 1 is a self-hosted operational core with four runtime components:

- Fastify API service.
- Worker service.
- Postgres.
- Redis with BullMQ.

## Request Paths

Ingestion:

1. Client calls `POST /v1/events`, `/v1/errors`, `/v1/llm`, `/v1/traces`, or `/v1/spans`.
2. API extracts the bearer API key and verifies the stored hash with `API_KEY_PEPPER`.
3. API validates the JSON payload with Zod.
4. API generates a signal id, attaches project and environment scope from the API key, enqueues the job, and returns `202 Accepted`.
5. Worker consumes the job, validates again, recursively sanitizes sensitive values, and writes the typed record into Postgres.

Human operations:

1. Admin seed creates the first admin user.
2. Humans log in through `/auth/login` and receive a signed cookie.
3. Admin-only routes manage users, projects, environments, and API keys.
4. Authenticated users can query raw telemetry and aggregates.

## Storage

Operational tables:

- `users`
- `projects`
- `environments`
- `api_keys`

Telemetry tables:

- `events`
- `errors`
- `llm_calls`
- `traces`
- `spans`

All telemetry records include project, environment, optional tenant/user/session/trace identifiers, timestamps, source, release, and metadata.

## API Surface

Health:

- `GET /health`
- `GET /ready`

Auth:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/google`
- `GET /auth/google/callback` when Google OAuth is enabled. Google sign-in only links and logs in existing local users with verified Google email addresses.

Admin:

- `/admin/users`
- `/admin/projects`
- `/admin/projects/:projectId/environments`
- `/admin/projects/:projectId/api-keys`
- `/admin/environments/:id`
- `/admin/api-keys/:id`

Ingestion:

- `POST /v1/events`
- `POST /v1/errors`
- `POST /v1/llm`
- `POST /v1/traces`
- `POST /v1/spans`

Query:

- `GET /query/events`
- `GET /query/errors`
- `GET /query/llm-calls`
- `GET /query/traces`
- `GET /query/traces/:id/spans`
- `GET /query/entities/tenants`
- `GET /query/entities/tenants/:tenantKey`
- `GET /query/overview`
- `GET /query/aggregates/events`
- `GET /query/aggregates/errors`
- `GET /query/aggregates/llm`
- `GET /query/aggregates/traces`

## Deferred Boundaries

ClickHouse, object storage, SDKs, dashboards, and log storage are intentionally deferred. Phase 1 keeps internal boundaries narrow enough to add those later without changing the ingestion contracts.

## Integration Console

`apps/console` contains the Vite + React + TypeScript browser console.

The API exposes `GET /console/config` for non-secret browser configuration and serves built console assets from `/console` in production. The console uses existing session authentication, admin routes, and query routes.

## Investigation Console

The console includes a read-only `Investigate` mode for Events. It uses the existing human-session query route `GET /query/events` and keeps project/environment scope tied to the active console selection.

The Events query supports exact `event_name` filtering in addition to project, environment, tenant, user, session, trace, date range, and limit filters. The first investigation slice does not mutate telemetry data and does not add new storage tables.

The console also includes a read-only Errors view for raw error occurrences. It uses `GET /query/errors` with exact `severity`, `status`, and `fingerprint` filters in addition to project, environment, tenant, user, session, trace, date range, and limit filters. This slice does not group errors, mutate status, or add storage tables.

The console also includes a read-only Traces view for raw traces and ordered spans. It uses `GET /query/traces` for trace rows and `GET /query/traces/:id/spans` for spans loaded after selecting a trace. This slice does not add cross-signal timelines, trace mutation, charts, storage tables, or ingestion routes.

The console also includes a read-only LLM view for raw AI calls and compact aggregate totals. It uses `GET /query/llm-calls` for call rows and `GET /query/aggregates/llm` for total calls, input tokens, output tokens, and total cost. This slice supports exact `provider`, `model`, `prompt_name`, and `status` filters and does not add charts, grouping, mutation, cross-signal timelines, storage tables, or ingestion routes.

The console also includes a read-only Entities view for tenant-first investigation. It uses `GET /query/entities/tenants` for impact-ranked tenant summaries and `GET /query/entities/tenants/:tenantKey` for selected tenant details. Entity queries are implemented behind the repository boundary in `packages/db/src/repositories/entities-query.ts` and aggregate existing `events`, `errors`, `traces`, and `llm_calls` records only. Spans are intentionally excluded from entity timelines; trace rows link operators into the existing Traces investigation flow when span detail is needed.

## Overview Console

The console includes a read-only `Overview` mode for the selected project and environment. It uses `GET /query/overview` to load KPIs, UTC-bucketed mini trends, top lists, and recent important signals for `24h`, `7d`, or `30d` windows.

Overview aggregates are computed from the existing events, errors, traces, and LLM call tables. It does not add storage tables, chart libraries, mutation routes, or SaaS workspace scope. Top-list rows can drill into existing investigation tabs by seeding exact filters; tenant top-list rows open the Entities investigation for the selected tenant. Recent signals remain read-only summaries without exact-record deep links.
