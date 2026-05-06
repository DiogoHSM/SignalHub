# Phase 4A Operational Safety Design

## Summary

Add the first Phase 4 operational maturity slice: configurable telemetry retention plus a self-health view for the SignalHub installation. This phase makes the self-hosted core safer to run for multiple projects before adding alert rules and notification channels.

The work stays inside the existing self-hosted architecture: Fastify API, worker, Postgres, Redis, BullMQ, and the React console. It does not introduce SaaS workspace assumptions, hosted control planes, external schedulers, or new paid infrastructure.

## Goals

- Add safe default retention windows for existing telemetry tables.
- Let operators configure retention through environment variables.
- Run retention cleanup from the worker process on a predictable schedule.
- Record retention execution history so cleanup is auditable.
- Expose self-health data for API, worker, Postgres, Redis, queue state, and ingestion freshness.
- Add a console view that helps an operator understand whether the installation is healthy.
- Keep the implementation easy to install and operate in Docker Compose.
- Preserve project/environment isolation for freshness and telemetry-derived health data.

## Non-Goals

- Alert rules.
- Notification channels.
- Alert history.
- Custom retention policies per project, environment, tenant, or signal name.
- Retention UI editing.
- Rollups, daily aggregations, materialized views, or data warehouse adapters.
- Log ingestion or log retention.
- Backups.
- ClickHouse or object storage.
- Distributed locks outside Postgres.
- Multi-node scheduling guarantees beyond safe best effort.

## Approach Options

### Recommended: Worker-owned retention plus API self-health

The worker owns scheduled cleanup because it already handles background operational work and depends on both Redis and Postgres. The API exposes read-only health details by querying Postgres, Redis/BullMQ, and retention history. The console renders those details in a new operational health panel.

This is the best fit for a self-hosted MVP: one installation, no extra services, predictable Docker Compose behavior, and a clear path to alerts later.

### Alternative: API-owned retention

The API could run cleanup on an interval. This is simpler to discover in development, but it mixes request serving with destructive background work and makes API restarts more operationally sensitive.

### Alternative: External cron

A separate cron container could call a cleanup endpoint or run a script. This is operationally explicit, but it adds one more component for self-hosters to understand before SignalHub has enough maturity to justify it.

## Retention Policy

Retention is configured through environment variables with conservative PRD-aligned defaults:

```txt
RETENTION_ENABLED=true
RETENTION_INTERVAL_MINUTES=60
RETENTION_BATCH_SIZE=1000
RETENTION_EVENTS_DAYS=90
RETENTION_ERRORS_DAYS=180
RETENTION_TRACES_DAYS=90
RETENTION_SPANS_DAYS=90
RETENTION_LLM_CALLS_DAYS=180
```

`RETENTION_ENABLED=false` disables scheduled deletion but keeps manual health reporting available.

The first implementation applies one global policy to all projects and environments. Per-project retention is deferred until the product has project-level operational settings and a stronger permissions model.

## Cleanup Semantics

Retention deletes telemetry records older than the configured window for each signal table:

- `events`: by `timestamp`.
- `errors`: by `timestamp`.
- `traces`: by `timestamp`, matching the existing query indexes and timeline semantics.
- `spans`: by `timestamp`, matching the existing query indexes and trace detail semantics.
- `llm_calls`: by `timestamp`.

Cleanup runs in bounded batches to avoid long table locks and unexpected resource spikes on small self-hosted machines. A single retention run may loop through multiple batches per table, but each delete statement should be bounded by `RETENTION_BATCH_SIZE`.

Retention must never delete operational tables:

- `users`
- `projects`
- `environments`
- `api_keys`

Retention must be idempotent. Running it twice should either delete additional eligible rows or no rows.

## Retention History

Add a small operational table:

```txt
retention_runs
```

Fields:

- `id`
- `started_at`
- `finished_at`
- `status`: `success` or `failed`
- `error_message`
- deleted row counts per signal table
- effective retention days per signal table
- `created_at`

This table is operational metadata, not telemetry. It should not be covered by telemetry retention.

The worker writes one row per retention run. Failed runs should preserve the error message in sanitized form and should not crash the worker process permanently.

## Worker Scheduling

The worker starts a retention scheduler when `RETENTION_ENABLED=true`.

Scheduling rules:

- Run once shortly after worker startup.
- Then run every `RETENTION_INTERVAL_MINUTES`.
- Do not overlap runs inside the same process.
- If a run is still active when the next interval fires, skip that interval and record no new run.

Multi-worker safety:

- The first implementation uses a Postgres advisory lock around the retention run.
- If another worker holds the lock, skip the run.
- This avoids duplicate cleanup work when a self-hosted operator scales workers later.

## Self-Health API

Add one authenticated read-only endpoint:

```txt
GET /system/health
```

This route requires a human session. It is not public like `/health` and `/ready`.

Response shape:

```ts
type SystemHealthResponse = {
  generatedAt: string;
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    api: {
      status: "healthy";
      uptimeSeconds: number;
    };
    postgres: {
      status: "healthy" | "unhealthy";
      latencyMs: number | null;
    };
    redis: {
      status: "healthy" | "unhealthy";
      latencyMs: number | null;
    };
    worker: {
      status: "healthy" | "degraded" | "unhealthy";
      lastHeartbeatAt: string | null;
    };
  };
  queues: {
    telemetry: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  };
  ingestion: {
    lastEventAt: string | null;
    lastErrorAt: string | null;
    lastTraceAt: string | null;
    lastSpanAt: string | null;
    lastLlmCallAt: string | null;
  };
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    lastRun: {
      id: string;
      status: "success" | "failed";
      startedAt: string;
      finishedAt: string | null;
      deleted: {
        events: number;
        errors: number;
        traces: number;
        spans: number;
        llmCalls: number;
      };
      errorMessage: string | null;
    } | null;
    policy: {
      eventsDays: number;
      errorsDays: number;
      tracesDays: number;
      spansDays: number;
      llmCallsDays: number;
    };
  };
};
```

## Health Status Rules

Overall status:

- `unhealthy` if Postgres or Redis is unhealthy.
- `unhealthy` if the queue cannot be inspected.
- `degraded` if the worker heartbeat is stale.
- `degraded` if the most recent retention run failed.
- `healthy` otherwise.

Worker heartbeat:

- Add a lightweight `system_heartbeats` table keyed by component name.
- The worker updates its heartbeat on an interval.
- The worker heartbeat interval is 30 seconds.
- The API treats the worker as stale when the heartbeat is older than 150 seconds.

Queue health:

- Use BullMQ queue counts for telemetry queue status.
- Failed jobs are visible as counts only in this phase.
- Detailed failed job inspection is deferred.

Ingestion freshness:

- Compute latest timestamps from existing telemetry tables.
- Return `null` for tables with no data.
- Do not make empty installations unhealthy just because no telemetry has arrived yet.

## Console UX

Add a read-only operational health panel in the console.

Recommended placement:

```txt
Setup | Overview | Investigate | System
```

The `System` mode includes:

- Overall installation status.
- Service tiles for API, worker, Postgres, and Redis.
- Telemetry queue counts.
- Ingestion freshness by signal type.
- Retention status, policy, last run status, and deleted row counts.

The UI should be quiet and operational. It should avoid marketing copy, decorative visuals, and complex charts. Operators need quick scanning and clear degraded/unhealthy states.

No settings should be editable in this slice. The panel should point to environment variable names where useful, but not include long setup instructions inside the app.

## Error Handling

API:

- If self-health dependencies fail partially, return a `200` with degraded or unhealthy component status when enough information is available.
- If the health route itself cannot build a response, return `503 system_health_unavailable`.
- Do not expose secrets or raw Redis/Postgres connection strings.

Worker:

- Retention failures are recorded in `retention_runs`.
- A failed retention run should not stop telemetry processing.
- Invalid retention configuration should fail fast on startup with a clear configuration error.

Console:

- Show retry state if `/system/health` fails.
- Treat stale responses defensively when switching console modes.
- Keep empty-state copy short for fresh installations.

## Testing

Backend tests:

- Retention config defaults and validation.
- Retention deletion by table and window.
- Batch deletion behavior.
- Idempotent retention runs.
- Retention history success and failure records.
- Advisory-lock skip behavior.
- `/system/health` status mapping for healthy, degraded, and unhealthy dependencies.
- Queue-count response mapping.
- Worker heartbeat freshness rules.

Console tests:

- `System` mode loads lazily.
- Healthy state renders all service tiles.
- Degraded retention state renders last failure.
- Queue counts render.
- Empty ingestion freshness renders without marking the install unhealthy.
- Retry state works.

Verification:

- `pnpm test`
- `pnpm build`
- `docker compose config --quiet`

## Rollout

Implementation order:

1. Add config values and validation.
2. Add migrations for retention history and heartbeat metadata.
3. Add repository functions for retention, heartbeats, queue health, and ingestion freshness.
4. Add worker retention scheduling and heartbeat updates.
5. Add authenticated `/system/health`.
6. Add console client types and API method.
7. Add `System` console mode and health panel.
8. Update docs, memory, and environment examples.

## Acceptance Criteria

- A default Docker Compose installation can run retention without extra services.
- Operators can disable retention through environment configuration.
- Old telemetry rows are deleted according to configured windows, in bounded batches.
- Retention runs are auditable through stored history.
- The console shows API, worker, Postgres, Redis, queue, ingestion freshness, and retention status.
- A fresh installation with no telemetry can still be healthy.
- A stale worker heartbeat marks the system degraded.
- A failed retention run marks the system degraded and shows the last failure.
- Tests, build, and Compose config verification pass.
