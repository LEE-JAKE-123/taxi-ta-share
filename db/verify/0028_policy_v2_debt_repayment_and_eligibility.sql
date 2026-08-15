SELECT
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_debt_events'::regclass
      AND tgname = 'point_debt_events_validate_repayment' AND NOT tgisinternal
  ) AS debt_repayment_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_groups'::regclass
      AND tgname = 'trip_groups_guard_policy_v2_usage_eligibility' AND NOT tgisinternal
  ) AS debt_usage_eligibility_guard_exists;
