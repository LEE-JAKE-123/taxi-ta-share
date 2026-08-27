-- DEC-009 / FR-17 / FR-33~34 / TR-01~03:
-- A HOST_NO_START review remains an audit decision. This separately-audited
-- execution cancels the trip and returns only the non-fault member escrow.
-- Host escrow and any host penalty remain held for a later, explicit policy.

CREATE TABLE trip_incident_no_start_refund_executions (
  execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL UNIQUE REFERENCES trip_incidents(incident_id) ON DELETE RESTRICT,
  review_command_id uuid NOT NULL UNIQUE REFERENCES trip_incident_review_commands(command_id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL UNIQUE REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  executed_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_incident_no_start_refund_executions_idempotent
    UNIQUE (executed_by, idempotency_key)
);

ALTER TABLE point_ledger
  ADD COLUMN no_start_refund_execution_id uuid
    REFERENCES trip_incident_no_start_refund_executions(execution_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX point_ledger_one_no_start_refund_per_execution_user_idx
  ON point_ledger (no_start_refund_execution_id, user_id)
  WHERE no_start_refund_execution_id IS NOT NULL;

CREATE FUNCTION validate_trip_incident_no_start_refund_execution()
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
  trip_host uuid;
  trip_status text;
  departure_at timestamptz;
  executor_role text;
  executor_status text;
  participant_count integer;
  deposited_participant_count integer;
  deposited_host_count integer;
  deposited_member_count integer;
  has_settlement boolean;
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

  SELECT g.host_user_id, g.status, g.departure_at
  INTO trip_host, trip_status, departure_at
  FROM trip_groups g
  WHERE g.trip_id = NEW.trip_id
  FOR UPDATE;

  SELECT role, account_status
  INTO executor_role, executor_status
  FROM users
  WHERE user_id = NEW.executed_by
  FOR SHARE;

  PERFORM 1
  FROM trip_participants p
  WHERE p.trip_id = NEW.trip_id
  FOR SHARE;

  PERFORM 1
  FROM trip_deposits d
  WHERE d.trip_id = NEW.trip_id
  FOR SHARE;

  SELECT
    count(*)::integer,
    count(d.user_id)::integer,
    count(*) FILTER (
      WHERE p.role = 'HOST' AND p.status = 'DEPOSITED' AND d.user_id IS NOT NULL
    )::integer,
    count(*) FILTER (
      WHERE p.role = 'MEMBER' AND p.status = 'DEPOSITED' AND d.user_id IS NOT NULL
    )::integer
  INTO participant_count, deposited_participant_count,
       deposited_host_count, deposited_member_count
  FROM trip_participants p
  LEFT JOIN trip_deposits d
    ON d.trip_id = p.trip_id AND d.user_id = p.user_id
  WHERE p.trip_id = NEW.trip_id;

  SELECT EXISTS (
    SELECT 1 FROM trip_settlements WHERE trip_id = NEW.trip_id
  ) INTO has_settlement;

  IF command_incident_id IS DISTINCT FROM NEW.incident_id
    OR command_admin_id IS DISTINCT FROM NEW.executed_by
    OR incident_trip_id IS DISTINCT FROM NEW.trip_id
    OR incident_type <> 'HOST_NO_START'
    OR incident_reported_user_id IS DISTINCT FROM trip_host
    OR trip_status <> 'CONFIRMED'
    OR departure_at > clock_timestamp()
    OR executor_role <> 'ADMIN'
    OR executor_status <> 'ACTIVE'
    OR NEW.executed_by IN (incident_reporter_user_id, incident_reported_user_id)
    OR EXISTS (
      SELECT 1 FROM trip_participants
      WHERE trip_id = NEW.trip_id AND user_id = NEW.executed_by
    )
    OR participant_count NOT BETWEEN 2 AND 4
    OR deposited_participant_count <> participant_count
    OR deposited_host_count <> 1
    OR deposited_member_count <> participant_count - 1
    OR has_settlement
  THEN
    RAISE EXCEPTION 'host no-start refund execution does not satisfy its authority or escrow requirements'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_incident_no_start_refund_executions_validate_insert
BEFORE INSERT ON trip_incident_no_start_refund_executions
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_no_start_refund_execution();

CREATE FUNCTION prevent_trip_incident_no_start_refund_execution_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip incident no-start refund executions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_incident_no_start_refund_executions_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_incident_no_start_refund_executions
FOR EACH ROW EXECUTE FUNCTION prevent_trip_incident_no_start_refund_execution_mutation();

CREATE FUNCTION validate_no_start_refund_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_trip_id uuid;
  execution_admin_id uuid;
  participant_role text;
  deposit_amount integer;
BEGIN
  IF NEW.no_start_refund_execution_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.trip_id, e.executed_by
  INTO execution_trip_id, execution_admin_id
  FROM trip_incident_no_start_refund_executions e
  WHERE e.execution_id = NEW.no_start_refund_execution_id
  FOR SHARE;

  SELECT p.role, d.amount
  INTO participant_role, deposit_amount
  FROM trip_participants p
  JOIN trip_deposits d
    ON d.trip_id = p.trip_id AND d.user_id = p.user_id
  WHERE p.trip_id = NEW.trip_id AND p.user_id = NEW.user_id
  FOR SHARE OF p, d;

  IF NOT FOUND
    OR execution_trip_id IS DISTINCT FROM NEW.trip_id
    OR participant_role <> 'MEMBER'
    OR NEW.entry_type <> 'REFUND'
    OR NEW.available_delta <> deposit_amount
    OR NEW.held_delta <> -deposit_amount
    OR NEW.actor_user_id IS DISTINCT FROM execution_admin_id
    OR NEW.system_deadline_command_id IS NOT NULL
    OR NEW.policy_v2_adjustment_command_id IS NOT NULL
    OR NEW.idempotency_key <> (
      'host-no-start-refund:' || NEW.no_start_refund_execution_id::text || ':' || NEW.user_id::text
    )
  THEN
    RAISE EXCEPTION 'host no-start refund ledger entry does not match its execution and member escrow'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_ledger_validate_no_start_refund
BEFORE INSERT ON point_ledger
FOR EACH ROW EXECUTE FUNCTION validate_no_start_refund_ledger_entry();

-- Settlement validation is bypassed only for rows with explicit no-start
-- execution provenance; every other settlement row retains the old guard.
DROP TRIGGER point_ledger_validate_boarded_settlement ON point_ledger;

CREATE TRIGGER point_ledger_validate_boarded_settlement
BEFORE INSERT ON point_ledger
FOR EACH ROW
WHEN (NEW.no_start_refund_execution_id IS NULL)
EXECUTE FUNCTION validate_boarded_settlement_ledger_entry();

CREATE FUNCTION validate_trip_incident_no_start_refund_execution_applied()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_closed_at timestamptz;
  trip_cancelled_at timestamptz;
  trip_closure_type text;
  cancellation_key uuid;
  has_settlement boolean;
BEGIN
  SELECT status, closed_at, cancelled_at, closure_type, cancellation_idempotency_key
  INTO trip_status, trip_closed_at, trip_cancelled_at, trip_closure_type, cancellation_key
  FROM trip_groups
  WHERE trip_id = NEW.trip_id
  FOR SHARE;

  SELECT EXISTS (
    SELECT 1 FROM trip_settlements WHERE trip_id = NEW.trip_id
  ) INTO has_settlement;

  IF trip_status <> 'CANCELLED'
    OR trip_closed_at IS NULL
    OR trip_cancelled_at IS NULL
    OR trip_closure_type <> 'CANCELLED'
    OR cancellation_key IS DISTINCT FROM NEW.idempotency_key
    OR has_settlement
    OR EXISTS (
      SELECT 1
      FROM trip_participants p
      JOIN trip_deposits d
        ON d.trip_id = p.trip_id AND d.user_id = p.user_id
      LEFT JOIN point_ledger l
        ON l.no_start_refund_execution_id = NEW.execution_id
       AND l.user_id = p.user_id
      WHERE p.trip_id = NEW.trip_id
        AND p.role = 'MEMBER'
        AND (
          p.status <> 'DEPOSITED'
          OR l.ledger_id IS NULL
          OR l.entry_type <> 'REFUND'
          OR l.trip_id <> NEW.trip_id
          OR l.available_delta <> d.amount
          OR l.held_delta <> -d.amount
          OR l.actor_user_id <> NEW.executed_by
        )
    )
    OR EXISTS (
      SELECT 1
      FROM point_ledger l
      LEFT JOIN trip_participants p
        ON p.trip_id = NEW.trip_id AND p.user_id = l.user_id
      LEFT JOIN trip_deposits d
        ON d.trip_id = p.trip_id AND d.user_id = p.user_id
      WHERE l.no_start_refund_execution_id = NEW.execution_id
        AND (p.role IS DISTINCT FROM 'MEMBER' OR d.user_id IS NULL)
    )
  THEN
    RAISE EXCEPTION 'host no-start refund execution must atomically cancel the trip and refund every member escrow'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trip_incident_no_start_refund_executions_require_refunds
AFTER INSERT ON trip_incident_no_start_refund_executions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_trip_incident_no_start_refund_execution_applied();
