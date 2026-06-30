# HTTP Ingestion

SignalMonitor accepts authenticated telemetry from HTTP clients and from the official `@sigmon/sdk`. API keys are scoped to one project and one environment, so normal ingestion payloads do not include project or environment IDs.

Use this guide for non-TypeScript clients, smoke tests, and code agents that need to implement the wire protocol directly. The public OpenAPI reference is available at `/docs` and `/openapi.json`.

## Credential Types

| Credential | Used by | Keep secret? | Notes |
| --- | --- | --- | --- |
| Ingestion API key | `/v1/events`, `/v1/errors`, `/v1/breadcrumbs`, `/v1/llm`, `/v1/traces`, `/v1/spans`, `/v1/identify/*` | Server keys: yes. Browser keys: public by design. | Create separate keys for server and browser emitters. |
| Heartbeat secret | `/v1/heartbeats/{id}` | Yes | Generated per heartbeat monitor. Use from cron, workers, and schedulers. |
| Source-map upload token | `/v1/source-maps` | Yes | CI-only token created from the Artifacts console. |
| Session cookie | `/admin/*`, `/query/*`, `/system/*` | Browser session only | Used by logged-in human operators and the console. |

Archived projects and environments are inactive scopes. Their ingestion keys, heartbeat secrets, and source-map upload tokens are rejected for new writes.

## Base Request

```http
POST /v1/events HTTP/1.1
Host: sigmon.example.com
Authorization: Bearer sh_your_api_key
Content-Type: application/json

{
  "name": "checkout_completed"
}
```

Successful ingestion requests return `202 Accepted` after SignalMonitor validates the payload and enqueues it for worker persistence.

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{ "accepted": true, "id": "evt_..." }
```

## Public Endpoints

| Signal type | Endpoint | Auth |
| --- | --- | --- |
| Events | `POST /v1/events` | Ingestion API key |
| Errors | `POST /v1/errors` | Ingestion API key |
| Breadcrumbs | `POST /v1/breadcrumbs` | Ingestion API key |
| LLM calls | `POST /v1/llm` | Ingestion API key |
| Traces | `POST /v1/traces` | Ingestion API key |
| Spans | `POST /v1/spans` | Ingestion API key |
| Identify user | `POST /v1/identify/user` | Ingestion API key |
| Identify tenant | `POST /v1/identify/tenant` | Ingestion API key |
| Heartbeat check-in | `POST /v1/heartbeats/{id}` | Heartbeat secret |
| Source-map upload | `POST /v1/source-maps` | Source-map upload token |

Browser SDK traffic posts directly to `/v1/*`. Configure the monitored app origin in the project browser-origin allowlist, or set `BROWSER_CORS_ORIGINS` on the Sigmon server, before enabling browser capture in production.

## Shared Fields

Most signal types accept the shared envelope fields below.

```json
{
  "timestamp": "2026-05-02T12:00:00.000Z",
  "tenant_id": "tenant_123",
  "user_id": "user_456",
  "session_id": "session_789",
  "trace_id": "trace_abc",
  "source": "backend",
  "release": "2026.05.02",
  "metadata": {
    "region": "us-east-1",
    "plan": "pro"
  }
}
```

`metadata`, `properties`, `context`, `traits`, and breadcrumb `data` must be JSON objects. Avoid sending secrets, tokens, cookies, raw private data, full request bodies, or full response bodies.

## Limits

- Timestamps must be ISO datetime strings.
- Short text fields such as shared IDs, `source`, `release`, `name`, `provider`, and `model` can be up to 256 characters.
- Medium text fields such as error messages, fingerprints, and LLM previews can be up to 2,000 characters.
- Stack traces and nested JSON string values can be up to 20,000 characters.
- Recursive JSON payloads are accepted for span `input`, `output`, and `error`, but they should be small and sanitized.

## Events

Required fields:

- `name`: event name.

Optional fields:

- Shared fields.
- `properties`: JSON object with event-specific properties. Defaults to `{}`.

```bash
curl -i https://sigmon.example.com/v1/events \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "checkout_completed",
    "user_id": "user_456",
    "source": "web",
    "release": "2026.05.02",
    "properties": {
      "cart_value_usd": 129.5,
      "currency": "USD"
    },
    "metadata": {
      "plan": "pro"
    }
  }'
```

## Errors

Required fields:

- `message`: error message.

Optional fields:

- Shared fields.
- `type`: error type or class.
- `severity`: one of `debug`, `info`, `warning`, `error`, `critical`, or `fatal`. Defaults to `error`.
- `stack`: stack trace string.
- `fingerprint`: grouping fingerprint.
- `context`: JSON object with additional error context. Defaults to `{}`.

```bash
curl -i https://sigmon.example.com/v1/errors \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Unhandled exception",
    "type": "RuntimeError",
    "severity": "error",
    "user_id": "user_456",
    "trace_id": "trace_abc",
    "fingerprint": "runtime-error-checkout",
    "context": {
      "route": "/checkout"
    }
  }'
```

## Breadcrumbs

Required fields:

- `type`: one of `navigation`, `click`, `console`, `network`, or `custom`.
- `message`: short human-readable step.

Optional fields:

- Shared fields.
- `category`: logical area, UI element, route, or subsystem.
- `level`: one of `debug`, `info`, `warning`, `error`, or `fatal`. Defaults to `info`.
- `data`: JSON object with safe supporting details. Defaults to `{}`.

```bash
curl -i https://sigmon.example.com/v1/breadcrumbs \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "click",
    "category": "checkout",
    "message": "Clicked pay",
    "session_id": "session_789",
    "data": {
      "plan": "team"
    }
  }'
```

## LLM Calls

Required fields:

- `provider`: LLM provider name.
- `model`: model name.

Optional fields:

- Shared fields.
- `prompt_name`: prompt or workflow name.
- `input_tokens`: nonnegative integer. Defaults to `0`.
- `output_tokens`: nonnegative integer. Defaults to `0`.
- `cost_usd`: nonnegative number. Defaults to `0`.
- `latency_ms`: nonnegative integer.
- `status`: one of `success`, `error`, or `pending`. Defaults to `success`.
- `error`: error message for failed calls.
- `input_preview`: bounded input preview.
- `output_preview`: bounded output preview.

```bash
curl -i https://sigmon.example.com/v1/llm \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-5",
    "prompt_name": "support_reply",
    "input_tokens": 120,
    "output_tokens": 64,
    "cost_usd": 0.0042,
    "latency_ms": 840,
    "status": "success",
    "trace_id": "trace_abc",
    "metadata": {
      "feature": "support"
    }
  }'
```

## Traces

Required fields:

- `name`: trace name.
- `started_at`: ISO datetime when the trace started.

Optional fields:

- Shared fields.
- `status`: one of `success`, `error`, or `pending`. Defaults to `pending`.
- `ended_at`: ISO datetime when the trace ended.
- `duration_ms`: nonnegative integer duration.

```bash
curl -i https://sigmon.example.com/v1/traces \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "checkout_request",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.000Z",
    "ended_at": "2026-05-02T12:00:01.240Z",
    "duration_ms": 1240,
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "source": "api"
  }'
```

## Spans

Required fields:

- `trace_id`: parent trace ID.
- `name`: span name.
- `started_at`: ISO datetime when the span started.

Optional fields:

- Shared fields.
- `parent_span_id`: parent span ID.
- `status`: one of `success`, `error`, or `pending`. Defaults to `pending`.
- `ended_at`: ISO datetime when the span ended.
- `duration_ms`: nonnegative integer duration.
- `input`: JSON value.
- `output`: JSON value.
- `error`: JSON value.
- `cost_usd`: nonnegative number.

```bash
curl -i https://sigmon.example.com/v1/spans \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "trace_abc",
    "parent_span_id": "span_parent",
    "name": "db.query",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.140Z",
    "ended_at": "2026-05-02T12:00:00.220Z",
    "duration_ms": 80,
    "input": {
      "table": "orders"
    },
    "output": {
      "row_count": 1
    }
  }'
```

## Identify

Identify calls upsert durable project/environment-scoped profile traits. Normal telemetry with matching `user_id` or `tenant_id` updates last-seen timestamps, but only identify calls update stored traits.

```bash
curl -i https://sigmon.example.com/v1/identify/user \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_456",
    "tenant_id": "tenant_123",
    "traits": {
      "email": "ana@example.com",
      "role": "admin",
      "plan": "pro"
    }
  }'

curl -i https://sigmon.example.com/v1/identify/tenant \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "tenant_123",
    "traits": {
      "name": "MicroERP",
      "plan": "pro",
      "operation_mode": "production"
    }
  }'
```

## Heartbeat Monitors

Heartbeat monitors are created in the console or admin API. The monitored job calls its check-in URL before the expected interval plus grace period expires.

```bash
curl -i -X POST https://sigmon.example.com/v1/heartbeats/mon_123 \
  -H "Authorization: Bearer heartbeat_secret"
```

## Source Maps

Source-map uploads are CI/admin operations, not normal application telemetry. Use a source-map upload token, never a browser ingestion key.

Upload a single `.map` file:

```bash
curl -i https://sigmon.example.com/v1/source-maps \
  -H "Authorization: Bearer smt_ci_upload_token" \
  -F project_id=prj_123 \
  -F environment_id=env_123 \
  -F release="$GITHUB_SHA" \
  -F minified_file=assets/app.js \
  -F file=@./dist/assets/app.js.map
```

Upload a zip bundle:

```bash
curl -i https://sigmon.example.com/v1/source-maps \
  -H "Authorization: Bearer smt_ci_upload_token" \
  -F project_id=prj_123 \
  -F environment_id=env_123 \
  -F release="$GITHUB_SHA" \
  -F bundle=@./dist/source-maps.zip
```

The CLI wraps the same endpoint:

```bash
pnpm source-maps:upload \
  --endpoint https://sigmon.example.com \
  --token "$SIGMON_SOURCE_MAP_TOKEN" \
  --project-id "$SIGMON_PROJECT_ID" \
  --environment-id "$SIGMON_ENVIRONMENT_ID" \
  --release "$GITHUB_SHA" \
  --bundle ./dist/source-maps.zip
```

Use `--timeout-ms` or `SIGMON_UPLOAD_TIMEOUT_MS` when CI needs a non-default upload timeout.

## Production Smoke Tests

Validate credentials before asking a code agent to instrument a product:

```bash
curl -i https://sigmon.example.com/v1/events \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"name":"deploy.smoke","properties":{"source":"curl"}}'
```

For browser keys, test from the actual production origin so CORS is exercised:

```js
fetch("https://sigmon.example.com/v1/events", {
  method: "POST",
  headers: {
    Authorization: "Bearer sh_browser_key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "browser.smoke",
    properties: { source: "browser-console" }
  })
}).then(async (response) => console.log(response.status, await response.text()));
```

Expected result is `202` and a new event in the selected project/environment.

## Status Codes and Retries

| Status | Meaning | Retry guidance |
| --- | --- | --- |
| `202` | Payload accepted after validation and enqueueing. | Do not retry. |
| `400` | Invalid JSON or payload fields. | Do not retry without changing the payload. |
| `401` | Missing or invalid credential. | Do not retry without changing credentials. |
| `404` | Heartbeat or scoped resource not found. | Do not retry without checking scope/configuration. |
| `408` | Request timeout. | Retry with bounded exponential backoff. |
| `429` | Rate limited. | Retry with bounded exponential backoff. |
| `500-599` | Server-side or dependency failure. | Retry with bounded exponential backoff. |

Also retry network failures, connection resets, and DNS or TLS failures with bounded exponential backoff. Cap retry count and total retry time so telemetry cannot block the product workflow indefinitely.
