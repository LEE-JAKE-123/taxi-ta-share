SELECT
  to_regclass('public.policy_v2_adjustment_commands') IS NOT NULL AS adjustment_commands_exists,
  to_regclass('public.policy_v2_adjustment_allocations') IS NOT NULL AS adjustment_allocations_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'fare_disputes'::regclass
      AND tgname = 'fare_disputes_validate_policy_v2_resolved_command'
      AND NOT tgisinternal
  ) AS resolved_dispute_command_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_settlements'::regclass
      AND tgname = 'trip_settlements_validate_policy_v2_finalization_adjustments'
      AND NOT tgisinternal
  ) AS finalization_adjustment_guard_exists;
