# HTTP Ingestion

SignalHub accepts authenticated JSON telemetry requests from any HTTP client. API keys are scoped to one project and one environment, so clients do not send project or environment IDs in ingestion payloads.

## Base Request

```http
POST /v1/events HTTP/1.1
Host: signalhub.example.com
Authorization: Bearer sh_your_api_key
Content-Type: application/json

{
  "name": "checkout_completed"
}
```

Successful requests return `202 Accepted` after SignalHub validates the payload and enqueues it for worker persistence.

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{ "accepted": true, "id": "evt_..." }
```

## Endpoints

| Signal type | Endpoint |
| --- | --- |
| Events | `POST /v1/events` |
| Errors | `POST /v1/errors` |
| LLM calls | `POST /v1/llm` |
| Traces | `POST /v1/traces` |
| Spans | `POST /v1/spans` |

## Shared Fields

All signal types can include the shared envelope fields below.

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

`metadata` must be a JSON object. Avoid sending secrets, tokens, cookies, raw private data, or other values that should not be stored in telemetry.

## Events

Required fields:

- `name`: event name.

Optional fields:

- Shared fields.
- `properties`: JSON object with event-specific properties. Defaults to `{}`.

```bash
curl -i https://signalhub.example.com/v1/events \
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
- `severity`: one of `debug`, `info`, `warning`, `error`, or `critical`. Defaults to `error`.
- `stack`: stack trace string.
- `fingerprint`: grouping fingerprint.
- `context`: JSON object with additional error context. Defaults to `{}`.

```bash
curl -i https://signalhub.example.com/v1/errors \
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
curl -i https://signalhub.example.com/v1/llm \
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
curl -i https://signalhub.example.com/v1/traces \
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
curl -i https://signalhub.example.com/v1/spans \
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

## Status Codes and Retries

| Status | Meaning | Retry guidance |
| --- | --- | --- |
| `202` | Payload accepted after validation and enqueueing. | Do not retry. |
| `400` | Invalid JSON or payload fields. | Do not retry without changing the payload. |
| `401` | Missing or invalid API key. | Do not retry without changing credentials. |
| `403` | Credentials are not allowed to ingest this signal. | Do not retry without changing credentials or access. |
| `408` | Request timeout. | Retry with bounded exponential backoff. |
| `429` | Rate limited. | Retry with bounded exponential backoff. |
| `500-599` | Server-side or dependency failure. | Retry with bounded exponential backoff. |

Also retry network failures, connection resets, and DNS or TLS failures with bounded exponential backoff. Cap retry count and total retry time so telemetry cannot block the product workflow indefinitely.
