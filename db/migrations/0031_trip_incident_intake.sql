-- DEC-015: incident intake is evidence only. It must not alter attendance,
-- escrow, settlement, balances, or enforcement; resolution is a later,
-- separately audited append-only workflow.

CREATE TABLE trip_incidents (
  incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  reporter_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reported_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  incident_type text NOT NULL,
  description text NOT NULL,
  evidence_ref text,
  idempotency_key uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_incidents_reporter_participation_fk
    FOREIGN KEY (trip_id, reporter_user_id)
    REFERENCES trip_participants(trip_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT trip_incidents_reported_participation_fk
    FOREIGN KEY (trip_id, reported_user_id)
    REFERENCES trip_participants(trip_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT trip_incidents_not_self CHECK (reporter_user_id <> reported_user_id),
  CONSTRAINT trip_incidents_type_valid CHECK (
    incident_type IN ('HOST_NO_START', 'MEMBER_NO_SHOW')
  ),
  CONSTRAINT trip_incidents_description_valid CHECK (
    btrim(description) <> '' AND char_length(description) BETWEEN 10 AND 2000
  ),
  CONSTRAINT trip_incidents_evidence_valid CHECK (
    evidence_ref IS NULL
    OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 2000)
  ),
  CONSTRAINT trip_incidents_idempotent UNIQUE (reporter_user_id, idempotency_key)
);

CREATE INDEX trip_incidents_trip_submitted_idx
  ON trip_incidents (trip_id, submitted_at DESC, incident_id);

CREATE INDEX trip_incidents_reported_submitted_idx
  ON trip_incidents (reported_user_id, submitted_at DESC, incident_id);

CREATE INDEX trip_incidents_intake_queue_idx
  ON trip_incidents (submitted_at, incident_id);

CREATE FUNCTION validate_trip_incident_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_host_user_id uuid;
BEGIN
  SELECT host_user_id
  INTO trip_host_user_id
  FROM trip_groups
  WHERE trip_id = NEW.trip_id
  FOR SHARE;

  IF NOT FOUND
    OR (NEW.incident_type = 'HOST_NO_START'
      AND NEW.reported_user_id <> trip_host_user_id)
    OR (NEW.incident_type = 'MEMBER_NO_SHOW'
      AND NEW.reported_user_id = trip_host_user_id)
  THEN
    RAISE EXCEPTION 'trip incident subject does not match its incident type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_incidents_validate_shape
BEFORE INSERT ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION validate_trip_incident_shape();

CREATE FUNCTION prevent_trip_incident_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip incidents are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_incidents_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION prevent_trip_incident_mutation();
