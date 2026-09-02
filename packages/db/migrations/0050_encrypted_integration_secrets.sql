alter table warehouse_destinations
  alter column connection_url drop not null,
  add column connection_url_encrypted text,
  add column connection_url_preview text;

alter table notification_channels
  add column url_encrypted text,
  add column url_preview text,
  add column secret_header_value_encrypted text;

alter table notification_channels drop constraint notification_channels_shape_check;
alter table notification_channels
  add constraint notification_channels_shape_check check (
    (type in ('webhook', 'slack', 'discord')
      and ((url is not null and url_encrypted is null) or (url is null and url_encrypted is not null))
      and jsonb_array_length(email_recipients) = 0)
    or
    (type = 'email' and url is null and url_encrypted is null and url_preview is null
      and jsonb_array_length(email_recipients) > 0
      and secret_header_name is null and secret_header_value is null
      and secret_header_value_encrypted is null)
  );
