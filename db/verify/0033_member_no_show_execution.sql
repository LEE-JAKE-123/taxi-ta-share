SELECT
  to_regclass('public.trip_incident_no_show_executions') IS NOT NULL
    AS no_show_executions_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_no_show_executions'::regclass
      AND tgname = 'trip_incident_no_show_executions_validate_insert'
      AND NOT tgisinternal
  ) AS no_show_execution_authority_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_no_show_executions'::regclass
      AND tgname = 'trip_incident_no_show_executions_prevent_mutation'
      AND NOT tgisinternal
  ) AS no_show_execution_immutability_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_no_show_executions'::regclass
      AND tgname = 'trip_incident_no_show_executions_require_participant'
      AND tgdeferrable AND tginitdeferred
      AND NOT tgisinternal
  ) AS no_show_execution_atomicity_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trip_participants_no_show_execution_unique_idx'
  ) AS no_show_execution_participant_unique_exists,
  (
    SELECT count(*) = 0
    FROM trip_participants p
    LEFT JOIN trip_incident_no_show_executions e
      ON e.execution_id = p.no_show_execution_id
    LEFT JOIN trip_incidents i ON i.incident_id = e.incident_id
    LEFT JOIN trip_incident_review_commands c ON c.command_id = e.review_command_id
    WHERE p.no_show_execution_id IS NOT NULL
      AND (
        p.status NOT IN ('NO_SHOW', 'COMPLETED')
        OR e.trip_id <> p.trip_id
        OR e.reported_user_id <> p.user_id
        OR e.executed_by <> p.no_show_marked_by
        OR e.idempotency_key <> p.no_show_idempotency_key
        OR i.incident_type <> 'MEMBER_NO_SHOW'
        OR i.trip_id <> p.trip_id
        OR i.reported_user_id <> p.user_id
        OR c.command_type <> 'RESPONSIBILITY_CONFIRMED'
      )
  ) AS no_show_execution_provenance_valid;
