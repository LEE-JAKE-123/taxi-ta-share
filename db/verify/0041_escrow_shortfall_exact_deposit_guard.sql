-- 0041 structural verification. The isolated E2E path proves that a
-- partial deposit cannot become DEPOSITED without the matching shortfall.
SELECT
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'validate_participant_deposit_completion'
      AND pg_get_functiondef(oid) LIKE '%deposit_amount > expected_points%'
      AND pg_get_functiondef(oid) LIKE '%deposit_amount < expected_points AND NOT matching_shortfall%'
  ) AS exact_deposit_completion_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'validate_trip_escrow_confirmation'
      AND pg_get_functiondef(oid) LIKE '%d.amount > expected_points%'
      AND pg_get_functiondef(oid) LIKE '%d.amount < expected_points AND NOT EXISTS%'
  ) AS exact_escrow_confirmation_guard_exists;
