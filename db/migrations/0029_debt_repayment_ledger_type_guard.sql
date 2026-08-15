-- TR-01~03: a REPAYMENT event may reference only the dedicated
-- DEBT_REPAYMENT ledger entry, never another negative ledger transaction.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM point_debt_events e
    LEFT JOIN point_ledger l ON l.ledger_id = e.repayment_ledger_id
    WHERE e.event_type = 'REPAYMENT'
      AND l.entry_type IS DISTINCT FROM 'DEBT_REPAYMENT'
  ) THEN
    RAISE EXCEPTION
      '0029 refused: existing REPAYMENT events have non-DEBT_REPAYMENT links'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_point_debt_repayment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger_user uuid;
  ledger_trip uuid;
  ledger_actor uuid;
  ledger_entry_type text;
  ledger_amount integer;
  debt_trip uuid;
BEGIN
  IF NEW.event_type <> 'REPAYMENT' THEN RETURN NEW; END IF;
  SELECT l.user_id, l.trip_id, l.actor_user_id, l.entry_type,
         l.available_delta, o.trip_id
  INTO ledger_user, ledger_trip, ledger_actor, ledger_entry_type,
       ledger_amount, debt_trip
  FROM point_ledger l
  JOIN point_debt_obligations o ON o.debt_id = NEW.debt_id
  WHERE l.ledger_id = NEW.repayment_ledger_id
  FOR SHARE OF l, o;
  IF NOT FOUND
    OR ledger_entry_type <> 'DEBT_REPAYMENT'
    OR ledger_user <> NEW.user_id
    OR ledger_trip <> debt_trip
    OR ledger_actor IS DISTINCT FROM NEW.actor_user_id
    OR ledger_amount <> NEW.debt_delta
    OR ledger_amount >= 0
    OR NEW.policy_v2_adjustment_command_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'debt repayment requires a matching DEBT_REPAYMENT ledger entry'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
