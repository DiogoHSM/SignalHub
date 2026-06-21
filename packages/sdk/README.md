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

## Node.js

```ts
import { createSignalMonitorClient } from "@sigmon/sdk/node";

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

sigmon.capture(new Error("Payment provider timeout"), {
  severity: "error",
  tenantId: "tenant_123",
  userId: "user_456",
  metadata: {
    route: "POST /api/checkout"
  }
});

await sigmon.flush();
```

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
  type: "ui",
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
import { createSignalMonitorClient } from "@sigmon/sdk/browser";
import { installBrowserErrorCapture } from "@sigmon/sdk/next";

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

## OpenAPI

The API reference remains the source of truth for payloads and non-TypeScript integrations:

- `https://my.sigmon.app/docs`
- `https://my.sigmon.app/openapi.json`
