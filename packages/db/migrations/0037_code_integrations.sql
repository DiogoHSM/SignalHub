create table project_code_integrations (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  provider text not null check (provider in ('github', 'gitlab')),
  name text not null,
  owner text not null,
  repo text not null,
  web_base_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (project_id, provider, owner, repo)
);

create index project_code_integrations_project_idx
  on project_code_integrations(project_id)
  where revoked_at is null;

create table incident_external_links (
  id text primary key,
  project_id text not null,
  environment_id text not null,
  error_group_id text not null references error_groups(id) on delete cascade,
  integration_id text references project_code_integrations(id) on delete set null,
  provider text not null check (provider in ('github', 'gitlab')),
  external_key text not null,
  title text not null,
  url text not null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, environment_id) references environments(project_id, id) on delete cascade
);

create index incident_external_links_group_idx
  on incident_external_links(error_group_id, created_at desc);

create table release_metadata (
  id text primary key,
  project_id text not null,
  environment_id text not null,
  release text not null,
  integration_id text references project_code_integrations(id) on delete set null,
  commit_sha text,
  commit_url text,
  pull_request_number integer,
  pull_request_url text,
  deployed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, environment_id, release),
  foreign key (project_id, environment_id) references environments(project_id, id) on delete cascade
);

create index release_metadata_scope_idx
  on release_metadata(project_id, environment_id, release);
