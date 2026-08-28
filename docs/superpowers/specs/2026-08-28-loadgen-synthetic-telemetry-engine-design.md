# Loadgen — Synthetic Telemetry Engine

Design spec. Linear: PER-498 (standalone, no parent epic).

## Purpose

SignalMonitor has no way to generate realistic, multi-service telemetry on demand. This blocks three
things at once: demoing a fresh install without a real customer's data, stress-testing the ingestion
pipeline (API → Redis/BullMQ → worker → Postgres) under sustained load, and giving future console
visualization work (PER-496 timeline/sequencer, PER-497 topology graph) real multi-service data to
prototype against instead of guessing layout with one mostly-empty project.

`packages/loadgen` is a new standalone package: a CLI tool that generates and sends synthetic telemetry
(events, errors, traces+spans, LLM calls, identify, breadcrumbs) for 2-3 fake "services" per project,
with a plausible dependency graph between them, optionally injecting scripted incidents (error-rate
spikes, monitor outages) to produce real alerts and incidents — not just background noise.

## Non-goals

- **Not a UI/mutation-action tester.** It generates telemetry; it does not click buttons, resolve
  incidents, or exercise console mutation flows. That's what the existing test suites are for.
- **No browser-only signals.** Session replay, the feedback widget, Web Vitals, and click maps are
  browser-SDK features requiring an actual browser runtime. Out of scope for a Node CLI. If wanted
  later, that's a separate, much larger spec (headless browser automation).
- **No auto-provisioning.** The tool does not log in as admin or create projects/environments/API
  keys. The operator provisions those manually (console or existing admin API) and hands the tool
  API keys. No admin password ever touches this tool.
- **No safety guardrail against production.** The tool will ingest into whatever project an API key
  points at, including real production projects, with no prefix check or confirmation prompt. The
  operator is responsible for pointing it at dedicated demo projects. (Considered and explicitly
  declined — see Decisions Made During Brainstorming below.)

## Architecture

Four independently testable units:

1. **Scenario profiles** (`packages/loadgen/src/profiles/*.ts`) — pure data. A handful of built-in
   named profiles (`ecommerce`, `fintech`, `saas-b2b`), each declaring:
   - N fake services with names/roles (e.g. `api-gateway`, `checkout`, `payments`, `inventory`,
     `notifications`) and a dependency graph between them (which service calls which — feeds trace
     span parent/child structure and matches what the existing `service-map` aggregate expects).
   - Baseline event/error/trace/LLM rates per service. Not every service has LLM calls (e.g. only a
     `recommendations` or `support-bot` service would).
   - Named incident templates (e.g. `checkout_outage`: elevated error rate on `checkout` + one HTTP
     monitor down window; `llm_cost_spike`: a burst of expensive LLM calls).
   - A pool of fake tenant/user identities with traits, for `identify()` calls and realistic
     Users/Entities investigation views.

2. **Timeline generator** (`packages/loadgen/src/timeline.ts`) — a pure function: `(profile, duration,
   projectCount, seed) => Beat[]`. A `Beat` is `{ timestampMs, projectIndex, serviceName, kind, payload
   }` where `kind` is one of `event | error | trace | llmCall | identify | breadcrumb`. Also produces a
   separate list of monitor-outage windows (`{ startMs, endMs, serviceName, monitorKind }`). No network,
   no I/O — fully deterministic given the same seed, so it's exhaustively unit-testable. A `trace` beat
   expands into a coherent set of spans sharing one `traceId` across the services the profile's
   dependency graph says are involved, so the resulting service-map has real edges.

3. **Executor** (`packages/loadgen/src/executor.ts`) — consumes the beat list from one shared
   timeline in two modes, selected per-beat by comparing the beat's timestamp to "now" at start:
   - **Backfill** (beat time is in the past): fire immediately via the ingestion HTTP client, stamping
     the signal's `timestamp` field with the beat's original scheduled time (ingestion already accepts
     an explicit timestamp — confirmed via existing SDK/ingestion schema usage). Bounded concurrency
     (a worker pool with a request cap) so a multi-day backfill doesn't fire-hose the ingestion queue.
   - **Live** (beat time is in the future): sleep until the beat's real wall-clock time, then fire with
     `timestamp: now`.
   - Monitor-outage windows are **live-only** (see Decisions Made During Brainstorming) — the executor
     only acts on a window if its start time is reached while running live; windows entirely in the
     backfilled past are skipped with a log line, not silently dropped.
   - On a beat send failure: bounded retry with backoff (matching the project's existing convention for
     transient external-call failures), then skip and continue — a long soak run must not die over one
     flaky request.

4. **Fake-target server** (`packages/loadgen/src/fake-target-server.ts`, a second bin in the same
   package) — a minimal standalone HTTP server, no database, in-memory state only:
   - `GET /t/:key` — the URL an HTTP monitor in Sigmon actually polls. Returns 200 or 503 depending on
     the key's current in-memory state (default: up).
   - `POST /control/:key` (bearer-token protected) — the executor calls this remotely to flip a key's
     state to `up`/`down` at the start/end of an outage window.
   - Runs locally for local/Compose testing, or as a small deployable service (e.g. on the existing
     Coolify/VPS infrastructure) for outage simulation against remote/production targets, since the
     Sigmon worker there needs to actually reach it over the network. Deployment specifics belong in
     `.claude/docs/DEPLOYMENT.md`, not this spec.
   - Heartbeat-monitor outages need no separate server at all: "down" is simply the executor not
     calling the public `POST /v1/heartbeats/:id` check-in endpoint during the window.

## Data flow / CLI

```sh
sigmon-loadgen run --profile ecommerce --projects 3 --live 2h
sigmon-loadgen run --profile fintech --projects 2 --backfill 7d
sigmon-loadgen run --profile saas-b2b --backfill 3d --live 1h   # one timeline, past backfilled + future live
```

- Credentials: the operator has already provisioned projects/environments/API keys. Config is
  endpoint + one API key per project, either repeated `--project <name>=<apiKey>` flags or a local
  `.loadgen.json` (gitignored — mirrors the existing root `SECRETS.md` convention for local-only
  operational secrets).
- `--backfill` and `--live` combine into one generated timeline spanning past+future (see Architecture
  §3) rather than two separate runs with duplicated logic.
- Live stdout stats: a periodic one-line summary (signals sent, current rate, active simulated
  incident, if any) every few seconds during a run.

## Error handling

Covered per-component in Architecture above (backfill concurrency cap, bounded retry/skip on send
failure, graceful degradation when the fake-target server is unreachable in remote mode — the scenario
continues without that outage window materializing, with a warning logged).

## Testing

- **Timeline generator**: pure unit tests. Given a fixed profile/duration/seed, assert deterministic
  beat output, correct incident-window placement, and trace/span coherence (shared `traceId`, spans
  matching the profile's declared service edges).
- **Executor**: unit tests against a mocked HTTP client — correct payload shape per beat kind, correct
  timestamp stamping in each mode, retry/backoff behavior on simulated failures. No real network.
- **Fake-target server**: focused in-process test (matching how other API tests in this repo spin up a
  real server instance) covering control-route auth and the up/down state flip.
- No Postgres/testcontainers tests needed — this package never touches the database directly, only the
  already-tested ingestion HTTP API.

## Decisions made during brainstorming

- **Target environments**: both local/Compose and remote production (`my.sigmon.app`). This is why the
  fake-target server needs a real deployment story, not just "run it on localhost."
- **Provisioning**: manual (operator pre-creates projects/environments/API keys). Rejected auto
  admin-login provisioning to avoid the tool ever touching an admin password.
- **Scenario control**: built-in named profiles + CLI flags, not a hand-written config file for v1.
  Lower friction to a first run; a config-file mode can be added later without changing the core
  architecture (it would just be another way to construct a `Profile` object).
- **Production isolation guardrail**: explicitly declined. No project-name-prefix enforcement. The
  operator is trusted to point the tool at dedicated demo projects themselves.
- **Package location**: new `packages/loadgen`, matching the precedent set by `@sigmon/mcp` (a
  bounded new capability gets its own package) rather than bolting onto the already-narrow `@sigmon/cli`.
- **Signal scope**: events, errors, traces+spans, LLM calls, identify, breadcrumbs. Explicitly excludes
  session replay, feedback, Web Vitals, click maps (browser-only, would need headless browser
  automation — a different, larger project if ever wanted).
- **Monitor-outage simulation is live-mode-only.** Monitors are inherently about real-time
  polling/check-ins; there is no ingestion path that accepts a historical monitor-check record, so
  backfilling a monitor "down" window has no meaningful implementation. This is a real constraint, not
  an oversight — documented so the implementation plan doesn't try to work around it.
