import type { FastifyInstance } from "fastify";

const sdkDocsContentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'";

const sdkDocsHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SignalMonitor SDK</title>
    <meta
      name="description"
      content="Public SDK documentation for instrumenting Node.js, browser, and Next.js applications with SignalMonitor."
    />
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f141b;
        --panel: #18212b;
        --panel-soft: #202b36;
        --text: #f3f7fb;
        --muted: #9ba8b6;
        --line: #2f3c49;
        --accent: #68e28b;
        --accent-strong: #39d46d;
        --blue: #72a7ff;
        --code: #0b1220;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
        line-height: 1.55;
      }

      a {
        color: var(--blue);
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      header {
        border-bottom: 1px solid var(--line);
        background: #111922;
      }

      nav,
      main {
        width: min(1120px, calc(100% - 40px));
        margin: 0 auto;
      }

      nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 0;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .mark {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 1px solid rgba(104, 226, 139, 0.7);
        border-radius: 8px;
        color: var(--accent);
      }

      .nav-links {
        display: flex;
        align-items: center;
        gap: 14px;
        color: var(--muted);
        font-size: 14px;
      }

      .hero {
        padding: 56px 0 34px;
      }

      .eyebrow {
        color: var(--accent);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      h1 {
        max-width: 820px;
        margin: 12px 0 14px;
        font-size: clamp(38px, 6vw, 72px);
        line-height: 0.95;
        letter-spacing: 0;
      }

      .lead {
        max-width: 780px;
        margin: 0;
        color: var(--muted);
        font-size: 19px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 28px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 0 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        font-weight: 750;
      }

      .button.primary {
        border-color: rgba(104, 226, 139, 0.75);
        background: rgba(57, 212, 109, 0.12);
        color: var(--accent);
      }

      .grid {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 28px;
        padding: 28px 0 72px;
      }

      .toc {
        position: sticky;
        top: 18px;
        align-self: start;
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
      }

      .toc strong {
        display: block;
        margin-bottom: 10px;
      }

      .toc a {
        display: block;
        padding: 6px 0;
        color: var(--muted);
        font-size: 14px;
      }

      .content {
        display: grid;
        gap: 18px;
      }

      section {
        padding: 24px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
      }

      h2,
      h3 {
        margin: 0 0 12px;
        letter-spacing: 0;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        margin-top: 20px;
        font-size: 18px;
      }

      p,
      ul,
      ol {
        color: var(--muted);
      }

      code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        font-size: 0.92em;
      }

      pre {
        overflow: auto;
        margin: 14px 0 0;
        padding: 16px;
        border: 1px solid #253245;
        border-radius: 8px;
        background: var(--code);
        color: #e7edf7;
      }

      pre code {
        font-size: 13px;
      }

      .callout {
        margin-top: 14px;
        padding: 14px 16px;
        border: 1px solid rgba(104, 226, 139, 0.45);
        border-radius: 8px;
        background: rgba(104, 226, 139, 0.08);
        color: #ccefd6;
      }

      .table-wrap {
        overflow: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--muted);
      }

      th,
      td {
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--text);
      }

      @media (max-width: 860px) {
        nav,
        main {
          width: min(100% - 28px, 1120px);
        }

        nav {
          align-items: flex-start;
          flex-direction: column;
        }

        .grid {
          grid-template-columns: 1fr;
        }

        .toc {
          position: static;
        }

        h1 {
          font-size: 42px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <nav aria-label="Documentation">
        <a class="brand" href="/sdk" aria-label="SignalMonitor SDK documentation">
          <span class="mark" aria-hidden="true">⌁</span>
          <span>SignalMonitor SDK</span>
        </a>
        <div class="nav-links">
          <a href="/docs/">API Reference</a>
          <a href="/openapi.json">OpenAPI JSON</a>
          <a href="https://www.npmjs.com/package/@sigmon/sdk">npm</a>
        </div>
      </nav>
    </header>

    <main>
      <div class="hero">
        <div class="eyebrow">Public SDK Guide</div>
        <h1>Instrument Node.js, browser, and Next.js apps with Sigmon.</h1>
        <p class="lead">
          Use <code>@sigmon/sdk</code> for product analytics, error tracking, breadcrumbs, traces,
          LLM calls, and user or tenant identity. Use the OpenAPI reference for non-TypeScript
          integrations and automation.
        </p>
        <div class="actions">
          <a class="button primary" href="#quick-start">Start integrating</a>
          <a class="button" href="/docs/">Open API docs</a>
        </div>
      </div>

      <div class="grid">
        <aside class="toc">
          <strong>On this page</strong>
          <a href="#install">Install</a>
          <a href="#configuration">Configuration</a>
          <a href="#quick-start">Quick start</a>
          <a href="#nextjs">Next.js App Router</a>
          <a href="#browser">Browser capture</a>
          <a href="#identity">Identify and traits</a>
          <a href="#traces">Traces and spans</a>
          <a href="#llm">LLM calls</a>
          <a href="#delivery">Delivery behavior</a>
          <a href="#source-maps">Source maps</a>
        </aside>

        <div class="content">
          <section id="install">
            <h2>Install</h2>
            <p>The public package is published as <code>@sigmon/sdk</code>.</p>
            <pre><code>pnpm add @sigmon/sdk
npm install @sigmon/sdk
yarn add @sigmon/sdk</code></pre>
          </section>

          <section id="configuration">
            <h2>Configuration</h2>
            <p>
              Create one Sigmon project and environment per deployed app environment, then create
              separate API keys for server and browser telemetry.
            </p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Where</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>SIGMON_ENDPOINT</code></td>
                    <td>Server, worker, CI</td>
                    <td>Your Sigmon origin, for example <code>https://my.sigmon.app</code>.</td>
                  </tr>
                  <tr>
                    <td><code>SIGMON_API_KEY</code></td>
                    <td>Server only</td>
                    <td>Secret ingestion key for API routes, workers, jobs, and server actions.</td>
                  </tr>
                  <tr>
                    <td><code>NEXT_PUBLIC_SIGMON_ENDPOINT</code></td>
                    <td>Browser bundle</td>
                    <td>Public Sigmon origin for client-side telemetry.</td>
                  </tr>
                  <tr>
                    <td><code>NEXT_PUBLIC_SIGMON_BROWSER_KEY</code></td>
                    <td>Browser bundle</td>
                    <td>Browser-scoped ingestion key. Public by design; do not reuse server keys.</td>
                  </tr>
                  <tr>
                    <td><code>NEXT_PUBLIC_APP_VERSION</code></td>
                    <td>Server and browser</td>
                    <td>Release or deploy id used for filters and source-map matching.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="quick-start">
            <h2>Quick start</h2>
            <p>Create a server-side client and flush before process exit or at the end of short-lived jobs.</p>
            <pre><code>import { createSignalMonitorClient } from "@sigmon/sdk/node";

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

await sigmon.flush();</code></pre>
            <div class="callout">
              Do not send secrets, cookies, authorization headers, full request bodies, or raw payment data
              in properties, context, breadcrumbs, span input, span output, or error metadata.
            </div>
          </section>

          <section id="nextjs">
            <h2>Next.js App Router</h2>
            <p>
              The Next.js wrapper captures route handler and server action failures, preserves the original
              exception, and flushes best-effort telemetry before rethrowing.
            </p>
            <pre><code>// app/api/health/route.ts
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
});</code></pre>
            <h3>Server actions</h3>
            <pre><code>import { withSignalMonitorAction } from "@sigmon/sdk/next";

export const submitCheckout = withSignalMonitorAction(async (formData: FormData) => {
  // Your action code here.
}, {
  client: sigmon,
  name: "checkout.submit",
  getContext: async () => ({
    tenantId: "tenant_123",
    userId: "user_456"
  })
});</code></pre>
          </section>

          <section id="browser">
            <h2>Browser capture</h2>
            <p>Use browser-scoped keys and install capture from a Client Component.</p>
            <pre><code>"use client";

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
}</code></pre>
            <h3>Manual breadcrumbs</h3>
            <pre><code>sigmonBrowser.breadcrumb({
  type: "click",
  category: "checkout",
  message: "Clicked pay",
  data: { plan: "team" }
});

sigmonBrowser.track("checkout.pay_clicked", {
  plan: "team"
});</code></pre>
          </section>

          <section id="identity">
            <h2>Identify and traits</h2>
            <p>
              Telemetry with matching <code>userId</code> or <code>tenantId</code> updates last seen data.
              Use identify calls when stable traits become known.
            </p>
            <pre><code>sigmon.identifyUser("user_456", {
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

await sigmon.flush();</code></pre>
          </section>

          <section id="traces">
            <h2>Traces and spans</h2>
            <p>
              Use traces for end-to-end workflows and spans for child operations such as database calls,
              external APIs, or expensive business logic.
            </p>
            <pre><code>const trace = sigmon.startTrace("POST /api/checkout", {
  tenantId: "tenant_123",
  userId: "user_456"
});

try {
  sigmon.span({
    traceId: trace.traceId,
    name: "stripe.payment_intent.create",
    durationMs: 214,
    status: "success"
  });

  trace.end({ status: "success" });
} catch (error) {
  sigmon.captureError(error, {
    severity: "error",
    traceId: trace.traceId
  });
  trace.end({ status: "error" });
  throw error;
}</code></pre>
          </section>

          <section id="llm">
            <h2>LLM calls</h2>
            <p>Record model, latency, token usage, cost, status, and safe previews.</p>
            <pre><code>sigmon.llm({
  provider: "openai",
  model: "gpt-4.1-mini",
  promptName: "invoice.summary",
  inputTokens: 620,
  outputTokens: 180,
  latencyMs: 1280,
  costUsd: 0.0021,
  status: "success"
}, {
  tenantId: "tenant_123",
  userId: "user_456"
});</code></pre>
          </section>

          <section id="delivery">
            <h2>Delivery behavior</h2>
            <p>
              The SDK queues telemetry in memory, sanitizes payloads, enforces payload size limits, retries
              transient failures, and reports local delivery problems through <code>onError</code>.
            </p>
            <pre><code>const sigmon = createSignalMonitorClient({
  endpoint: process.env.SIGMON_ENDPOINT ?? "",
  apiKey: process.env.SIGMON_API_KEY ?? "",
  maxQueueSize: 1000,
  flushIntervalMs: 5000,
  requestTimeoutMs: 10000,
  maxRetries: 3,
  onError(error) {
    console.warn("Sigmon delivery issue", error);
  }
});</code></pre>
          </section>

          <section id="source-maps">
            <h2>Source maps</h2>
            <p>
              Upload source maps from CI using the CLI and a source-map upload token created in the console.
              Match the upload release with <code>NEXT_PUBLIC_APP_VERSION</code> or your deploy id.
            </p>
            <pre><code>pnpm source-maps:upload \\
  --endpoint "$SIGMON_ENDPOINT" \\
  --token "$SIGMON_SOURCE_MAP_TOKEN" \\
  --project-id "$SIGMON_PROJECT_ID" \\
  --environment-id "$SIGMON_ENVIRONMENT_ID" \\
  --release "$GITHUB_SHA" \\
  --bundle ./dist/source-maps.zip</code></pre>
            <p>
              For raw HTTP payloads, non-TypeScript clients, and admin/query automation, use the
              <a href="/docs/">API reference</a> or <a href="/openapi.json">OpenAPI JSON</a>.
            </p>
          </section>
        </div>
      </div>
    </main>
  </body>
</html>`;

export async function registerSdkDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sdk", async (_request, reply) => {
    return reply.redirect("/sdk/", 301);
  });

  app.get("/sdk/", async (_request, reply) => {
    return reply
      .header("Content-Security-Policy", sdkDocsContentSecurityPolicy)
      .type("text/html; charset=utf-8")
      .send(sdkDocsHtml);
  });
}
