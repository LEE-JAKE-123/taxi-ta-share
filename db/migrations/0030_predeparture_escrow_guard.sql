-- DEC-015 / FR-18~19 / FR-33~34 / TR-02~03:
-- Escrow may only be created and confirmed before the trip departure time.
-- `clock_timestamp()` is intentional: a transaction that crosses the cutoff
-- must fail at the actual write/commit boundary, not at transaction start.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM trip_groups g
    JOIN trip_deposits d ON d.trip_id = g.trip_id
    WHERE g.status = 'CLOSED'
      AND g.departure_at <= clock_timestamp()
  ) THEN
    RAISE EXCEPTION
      '0030 refused: late CLOSED-trip deposits require append-only refund recovery'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION assert_predeparture_closed_escrow(target_trip_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_departure_at timestamptz;
BEGIN
  SELECT status, departure_at
  INTO trip_status, trip_departure_at
  FROM trip_groups
  WHERE trip_id = target_trip_id
  FOR UPDATE;

  IF NOT FOUND
    OR trip_status <> 'CLOSED'
    OR trip_departure_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION 'escrow requires a closed trip before departure'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION validate_trip_deposit_predeparture()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_predeparture_closed_escrow(NEW.trip_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_deposits_validate_predeparture
BEFORE INSERT ON trip_deposits
FOR EACH ROW
EXECUTE FUNCTION validate_trip_deposit_predeparture();

CREATE FUNCTION validate_deposit_ledger_predeparture()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entry_type = 'DEPOSIT' THEN
    PERFORM assert_predeparture_closed_escrow(NEW.trip_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Alphabetical trigger ordering executes this guard before the existing
-- point_ledger_validate_sprint6 trigger for the same INSERT event.
CREATE TRIGGER a_point_ledger_validate_deposit_predeparture
BEFORE INSERT ON point_ledger
FOR EACH ROW
WHEN (NEW.entry_type = 'DEPOSIT')
EXECUTE FUNCTION validate_deposit_ledger_predeparture();

CREATE FUNCTION validate_participant_deposit_predeparture()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'DEPOSITED'
    AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    PERFORM assert_predeparture_closed_escrow(NEW.trip_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER a_trip_participants_validate_deposit_predeparture
BEFORE UPDATE OF status ON trip_participants
FOR EACH ROW
EXECUTE FUNCTION validate_participant_deposit_predeparture();

CREATE FUNCTION validate_trip_confirmation_predeparture()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'CLOSED'
    AND NEW.status = 'CONFIRMED'
    AND NEW.departure_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION 'trip confirmation requires departure in the future'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Deferred validation protects transactions that begin before departure but
-- reach COMMIT after it. The whole escrow transaction rolls back on failure.
CREATE CONSTRAINT TRIGGER trip_groups_validate_confirmation_predeparture
AFTER UPDATE OF status ON trip_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_trip_confirmation_predeparture();

CREATE OR REPLACE FUNCTION enforce_trip_closure_participant_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  confirmed_count integer;
  has_deposit boolean;
BEGIN
  IF NEW.status NOT IN ('CLOSED', 'EXPIRED') THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
  INTO confirmed_count
  FROM trip_participants
  WHERE trip_id = NEW.trip_id
    AND status IN (
      'APPROVED', 'DEPOSITED', 'CHECKED_IN',
      'NO_SHOW', 'DISPUTED', 'COMPLETED'
    );

  IF NEW.status = 'CLOSED' AND confirmed_count < 2 THEN
    RAISE EXCEPTION 'closed trip requires at least two confirmed participants'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'EXPIRED' AND confirmed_count >= 2 THEN
    SELECT EXISTS (
      SELECT 1 FROM trip_deposits WHERE trip_id = NEW.trip_id
    ) INTO has_deposit;

    IF NEW.departure_at > clock_timestamp() OR has_deposit THEN
      RAISE EXCEPTION 'expired trip requires fewer than two confirmed participants or an unescrowed elapsed departure'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
