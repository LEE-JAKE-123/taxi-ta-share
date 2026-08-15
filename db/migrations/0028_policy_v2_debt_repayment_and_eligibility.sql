-- FR-30~40, FR-52~54, TR-01~03: debt is repaid only by an auditable point
-- ledger debit, and debt/open-dispute eligibility is enforced at the DB edge.
ALTER TABLE point_debt_events
  ADD COLUMN repayment_ledger_id uuid
    REFERENCES point_ledger(ledger_id) ON DELETE RESTRICT,
  ADD CONSTRAINT point_debt_events_repayment_ledger_shape CHECK (
    (event_type = 'REPAYMENT' AND repayment_ledger_id IS NOT NULL)
    OR (event_type <> 'REPAYMENT' AND repayment_ledger_id IS NULL)
  );

CREATE UNIQUE INDEX point_debt_events_repayment_ledger_unique_idx
  ON point_debt_events (repayment_ledger_id)
  WHERE repayment_ledger_id IS NOT NULL;

ALTER TABLE point_ledger
  DROP CONSTRAINT point_ledger_entry_type_valid,
  DROP CONSTRAINT point_ledger_shape_valid,
  DROP CONSTRAINT point_ledger_actor_or_system_command_valid,
  ADD CONSTRAINT point_ledger_entry_type_valid CHECK (entry_type IN (
    'ADMIN_GRANT', 'DEPOSIT', 'SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT',
    'FARE_ADJUSTMENT_REFUND', 'FARE_ADJUSTMENT_DEBIT', 'DEBT_REPAYMENT'
  )),
  ADD CONSTRAINT point_ledger_shape_valid CHECK (
    (entry_type = 'ADMIN_GRANT' AND available_delta > 0 AND held_delta = 0 AND trip_id IS NULL)
    OR (entry_type = 'DEPOSIT' AND available_delta < 0 AND held_delta = -available_delta AND trip_id IS NOT NULL)
    OR (entry_type = 'SETTLEMENT_CHARGE' AND available_delta = 0 AND held_delta < 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'REFUND' AND available_delta > 0 AND held_delta = -available_delta AND trip_id IS NOT NULL)
    OR (entry_type = 'ADDITIONAL_DEBIT' AND available_delta < 0 AND held_delta = 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'FARE_ADJUSTMENT_REFUND' AND available_delta > 0 AND held_delta = 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'FARE_ADJUSTMENT_DEBIT' AND available_delta < 0 AND held_delta = 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'DEBT_REPAYMENT' AND available_delta < 0 AND held_delta = 0 AND trip_id IS NOT NULL)
  ),
  ADD CONSTRAINT point_ledger_actor_or_system_command_valid CHECK (
    (
      policy_v2_adjustment_command_id IS NOT NULL
      AND actor_user_id IS NOT NULL
      AND system_deadline_command_id IS NULL
      AND entry_type IN ('FARE_ADJUSTMENT_REFUND', 'FARE_ADJUSTMENT_DEBIT')
    )
    OR (
      policy_v2_adjustment_command_id IS NULL
      AND (
        (actor_user_id IS NOT NULL AND system_deadline_command_id IS NULL)
        OR (
          actor_user_id IS NULL
          AND system_deadline_command_id IS NOT NULL
          AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION validate_point_debt_repayment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger_user uuid;
  ledger_trip uuid;
  ledger_actor uuid;
  ledger_amount integer;
  debt_trip uuid;
BEGIN
  IF NEW.event_type <> 'REPAYMENT' THEN RETURN NEW; END IF;
  SELECT l.user_id, l.trip_id, l.actor_user_id, l.available_delta, o.trip_id
  INTO ledger_user, ledger_trip, ledger_actor, ledger_amount, debt_trip
  FROM point_ledger l
  JOIN point_debt_obligations o ON o.debt_id = NEW.debt_id
  WHERE l.ledger_id = NEW.repayment_ledger_id
  FOR SHARE OF l, o;
  IF NOT FOUND OR ledger_user <> NEW.user_id OR ledger_trip <> debt_trip
    OR ledger_actor IS DISTINCT FROM NEW.actor_user_id
    OR ledger_amount <> NEW.debt_delta
    OR ledger_amount >= 0
    OR NEW.policy_v2_adjustment_command_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'debt repayment requires a matching append-only repayment ledger entry'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_debt_events_validate_repayment
BEFORE INSERT ON point_debt_events
FOR EACH ROW EXECUTE FUNCTION validate_point_debt_repayment();

CREATE OR REPLACE FUNCTION guard_policy_v2_usage_eligibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user uuid;
  open_dispute_count integer;
  has_uncontested_debt boolean;
BEGIN
  IF TG_TABLE_NAME = 'trip_groups' THEN
    target_user := NEW.host_user_id;
  ELSIF TG_TABLE_NAME = 'trip_participants' THEN
    IF TG_OP = 'UPDATE' AND NEW.status NOT IN ('APPLIED', 'APPROVED') THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('APPLIED', 'APPROVED') THEN RETURN NEW; END IF;
    target_user := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'trip_deposits' THEN
    target_user := NEW.user_id;
  END IF;
  PERFORM 1 FROM users WHERE user_id = target_user FOR UPDATE;
  SELECT count(*)::int INTO open_dispute_count
  FROM fare_disputes WHERE user_id = target_user AND status = 'OPEN';
  SELECT EXISTS (
    SELECT 1 FROM point_debt_obligations d
    WHERE d.user_id = target_user AND d.status = 'OPEN'
      AND NOT EXISTS (
        SELECT 1 FROM fare_disputes f
        WHERE f.trip_id = d.trip_id AND f.user_id = d.user_id
          AND f.fare_revision = d.fare_revision AND f.status = 'OPEN'
      )
  ) INTO has_uncontested_debt;
  IF open_dispute_count >= 3 OR has_uncontested_debt THEN
    RAISE EXCEPTION 'unresolved debt or three open disputes blocks normal trip use'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_groups_guard_policy_v2_usage_eligibility
BEFORE INSERT ON trip_groups
FOR EACH ROW EXECUTE FUNCTION guard_policy_v2_usage_eligibility();
CREATE TRIGGER trip_participants_guard_policy_v2_usage_eligibility
BEFORE INSERT OR UPDATE OF status ON trip_participants
FOR EACH ROW EXECUTE FUNCTION guard_policy_v2_usage_eligibility();
CREATE TRIGGER trip_deposits_guard_policy_v2_usage_eligibility
BEFORE INSERT ON trip_deposits
FOR EACH ROW EXECUTE FUNCTION guard_policy_v2_usage_eligibility();
