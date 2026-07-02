create table data_governance_policies (
  project_id text not null references projects(id) on delete cascade,
  environment_id text not null,
  retention_policy jsonb not null default '{}'::jsonb,
  property_rules jsonb not null default '[]'::jsonb,
  updated_by_user_id text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, environment_id),
  foreign key (project_id, environment_id) references environments(project_id, id) on delete cascade
);
