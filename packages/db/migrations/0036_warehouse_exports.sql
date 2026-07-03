create table warehouse_destinations (
  id text primary key,
  project_id text not null,
  environment_id text not null,
  name text not null,
  destination_type text not null check (destination_type in ('postgres')),
  connection_url text not null,
  datasets jsonb not null default '[]'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  batch_size integer not null default 500 check (batch_size between 1 and 5000),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (project_id, environment_id) references environments(project_id, id) on delete cascade
);

create index warehouse_destinations_scope_idx
  on warehouse_destinations(project_id, environment_id)
  where archived_at is null;

create index warehouse_destinations_enabled_idx
  on warehouse_destinations(enabled, archived_at)
  where archived_at is null;

create table warehouse_export_runs (
  id text primary key,
  destination_id text not null references warehouse_destinations(id) on delete cascade,
  project_id text not null,
  environment_id text not null,
  trigger text not null check (trigger in ('scheduled', 'manual', 'retry')),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz,
  cursor_before jsonb not null default '{}'::jsonb,
  cursor_after jsonb not null default '{}'::jsonb,
  exported jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (project_id, environment_id) references environments(project_id, id) on delete cascade
);

create index warehouse_export_runs_destination_idx
  on warehouse_export_runs(destination_id, started_at desc);
