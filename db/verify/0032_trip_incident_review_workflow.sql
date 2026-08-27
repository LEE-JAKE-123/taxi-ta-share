SELECT
  to_regclass('public.trip_incident_rebuttals') IS NOT NULL
    AS trip_incident_rebuttals_exists,
  to_regclass('public.trip_incident_review_commands') IS NOT NULL
    AS trip_incident_review_commands_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_rebuttals'::regclass
      AND tgname = 'trip_incident_rebuttals_validate_insert'
      AND NOT tgisinternal
  ) AS rebuttal_subject_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_rebuttals'::regclass
      AND tgname = 'trip_incident_rebuttals_prevent_mutation'
      AND NOT tgisinternal
  ) AS rebuttal_immutability_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_review_commands'::regclass
      AND tgname = 'trip_incident_review_commands_validate_insert'
      AND NOT tgisinternal
  ) AS review_admin_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_review_commands'::regclass
      AND tgname = 'trip_incident_review_commands_prevent_mutation'
      AND NOT tgisinternal
  ) AS review_immutability_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trip_incident_review_commands_one_terminal_idx'
  ) AS one_terminal_decision_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trip_incident_rebuttals_one_per_incident'
  ) AS one_rebuttal_guard_exists,
  position(
    $$has_valid_notification IS DISTINCT FROM true$$
    IN pg_get_functiondef('validate_trip_incident_review_command()'::regprocedure)
  ) > 0
  AND position(
    $$NOT has_rebuttal
          AND clock_timestamp() < rebuttal_deadline_at$$
    IN pg_get_functiondef('validate_trip_incident_review_command()'::regprocedure)
  ) > 0 AS confirmed_requires_notice_and_response_or_deadline_guard_exists;
