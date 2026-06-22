ALTER TABLE error_groups ADD COLUMN assigned_to_user_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE error_groups ADD COLUMN silenced_until timestamptz;
ALTER TABLE error_groups ADD COLUMN incident_number text;

CREATE SEQUENCE IF NOT EXISTS incident_number_seq;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM error_groups WHERE incident_number IS NULL ORDER BY created_at, id LOOP
    UPDATE error_groups
    SET incident_number = 'INC-' || lpad(nextval('incident_number_seq')::text, 4, '0')
    WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE error_groups ADD CONSTRAINT error_groups_incident_number_unique UNIQUE (incident_number);

CREATE OR REPLACE FUNCTION assign_incident_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.incident_number IS NULL THEN
    NEW.incident_number := 'INC-' || lpad(nextval('incident_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER error_groups_assign_incident_number
BEFORE INSERT ON error_groups
FOR EACH ROW EXECUTE FUNCTION assign_incident_number();

CREATE TABLE triage_notes (
  id text PRIMARY KEY,
  error_group_id text NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  author_user_id text REFERENCES users(id) ON DELETE SET NULL,
  author_email text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX triage_notes_group_created_idx ON triage_notes (error_group_id, created_at);
