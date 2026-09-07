# @sigmon/sdk

JavaScript and TypeScript SDK for sending telemetry to a self-hosted SignalMonitor instance.

Use this package when instrumenting TypeScript, Node.js, browser, or Next.js projects. Use the raw OpenAPI document when integrating other languages or low-level automation.

Public docs:

- `https://my.sigmon.app/sdk`
- `https://my.sigmon.app/docs`
- `https://my.sigmon.app/agents.md` (step-by-step setup instructions for coding agents)

## Install

```sh
pnpm add @sigmon/sdk
```

## Runtime Configuration

Server-side code should keep ingestion keys in secret storage:

```env
SIGMON_ENDPOINT=https://my.sigmon.app
SIGMON_API_KEY=sh_SERVER_INGESTION_KEY
```

Browser telemetry should use a browser-scoped ingestion key. Browser keys are public by design, so create one per project and environment:

```env
NEXT_PUBLIC_SIGMON_ENDPOINT=https://my.sigmon.app
NEXT_PUBLIC_SIGMON_BROWSER_KEY=sh_BROWSER_INGESTION_KEY
NEXT_PUBLIC_APP_VERSION=2026.05.25
```

Configure browser origins on the Sigmon side before shipping browser capture. Use the project browser-origin allowlist in the console, or set `BROWSER_CORS_ORIGINS=https://app.example.com` on the Sigmon API service for coarse server-level allowlisting.

Keep these scopes separate:

| Scope | Lives in | Purpose |
| --- | --- | --- |
| Sigmon server/admin config | Sigmon API, worker, scheduler, hosting platform, Docker Compose | Database, Redis, sessions, retention, backups, SMTP/webhook delivery, CORS defaults, source-map storage. |
| Monitored project config | The app being monitored | `SIGMON_ENDPOINT`, server ingestion key, browser ingestion key, release/deploy id, source-map upload token in CI. |

## Node.js

```ts
import { createSignalMonitorClient, installNodeErrorCapture } from "@sigmon/sdk/node";

const sigmon = createSignalMonitorClient({
  endpoint: process.env.SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.SIGMON_API_KEY ?? "",
  defaultContext: {
    source: "api",
    release: process.env.APP_VERSION
  }
});

sigmon.track("checkout.started", {
  plan: "team"
}, {
  tenantId: "tenant_123",
  userId: "user_456"
});

sigmon.captureError(new Error("Payment provider timeout"), {
  severity: "error",
  tenantId: "tenant_123",
  userId: "user_456",
  metadata: {
    route: "POST /api/checkout"
  }
});

await sigmon.flush();
```

### Client methods and delivery lifecycle

Every runtime client exposes the same core methods. Runtime-specific entrypoints add helpers around
this client rather than changing the ingestion contract.

| Method | Purpose |
| --- | --- |
| `track` | Product events and conversion telemetry. |
| `assignExperiment` | Deterministically select a weighted variant and record the exposure. |
| `evaluateFlag` | Evaluate a local feature-flag snapshot with a safe fallback. |
| `captureError` | Errors with stack, release, severity, and runtime context. |
| `breadcrumb` | Bounded context leading up to an error or session event. |
| `llm` | LLM provider/model, token, cost, status, and latency telemetry. |
| `trace`, `startTrace`, `span` | Distributed trace and span telemetry, including W3C propagation helpers. |
| `webVital` | Send one Web Vital sample directly; browser apps normally use `installBrowserWebVitals`. |
| `click` | Send one privacy-safe click-map sample; browser apps normally use `installBrowserClickCapture`. |
| `replay` | Send a privacy-safe replay timeline; browser apps normally use `createBrowserReplayRecorder`. |
| `profile` | Send a bounded runtime CPU or memory profile. |
| `submitSurvey`, `feedback` | Survey responses and user feedback. |
| `identify`, `identifyUser`, `identifyTenant` | Persist stable actor traits and refresh identity activity. |
| `flush` | Wait for telemetry currently queued by the client. |
| `shutdown` | Stop accepting new telemetry and flush queued delivery before process exit. |

Use `await sigmon.shutdown()` during graceful termination of a long-running process. Use
`await sigmon.flush()` when the client will continue running but the current job or request must wait
for queued telemetry.

### Event property hygiene

Sigmon accepts flexible event properties, then surfaces a property catalog in the console and through
`GET /query/events/properties`. Keep properties easy to query:

- Use stable `snake_case` names.
- Keep one JSON type per property name, for example `amount_cents` is always a number.
- Put `tenantId`, `userId`, `sessionId`, and `traceId` in Sigmon context instead of duplicating them in properties.
- Avoid secrets, tokens, cookies, raw PII, full request bodies, and full response bodies.
- Use `metadata` for runtime/emitter context and `properties` for product-event facts.

Funnels are derived from normal event telemetry. To make conversion analysis useful, send stable actor
context on each funnel event:

```ts
sigmon.track("signup.started", {}, { userId: "user_456", tenantId: "tenant_123" });
sigmon.track("project.created", {}, { userId: "user_456", tenantId: "tenant_123" });
sigmon.track("key.created", {}, { userId: "user_456", tenantId: "tenant_123" });
```

Retention curves use the same product events. Pick a stable entry event such as `signup.started` and a
return event such as `app.opened`; Sigmon groups actors into daily, weekly, or monthly cohorts from the
first entry event and counts later return activity.

Saved segments also come from normal event telemetry. Keep actor identifiers and event properties
consistent so operators can save reusable user or tenant cohorts such as "team plan users who created
a project in the last 30 days" and apply them back to event investigation.

User journey paths use the same events to find common sequences before or after a selected event. Send
stable `userId`, `tenantId`, `sessionId`, or `traceId` context on each product event so Sigmon can group
paths by the right actor and expose sample events for drilldown.

Custom dashboards and saved reports are also derived from normal event and error telemetry. You do not
need a dashboard-specific SDK call; keep event naming, actor IDs, and product properties consistent so
operators can compose stable metric, trend, and top-list widgets in the Sigmon console.

A/B experiments use deterministic SDK assignment plus normal event telemetry. Create the experiment in
the Sigmon console, then assign a subject and let the SDK send the exposure event:

```ts
const assignment = sigmon.assignExperiment({
  experimentKey: "checkout_copy",
  subjectId: "user_456",
  variants: [
    { key: "control", weight: 50 },
    { key: "treatment", weight: 50 }
  ],
  properties: { surface: "pricing" }
});

renderCheckoutCopy(assignment.variant);
sigmon.track("checkout.completed", {
  experiment_key: "checkout_copy",
  variant: assignment.variant
});
```

Sigmon reads results from `GET /query/experiments/:id/results`; keep `experiment_key`, `variant`, and
stable user/tenant/session context on exposure and conversion events.

Feature flags use saved project/environment definitions in the Sigmon console and a safe SDK evaluator
that can run with a local snapshot. Always provide an off/default variant so app code has a deterministic
fallback if remote config is unavailable:

```ts
const flag = sigmon.evaluateFlag({
  key: "new_checkout",
  fallbackVariant: "off",
  variants: [
    { key: "off", value: false },
    { key: "on", value: true }
  ],
  rules: [{ variant: "on", match: { userId: "user_456", traits: { plan: "team" } } }],
  subject: { userId: "user_456", traits: { plan: "team" } }
});

if (flag.value === true) {
  renderNewCheckout();
}
```

The helper records `sigmon.feature_flag.evaluated` unless `trackExposure: false` is set.

For gradual rollouts, add a deterministic percentage rule. The same rule shape works in server and
browser code, and the SDK uses the same stable hash as the Sigmon API preview:

```ts
const flag = sigmon.evaluateFlag({
  key: "new_checkout",
  fallbackVariant: "off",
  variants: [
    { key: "off", value: false },
    { key: "on", value: true }
  ],
  rules: [{ id: "gradual_rollout", variant: "on", match: {}, rollout: { percentage: 10, stickiness: "user" } }],
  subject: { userId: "user_456" }
});
```

Beta programs are managed in the Sigmon console or admin API and can be linked to a feature flag.
When you add or remove beta participants, Sigmon updates scoped targeting rules on that linked flag.
Application code still reads the rollout through `evaluateFlag`, so early access fails closed with the
same default/off variant as any other feature flag.

In-app surveys are also managed in the Sigmon console. Use `submitSurvey` when a browser widget or
product flow collects answers. The `answers` object is keyed by survey question id and is persisted
with the same user, tenant, session, source, release, and metadata context as other telemetry:

```ts
sigmon.submitSurvey({
  surveyId: "srv_activation_pulse",
  actorType: "user",
  actorId: "user_456",
  answers: {
    satisfaction: 5,
    comment: "Great"
  }
}, {
  tenantId: "tenant_123",
  userId: "user_456",
  sessionId: "sess_789",
  metadata: { placement: "checkout_success" }
});
```

Survey responses are sent to `POST /v1/surveys/responses`. Configure browser origins before calling
this directly from the browser with a browser-scoped ingestion key.

NPS campaigns use the same survey response endpoint. Create a standard NPS campaign in the console,
then submit an answer keyed as `nps` on the 0-10 scale. The console reads `GET /query/surveys/:id/nps`
to show score, promoter/passive/detractor counts, trend, and tenant/release/plan segments.

For free-form product feedback, enable the Feedback widget in project settings and install the browser
helper. It renders a small opt-in button, captures the current page URL/path, and sends text feedback
to `POST /v1/feedback` with the same user, tenant, session, source, release, and metadata context.

```ts
import { createSignalMonitorClient, installFeedbackWidget } from "@sigmon/sdk/browser";

const sigmonBrowser = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT!,
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY!,
  defaultContext: {
    source: "browser",
    release: process.env.NEXT_PUBLIC_APP_VERSION
  }
});

installFeedbackWidget(sigmonBrowser, {
  buttonLabel: "Feedback",
  category: "ux",
  flush: true,
  context: () => ({
    tenantId: currentTenantId(),
    userId: currentUserId(),
    sessionId: currentSessionId()
  })
});
```

Screenshot capture is intentionally not enabled in the SDK until masking and explicit consent controls
are available.

Click maps are separate from click breadcrumbs. Breadcrumbs tell the story around an error or session;
click maps aggregate opt-in browser coordinates by route and safe selector. Add stable
`data-sigmon-id` attributes to meaningful controls before enabling click capture.

Install runtime-level capture in worker, queue, cron, and CLI entrypoints:

```ts
installNodeErrorCapture(sigmon, {
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  flush: true,
  context: {
    metadata: { service: "worker" }
  }
});
```

The helper records `mechanism` as `node.uncaughtException` or `node.unhandledRejection`, marks the event as unhandled, defaults severity to `fatal`, and returns a cleanup function for tests or hot reloads.

## Browser

```ts
import { createSignalMonitorClient } from "@sigmon/sdk/browser";

const sigmon = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY ?? "",
  defaultContext: {
    source: "web",
    release: process.env.NEXT_PUBLIC_APP_VERSION
  }
});

sigmon.breadcrumb({
  type: "click",
  category: "checkout",
  message: "Clicked pay"
});

sigmon.track("checkout.pay_clicked", {
  plan: "team"
});
```

### Browser session replay

Session replay is opt-in and privacy-safe. The browser helper records a masked interaction timeline
with navigation and safe click selectors; it does not capture screenshots, DOM snapshots, raw text,
input values, passwords, cookies, or HTML.

Use one `replayId` to connect product events, error occurrences, and the replay buffer:

```ts
import {
  createBrowserReplayRecorder,
  createSignalMonitorClient,
  installBrowserErrorCapture
} from "@sigmon/sdk/browser";

const sigmon = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY ?? "",
  defaultContext: {
    source: "web",
    release: process.env.NEXT_PUBLIC_APP_VERSION
  }
});

const replay = createBrowserReplayRecorder(sigmon, {
  enabled: true,
  route: () => window.location.pathname
});

const stopErrors = installBrowserErrorCapture(sigmon, {
  flush: true,
  context: {
    replayId: replay.replayId
  }
});

sigmon.track("checkout.pay_clicked", { plan: "team" }, { replayId: replay.replayId });

window.addEventListener("error", () => {
  void replay.flush();
});
```

Add `data-sigmon-id` attributes to meaningful buttons and links so the replay timeline uses stable,
intentional selectors.

The console can filter replay samples by saved segment through `GET /query/replays`. Stable `userId`,
`tenantId`, event names, and shared `replayId` values make those cohort replay samples actionable.

## Next.js App Router

```ts
// app/api/health/route.ts
import { createSignalMonitorNextClient, withSignalMonitorRoute } from "@sigmon/sdk/next";

const sigmon = createSignalMonitorNextClient({
  endpoint: process.env.SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.SIGMON_API_KEY ?? "",
  defaultContext: {
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    metadata: { service: "web" }
  }
});

export const GET = withSignalMonitorRoute(async () => {
  return Response.json({ ok: true });
}, {
  client: sigmon,
  routeName: "GET /api/health"
});
```

Install browser global error capture from a Client Component:

```tsx
"use client";

import { useEffect } from "react";
import { createSignalMonitorClient, installBrowserErrorCapture } from "@sigmon/sdk/browser";

const sigmonBrowser = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY ?? "",
  defaultContext: {
    source: "web",
    release: process.env.NEXT_PUBLIC_APP_VERSION
  }
});

export function SignalMonitorBrowserCapture() {
  useEffect(() => {
    return installBrowserErrorCapture(sigmonBrowser, {
      captureErrors: true,
      captureUnhandledRejections: true,
      flush: true
    });
  }, []);

  return null;
}
```

Install browser Web Vitals capture from the same Client Component when you want route-level LCP,
INP, CLS, FCP, FID, and TTFB in the APM view. The helper uses the browser PerformanceObserver API
directly, sends p75-ready samples to `/v1/web-vitals`, and stays opt-in so public browser keys are
only used from allowlisted origins.

```tsx
"use client";

import { useEffect } from "react";
import {
  createSignalMonitorClient,
  installBrowserErrorCapture,
  installBrowserClickCapture,
  installBrowserWebVitals
} from "@sigmon/sdk/browser";

const sigmonBrowser = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY ?? "",
  defaultContext: {
    source: "web",
    release: process.env.NEXT_PUBLIC_APP_VERSION
  }
});

export function SignalMonitorBrowserCapture() {
  useEffect(() => {
    const stopErrors = installBrowserErrorCapture(sigmonBrowser, { flush: true });
    const stopVitals = installBrowserWebVitals(sigmonBrowser, {
      route: () => window.location.pathname,
      metadata: { service: "web" },
      flush: true
    });
    const stopClicks = installBrowserClickCapture(sigmonBrowser, {
      enabled: true,
      route: () => window.location.pathname,
      flush: true
    });
    return () => {
      stopClicks();
      stopVitals();
      stopErrors();
    };
  }, []);

  return null;
}
```

Install browser click map capture only after reviewing privacy expectations for the monitored app.
The helper sends normalized viewport coordinates to `/v1/clicks`, uses `data-sigmon-id` when present,
falls back to minimal tag/role selectors, ignores form fields and `contenteditable` regions, respects
`data-sigmon-ignore`, and never sends text content, input values, DOM snapshots, or screenshots.

```tsx
"use client";

import { useEffect } from "react";
import { createSignalMonitorClient, installBrowserClickCapture } from "@sigmon/sdk/browser";

const sigmonBrowser = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY ?? "",
  defaultContext: {
    source: "web",
    release: process.env.NEXT_PUBLIC_APP_VERSION
  }
});

export function SignalMonitorClickMaps() {
  useEffect(() => {
    return installBrowserClickCapture(sigmonBrowser, {
      enabled: true,
      route: () => window.location.pathname,
      selectorAttribute: "data-sigmon-id",
      ignoreSelectors: ["[data-sigmon-ignore]"],
      flush: true
    });
  }, []);

  return null;
}
```

## Runtime Profiles

Node runtime profiling is opt-in and bounded. Use it around worker jobs, scheduled tasks, CLI commands,
or suspicious request paths when you need CPU hot functions or memory snapshots in the Traces/APM view.
Profiles are sent to `/v1/profiles` and retained by `RETENTION_PROFILES_DAYS`.

```ts
import {
  captureNodeMemoryProfile,
  createSignalMonitorClient,
  startNodeCpuProfile
} from "@sigmon/sdk/node";

const sigmon = createSignalMonitorClient({
  endpoint: process.env.SIGMON_ENDPOINT ?? "https://my.sigmon.app",
  apiKey: process.env.SIGMON_API_KEY ?? "",
  defaultContext: {
    source: "worker",
    release: process.env.APP_VERSION,
    metadata: { service: "worker" }
  }
});

const cpu = await startNodeCpuProfile(sigmon, {
  name: "worker.reconcileInvoices",
  service: "worker",
  maxDurationMs: 10_000,
  flush: true
});

try {
  await reconcileInvoices();
} finally {
  await cpu.stop();
}

await captureNodeMemoryProfile(sigmon, {
  name: "worker.reconcileInvoices.memory",
  service: "worker",
  flush: true
});
```

For custom runtimes or external profilers, call `sigmon.profile(...)` directly:

```ts
await sigmon.profile({
  name: "api.checkout.cpu",
  kind: "cpu",
  runtime: "node",
  service: "api",
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: 250,
  sampleCount: 120,
  topFunctions: [
    { functionName: "priceCart", selfTimeMs: 80, totalTimeMs: 120, sampleCount: 30 }
  ],
  summary: { trigger: "manual-smoke" }
});
```

## Traces, Spans, and Propagation

Use `startTrace` around request or workflow boundaries. New traces created without a custom `traceId` use W3C-compatible ids and expose `traceparent` headers for downstream calls.

```ts
const trace = sigmon.startTrace("POST /api/checkout", {
  tenantId: "tenant_123",
  userId: "user_456",
  metadata: { service: "api" }
});

await fetch("https://worker.example.com/jobs", {
  method: "POST",
  headers: trace.headers(),
  body: JSON.stringify({ type: "checkout" })
});

sigmon.span({
  traceId: trace.traceId,
  name: "postgres order lookup",
  durationMs: 42,
  status: "success"
}, {
  metadata: {
    service: "api",
    target_service: "postgres",
    "db.system": "postgres"
  }
});

trace.end({ status: "success" });
await sigmon.flush();
```

Next.js wrappers read incoming `traceparent` headers automatically. Add `metadata.service`, `metadata.target_service`, `metadata.peer_service`, or `metadata.peer` to spans when you want the Sigmon service map to show dependency edges.

### Manual Trace Propagation (Express, Hono, workers)

Outside Next.js, propagate `traceparent` yourself with the same three helpers every entrypoint re-exports:

```ts
import { createTraceContext, parseTraceparent, traceContextHeaders } from "@sigmon/sdk/node";

// Continue an incoming trace, or start a fresh one if there's no valid header
const incoming = parseTraceparent(request.headers["traceparent"]);
const context = incoming ?? createTraceContext();

const trace = sigmon.startTrace("POST /api/checkout", {
  traceId: context.traceId,
  metadata: { service: "api" }
});

await fetch("https://worker.example.com/jobs", {
  method: "POST",
  headers: traceContextHeaders(context),
  body: JSON.stringify({ type: "checkout" })
});
```

`parseTraceparent` returns `undefined` for a missing or malformed header, so `?? createTraceContext()` always leaves you with a valid W3C trace context. `createTraceContext(traceId?, spanId?)` also accepts an existing trace/span id pair to build a context around, which is what `trace.headers()` uses internally for the Next.js/browser wrappers above.

## Identify

Use identify calls when stable user or tenant traits become known. Telemetry with matching `userId` or `tenantId` updates `last_seen_at`, but only identify calls update persisted traits.
Repeated identify calls shallow-merge traits: supplied keys replace earlier values while omitted keys remain unchanged.

```ts
sigmon.identifyUser("user_456", {
  name: "Ana Souza",
  email: "ana@example.com",
  role: "admin",
  plan: "pro"
}, {
  tenantId: "tenant_123"
});

sigmon.identifyTenant("tenant_123", {
  name: "MicroERP",
  plan: "pro",
  operation_mode: "production"
});

await sigmon.flush();
```

## Experiments, flags, surveys, and campaigns

The SDK assigns weighted variants deterministically. Give `assignExperiment` a stable subject id and
the same subject receives the same variant across calls. The helper also records the exposure event;
send the conversion as normal product telemetry with the same experiment and actor context.

```ts
const assignment = sigmon.assignExperiment({
  experimentKey: "checkout_copy",
  subjectId: "user_456",
  variants: [
    { key: "control", weight: 50 },
    { key: "short_copy", weight: 50 }
  ],
  properties: { page: "checkout" }
});

sigmon.track("checkout.completed", {
  experiment_key: "checkout_copy",
  variant: assignment.variant,
  orderValueCents: 12900
}, {
  tenantId: "tenant_123",
  userId: "user_456"
});

await sigmon.flush();
```

Create the matching experiment in the console with the same key, variants, exposure event, and
conversion event. Experiment readouts are derived from exposure and conversion events, so keep actor
identifiers and property names consistent. A custom exposure event such as `checkout.exposed` is valid
when the console experiment and SDK assignment use the same name.

## Feature Flags

Feature flags live beside experiments in the console. Each flag has a stable key, active/paused status,
safe default variant, bounded variants, and ordered targeting rules. Use the SDK evaluator with the
same definition shape in server or browser code, and keep `trackExposure` enabled when you want Sigmon
to count usage of a flag.

Gradual rollout rules are percentage-based feature-flag rules. Pick a stickiness unit (`user`,
`tenant`, or `session`) and a percentage from 0 to 100; Sigmon buckets matching subjects
deterministically so the same actor keeps the same result across requests and runtimes.

Experiment readouts are directional operational views, not a statistical-significance engine. Use them to spot obvious changes in conversion, quality, latency, or cost before drilling into events, users, tenants, traces, errors, or LLM calls.

Beta programs live beside feature flags in the console. Create a program, link it to a flag and variant,
then add user or tenant participants. Sigmon syncs those participants into flag targeting rules, while
your application continues to call `evaluateFlag` with a safe fallback. Adoption is measured from normal
event telemetry emitted by participating users or tenants.

Message campaigns are created and updated through the console or `/admin/message-campaigns`. Campaign
delivery and conversion reporting use the same project/environment and actor context as SDK telemetry;
the SDK does not expose administrator credentials or campaign-management methods to monitored apps.

## Source Maps

Create a source-map upload token in the Sigmon Artifacts console and keep it in CI secrets. Browser ingestion keys cannot upload source maps.

The release value in errors must match the release used during upload. For Next.js/Vercel, a commit SHA or deployment id usually works well:

```sh
pnpm source-maps:upload \
  --endpoint "$SIGMON_ENDPOINT" \
  --token "$SIGMON_SOURCE_MAP_TOKEN" \
  --project-id "$SIGMON_PROJECT_ID" \
  --environment-id "$SIGMON_ENVIRONMENT_ID" \
  --release "$NEXT_PUBLIC_APP_VERSION" \
  --bundle ./dist/source-maps.zip
```

Use `--file ./dist/assets/app.js.map --minified-file assets/app.js` for a single map, or `--bundle ./dist/source-maps.zip` for multiple maps. Use `--timeout-ms` or `SIGMON_UPLOAD_TIMEOUT_MS` when CI needs a non-default upload timeout.

When an incident still shows minified frames, use the source-map diagnostic in the incident stack panel:

- `Source maps resolved`: the release and generated file path matched an uploaded artifact.
- `Source maps partially resolved`: at least one generated file matched, but another frame did not. Upload maps for every generated chunk in the stack.
- `Source maps not applied`: the error has no release, no matching uploaded artifact for that release, or the generated file path differs from the uploaded `--minified-file`.
- `Source maps unavailable`: the Sigmon source-map storage or artifacts API needs operational attention.

For Vercel/Next.js, the most common failure is a release mismatch: browser/server errors must send the same `NEXT_PUBLIC_APP_VERSION` (or deploy id/commit SHA) that CI used in `pnpm source-maps:upload --release`.

## Production smoke tests

Use curl to validate a server key:

```sh
curl -i "$SIGMON_ENDPOINT/v1/events" \
  -H "Authorization: Bearer $SIGMON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"deploy.smoke","properties":{"source":"curl"}}'
```

Use the browser console on the actual production origin to validate CORS and the browser key:

```js
fetch("https://my.sigmon.app/v1/events", {
  method: "POST",
  headers: {
    Authorization: "Bearer sh_BROWSER_INGESTION_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "browser.smoke",
    properties: { source: "browser-console" }
  })
}).then(async (response) => console.log(response.status, await response.text()));
```

Expected result is `202` and a new event in the selected project/environment. A `401` means the key is wrong or scoped to a different project/environment; a browser CORS failure means the app origin is not allowlisted in Sigmon.

Common ingest failures now include a `hint` field:

- `invalid_api_key`: check that the request sends `Authorization: Bearer <key>` and that browser calls use a browser-scoped key for the same project/environment.
- `invalid_ingestion_payload`: compare the request body with `/docs` or `/openapi.json`, or use the SDK to generate schema-compatible payloads.
- `ingestion_unavailable`: check Sigmon Redis connectivity and worker/scheduler health.

## OpenAPI

The API reference remains the source of truth for payloads and non-TypeScript integrations:

- `https://my.sigmon.app/docs`
- `https://my.sigmon.app/openapi.json`
