SELECT
  to_regprocedure('assert_predeparture_closed_escrow(uuid)') IS NOT NULL
    AS predeparture_escrow_function_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_deposits'::regclass
      AND tgname = 'trip_deposits_validate_predeparture'
      AND NOT tgisinternal
  ) AS deposit_insert_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_ledger'::regclass
      AND tgname = 'a_point_ledger_validate_deposit_predeparture'
      AND NOT tgisinternal
  ) AS deposit_ledger_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_participants'::regclass
      AND tgname = 'a_trip_participants_validate_deposit_predeparture'
      AND NOT tgisinternal
  ) AS participant_deposit_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_groups'::regclass
      AND tgname = 'trip_groups_validate_confirmation_predeparture'
      AND tgdeferrable
      AND tginitdeferred
      AND NOT tgisinternal
  ) AS confirmation_commit_guard_exists,
  NOT EXISTS (
    SELECT 1
    FROM trip_groups g
    JOIN trip_deposits d ON d.trip_id = g.trip_id
    WHERE g.status = 'CLOSED'
      AND g.departure_at <= clock_timestamp()
  ) AS no_legacy_late_closed_deposits;
