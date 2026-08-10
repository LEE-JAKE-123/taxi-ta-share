-- Confirmed-cohort settlement correction.
-- Forward-only: historical BOARDED settlements and append-only ledger entries
-- remain unchanged; every new settlement must use the escrow-confirmed cohort.

CREATE OR REPLACE FUNCTION validate_trip_settlement_participant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_deposit integer;
  expected_share integer;
  expected_basis text;
BEGIN
  SELECT d.amount, s.final_share, s.cohort_basis
  INTO expected_deposit, expected_share, expected_basis
  FROM trip_deposits d
  JOIN trip_settlements s ON s.trip_id = d.trip_id
  WHERE d.trip_id = NEW.trip_id
    AND d.user_id = NEW.user_id
  FOR SHARE OF d, s;

  IF NOT FOUND
    OR expected_basis <> 'ESCROW_CONFIRMED'
    OR NEW.deposit_amount <> expected_deposit
    OR NEW.final_share <> expected_share
  THEN
    RAISE EXCEPTION 'settlement participant must match the escrow-confirmed cohort'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO trip_settlement_participants (
  trip_id, user_id, deposit_amount, final_share
)
SELECT s.trip_id, d.user_id, d.amount, s.final_share
FROM trip_settlements s
JOIN trip_deposits d ON d.trip_id = s.trip_id
WHERE s.cohort_basis = 'ESCROW_CONFIRMED'
  AND NOT EXISTS (
    SELECT 1
    FROM trip_settlement_participants sp
    WHERE sp.trip_id = s.trip_id AND sp.user_id = d.user_id
  );

CREATE OR REPLACE FUNCTION validate_fare_dispute_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  settlement_status text;
  submitted_by uuid;
  confirmation_deadline timestamptz;
  has_confirmation boolean;
BEGIN
  SELECT g.status, s.status, s.submitted_by, s.confirmation_deadline,
         EXISTS (
           SELECT 1
           FROM fare_confirmations c
           WHERE c.trip_id = NEW.trip_id AND c.user_id = NEW.user_id
         )
  INTO trip_status, settlement_status, submitted_by, confirmation_deadline,
       has_confirmation
  FROM trip_groups g
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  JOIN trip_deposits d
    ON d.trip_id = g.trip_id
   AND d.user_id = NEW.user_id
  WHERE g.trip_id = NEW.trip_id
  -- Both confirmation and dispute submissions take the same exclusive lock so
  -- they cannot each observe an empty opposite record and commit together.
  FOR UPDATE OF g, s, d;

  IF NOT FOUND
    OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_status <> 'PENDING_CONFIRMATION'
    OR submitted_by = NEW.user_id
    OR confirmation_deadline <= now()
    OR has_confirmation
  THEN
    RAISE EXCEPTION 'fare dispute requires a pending settlement participant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fare_disputes_validate_submission ON fare_disputes;
CREATE TRIGGER fare_disputes_validate_submission
BEFORE INSERT ON fare_disputes
FOR EACH ROW
EXECUTE FUNCTION validate_fare_dispute_submission();

CREATE OR REPLACE FUNCTION validate_fare_confirmation_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  settlement_status text;
  confirmation_deadline timestamptz;
  has_open_dispute boolean;
  has_existing_confirmation boolean;
BEGIN
  SELECT g.status, s.status, s.confirmation_deadline,
         EXISTS (
           SELECT 1
           FROM fare_disputes d
           WHERE d.trip_id = NEW.trip_id
             AND d.user_id = NEW.user_id
             AND d.status = 'OPEN'
         ),
         EXISTS (
           SELECT 1
           FROM fare_confirmations c
           WHERE c.trip_id = NEW.trip_id AND c.user_id = NEW.user_id
         )
  INTO trip_status, settlement_status, confirmation_deadline, has_open_dispute,
       has_existing_confirmation
  FROM trip_groups g
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  JOIN trip_deposits d
    ON d.trip_id = g.trip_id
   AND d.user_id = NEW.user_id
  WHERE g.trip_id = NEW.trip_id
  -- Serialize the mutually exclusive confirmation/dispute decision per trip.
  FOR UPDATE OF g, s, d;

  IF has_existing_confirmation THEN
    RETURN NEW;
  END IF;

  IF NOT FOUND
    OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_status <> 'PENDING_CONFIRMATION'
    OR confirmation_deadline <= now()
    OR has_open_dispute
  THEN
    RAISE EXCEPTION 'fare confirmation requires an undisputed pending settlement participant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fare_confirmations_validate_submission ON fare_confirmations;
CREATE TRIGGER fare_confirmations_validate_submission
BEFORE INSERT ON fare_confirmations
FOR EACH ROW
EXECUTE FUNCTION validate_fare_confirmation_submission();

CREATE OR REPLACE FUNCTION validate_boarded_settlement_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_host uuid;
  trip_status text;
  settlement_status text;
  cohort_basis text;
  deposit_amount integer;
  share_amount integer;
  is_confirmed_cohort boolean;
BEGIN
  IF NEW.entry_type NOT IN (
    'SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT g.host_user_id, g.status, s.status, s.cohort_basis, d.amount,
         s.final_share, sp.user_id IS NOT NULL
  INTO trip_host, trip_status, settlement_status, cohort_basis,
       deposit_amount, share_amount, is_confirmed_cohort
  FROM trip_groups g
  JOIN trip_deposits d
    ON d.trip_id = g.trip_id
   AND d.user_id = NEW.user_id
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  LEFT JOIN trip_settlement_participants sp
    ON sp.trip_id = d.trip_id
   AND sp.user_id = d.user_id
  WHERE g.trip_id = NEW.trip_id
  FOR SHARE OF g, d, s;

  IF NOT FOUND
    OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_status <> 'PENDING_CONFIRMATION'
    OR cohort_basis <> 'ESCROW_CONFIRMED'
    OR is_confirmed_cohort IS DISTINCT FROM true
    OR NEW.actor_user_id <> trip_host
    OR (
      NEW.entry_type = 'SETTLEMENT_CHARGE'
      AND (
        NEW.available_delta <> 0
        OR NEW.held_delta <> -least(deposit_amount, share_amount)
      )
    )
    OR (
      NEW.entry_type = 'REFUND'
      AND (
        deposit_amount <= share_amount
        OR NEW.available_delta <> deposit_amount - share_amount
        OR NEW.held_delta <> -NEW.available_delta
      )
    )
    OR (
      NEW.entry_type = 'ADDITIONAL_DEBIT'
      AND (
        deposit_amount >= share_amount
        OR NEW.available_delta <> -(share_amount - deposit_amount)
        OR NEW.held_delta <> 0
      )
    )
  THEN
    RAISE EXCEPTION 'settlement ledger entry does not match the confirmed cohort'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_demo_settlement_cohort()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_host uuid;
  cohort_count integer;
BEGIN
  SELECT status, host_user_id
  INTO trip_status, trip_host
  FROM trip_groups
  WHERE trip_id = NEW.trip_id
  FOR SHARE;

  SELECT count(*) INTO cohort_count
  FROM trip_deposits
  WHERE trip_id = NEW.trip_id;

  IF trip_status <> 'IN_PROGRESS'
    OR NEW.submitted_by <> trip_host
    OR NEW.cohort_basis <> 'ESCROW_CONFIRMED'
    OR cohort_count NOT BETWEEN 2 AND 4
    OR NEW.participant_count <> cohort_count
    OR NEW.final_share <> ceil(NEW.actual_fare::numeric / cohort_count)::integer
  THEN
    RAISE EXCEPTION 'settlement must use the in-progress escrow-confirmed cohort'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
