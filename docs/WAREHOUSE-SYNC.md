# Warehouse Sync

Warehouse sync exports selected SignalMonitor telemetry into an external Postgres database for analytical access.

## Scope

The first destination type is `postgres`. A destination is scoped to one project and environment and can export:

- `events`
- `errors`
- `traces`
- `llmCalls`

Each dataset uses an incremental cursor with `{ timestamp, id }` so repeated timestamps do not skip rows. Runs are idempotent at the destination because rows are upserted by `(dataset, source_id)`.

## Destination Schema

The scheduler creates a landing table in the destination database when needed:

```sql
create table if not exists sigmon_telemetry_export (
  dataset text not null,
  source_id text not null,
  project_id text not null,
  environment_id text not null,
  occurred_at timestamptz not null,
  received_at timestamptz,
  payload jsonb not null,
  exported_at timestamptz not null default now(),
  primary key (dataset, source_id)
);
```

`payload` contains the full source row as JSON. Downstream warehouses can materialize typed tables from this landing table.

## Operation

Use Console -> Project Settings -> Warehouse sync to:

- Create a Postgres destination.
- Select datasets.
- Set batch size.
- Pause or resume a destination.
- Trigger a manual export.
- Review recent export runs and failures.

The raw connection URL is write-only. The API and console return a redacted preview.

The scheduler evaluates warehouse exports when:

```dotenv
WAREHOUSE_EXPORTS_ENABLED=true
WAREHOUSE_EXPORTS_INTERVAL_MINUTES=15
```

The scheduler service must have network access to the destination Postgres database.
