-- DEC-015 execution boundary: an incident review remains audit-only.  This
-- migration adds the separately-audited execution that can establish the
-- participant fact needed by the fixed escrow-cohort settlement flow.

CREATE TABLE trip_incident_no_show_executions (
  execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL UNIQUE REFERENCES trip_incidents(incident_id) ON DELETE RESTRICT,
  review_command_id uuid NOT NULL UNIQUE REFERENCES trip_incident_review_commands(command_id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  reported_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  executed_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_incident_no_show_executions_idempotent
    UNIQUE (executed_by, idempotency_key)
);

CREATE UNIQUE INDEX trip_incident_no_show_executions_target_idx
  ON trip_incident_no_show_executions (trip_id, reported_user_id);

ALTER TABLE trip_participants
  ADD COLUMN no_show_execution_id uuid
    REFERENCES trip_incident_no_show_executions(execution_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX trip_participants_no_show_execution_unique_idx
  ON trip_participants (no_show_execution_id)
  WHERE no_show_execution_id IS NOT NULL;

CREATE FUNCTION validate_trip_incident_no_show_execution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  command_incident_id uuid;
  command_admin_id uuid;
  incident_trip_id uuid;
  incident_reporter_user_id uuid;
  incident_reported_user_id uuid;
  incident_type text;
  participant_status text;
  participant_role text;
  trip_status text;
  executor_role text;
  executor_status text;
BEGIN
  SELECT c.incident_id, c.admin_user_id
  INTO command_incident_id, command_admin_id
  FROM trip_incident_review_commands c
  WHERE c.command_id = NEW.review_command_id
    AND c.command_type = 'RESPONSIBILITY_CONFIRMED'
  FOR SHARE;

  SELECT i.trip_id, i.reporter_user_id, i.reported_user_id, i.incident_type
  INTO incident_trip_id, incident_reporter_user_id, incident_reported_user_id, incident_type
  FROM trip_incidents i
  WHERE i.incident_id = NEW.incident_id
  FOR SHARE;

  SELECT p.status, p.role, g.status
  INTO participant_status, participant_role, trip_status
  FROM trip_participants p
  JOIN trip_groups g ON g.trip_id = p.trip_id
  WHERE p.trip_id = NEW.trip_id AND p.user_id = NEW.reported_user_id
  FOR UPDATE OF p, g;

  SELECT role, account_status
  INTO executor_role, executor_status
  FROM users
  WHERE user_id = NEW.executed_by
  FOR SHARE;

  IF command_incident_id IS DISTINCT FROM NEW.incident_id
    OR command_admin_id IS DISTINCT FROM NEW.executed_by
    OR incident_trip_id IS DISTINCT FROM NEW.trip_id
    OR incident_reported_user_id IS DISTINCT FROM NEW.reported_user_id
    OR incident_type <> 'MEMBER_NO_SHOW'
    OR participant_status <> 'DEPOSITED'
    OR participant_role <> 'MEMBER'
    OR trip_status <> 'IN_PROGRESS'
    OR executor_role <> 'ADMIN'
    OR executor_status <> 'ACTIVE'
    OR NEW.executed_by IN (incident_reporter_user_id, NEW.reported_user_id)
    OR EXISTS (
      SELECT 1 FROM trip_participants
      WHERE trip_id = NEW.trip_id AND user_id = NEW.executed_by
    )
  THEN
    RAISE EXCEPTION 'member no-show execution does not satisfy its authority or state requirements'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_incident_no_show_executions_validate_insert
BEFORE INSERT ON trip_incident_no_show_executions
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_no_show_execution();

CREATE FUNCTION prevent_trip_incident_no_show_execution_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip incident no-show executions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_incident_no_show_executions_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_incident_no_show_executions
FOR EACH ROW EXECUTE FUNCTION prevent_trip_incident_no_show_execution_mutation();

-- Existing NO_SHOW rows predate incident review provenance.  The stricter
-- linkage applies only to new DEPOSITED -> NO_SHOW transitions.
CREATE OR REPLACE FUNCTION validate_demo_journey_participant_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_host uuid;
  valid_execution boolean;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    IF OLD.no_show_at IS DISTINCT FROM NEW.no_show_at
      OR OLD.no_show_marked_by IS DISTINCT FROM NEW.no_show_marked_by
      OR OLD.no_show_idempotency_key IS DISTINCT FROM NEW.no_show_idempotency_key
      OR OLD.no_show_execution_id IS DISTINCT FROM NEW.no_show_execution_id
    THEN
      RAISE EXCEPTION 'no-show audit data is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status, host_user_id
  INTO trip_status, trip_host
  FROM trip_groups
  WHERE trip_id = NEW.trip_id
  FOR SHARE;

  IF OLD.status = 'DEPOSITED' AND NEW.status = 'CHECKED_IN' THEN
    IF trip_status <> 'IN_PROGRESS'
      OR NEW.checked_in_at IS NULL
      OR NEW.check_in_idempotency_key IS NULL
    THEN
      RAISE EXCEPTION 'check-in requires an in-progress trip and audit data'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'DEPOSITED' AND NEW.status = 'NO_SHOW' THEN
    SELECT EXISTS (
      SELECT 1
      FROM trip_incident_no_show_executions e
      JOIN trip_incidents i ON i.incident_id = e.incident_id
      JOIN trip_incident_review_commands c ON c.command_id = e.review_command_id
      WHERE e.execution_id = NEW.no_show_execution_id
        AND e.trip_id = NEW.trip_id
        AND e.reported_user_id = NEW.user_id
        AND e.executed_by = NEW.no_show_marked_by
        AND e.idempotency_key = NEW.no_show_idempotency_key
        AND i.incident_type = 'MEMBER_NO_SHOW'
        AND i.trip_id = NEW.trip_id
        AND i.reported_user_id = NEW.user_id
        AND c.command_type = 'RESPONSIBILITY_CONFIRMED'
    ) INTO valid_execution;

    IF trip_status <> 'IN_PROGRESS'
      OR NEW.role <> 'MEMBER'
      OR NEW.no_show_at IS NULL
      OR NEW.no_show_marked_by IS NULL
      OR NEW.no_show_idempotency_key IS NULL
      OR NEW.no_show_execution_id IS NULL
      OR valid_execution IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION 'no-show requires a matching reviewed execution'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'COMPLETED'
    AND OLD.status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid demo journey participant transition % -> %',
    OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER trip_participants_validate_demo_journey ON trip_participants;

CREATE TRIGGER trip_participants_validate_demo_journey
BEFORE UPDATE OF status, no_show_at, no_show_marked_by,
  no_show_idempotency_key, no_show_execution_id ON trip_participants
FOR EACH ROW
WHEN (
  OLD.status IN ('DEPOSITED', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED')
  OR NEW.status IN ('CHECKED_IN', 'NO_SHOW')
)
EXECUTE FUNCTION validate_demo_journey_participant_transition();

CREATE FUNCTION validate_trip_incident_no_show_execution_applied()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM trip_participants p
    WHERE p.trip_id = NEW.trip_id
      AND p.user_id = NEW.reported_user_id
      AND p.status = 'NO_SHOW'
      AND p.no_show_execution_id = NEW.execution_id
      AND p.no_show_marked_by = NEW.executed_by
      AND p.no_show_idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'member no-show execution must atomically establish participant status'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trip_incident_no_show_executions_require_participant
AFTER INSERT ON trip_incident_no_show_executions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_no_show_execution_applied();
