alter table error_groups
  add column priority text;

alter table error_groups
  add constraint error_groups_priority_check
  check (priority is null or priority in ('urgent', 'high', 'normal', 'low'));
