# @sigmon/loadgen

Synthetic telemetry generator for SignalMonitor. Generates realistic events, errors, traces+spans,
LLM calls, identify calls, and breadcrumbs for 2-3 fake services per project, with scripted
incidents (error-rate spikes, monitor outages), for demoing a fresh install, stress-testing the
ingestion pipeline, and prototyping console visualizations against real multi-service data.

Design spec: `docs/superpowers/specs/2026-08-28-loadgen-synthetic-telemetry-engine-design.md`.

## Setup

You provision the projects/environments/API keys yourself (console or Admin API) — this tool never
logs in as admin. Create a `.loadgen.json`:

```json
{
  "endpoint": "https://my.sigmon.app",
  "projects": [
    { "name": "demo-ecommerce", "apiKey": "shsk_..." }
  ],
  "monitors": {
    "heartbeat": [
      { "projectIndex": 0, "serviceName": "fraud-check", "monitorId": "mon_...", "secret": "..." }
    ],
    "http": [
      { "projectIndex": 0, "serviceName": "checkout", "controlUrl": "https://your-fake-target-host", "controlToken": "..." }
    ]
  }
}
```

`monitors` is optional — omit it and incident templates that target a monitor simply skip that
side effect while still producing their error-rate/LLM-cost effect.

## Usage

```sh
# Backfill 7 days of history instantly, no live run
sigmon-loadgen run --profile fintech --projects 2 --backfill 7d

# Run live for 2 hours (soak / stress test)
sigmon-loadgen run --profile ecommerce --projects 3 --live 2h

# Backfill 3 days of history, then keep running live for 1 hour
sigmon-loadgen run --profile saas-b2b --backfill 3d --live 1h
```

Built-in profiles: `ecommerce`, `fintech`, `saas-b2b`.

## Fake HTTP-monitor target

Only needed if a profile's incident has `monitorKind: "http"` and you want that outage to actually
flip a real Sigmon HTTP monitor. Run it wherever the Sigmon worker can reach it — locally for
local/Compose testing, or as a small deployed service (see `.claude/docs/DEPLOYMENT.md`) for
outage simulation against a remote/production Sigmon instance:

```sh
LOADGEN_CONTROL_TOKEN=<token> PORT=8090 sigmon-loadgen-fake-target
```

Point the Sigmon HTTP monitor's URL at `http://<host>:8090/t/<serviceName>`. The executor flips it
between healthy (200) and down (503) via `POST /control/<serviceName>` at the start/end of the
outage window.

## Limitations

Monitor-outage simulation (both HTTP and heartbeat) only takes effect for windows that fall in the
run's live portion — Sigmon has no ingestion path for a historical monitor-check record, so a
`--backfill`-only run cannot simulate a monitor outage in the past. See the design spec for why.
