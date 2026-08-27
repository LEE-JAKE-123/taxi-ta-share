SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trip_escrow_shortfalls'
      AND column_name = 'settled_at' AND is_nullable = 'YES'
  ) AS escrow_shortfall_open_timestamp_nullable,
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'validate_trip_incident_no_start_refund_execution_applied'
      AND pg_get_functiondef(oid) LIKE '%waive every member escrow shortfall%'
  ) AS no_start_zero_hold_shortfall_guard_exists;
