alter table events
  add column if not exists replay_id text;

create index if not exists events_scope_replay_idx
  on events(project_id, environment_id, replay_id, timestamp desc, id desc)
  where replay_id is not null;
