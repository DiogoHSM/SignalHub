ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_type_check;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_type_check CHECK (type IN ('webhook', 'email', 'slack', 'discord'));

ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_shape_check;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_shape_check CHECK (
    (type IN ('webhook', 'slack', 'discord') AND url IS NOT NULL AND jsonb_array_length(email_recipients) = 0)
    OR
    (type = 'email' AND url IS NULL AND jsonb_array_length(email_recipients) > 0
      AND secret_header_name IS NULL AND secret_header_value IS NULL)
  );
