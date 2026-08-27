-- FR-05 / TR-02: PostgreSQL's PL/pgSQL variable-column ambiguity prevented
-- incident review commands from being recorded. Keep the existing reviewer
-- authorization and rebuttal-window rules, but use unambiguous local names.

CREATE OR REPLACE FUNCTION validate_trip_incident_review_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  incident_reporter_user_id uuid;
  incident_reported_user_id uuid;
  incident_trip_id uuid;
  admin_role text;
  admin_status text;
  has_started boolean;
  has_terminal boolean;
  has_rebuttal boolean;
  has_valid_notification boolean;
  rebuttal_deadline_at timestamptz;
BEGIN
  SELECT i.trip_id, i.reporter_user_id, i.reported_user_id
  INTO incident_trip_id, incident_reporter_user_id, incident_reported_user_id
  FROM trip_incidents i
  WHERE i.incident_id = NEW.incident_id
  FOR UPDATE;

  SELECT u.role, u.account_status
  INTO admin_role, admin_status
  FROM users u
  WHERE u.user_id = NEW.admin_user_id
  FOR SHARE;

  IF NOT FOUND OR admin_role <> 'ADMIN' OR admin_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'trip incident review requires an active administrator'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.admin_user_id IN (incident_reporter_user_id, incident_reported_user_id)
    OR EXISTS (
      SELECT 1 FROM trip_participants p
      WHERE p.trip_id = incident_trip_id AND p.user_id = NEW.admin_user_id
    )
  THEN
    RAISE EXCEPTION 'a trip participant or incident party cannot review this incident'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_incident_review_commands c
    WHERE c.incident_id = NEW.incident_id AND c.command_type = 'START_REVIEW'
  ) INTO has_started;

  SELECT EXISTS (
    SELECT 1 FROM trip_incident_review_commands c
    WHERE c.incident_id = NEW.incident_id
      AND c.command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
  ) INTO has_terminal;

  SELECT EXISTS (
    SELECT 1 FROM trip_incident_rebuttals r
    WHERE r.incident_id = NEW.incident_id
  ) INTO has_rebuttal;

  SELECT true, n.rebuttal_deadline_at
  INTO has_valid_notification, rebuttal_deadline_at
  FROM trip_incident_review_notifications n
  JOIN trip_incident_review_commands c
    ON c.command_id = n.review_command_id
  WHERE n.incident_id = NEW.incident_id
    AND c.incident_id = NEW.incident_id
    AND c.command_type = 'START_REVIEW'
    AND n.recipient_user_id = incident_reported_user_id
    AND n.notification_type = 'IN_APP_REBUTTAL_WINDOW'
    AND n.policy_version = 'MVP_IN_APP_10M_V1'
    AND n.rebuttal_deadline_at = n.exposed_at + interval '10 minutes'
  FOR SHARE OF n, c;

  IF NOT FOUND THEN
    has_valid_notification := false;
  END IF;

  IF has_terminal
    OR (NEW.command_type = 'START_REVIEW' AND has_started)
    OR (NEW.command_type <> 'START_REVIEW' AND NOT has_started)
    OR (
      NEW.command_type = 'RESPONSIBILITY_CONFIRMED'
      AND (
        has_valid_notification IS DISTINCT FROM true
        OR (NOT has_rebuttal AND clock_timestamp() < rebuttal_deadline_at)
      )
    )
  THEN
    RAISE EXCEPTION 'invalid trip incident review command transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
