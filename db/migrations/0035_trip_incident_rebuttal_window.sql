-- DEC-016 / PRD 5.5.1 / FR-35~40 / TR-01~03:
-- A rebuttal is an opportunity, not a mandatory submission. Starting review
-- publishes a durable in-app notice and a policy-versioned ten-minute window.
-- Responsibility can be confirmed only after a response or that window ends.

-- A historical confirmation cannot be truthfully associated with the new
-- notice-and-window policy. Refuse this forward-only migration instead of
-- inventing a notification or changing the append-only review history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM trip_incident_review_commands
    WHERE command_type = 'RESPONSIBILITY_CONFIRMED'
  ) THEN
    RAISE EXCEPTION
      '0035 refused: legacy responsibility confirmations lack rebuttal-window notification provenance'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE TABLE trip_incident_review_notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL UNIQUE REFERENCES trip_incidents(incident_id) ON DELETE RESTRICT,
  review_command_id uuid NOT NULL UNIQUE REFERENCES trip_incident_review_commands(command_id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  exposed_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  notification_type text NOT NULL DEFAULT 'IN_APP_REBUTTAL_WINDOW',
  policy_version text NOT NULL DEFAULT 'MVP_IN_APP_10M_V1',
  idempotency_key uuid NOT NULL,
  exposed_at timestamptz NOT NULL DEFAULT now(),
  rebuttal_deadline_at timestamptz NOT NULL,
  CONSTRAINT trip_incident_review_notifications_type_valid
    CHECK (notification_type = 'IN_APP_REBUTTAL_WINDOW'),
  CONSTRAINT trip_incident_review_notifications_policy_valid
    CHECK (policy_version = 'MVP_IN_APP_10M_V1'),
  CONSTRAINT trip_incident_review_notifications_idempotent
    UNIQUE (exposed_by, idempotency_key),
  CONSTRAINT trip_incident_review_notifications_deadline_valid
    CHECK (rebuttal_deadline_at > exposed_at)
);

CREATE INDEX trip_incident_review_notifications_recipient_deadline_idx
  ON trip_incident_review_notifications (recipient_user_id, rebuttal_deadline_at);

CREATE FUNCTION validate_trip_incident_review_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  command_incident_id uuid;
  command_type text;
  incident_trip_id uuid;
  incident_reporter_user_id uuid;
  incident_reported_user_id uuid;
  executor_role text;
  executor_status text;
BEGIN
  SELECT c.incident_id, c.command_type
  INTO command_incident_id, command_type
  FROM trip_incident_review_commands c
  WHERE c.command_id = NEW.review_command_id
  FOR SHARE;

  SELECT trip_id, reporter_user_id, reported_user_id
  INTO incident_trip_id, incident_reporter_user_id, incident_reported_user_id
  FROM trip_incidents
  WHERE incident_id = NEW.incident_id
  FOR SHARE;

  SELECT role, account_status
  INTO executor_role, executor_status
  FROM users
  WHERE user_id = NEW.exposed_by
  FOR SHARE;

  IF command_incident_id IS DISTINCT FROM NEW.incident_id
    OR command_type <> 'START_REVIEW'
    OR incident_reported_user_id IS DISTINCT FROM NEW.recipient_user_id
    OR executor_role <> 'ADMIN'
    OR executor_status <> 'ACTIVE'
    OR NEW.exposed_by IN (incident_reporter_user_id, incident_reported_user_id)
    OR EXISTS (
      SELECT 1 FROM trip_participants
      WHERE trip_id = incident_trip_id AND user_id = NEW.exposed_by
    )
  THEN
    RAISE EXCEPTION 'review notification must expose the same start-review command to its reported user'
      USING ERRCODE = '23514';
  END IF;

  NEW.notification_type := 'IN_APP_REBUTTAL_WINDOW';
  NEW.policy_version := 'MVP_IN_APP_10M_V1';
  NEW.exposed_at := clock_timestamp();
  NEW.rebuttal_deadline_at := NEW.exposed_at + interval '10 minutes';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_incident_review_notifications_validate_insert
BEFORE INSERT ON trip_incident_review_notifications
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_review_notification();

CREATE FUNCTION prevent_trip_incident_review_notification_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip incident review notifications are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_incident_review_notifications_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_incident_review_notifications
FOR EACH ROW EXECUTE FUNCTION prevent_trip_incident_review_notification_mutation();

CREATE OR REPLACE FUNCTION validate_trip_incident_rebuttal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_user_id uuid;
  terminal_exists boolean;
  has_started boolean;
  has_notification boolean;
  deadline_at timestamptz;
BEGIN
  SELECT reported_user_id
  INTO subject_user_id
  FROM trip_incidents
  WHERE incident_id = NEW.incident_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id
      AND command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
  ) INTO terminal_exists;
  SELECT EXISTS (
    SELECT 1
    FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id AND command_type = 'START_REVIEW'
  ) INTO has_started;
  SELECT true, n.rebuttal_deadline_at
  INTO has_notification, deadline_at
  FROM trip_incident_review_notifications n
  WHERE n.incident_id = NEW.incident_id
  FOR SHARE;

  IF NOT FOUND THEN
    has_notification := false;
  END IF;

  IF subject_user_id IS DISTINCT FROM NEW.author_user_id
    OR terminal_exists
    OR NOT has_started
    OR NOT has_notification
    OR clock_timestamp() >= deadline_at
  THEN
    RAISE EXCEPTION 'only the incident subject may submit one rebuttal during the open review window'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_trip_incident_review_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reporter_user_id uuid;
  reported_user_id uuid;
  incident_trip_id uuid;
  admin_role text;
  admin_status text;
  has_started boolean;
  has_terminal boolean;
  has_rebuttal boolean;
  has_valid_notification boolean;
  rebuttal_deadline_at timestamptz;
BEGIN
  SELECT trip_id, reporter_user_id, reported_user_id
  INTO incident_trip_id, reporter_user_id, reported_user_id
  FROM trip_incidents
  WHERE incident_id = NEW.incident_id
  FOR UPDATE;

  SELECT role, account_status
  INTO admin_role, admin_status
  FROM users
  WHERE user_id = NEW.admin_user_id
  FOR SHARE;

  IF NOT FOUND OR admin_role <> 'ADMIN' OR admin_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'trip incident review requires an active administrator'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.admin_user_id IN (reporter_user_id, reported_user_id)
    OR EXISTS (
      SELECT 1 FROM trip_participants
      WHERE trip_id = incident_trip_id AND user_id = NEW.admin_user_id
    )
  THEN
    RAISE EXCEPTION 'a trip participant or incident party cannot review this incident'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id AND command_type = 'START_REVIEW'
  ) INTO has_started;
  SELECT EXISTS (
    SELECT 1 FROM trip_incident_review_commands
    WHERE incident_id = NEW.incident_id
      AND command_type IN ('RESPONSIBILITY_CONFIRMED', 'NOT_ESTABLISHED')
  ) INTO has_terminal;
  SELECT EXISTS (
    SELECT 1 FROM trip_incident_rebuttals
    WHERE incident_id = NEW.incident_id
  ) INTO has_rebuttal;
  SELECT true, n.rebuttal_deadline_at
  INTO has_valid_notification, rebuttal_deadline_at
  FROM trip_incident_review_notifications n
  JOIN trip_incident_review_commands c
    ON c.command_id = n.review_command_id
  WHERE n.incident_id = NEW.incident_id
    AND c.incident_id = NEW.incident_id
    AND c.command_type = 'START_REVIEW'
    AND n.recipient_user_id = reported_user_id
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
        OR (
          NOT has_rebuttal
          AND clock_timestamp() < rebuttal_deadline_at
        )
      )
    )
  THEN
    RAISE EXCEPTION 'invalid trip incident review command transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_trip_incident_start_review_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.command_type = 'START_REVIEW' AND NOT EXISTS (
    SELECT 1
    FROM trip_incident_review_notifications n
    WHERE n.incident_id = NEW.incident_id
      AND n.review_command_id = NEW.command_id
      AND n.recipient_user_id = (
        SELECT reported_user_id FROM trip_incidents WHERE incident_id = NEW.incident_id
      )
  ) THEN
    RAISE EXCEPTION 'start review must atomically publish an in-app rebuttal opportunity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trip_incident_review_commands_require_notification
AFTER INSERT ON trip_incident_review_commands
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_start_review_notification();
