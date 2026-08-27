SELECT
  to_regclass('public.trip_incidents') IS NOT NULL AS trip_incidents_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incidents'::regclass
      AND tgname = 'trip_incidents_validate_shape'
      AND NOT tgisinternal
  ) AS incident_shape_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incidents'::regclass
      AND tgname = 'trip_incidents_prevent_mutation'
      AND NOT tgisinternal
  ) AS incident_immutability_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trip_incidents_trip_submitted_idx'
  ) AS incident_trip_index_exists,
  NOT EXISTS (
    SELECT 1
    FROM trip_incidents i
    LEFT JOIN trip_participants reporter
      ON reporter.trip_id = i.trip_id
     AND reporter.user_id = i.reporter_user_id
    LEFT JOIN trip_participants reported
      ON reported.trip_id = i.trip_id
     AND reported.user_id = i.reported_user_id
    WHERE reporter.user_id IS NULL OR reported.user_id IS NULL
  ) AS incident_participants_valid;
