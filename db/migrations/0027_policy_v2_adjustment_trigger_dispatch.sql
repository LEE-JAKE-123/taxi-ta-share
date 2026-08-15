-- 0026 used a CASE expression over trigger-specific NEW fields. PostgreSQL
-- evaluates a missing field even for a non-selected CASE branch on another
-- trigger table. Dispatch before reading the table-specific field instead.
CREATE OR REPLACE FUNCTION validate_policy_v2_adjustment_financials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  adjustment_id uuid;
  invalid_rows integer;
BEGIN
  IF TG_TABLE_NAME = 'policy_v2_adjustment_commands' THEN
    adjustment_id := NEW.command_id;
  ELSIF TG_TABLE_NAME = 'policy_v2_adjustment_allocations' THEN
    adjustment_id := NEW.command_id;
  ELSIF TG_TABLE_NAME = 'point_ledger' THEN
    adjustment_id := NEW.policy_v2_adjustment_command_id;
  ELSIF TG_TABLE_NAME = 'point_debt_events' THEN
    adjustment_id := NEW.policy_v2_adjustment_command_id;
  END IF;
  IF adjustment_id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO invalid_rows
  FROM policy_v2_adjustment_allocations a
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(-l.available_delta) FILTER (WHERE l.entry_type = 'FARE_ADJUSTMENT_DEBIT'), 0)::integer AS debited,
      coalesce(sum(l.available_delta) FILTER (WHERE l.entry_type = 'FARE_ADJUSTMENT_REFUND'), 0)::integer AS refunded
    FROM point_ledger l
    WHERE l.policy_v2_adjustment_command_id = adjustment_id AND l.user_id = a.user_id
  ) ledger ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(e.debt_delta), 0)::integer AS debt_delta
    FROM point_debt_events e
    WHERE e.policy_v2_adjustment_command_id = adjustment_id AND e.user_id = a.user_id
  ) debt ON true
  WHERE a.command_id = adjustment_id
    AND (
      (a.revised_share > a.previous_share AND (
        ledger.refunded <> 0 OR ledger.debited + debt.debt_delta <> a.revised_share - a.previous_share
      ))
      OR (a.revised_share < a.previous_share AND (
        ledger.debited <> 0 OR ledger.refunded - debt.debt_delta <> a.previous_share - a.revised_share
      ))
      OR (a.revised_share = a.previous_share AND (
        ledger.debited <> 0 OR ledger.refunded <> 0 OR debt.debt_delta <> 0
      ))
    );
  IF invalid_rows <> 0 THEN
    RAISE EXCEPTION 'policy-v2 adjustment must exactly decompose every participant compensation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
