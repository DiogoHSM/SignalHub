# @sigmon/sdk

JavaScript and TypeScript SDK for sending telemetry to a self-hosted SignalMonitor instance.

Use this package when instrumenting TypeScript, Node.js, browser, or Next.js projects. Use the raw OpenAPI document when integrating other languages or low-level automation.

Public docs:

- `https://my.sigmon.app/sdk`
- `https://my.sigmon.app/docs`

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
| Sigmon server/admin config | Sigmon API, worker, scheduler, EasyPanel, Docker Compose | Database, Redis, sessions, retention, backups, SMTP/webhook delivery, CORS defaults, source-map storage. |
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
    return () => {
      stopVitals();
      stopErrors();
    };
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

## Identify

Use identify calls when stable user or tenant traits become known. Telemetry with matching `userId` or `tenantId` updates `last_seen_at`, but only identify calls update persisted traits.

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

## Experiments and A/B Tests

Sigmon experiments are derived from normal event telemetry. The SDK does not assign variants or change feature-flag behavior in your app; your application should choose a stable variant and send exposure and conversion events with consistent properties.

Minimum event properties:

- `experiment`: stable experiment key, for example `checkout_copy`.
- `variant`: stable variant key, for example `control` or `short_copy`.

Recommended event names:

- Exposure event: `experiment.exposed` or a product-specific event such as `checkout.exposed`.
- Conversion event: `experiment.converted` or a product-specific event such as `checkout.completed`.

```ts
const experiment = "checkout_copy";
const variant = "short_copy";

sigmon.track("checkout.exposed", {
  experiment,
  variant,
  page: "checkout"
}, {
  tenantId: "tenant_123",
  userId: "user_456"
});

sigmon.track("checkout.completed", {
  experiment,
  variant,
  orderValueCents: 12900
}, {
  tenantId: "tenant_123",
  userId: "user_456"
});

await sigmon.flush();
```

In the console, open `Experiments` and map the experiment property, variant property, exposure event, and conversion event. If your app already uses different names, keep them consistent and map them there.

Experiment readouts are directional operational views, not a statistical-significance engine. Use them to spot obvious changes in conversion, quality, latency, or cost before drilling into events, users, tenants, traces, errors, or LLM calls.

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

## Production Smoke Tests

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
