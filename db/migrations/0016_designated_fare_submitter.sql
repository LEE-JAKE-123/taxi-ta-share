-- FR-50: a host may designate one escrow-confirmed participant to submit the
-- actual fare before the trip starts. The host remains an implicit submitter.

ALTER TABLE trip_groups
  ADD COLUMN fare_submitter_user_id uuid,
  ADD COLUMN fare_submitter_set_by uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN fare_submitter_idempotency_key uuid,
  ADD COLUMN fare_submitter_set_at timestamptz,
  ADD CONSTRAINT trip_groups_fare_submitter_participant_fk
    FOREIGN KEY (trip_id, fare_submitter_user_id)
    REFERENCES trip_participants(trip_id, user_id) ON DELETE RESTRICT,
  ADD CONSTRAINT trip_groups_fare_submitter_audit_valid CHECK (
    (fare_submitter_set_by IS NULL
      AND fare_submitter_idempotency_key IS NULL
      AND fare_submitter_set_at IS NULL)
    OR (
      fare_submitter_set_by IS NOT NULL
      AND fare_submitter_idempotency_key IS NOT NULL
      AND fare_submitter_set_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT trip_groups_fare_submitter_idempotent
    UNIQUE (fare_submitter_set_by, fare_submitter_idempotency_key);

CREATE INDEX trip_groups_fare_submitter_idx
  ON trip_groups (fare_submitter_user_id)
  WHERE fare_submitter_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_designated_fare_submitter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  participant_status text;
  participant_role text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'designated fare submitter can only be changed before departure'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.fare_submitter_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'designated fare submitter requires a confirmed trip'
      USING ERRCODE = '23514';
  END IF;

  SELECT p.status, p.role
  INTO participant_status, participant_role
  FROM trip_participants p
  WHERE p.trip_id = NEW.trip_id
    AND p.user_id = NEW.fare_submitter_user_id
  FOR SHARE;

  IF participant_status <> 'DEPOSITED'
    OR participant_role <> 'MEMBER'
  THEN
    RAISE EXCEPTION 'designated fare submitter must be a deposited member before departure'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_groups_validate_designated_fare_submitter ON trip_groups;
CREATE TRIGGER trip_groups_validate_designated_fare_submitter
BEFORE INSERT OR UPDATE OF fare_submitter_user_id ON trip_groups
FOR EACH ROW
EXECUTE FUNCTION validate_designated_fare_submitter();
