alter table errors
  add column if not exists replay_id text;

create table if not exists session_replays (
  id text primary key,
  replay_id text not null,
  project_id text not null references projects(id) on delete cascade,
  environment_id text not null references environments(id) on delete cascade,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  source text,
  release text,
  metadata jsonb not null default '{}'::jsonb,
  route text,
  error_id text,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms integer,
  event_count integer not null default 0,
  masked boolean not null default true,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(project_id, environment_id, replay_id)
);

create index if not exists session_replays_scope_started_idx
  on session_replays(project_id, environment_id, started_at desc, id desc);

create index if not exists session_replays_scope_error_idx
  on session_replays(project_id, environment_id, error_id)
  where error_id is not null;

create index if not exists session_replays_scope_session_idx
  on session_replays(project_id, environment_id, session_id, started_at desc)
  where session_id is not null;

create index if not exists errors_scope_replay_idx
  on errors(project_id, environment_id, replay_id)
  where replay_id is not null;
