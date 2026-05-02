# Phase 2 JavaScript SDK and HTTP Ingestion Guide Design

## Source

This design is based on `PRD.md` v0.2 and follows the completed Phase 1 telemetry core. Phase 2 focuses on making existing products easy to instrument without changing the self-hosted core architecture.

## Product Boundary

Phase 2 adds a JavaScript/TypeScript SDK plus a small language-agnostic HTTP ingestion guide. The SDK is the primary developer experience for JavaScript applications, while the HTTP guide documents the raw ingestion contract for other languages.

The SDK sends telemetry into the existing Phase 1 ingestion endpoints:

- `POST /v1/events`
- `POST /v1/errors`
- `POST /v1/llm`
- `POST /v1/traces`
- `POST /v1/spans`

Out of scope for this phase:

- Automatic browser instrumentation.
- Framework-specific integrations.
- Source maps.
- Session replay.
- Logs ingestion.
- Batch ingestion endpoints on the API.
- New backend storage tables.
- Console UI changes.

## Recommended Approach

Build a buffered TypeScript SDK in `packages/sdk` as `@signal-hub/sdk`.

The SDK should be small, isomorphic, and framework-independent. It should use `globalThis.fetch`, avoid DOM-only assumptions, and support both browser and Node runtimes that provide `fetch`.

This approach gives real applications a practical integration path while keeping the implementation safe for self-hosted users:

- Tracking methods do not throw by default.
- Telemetry is buffered in memory and flushed explicitly or on an interval.
- Transient failures are retried with bounded exponential backoff.
- Permanent failures surface through `flush()` summaries and optional `onError`.
- Client-side sanitization is best effort; server-side worker sanitization remains mandatory.

## Public API

Primary constructor:

```ts
import { createSignalHubClient } from "@signal-hub/sdk";

const signal = createSignalHubClient({
  endpoint: "https://signal.example.com",
  apiKey: "sh_...",
  defaultContext: {
    tenantId: "tenant_123",
    userId: "user_456",
    source: "web",
    release: "1.2.3"
  }
});
```

Core methods:

- `track(name, properties?, context?)`
- `captureError(error, input?)`
- `llm(input, context?)`
- `trace(input, context?)`
- `startTrace(name, input?)`
- `span(input, context?)`
- `identify(context)`
- `flush(options?)`
- `shutdown(options?)`

Supporting exported types:

- `SignalHubClient`
- `SignalHubClientOptions`
- `SignalContext`
- `EventInput`
- `ErrorInput`
- `LlmInput`
- `TraceInput`
- `SpanInput`
- `FlushOptions`
- `FlushResult`

## Client Options

`createSignalHubClient` accepts:

- `endpoint`: SignalHub API base URL. Required.
- `apiKey`: ingestion API key secret. Required.
- `defaultContext`: optional fields attached to all signals.
- `fetch`: optional custom fetch implementation for tests and nonstandard runtimes.
- `maxQueueSize`: default `1000`.
- `flushIntervalMs`: optional. When set, the SDK flushes on an interval.
- `requestTimeoutMs`: default `10000`.
- `maxRetries`: default `3`.
- `retryBaseDelayMs`: default `250`.
- `maxSerializedPayloadBytes`: default `64_000`.
- `onError`: optional callback for permanent send failures and dropped items.

The SDK should normalize the endpoint by removing trailing slashes and should reject construction when `endpoint` or `apiKey` is missing.

## Context Model

`defaultContext` applies to every signal unless overridden by a per-call context.

Supported context fields:

- `tenantId`
- `userId`
- `sessionId`
- `traceId`
- `source`
- `release`
- `metadata`

The SDK maps these fields to the Phase 1 snake_case envelope:

- `tenantId` -> `tenant_id`
- `userId` -> `user_id`
- `sessionId` -> `session_id`
- `traceId` -> `trace_id`
- `source` -> `source`
- `release` -> `release`
- `metadata` -> `metadata`

Per-call metadata is shallow-merged over default metadata. Other per-call context fields replace default values.

`identify(context)` updates the default context in memory. It does not send a dedicated identify event in Phase 2. Callers who want an identify event can explicitly call `track`.

## Signal Mapping

### Events

`track(name, properties?, context?)` enqueues one event:

```ts
signal.track("dashboard_created", { charts_count: 6 });
```

Mapped payload:

- `name`
- `properties`
- common context fields

### Errors

`captureError(error, input?)` accepts an `Error`, unknown thrown value, or string.

The SDK extracts:

- `message`
- `type`
- `stack`
- `severity`
- `fingerprint`
- `context`
- common context fields

Default severity is `error`. Unknown thrown values are converted into a string message.

### LLM Calls

`llm(input, context?)` maps directly to `/v1/llm`.

Supported fields:

- `provider`
- `model`
- `promptName`
- `inputTokens`
- `outputTokens`
- `costUsd`
- `latencyMs`
- `status`
- `error`
- `inputPreview`
- `outputPreview`
- common context fields

The SDK converts camelCase to the current ingestion schema:

- `promptName` -> `prompt_name`
- `inputTokens` -> `input_tokens`
- `outputTokens` -> `output_tokens`
- `costUsd` -> `cost_usd`
- `latencyMs` -> `latency_ms`
- `inputPreview` -> `input_preview`
- `outputPreview` -> `output_preview`

### Traces

`trace(input, context?)` enqueues one trace payload.

`startTrace(name, input?)` creates a trace helper object:

```ts
const trace = signal.startTrace("generate_dashboard");

signal.span({
  traceId: trace.traceId,
  name: "llm_generate_sql",
  startedAt,
  endedAt,
  status: "success"
});
```

`startTrace` returns:

- `traceId`
- `startedAt`
- `end(input?)`

The helper should enqueue a trace when `end()` is called. It may also support `enqueueOnStart: true`, but the default is to enqueue on end so duration and status are known.

### Spans

`span(input, context?)` enqueues one span payload.

Supported camelCase fields include:

- `traceId`
- `parentSpanId`
- `name`
- `status`
- `startedAt`
- `endedAt`
- `durationMs`
- `input`
- `output`
- `error`
- `costUsd`

Dates are serialized to ISO strings. If `durationMs` is omitted and both `startedAt` and `endedAt` exist, the SDK computes duration in milliseconds.

## Queue and Flush Behavior

The SDK keeps an in-memory FIFO queue of normalized signal items.

Queue behavior:

- Each tracking method appends one item to the queue.
- If the queue exceeds `maxQueueSize`, the SDK drops the oldest item and increments an internal dropped counter.
- Tracking methods do not throw for send failures because they do not send immediately.
- Tracking methods may throw only for construction-time programming errors or obviously invalid required arguments, such as missing event name.

Flush behavior:

- `flush()` drains queued items in FIFO order.
- Because Phase 1 exposes single-signal endpoints, the SDK sends one HTTP request per queued item.
- `flush()` returns:

```ts
type FlushResult = {
  sent: number;
  failed: number;
  retained: number;
  dropped: number;
};
```

- `flush({ discardOnFailure: true })` removes items that still fail after all retries.
- Without `discardOnFailure`, transient failures after all retries stay in the queue.
- Permanent failures are removed and reported through `onError`.

`shutdown()` stops interval flushing and calls `flush()`.

## Retry and Error Classification

Retry:

- Network errors.
- Request timeout.
- `408`.
- `429`.
- `5xx`.

Do not retry:

- `400`.
- `401`.
- `403`.
- Other `4xx` responses.

Retry timing:

- Exponential backoff from `retryBaseDelayMs`.
- Small jitter may be added to avoid synchronized retries.
- Attempts are capped by `maxRetries`.

Timeout:

- Use `AbortController` when available.
- If `AbortController` is unavailable, still call fetch and rely on runtime behavior.

## Client-Side Safety

The SDK performs best-effort safety checks before enqueueing:

- Redact common sensitive keys before enqueueing.
- Reuse the same sensitive key set as Phase 1 server sanitization where possible.
- Truncate string fields to match known API limits where practical.
- Reject or drop payloads above `maxSerializedPayloadBytes`.
- Avoid logging API keys or request bodies.

Client-side masking is not a security boundary. The worker remains responsible for mandatory sanitization before persistence.

## HTTP Ingestion Guide

Add a small guide at `docs/HTTP-INGESTION.md`.

The guide should cover:

- Base URL and ingestion endpoints.
- `Authorization: Bearer sh_...`.
- `Content-Type: application/json`.
- Project and environment scope comes from the API key.
- Successful response: `202 Accepted` with `{ "accepted": true, "id": "..." }`.
- Common errors:
  - `400`: invalid payload.
  - `401`: missing or invalid API key.
  - `403`: request is authenticated but forbidden, such as a detected scope mismatch.
  - `503`: queue or ingestion dependency unavailable.
- Retry guidance:
  - retry `408`, `429`, `5xx`, and network failures.
  - do not retry `400`, `401`, or `403` without changing the request or credentials.
- Copy-paste examples for events, errors, LLM calls, traces, and spans.

The guide should not introduce new endpoints or SDK-only fields.

## Package Layout

Create:

```txt
packages/sdk
├── package.json
├── src
│   ├── index.ts
│   ├── client.ts
│   ├── queue.ts
│   ├── mapping.ts
│   ├── retry.ts
│   ├── sanitize.ts
│   └── types.ts
└── test
    ├── client.test.ts
    ├── mapping.test.ts
    ├── queue.test.ts
    ├── retry.test.ts
    └── contract.test.ts
```

Boundaries:

- `types.ts`: public input and result types.
- `mapping.ts`: camelCase-to-ingestion payload conversion.
- `queue.ts`: FIFO queue, overflow, dropped count.
- `retry.ts`: retry classification and backoff.
- `sanitize.ts`: client-side best-effort masking/truncation.
- `client.ts`: public client implementation and flush behavior.
- `index.ts`: public exports only.

## Testing

Required tests:

- Payload mapping for every signal type.
- Context merge behavior.
- Date serialization and duration calculation.
- Error extraction from `Error`, string, and unknown thrown values.
- Queue FIFO behavior.
- Queue overflow drops oldest and counts dropped items.
- Retry classification for network errors, `408`, `429`, `5xx`, and permanent `4xx`.
- `flush()` summary for success, permanent failure, transient failure retained, and discard-on-failure.
- `shutdown()` stops interval flushing and flushes pending items.
- Client-side sanitization and payload-size enforcement.
- Contract-style tests that run SDK-generated payloads through the existing ingestion Zod schemas.

Do not require a live API server for SDK unit tests. Use injected `fetch` for send behavior.

## Acceptance Criteria

- A TypeScript app can install `@signal-hub/sdk`, create a client, call tracking methods, and flush telemetry into the existing Phase 1 API.
- SDK methods support events, errors, LLM calls, traces, and spans.
- SDK-generated payloads are accepted by existing ingestion schemas.
- `flush()` handles success, permanent failure, retryable failure, and retained queue behavior predictably.
- The SDK works in Node and browser-like runtimes with `globalThis.fetch`.
- The HTTP guide provides enough information for non-JavaScript clients to ingest telemetry safely.
- No backend API changes are required for Phase 2.
