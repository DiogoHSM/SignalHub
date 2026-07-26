# HTTP Ingestion

SignalMonitor accepts authenticated telemetry from HTTP clients and from the official `@sigmon/sdk`. API keys are scoped to one project and one environment, so normal ingestion payloads do not include project or environment IDs.

Use this guide for non-TypeScript clients, smoke tests, and code agents that need to implement the wire protocol directly. The public OpenAPI reference is available at `/docs` and `/openapi.json`.

## Credential Types

| Credential | Used by | Keep secret? | Notes |
| --- | --- | --- | --- |
| Ingestion API key | `/v1/events`, `/v1/errors`, `/v1/breadcrumbs`, `/v1/clicks`, `/v1/replays`, `/v1/surveys/responses`, `/v1/llm`, `/v1/web-vitals`, `/v1/profiles`, `/v1/traces`, `/v1/spans`, `/v1/identify/*` | Server keys: yes. Browser keys: public by design. | Create separate keys for server and browser emitters. |
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
| Browser click maps | `POST /v1/clicks` | Ingestion API key |
| Privacy-safe session replays | `POST /v1/replays` | Ingestion API key |
| In-app survey responses | `POST /v1/surveys/responses` | Ingestion API key |
| Product feedback | `POST /v1/feedback` | Ingestion API key |
| LLM calls | `POST /v1/llm` | Ingestion API key |
| Web Vitals | `POST /v1/web-vitals` | Ingestion API key |
| Runtime profiles | `POST /v1/profiles` | Ingestion API key |
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

Project administrators can add Data Governance rules in Project Settings. These rules run in the worker before persistence and can mask or block configured JSON paths for shared metadata, event properties, error context, span payloads, breadcrumb data, replay event data, and identity traits. Built-in secret redaction still applies even when no project-specific rules exist.

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
- `replay_id`: optional privacy-safe replay id. Use the same id on `/v1/replays` to open the replay from event detail and show this event as a timeline marker.
- `properties`: JSON object with event-specific properties. Defaults to `{}`.

```bash
curl -i https://sigmon.example.com/v1/events \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "checkout_completed",
    "user_id": "user_456",
    "replay_id": "rpl_browser_123",
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

### Event property hygiene

Sigmon stores event properties as JSON and exposes an operator-facing property catalog at `GET /query/events/properties`.
Use stable property names and stable value types so dashboards, filters, and future funnels stay trustworthy:

- Prefer `snake_case` names such as `plan`, `cart_value_usd`, and `operation_mode`.
- Keep one meaning per property name. Do not reuse `status` for unrelated lifecycle states across unrelated event families.
- Keep one JSON type per property. Avoid sending `amount` as a number in one code path and a string in another.
- Keep cardinality bounded. IDs belong in `user_id`, `tenant_id`, `session_id`, `trace_id`, or carefully named properties.
- Never send secrets, tokens, cookies, full request bodies, full response bodies, or raw PII in properties.
- Use `metadata` for emitter or runtime context and `properties` for facts about the product event itself.

### Conversion funnels

Operators can analyze ordered event funnels with `GET /query/events/funnel`. Funnel analysis is based on stable actor IDs, so send at least one of `user_id`, `tenant_id`, `session_id`, or `trace_id` on product events that should participate in conversion analysis. The whole funnel is aggregated in SQL (no per-actor row data leaves Postgres), so it stays cheap even for large event volumes.

Optional query params, all backward compatible: `conversion_window` (compact duration like `30m`, `24h`, or `7d`; bounds elapsed time from an actor's first step to each later step, rejecting values that exceed the requested `window`), `breakdown_property` (splits results into up to 20 series by an event property value), `tenant_id` (restricts matched events to one tenant), and `segment_id` (restricts matched actors to a saved analytics segment).

Example query:

```http
GET /query/events/funnel?project_id=prj_123&environment_id=env_123&window=7d&steps=signup.started,project.created,key.created&conversion_window=24h&breakdown_property=plan
```

### Experiments

Operators can create A/B experiments in the console and read variant conversion with `GET /query/experiments/:id/results`. The SDK helper records exposure as the normal event `sigmon.experiment.exposed` with `experiment_key`, `variant`, and `subject_id` properties. Conversion is derived from the experiment's configured conversion event, grouped by stable actor context.

Example exposure event body:

```json
{
  "name": "sigmon.experiment.exposed",
  "user_id": "user_123",
  "properties": {
    "experiment_key": "checkout_copy",
    "variant": "treatment",
    "subject_id": "user_123"
  }
}
```

Example result query:

```http
GET /query/experiments/exp_123/results?project_id=prj_123&environment_id=env_123&window=30d
```

### Feature flags

Operators can create feature flags in the console with a safe default variant and ordered targeting
rules. SDK evaluation records a normal product event named `sigmon.feature_flag.evaluated` unless
exposure tracking is disabled.

Example exposure event body:

```json
{
  "name": "sigmon.feature_flag.evaluated",
  "user_id": "user_123",
  "properties": {
    "flag_key": "new_checkout",
    "variant": "on",
    "value": true,
    "reason": "rule_match",
    "matched": true
  }
}
```

Keep flag keys stable and always provide a default/off variant in application code so a missing or
paused flag fails closed.

Feature flag rules can also include deterministic gradual rollout:

```json
{
  "id": "gradual_rollout",
  "variant": "on",
  "match": {},
  "rollout": {
    "percentage": 10,
    "stickiness": "user"
  }
}
```

`stickiness` can be `user`, `tenant`, or `session`. Sigmon hashes the selected actor id with the flag
and rule id so the same actor keeps a stable result across API preview and SDK evaluation.

### Beta programs

Operators can create beta programs in the console or admin API, link a program to a feature flag
variant, and add user or tenant participants. Sigmon syncs active participants into targeting rules
on the linked feature flag. Runtime code does not need a separate beta API call: keep using the
feature-flag evaluator with a safe fallback, and use normal event telemetry to measure beta adoption.

### In-app surveys

Operators can create lightweight in-app surveys in the Experiments console and read response totals
with `GET /query/surveys/:id/results`. Submit responses from a browser widget, SDK call, or server
flow with the survey id and an `answers` object keyed by question id.

```bash
curl -i https://sigmon.example.com/v1/surveys/responses \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "survey_id": "srv_activation_pulse",
    "actor_type": "user",
    "actor_id": "user_456",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "session_id": "sess_789",
    "source": "web",
    "answers": {
      "satisfaction": 5,
      "comment": "Great"
    },
    "metadata": {
      "placement": "checkout_success"
    }
  }'
```

Configure browser origins before posting survey responses directly from the browser. Survey answers
go through the same worker-side data-governance rules and built-in secret redaction as other browser
telemetry.

NPS tracking is a standard survey pattern. Create an NPS campaign in the console, submit responses with
an answer key such as `"nps": 10`, then query `GET /query/surveys/{id}/nps` for score, promoter/passive/
detractor counts, trend buckets, and tenant/release/plan segments.

### Product feedback

Use feedback for free-form comments collected by the browser SDK widget or a custom product flow.
Feedback is listed in the console and can be marked open, reviewed, or archived.

```bash
curl -i https://sigmon.example.com/v1/feedback \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "The export button is confusing.",
    "category": "ux",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "session_id": "sess_789",
    "source": "browser",
    "page_url": "https://app.example.com/reports",
    "path": "/reports?tab=exports",
    "metadata": {
      "surface": "reports"
    }
  }'
```

Configure browser origins before posting feedback directly from the browser. Screenshot capture is
reserved for a future privacy-safe widget flow with masking and explicit consent controls.

### Retention curves

Operators can analyze temporal retention cohorts with `GET /query/events/retention`. Retention uses the first `entry_event` per actor as the cohort start, then counts actors who later emit `return_event` across daily, weekly, or monthly intervals.

Example query:

```http
GET /query/events/retention?project_id=prj_123&environment_id=env_123&window=30d&entry_event=signup.started&return_event=app.opened&period=weekly&intervals=6
```

### Saved segments

Operators can save reusable user or tenant segments from event conditions in the console. The first segment model is intentionally bounded: it supports an actor type (`user` or `tenant`), a window (`24h`, `7d`, or `30d`), an optional event name, and an optional event property condition. Saved segments can be previewed and applied to `GET /query/events` with `segment_id`.

Example query:

```http
GET /query/events?project_id=prj_123&environment_id=env_123&segment_id=seg_123
```

Saved segments can also scope replay investigation. `GET /query/replays` returns privacy-safe replay samples for the same project/environment, with optional `segment_id`, `tenant_id`, `user_id`, `event_name`, and `limit`. Each row includes minimal context for triage: replay id, user, tenant, route, timestamp, duration, linked product event, and linked error when available.

Example query:

```http
GET /query/replays?project_id=prj_123&environment_id=env_123&segment_id=seg_123&event_name=checkout.started&limit=10
```

### User journey paths

Operators can discover common event sequences with `GET /query/events/paths`. Path analysis is also derived from normal product events; it groups events by a stable actor (`user`, `tenant`, `session`, `trace`, or `auto`) and returns the most common compact paths plus sample event ids for drilldown.

Example query:

```http
GET /query/events/paths?project_id=prj_123&environment_id=env_123&window=7d&start_event=signup.started&end_event=key.created&actor=auto&max_depth=5
```

### Custom dashboards and reports

Operators can save custom dashboards in the console and render report data with `GET /query/reports/dashboards/{id}`. Dashboards do not require a separate ingestion payload: metric, trend, and top-list widgets are derived from the same event and error telemetry described above. Keep event names, actor IDs, and properties stable so saved reports stay useful across releases.

### Recent activity

Use `GET /query/recent-activity` for one mixed, time-ordered feed across events, errors, traces, and LLM calls. It is useful for overview panels and operator timelines because it includes both successful and failed signals instead of only failure lists.

```http
GET /query/recent-activity?project_id=prj_123&environment_id=env_123&window=24h&limit=20
```

Add `release=web%401.2.3` to inspect activity around one deploy.

### Release queries

Send a stable `release` value with events, errors, traces, and LLM calls to make deploy investigation useful. Operators can list recently observed releases with `GET /query/releases` and filter Overview with the same exact release value.

Example queries:

```http
GET /query/releases?project_id=prj_123&environment_id=env_123&window=7d&limit=10
GET /query/overview?project_id=prj_123&environment_id=env_123&window=7d&release=web%401.2.3
```

`GET /query/overview` also returns `deltas` beside `kpis`. Each KPI delta compares the selected
window with the immediately previous window of the same size and includes `current`, `previous`,
`absolute`, `percent`, and `direction`. `previous`, `absolute`, and `percent` are `null` when the
prior window has no telemetry to compare against.

### Browser click maps

Click maps are opt-in browser telemetry for aggregated UI density, not session replay. Send normalized
viewport coordinates and stable safe selectors to `POST /v1/clicks`; do not send text content, input
values, DOM snapshots, screenshots, or full CSS paths. Prefer the `@sigmon/sdk/browser`
`installBrowserClickCapture` helper and deliberate `data-sigmon-id` attributes.

Required fields:

- `route`: browser path or route.
- `selector`: stable safe selector, ideally based on `data-sigmon-id`.
- `x` and `y`: normalized viewport coordinates from `0` to `1`.
- `viewport_width` and `viewport_height`: positive viewport dimensions.

Optional fields:

- Shared fields.
- `element_tag`, `element_role`, `scroll_x`, `scroll_y`, and `masked`.

Example:

```bash
curl -i https://sigmon.example.com/v1/clicks \
  -H "Authorization: Bearer sh_browser_key" \
  -H "Content-Type: application/json" \
  -d '{
    "route": "/checkout",
    "selector": "[data-sigmon-id=\"checkout-submit\"]",
    "element_tag": "button",
    "element_role": "button",
    "x": 0.72,
    "y": 0.61,
    "viewport_width": 1440,
    "viewport_height": 900,
    "scroll_x": 0,
    "scroll_y": 320,
    "masked": true,
    "source": "web",
    "release": "2026.05.02"
  }'
```

### Privacy-safe session replays

Session replays are opt-in masked timelines for incident debugging, not video replay. They store
navigation and safe interaction events that can be linked to an error by sending the same `replay_id`
on `POST /v1/errors` and `POST /v1/replays`.

Do not send screenshots, DOM snapshots, raw text content, form values, passwords, cookies, HTML, request
bodies, or response bodies. Prefer the `@sigmon/sdk/browser` `createBrowserReplayRecorder` helper; it
records navigation and safe click selectors, skips form controls by default, and keeps the payload masked.

Required fields:

- `replay_id`: stable replay id.
- `started_at`: ISO datetime for the beginning of the buffer.

Optional fields:

- Shared fields.
- `ended_at`, `duration_ms`, `route`, `error_id`, `masked`, and `events`.

Each event accepts `offset_ms`, `type`, optional `route`, optional safe `selector`, optional sanitized
`message`, optional normalized `x`/`y`, and optional sanitized `data`.

Example:

```bash
curl -i https://sigmon.example.com/v1/replays \
  -H "Authorization: Bearer sh_browser_key" \
  -H "Content-Type: application/json" \
  -d '{
    "replay_id": "rpl_browser_123",
    "started_at": "2026-06-01T12:00:00.000Z",
    "ended_at": "2026-06-01T12:00:02.000Z",
    "duration_ms": 2000,
    "route": "/checkout",
    "masked": true,
    "session_id": "session_789",
    "source": "web",
    "release": "2026.05.02",
    "events": [
      { "offset_ms": 0, "type": "navigation", "route": "/checkout", "data": {} },
      {
        "offset_ms": 750,
        "type": "click",
        "selector": "[data-sigmon-id=\"checkout-submit\"]",
        "x": 0.72,
        "y": 0.61,
        "data": {}
      }
    ]
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
- `replay_id`: optional replay id that links this occurrence to a masked session replay.
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

## Web Vitals

Required fields:

- `name`: one of `CLS`, `FCP`, `FID`, `INP`, `LCP`, or `TTFB`.
- `value`: numeric metric value. CLS is unitless; timing metrics are milliseconds.

Optional fields:

- Shared fields.
- `rating`: one of `good`, `needs-improvement`, or `poor`.
- `route`: route or path where the metric was observed.
- `navigation_type`: browser navigation type.

```bash
curl -i https://sigmon.example.com/v1/web-vitals \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "LCP",
    "value": 1820,
    "rating": "good",
    "route": "/checkout",
    "source": "web",
    "release": "2026.05.02"
  }'
```

## Runtime Profiles

Required fields:

- `name`: profile name, usually a route, worker job, scheduler task, or CLI command.
- `kind`: `cpu` or `memory`.
- `started_at`: ISO datetime when the profile window started.

Optional fields:

- Shared fields.
- `runtime`: runtime name. Defaults to `node`.
- `service`: logical service, such as `api`, `worker`, or `scheduler`.
- `route`: route or operation name.
- `ended_at`, `duration_ms`, `sample_count`, `sampling_interval_ms`.
- CPU fields: `cpu_usage_percent`, `cpu_user_ms`, `cpu_system_ms`, `top_functions`.
- Memory fields: `rss_bytes`, `heap_used_bytes`, `heap_total_bytes`, `external_bytes`, `array_buffers_bytes`.
- `summary`: small JSON object for profiler metadata.

CPU profiles must include at least one CPU measurement or `top_functions`. Memory profiles must include at least one memory measurement.

```bash
curl -i https://sigmon.example.com/v1/profiles \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "worker.reconcileInvoices",
    "kind": "cpu",
    "runtime": "node",
    "service": "worker",
    "started_at": "2026-05-02T12:00:00.000Z",
    "ended_at": "2026-05-02T12:00:10.000Z",
    "duration_ms": 10000,
    "sample_count": 250,
    "top_functions": [
      {
        "function_name": "reconcileInvoices",
        "self_time_ms": 420,
        "total_time_ms": 900,
        "sample_count": 42
      }
    ],
    "summary": {
      "trigger": "manual-smoke"
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

Identify calls upsert durable project/environment-scoped profile traits. New `traits` shallow-merge into the existing stored traits for that project/environment, so a later identify call can update one key without resending the whole profile. Normal telemetry with matching `user_id` or `tenant_id` updates last-seen timestamps, but only identify calls update stored traits.

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

## Message campaigns

Campaign definitions and results are managed through the session-authenticated admin/query API, not the ingestion key:

- `POST /admin/message-campaigns`
- `GET /admin/message-campaigns`
- `PATCH /admin/message-campaigns/:id`
- `DELETE /admin/message-campaigns/:id`
- `GET /query/message-campaigns/:id/results`

The first native campaign slice is measurement-first. Sigmon stores the definition, target segment, delivery channel reference, consent category, opt-out records, and engagement metrics, but it does not send scheduled outbound messages by itself yet. Emit delivery and engagement lifecycle events from your app or delivery workflow as normal events:

```bash
curl -i https://sigmon.example.com/v1/events \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sigmon.campaign.delivered",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "properties": {
      "campaign_id": "cmp_invoice_activation",
      "campaign_key": "invoice_activation",
      "campaign_event": "delivered"
    }
  }'
```

Use the campaign `conversionEvent` as the business outcome, for example `invoice.paid`, and include the campaign id or key in event properties when your product can attribute it.

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
