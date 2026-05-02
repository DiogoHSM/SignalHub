# SignalHub

SignalHub is a self-hosted telemetry core for product analytics, error tracking, LLM observability, traces, and spans. One installation can monitor multiple projects and environments. Clients ingest telemetry with project-environment API keys, the API validates and queues each signal in Redis/BullMQ, and the worker sanitizes and persists typed records in Postgres.

## Phase 1 Capabilities

- Local admin login with a bootstrap admin seed.
- Admin management for users, projects, environments, and scoped ingestion API keys.
- API-key ingestion for events, errors, LLM calls, traces, and spans.
- Zod payload validation and recursive sanitization before persistence.
- Redis-backed ingestion queue with worker processing.
- Postgres storage for operational data and typed telemetry tables.
- Human-session query endpoints for raw telemetry and basic aggregates.
- Health and readiness endpoints for API, Postgres, and Redis checks.

Phase 1 does not implement a SaaS workspace model, billing, invites, per-project RBAC, ClickHouse, object storage, dashboards, SDKs, or log storage.

## Prerequisites

- Node.js 22
- pnpm 9.15.x
- Docker and Docker Compose

## Required Secrets

Create `.env` from `.env.example` and replace the example values before running anything beyond a disposable local install.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres URL used by local Node processes. |
| `REDIS_URL` | Yes | Redis URL used by local Node processes. |
| `POSTGRES_PASSWORD` | Yes for Compose | Password for the Compose Postgres user. Set before first database start. |
| `POSTGRES_PASSWORD_URLENCODED` | Sometimes | URL-encoded copy of `POSTGRES_PASSWORD` when it contains URL-reserved characters. |
| `SESSION_SECRET` | Yes | At least 32 characters outside tests. Signs human session cookies. |
| `API_KEY_PEPPER` | Yes | At least 32 characters outside tests. Used when hashing ingestion API keys. |
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | Email for the first admin account. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes | At least 32 characters outside tests. Used by the admin seed script. |
| `GOOGLE_OAUTH_ENABLED` | No | `false` by default. Google OAuth is inert unless explicitly enabled. |
| `GOOGLE_CLIENT_ID` | If OAuth enabled | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | If OAuth enabled | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | If OAuth enabled | OAuth callback URL, usually `http://localhost:3000/auth/google/callback` locally. |

Do not commit real secrets. Root-level `SECRETS.md` is ignored for local operator notes. The committed `.claude/docs/SECRETS.md` contains sanitized variable names and safe examples only.

## Local Development

1. Create local environment settings:

   ```sh
   cp .env.example .env
   ```

2. Edit `.env`. Replace `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` with strong values.

3. Install dependencies:

   ```sh
   pnpm install
   ```

4. Start Postgres and Redis:

   ```sh
   docker compose up -d postgres redis
   ```

5. Run migrations and seed the bootstrap admin:

   ```sh
   pnpm db:migrate
   pnpm seed:admin
   ```

   The API also runs migrations on startup for self-hosted deployments. The seed script creates the bootstrap admin only if that email does not already exist as an admin.

6. Start the API and worker in separate terminals:

   ```sh
   pnpm dev:api
   pnpm dev:worker
   ```

7. Check health:

   ```sh
   curl http://localhost:3000/health
   curl http://localhost:3000/ready
   ```

## Docker Compose Setup

Docker Compose starts Postgres, Redis, the API, and the telemetry worker. It loads `.env` when present and overrides `DATABASE_URL` and `REDIS_URL` for the internal Compose network.

```sh
cp .env.example .env
# edit .env before first start
docker compose up -d postgres redis
docker compose run --rm api pnpm seed:admin
docker compose up --build
```

Compose binds Postgres and Redis to `127.0.0.1` for local tooling. Change `POSTGRES_PORT`, `REDIS_PORT`, and secrets in `.env` before exposing services or reusing the stack outside local development.

If `POSTGRES_PASSWORD` contains URL-reserved characters, set `POSTGRES_PASSWORD_URLENCODED` to the URL-encoded form and use the encoded value in `DATABASE_URL`. If rotating the password on an existing `postgres_data` volume, first change the `signalhub` role password inside Postgres, then update `.env` and restart the API and worker.

Validate the Compose file with:

```sh
docker compose config
```

## Admin Bootstrap

Seed the first admin from `.env`:

```sh
pnpm seed:admin
```

Log in and store the session cookie:

```sh
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-admin-password-32-chars-min"}' \
  http://localhost:3000/auth/login
```

Check the logged-in user:

```sh
curl -b cookies.txt http://localhost:3000/auth/me
```

## API Key Creation

Create a project:

```sh
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo Project"}' \
  http://localhost:3000/admin/projects
```

Create an environment:

```sh
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"production"}' \
  http://localhost:3000/admin/projects/prj_YOUR_PROJECT_ID/environments
```

Create an ingestion API key:

```sh
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"env_YOUR_ENVIRONMENT_ID","name":"Production ingest"}' \
  http://localhost:3000/admin/projects/prj_YOUR_PROJECT_ID/api-keys
```

Copy the one-time `apiKey.secret` from the response. The stored record keeps only a prefix and hash, so the full secret is not shown again.

## Ingestion Examples

All ingestion endpoints require `Authorization: Bearer sh_YOUR_API_KEY_SECRET`. Successful requests return `202 Accepted` with `{ "accepted": true, "id": "..." }`.

### Event

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "account.created",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "session_id": "sess_789",
    "source": "web",
    "release": "2026.05.02",
    "properties": {
      "plan": "pro",
      "signup_source": "invite"
    },
    "metadata": {
      "request_id": "req_abc"
    }
  }' \
  http://localhost:3000/v1/events
```

### Error

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Payment provider timeout",
    "type": "PaymentTimeoutError",
    "severity": "error",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "trace_id": "trace_checkout_001",
    "fingerprint": "payment-timeout",
    "stack": "PaymentTimeoutError: provider timeout\n    at chargeCustomer",
    "context": {
      "provider": "example-pay",
      "operation": "charge"
    },
    "metadata": {}
  }' \
  http://localhost:3000/v1/errors
```

### LLM Call

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-5-mini",
    "prompt_name": "dashboard_summary",
    "input_tokens": 1200,
    "output_tokens": 240,
    "cost_usd": 0.0123,
    "latency_ms": 842,
    "status": "success",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "trace_id": "trace_report_001",
    "input_preview": "Summarize dashboard metrics for...",
    "output_preview": "Revenue increased by...",
    "metadata": {
      "workflow": "report_generation"
    }
  }' \
  http://localhost:3000/v1/llm
```

### Trace

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "generate_dashboard",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.000Z",
    "ended_at": "2026-05-02T12:00:02.400Z",
    "duration_ms": 2400,
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "session_id": "sess_789",
    "trace_id": "trace_dashboard_001",
    "metadata": {
      "entrypoint": "api"
    }
  }' \
  http://localhost:3000/v1/traces
```

### Span

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "trace_dashboard_001",
    "parent_span_id": "spn_parent_optional",
    "name": "llm_generate_sql",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.400Z",
    "ended_at": "2026-05-02T12:00:01.100Z",
    "duration_ms": 700,
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "input": {
      "prompt_name": "sql_generation"
    },
    "output": {
      "row_count": 12
    },
    "cost_usd": 0.0042,
    "metadata": {}
  }' \
  http://localhost:3000/v1/spans
```

## Query Examples

Query endpoints require a human session cookie from `/auth/login`. They require `project_id` and `environment_id`, accept `tenant_id`, `user_id`, `session_id`, `trace_id`, `from`, `to`, `limit`, and return `{ "data": ... }`.

### Raw Events

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/events?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID&tenant_id=tenant_123&limit=25"
```

Other raw telemetry endpoints:

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/errors?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/llm-calls?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID&trace_id=trace_report_001"

curl -b cookies.txt \
  "http://localhost:3000/query/traces?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID&from=2026-05-02T00:00:00.000Z"

curl -b cookies.txt \
  "http://localhost:3000/query/traces/trace_dashboard_001/spans?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"
```

### Aggregates

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/events?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/errors?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/llm?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/traces?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"
```

## Verification

Common checks before shipping changes:

```sh
pnpm test
pnpm build
docker compose config
git status -sb
```
