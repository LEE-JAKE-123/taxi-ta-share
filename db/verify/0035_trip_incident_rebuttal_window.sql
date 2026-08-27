SELECT
  to_regclass('public.trip_incident_review_notifications') IS NOT NULL
    AS review_notifications_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_review_notifications'::regclass
      AND tgname = 'trip_incident_review_notifications_validate_insert'
      AND NOT tgisinternal
  ) AS review_notification_authority_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_review_notifications'::regclass
      AND tgname = 'trip_incident_review_notifications_prevent_mutation'
      AND NOT tgisinternal
  ) AS review_notification_immutability_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_review_commands'::regclass
      AND tgname = 'trip_incident_review_commands_require_notification'
      AND tgdeferrable AND tginitdeferred
      AND NOT tgisinternal
  ) AS start_review_notification_atomicity_guard_exists,
  position(
    $$has_valid_notification IS DISTINCT FROM true$$
    IN pg_get_functiondef('validate_trip_incident_review_command()'::regprocedure)
  ) > 0 AS responsibility_confirmation_notification_guard_exists,
  (
    SELECT count(*) = 0
    FROM trip_incident_review_notifications n
    JOIN trip_incident_review_commands c ON c.command_id = n.review_command_id
    JOIN trip_incidents i ON i.incident_id = n.incident_id
    WHERE c.command_type <> 'START_REVIEW'
       OR c.incident_id <> n.incident_id
       OR i.reported_user_id <> n.recipient_user_id
       OR n.notification_type <> 'IN_APP_REBUTTAL_WINDOW'
       OR n.policy_version <> 'MVP_IN_APP_10M_V1'
       OR n.rebuttal_deadline_at <> n.exposed_at + interval '10 minutes'
  ) AS review_notification_provenance_valid,
  NOT EXISTS (
    SELECT 1
    FROM trip_incident_review_commands c
    JOIN trip_incidents i ON i.incident_id = c.incident_id
    WHERE c.command_type = 'RESPONSIBILITY_CONFIRMED'
      AND NOT EXISTS (
        SELECT 1
        FROM trip_incident_review_notifications n
        JOIN trip_incident_review_commands start_command
          ON start_command.command_id = n.review_command_id
        WHERE n.incident_id = c.incident_id
          AND start_command.incident_id = c.incident_id
          AND start_command.command_type = 'START_REVIEW'
          AND n.recipient_user_id = i.reported_user_id
          AND n.notification_type = 'IN_APP_REBUTTAL_WINDOW'
          AND n.policy_version = 'MVP_IN_APP_10M_V1'
          AND n.rebuttal_deadline_at = n.exposed_at + interval '10 minutes'
      )
  ) AS responsibility_confirmations_have_valid_notification;
