alter table api_keys add column capability text not null default 'browser';
alter table api_keys add constraint api_keys_capability_check check (capability in ('browser', 'server'));
