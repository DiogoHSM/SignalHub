# SignalMonitor Agent Setup

This document is instructions for an AI coding agent (Claude Code, Codex, Antigravity, or similar) working inside **a different codebase** — the project a developer wants to monitor with SignalMonitor ("Sigmon"). A developer points their agent at this file's public URL and the agent follows it end to end: detect the target project's stack, connect to the developer's Sigmon instance, provision project/environment/API keys where it's safe to do so, install and wire the SDK, and verify telemetry arrives.

This is not the Sigmon install guide. If the developer doesn't have a running Sigmon instance yet,
use the repository's [self-hosting guide](https://github.com/DiogoHSM/sigmon/blob/main/docs/SELF-HOSTING.md)
first — this document assumes one is already reachable.

## 0. Before doing anything

Confirm with the human, in the target codebase:

1. The Sigmon instance URL that will receive telemetry (e.g. `https://my.sigmon.app`).
2. Whether a Sigmon project already exists for this codebase, or a new one should be created, and what to name it.
3. Which of this codebase's deploy environments should be wired up now. Map them explicitly — don't infer silently. A typical map:
   - `local` — the developer's machine.
   - a self-managed staging/dev host the developer controls (e.g. a VPS behind a `dev.<app>.<tld>` subdomain).
   - a managed cloud production environment (GCP, AWS, etc.).
4. For each environment, which signals to enable. Errors and traces are safe defaults everywhere; Session Replay and the Feedback widget capture end-user content and must be opt-in per environment, never turned on silently (see §9).
5. Explicit go-ahead to write files (`.env*`, init code) and, where applicable, to call the Sigmon Admin API on the developer's behalf.

Do not proceed past this section on assumptions. If the environment map or signal list is ambiguous, ask.

## 1. Detect the target project

- Read `package.json` / lockfile to identify the package manager and framework (Next.js, Express, a browser SPA, plain Node, monorepo layout).
- Check for existing error/analytics tooling (Sentry, PostHog, etc.) already wired in the entry points you're about to touch, so you don't double-instrument.
- Look for existing `.env*` files, Docker Compose files, and CI/CD configs to find the deploy environments already present, and cross-check them against the map the human gave you in §0.

## 2. Automation trust tiers

This is the part that changes behavior — not because the Sigmon API is different per environment, but because writing secrets into a shared/production system is a different risk than writing them into a developer's own machine. Match automation level to blast radius:

| Tier | Example | Sigmon-side automation | Deploy-side automation |
| --- | --- | --- | --- |
| Local dev | developer's machine | Full: log in as Sigmon admin and auto-create project/environment/API key via the Admin API | Full: write the key straight into a git-ignored `.env.local` |
| Self-managed dev/stage | a VPS the developer controls, e.g. `dev.pinima.online` | Full: same Admin API flow, environment named to match (e.g. `dev`) | Full if you already have repo or SSH access to that host's env file/compose override; otherwise hand the value to the human to paste |
| Managed cloud production | GCP Cloud Run/App Engine/GKE, AWS, etc. | None: do not hold or use Sigmon admin credentials against this environment. Ask the human to create/select the `prod` environment and generate the API key from the Sigmon console themselves | Draft only: propose the exact `gcloud`/Terraform/etc. command to set the secret, show it, and wait for explicit per-run confirmation before executing anything |

The production row isn't special-cased because Sigmon treats it differently — it's the same general rule as any other agent action: don't push changes into shared/production infrastructure without a human confirming that specific step.

## 3. Connect to Sigmon (local / self-managed tiers only)

```
POST {endpoint}/auth/login
  { "email": "...", "password": "..." }
→ sets an admin session cookie
```

Use that session for the Admin API:

```
GET  {endpoint}/admin/projects
     → find the target project by name, or:
POST {endpoint}/admin/projects
     { "name": "Pinima" }

POST {endpoint}/admin/projects/:projectId/environments
     { "name": "local" }        # repeat per environment in scope

POST {endpoint}/admin/projects/:projectId/api-keys
     { "environmentId": "...", "name": "local server", "capability": "server" }
     → { "apiKey": { "secret": "...", ... } }

# Only when browser telemetry is in scope, create a separate public browser key:
POST {endpoint}/admin/projects/:projectId/api-keys
     { "environmentId": "...", "name": "local browser", "capability": "browser" }
     → { "apiKey": { "secret": "...", ... } }
```

Each `secret` field is returned once, at creation, and never again. Use it immediately; never log it,
never write it into a commit message or code comment, and never persist the admin password or session
cookie to disk. Never substitute a server key for a browser key: the server key is confidential and
must not enter a public bundle.

For the production tier, skip this section entirely — the human supplies an already-created API key instead.

## 4. Install the SDK

Detect the package manager from the lockfile and install `@sigmon/sdk`, then pick the entrypoint that matches the target:

- `@sigmon/sdk/node` — Node backends.
- `@sigmon/sdk/browser` — browser/SPA code.
- `@sigmon/sdk/next` — Next.js server routes and server actions.

Next.js applications with client-side capture normally use both `@sigmon/sdk/next` on the server and
`@sigmon/sdk/browser` in Client Components. Keep the clients and keys separate: never import the
browser entrypoint into server-only code, and never expose the server ingestion key to a browser bundle.

## 5. Configure per environment

Standard variable names, one pair per environment, written to that environment's own config surface:

```dotenv
SIGMON_ENDPOINT=https://my.sigmon.app
SIGMON_API_KEY=<the server-scoped ingestion key>
NEXT_PUBLIC_SIGMON_ENDPOINT=https://my.sigmon.app
NEXT_PUBLIC_SIGMON_BROWSER_KEY=<the browser-scoped ingestion key>
NEXT_PUBLIC_APP_VERSION=<release-or-deploy-id>
```

- `local` → `.env.local` (confirm it's git-ignored before writing; if it isn't, stop and fix that first).
- self-managed dev/stage → that host's env file or Compose override, if you have access to it.
- production → do not write this yourself unless the human has approved the specific command; see the tier table in §2.

`SIGMON_ENDPOINT` is normally identical across all environments of one codebase — it is the same
Sigmon install receiving telemetry from every deploy stage. The scoped keys and release id change per
environment. Omit the `NEXT_PUBLIC_*` variables entirely when browser telemetry is not in scope.

## 6. Wire instrumentation

Initialize one client near each runtime entry point. For Node.js:

```ts
import { createSignalMonitorClient } from "@sigmon/sdk/node";

const signal = createSignalMonitorClient({
  endpoint: process.env.SIGMON_ENDPOINT!,
  apiKey: process.env.SIGMON_API_KEY!
});
```

For a Next.js App Router route or server action:

```ts
import { createSignalMonitorNextClient, withSignalMonitorRoute } from "@sigmon/sdk/next";

const signal = createSignalMonitorNextClient({
  endpoint: process.env.SIGMON_ENDPOINT!,
  apiKey: process.env.SIGMON_API_KEY!,
  defaultContext: { release: process.env.NEXT_PUBLIC_APP_VERSION }
});

export const GET = withSignalMonitorRoute(async () => Response.json({ ok: true }), {
  client: signal,
  routeName: "GET /api/health"
});
```

For client-side errors, Web Vitals, clicks, replay, or feedback in a browser or Next.js Client
Component:

```ts
import { createSignalMonitorClient, installBrowserErrorCapture } from "@sigmon/sdk/browser";

const signalBrowser = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT!,
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY!,
  defaultContext: { release: process.env.NEXT_PUBLIC_APP_VERSION, source: "web" }
});

const stopErrorCapture = installBrowserErrorCapture(signalBrowser, { flush: true });
```

Store and invoke cleanup callbacks such as `stopErrorCapture` during hot reloads, tests, or component
unmounts. Gracefully terminate long-running server processes with `await signal.shutdown()`.

Then wire only the signals confirmed in §0 — error capture, trace propagation, product events, LLM call wrapping, Web Vitals. If the target has a browser-facing origin, remind the human to add it under `Project Settings > Browser origins` in the Sigmon console (or `BROWSER_CORS_ORIGINS` on the Sigmon instance) or browser telemetry will be rejected by CORS.

## 7. Verify

Per environment you configured:

1. Trigger one real signal (a startup log, a test error, a request) to confirm delivery.
2. Check the Sigmon console Overview for that project/environment for the event, or query `{endpoint}/health` and `{endpoint}/ready` if you only need to confirm the Sigmon instance itself is up.
3. Report success or failure to the human in plain language, per environment — don't claim an environment is wired up without having seen a signal land.

## 8. Handoff summary

End with a short summary, one line per environment:

```
- local:      configured, verified (event received)
- dev:        configured, verified (event received)
- prod:       key generated, waiting on you to set SIGMON_API_KEY in Cloud Run and redeploy
```

Include the console URL for the project so the human can open it directly.

## 9. Guardrails

- Never write the Sigmon admin password, or any admin session token, to disk, logs, commit messages, or code comments.
- Never persist an API key into a git-tracked file. Confirm the target `.env*` is git-ignored before writing a secret into it.
- Never call the Sigmon Admin API against the production tier. Never run a cloud-provider command that changes production configuration without showing the exact command and getting explicit confirmation first.
- Never enable Session Replay or the Feedback widget as a side effect of "turning on everything" — they capture end-user content and are opt-in per SignalMonitor's own constraints.
- If the environment classification (local/staging/prod) is ambiguous for a host, ask. Don't guess and don't default to the safer-looking Sigmon-side automation just because the deploy target is unclear.
