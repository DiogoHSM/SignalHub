alter table warehouse_destinations
  alter column connection_url drop not null,
  add column connection_url_encrypted text,
  add column connection_url_preview text;

alter table notification_channels
  add column secret_header_value_encrypted text;
