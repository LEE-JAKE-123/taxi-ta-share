-- 0037 structural verification. Behavioural validation belongs to the
-- isolated-database E2E flow because it requires a complete confirmed cohort.
SELECT
  to_regclass('public.trip_escrow_shortfalls') IS NOT NULL
    AS escrow_shortfalls_exists,
  to_regclass('public.trip_escrow_shortfall_events') IS NOT NULL
    AS escrow_shortfall_events_exists,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trip_deposits'::regclass AND conname = 'trip_deposits_amount_valid'
      AND pg_get_constraintdef(oid) LIKE '%amount >= 0%'
      AND pg_get_constraintdef(oid) LIKE '%amount <= 1000000%'
  ) AS zero_held_deposit_supported,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_escrow_shortfall_events'::regclass
      AND tgname = 'z_trip_escrow_shortfall_events_apply' AND NOT tgisinternal
  ) AS escrow_shortfall_projection_trigger_exists;
