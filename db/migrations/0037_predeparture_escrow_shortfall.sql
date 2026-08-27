-- FR-33~40 / TR-01~03: a participant can defer only the unavailable portion
-- of the estimated pre-departure escrow.  The cash actually available still
-- moves to held balance through the ordinary DEPOSIT ledger.  The deferred
-- portion is a separate append-only commitment, never a negative balance or
-- a fabricated held deposit.

ALTER TABLE trip_deposits
  DROP CONSTRAINT trip_deposits_amount_valid,
  ADD CONSTRAINT trip_deposits_amount_valid CHECK (amount BETWEEN 0 AND 1000000);

CREATE TABLE trip_escrow_shortfalls (
  shortfall_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  expected_deposit_points integer NOT NULL CHECK (expected_deposit_points BETWEEN 1 AND 1000000),
  outstanding_points integer NOT NULL DEFAULT 0 CHECK (outstanding_points BETWEEN 0 AND 1000000),
  status text NOT NULL DEFAULT 'SETTLED' CHECK (status IN ('OPEN', 'SETTLED', 'WAIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_escrow_shortfalls_one_per_participant UNIQUE (trip_id, user_id),
  CONSTRAINT trip_escrow_shortfalls_balance_valid CHECK (outstanding_points <= expected_deposit_points),
  CONSTRAINT trip_escrow_shortfalls_status_valid CHECK (
    (status = 'OPEN' AND outstanding_points > 0 AND settled_at IS NULL)
    OR (status IN ('SETTLED', 'WAIVED') AND outstanding_points = 0 AND settled_at IS NOT NULL)
  )
);

CREATE INDEX trip_escrow_shortfalls_user_open_idx
  ON trip_escrow_shortfalls (user_id, created_at, shortfall_id)
  WHERE status = 'OPEN';

CREATE TABLE trip_escrow_shortfall_events (
  shortfall_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shortfall_id uuid NOT NULL REFERENCES trip_escrow_shortfalls(shortfall_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('INCUR', 'RECONCILE', 'WAIVE')),
  points_delta integer NOT NULL CHECK (points_delta BETWEEN -1000000 AND 1000000 AND points_delta <> 0),
  actor_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  system_deadline_command_id uuid REFERENCES system_deadline_commands(command_id) ON DELETE RESTRICT,
  no_start_refund_execution_id uuid REFERENCES trip_incident_no_start_refund_executions(execution_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_escrow_shortfall_events_shape_valid CHECK (
    (event_type = 'INCUR' AND points_delta > 0 AND actor_user_id IS NOT NULL
      AND system_deadline_command_id IS NULL AND no_start_refund_execution_id IS NULL)
    OR (event_type = 'RECONCILE' AND points_delta < 0 AND actor_user_id IS NULL
      AND system_deadline_command_id IS NOT NULL AND no_start_refund_execution_id IS NULL)
    OR (event_type = 'WAIVE' AND points_delta < 0 AND actor_user_id IS NULL
      AND system_deadline_command_id IS NULL AND no_start_refund_execution_id IS NOT NULL)
  )
);

CREATE INDEX trip_escrow_shortfall_events_shortfall_created_idx
  ON trip_escrow_shortfall_events (shortfall_id, created_at, shortfall_event_id);

CREATE OR REPLACE FUNCTION prevent_trip_escrow_shortfall_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.outstanding_points <> 0 OR NEW.status <> 'SETTLED' OR NEW.settled_at IS NULL THEN
      RAISE EXCEPTION 'an escrow shortfall must begin as a zero settled projection'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'escrow shortfall projections are updated only from append-only events'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_escrow_shortfalls_prevent_mutation
BEFORE INSERT OR UPDATE OR DELETE ON trip_escrow_shortfalls
FOR EACH ROW EXECUTE FUNCTION prevent_trip_escrow_shortfall_mutation();

CREATE OR REPLACE FUNCTION prevent_trip_escrow_shortfall_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'escrow shortfall events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trip_escrow_shortfall_events_prevent_mutation
BEFORE UPDATE OR DELETE ON trip_escrow_shortfall_events
FOR EACH ROW EXECUTE FUNCTION prevent_trip_escrow_shortfall_event_mutation();

CREATE OR REPLACE FUNCTION validate_trip_escrow_shortfall_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  departure_at timestamptz;
  participant_status text;
  cohort_count integer;
  expected_points integer;
BEGIN
  SELECT g.status, g.departure_at, p.status,
         count(*) OVER ()::integer,
         ceil(g.estimated_fare::numeric / count(*) OVER ())::integer
  INTO trip_status, departure_at, participant_status, cohort_count, expected_points
  FROM trip_groups g
  JOIN trip_participants p ON p.trip_id = g.trip_id
  WHERE g.trip_id = NEW.trip_id
    AND p.status IN ('APPROVED', 'DEPOSITED')
  ORDER BY p.user_id
  LIMIT 1;

  SELECT p.status
  INTO participant_status
  FROM trip_participants p
  WHERE p.trip_id = NEW.trip_id AND p.user_id = NEW.user_id
  FOR SHARE;

  IF NOT FOUND
    OR trip_status IS DISTINCT FROM 'CLOSED'
    OR departure_at IS NULL OR departure_at <= clock_timestamp()
    OR participant_status IS DISTINCT FROM 'APPROVED'
    OR cohort_count IS NULL OR cohort_count NOT BETWEEN 2 AND 4
    OR NEW.expected_deposit_points IS DISTINCT FROM expected_points
  THEN
    RAISE EXCEPTION 'escrow shortfall projection requires a closed pre-departure approved cohort'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_escrow_shortfalls_validate_projection
BEFORE INSERT ON trip_escrow_shortfalls
FOR EACH ROW EXECUTE FUNCTION validate_trip_escrow_shortfall_projection();

CREATE OR REPLACE FUNCTION validate_trip_escrow_shortfall_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  shortfall trip_escrow_shortfalls%ROWTYPE;
  trip_status text;
  departure_at timestamptz;
  trip_host uuid;
  participant_status text;
  participant_role text;
  deposit_amount integer;
  command_trip_id uuid;
  command_type text;
  command_revision smallint;
  settlement_status text;
  settlement_policy text;
  execution_trip_id uuid;
BEGIN
  SELECT * INTO shortfall
  FROM trip_escrow_shortfalls
  WHERE shortfall_id = NEW.shortfall_id
  FOR UPDATE;
  IF NOT FOUND OR shortfall.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'escrow shortfall event must reference its owner projection'
      USING ERRCODE = '23514';
  END IF;

  SELECT g.status, g.departure_at, g.host_user_id, p.status, p.role, d.amount
  INTO trip_status, departure_at, trip_host, participant_status, participant_role, deposit_amount
  FROM trip_groups g
  JOIN trip_participants p ON p.trip_id = g.trip_id AND p.user_id = shortfall.user_id
  JOIN trip_deposits d ON d.trip_id = p.trip_id AND d.user_id = p.user_id
  WHERE g.trip_id = shortfall.trip_id
  FOR SHARE OF g, p, d;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'escrow shortfall event requires its trip deposit' USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'INCUR' THEN
    IF trip_status <> 'CLOSED'
      OR departure_at <= clock_timestamp()
      OR participant_status <> 'APPROVED'
      OR NEW.actor_user_id <> trip_host
      OR NEW.points_delta <> shortfall.expected_deposit_points - deposit_amount
      OR NEW.points_delta <= 0
    THEN
      RAISE EXCEPTION 'escrow shortfall incur must exactly cover a pre-departure deposit gap'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.event_type = 'RECONCILE' THEN
    SELECT c.trip_id, c.command_type, c.fare_revision, s.status, s.allocation_policy
    INTO command_trip_id, command_type, command_revision, settlement_status, settlement_policy
    FROM system_deadline_commands c
    JOIN trip_settlements s ON s.trip_id = c.trip_id AND s.fare_revision = c.fare_revision
    WHERE c.command_id = NEW.system_deadline_command_id
    FOR SHARE OF c, s;
    IF NOT FOUND
      OR command_trip_id <> shortfall.trip_id
      OR command_type <> 'PROVISIONAL_SETTLE'
      OR settlement_status <> 'PROVISIONALLY_SETTLED'
      OR settlement_policy <> 'HOST_APPROVAL_ORDER'
      OR NEW.points_delta <> -shortfall.outstanding_points
    THEN
      RAISE EXCEPTION 'escrow shortfall reconciliation requires its provisional settlement command'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.event_type = 'WAIVE' THEN
    SELECT trip_id INTO execution_trip_id
    FROM trip_incident_no_start_refund_executions
    WHERE execution_id = NEW.no_start_refund_execution_id
    FOR SHARE;
    IF NOT FOUND
      OR execution_trip_id <> shortfall.trip_id
      OR participant_role <> 'MEMBER'
      OR NEW.points_delta <> -shortfall.outstanding_points
    THEN
      RAISE EXCEPTION 'escrow shortfall waiver requires a member no-start refund execution'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER a_trip_escrow_shortfall_events_validate
BEFORE INSERT ON trip_escrow_shortfall_events
FOR EACH ROW EXECUTE FUNCTION validate_trip_escrow_shortfall_event();

CREATE OR REPLACE FUNCTION apply_trip_escrow_shortfall_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  shortfall trip_escrow_shortfalls%ROWTYPE;
  next_outstanding integer;
  next_status text;
BEGIN
  SELECT * INTO shortfall FROM trip_escrow_shortfalls
  WHERE shortfall_id = NEW.shortfall_id FOR UPDATE;
  next_outstanding := shortfall.outstanding_points + NEW.points_delta;
  IF next_outstanding < 0 OR next_outstanding > shortfall.expected_deposit_points THEN
    RAISE EXCEPTION 'escrow shortfall event exceeds the outstanding commitment'
      USING ERRCODE = '23514';
  END IF;
  next_status := CASE
    WHEN next_outstanding > 0 THEN 'OPEN'
    WHEN NEW.event_type = 'WAIVE' THEN 'WAIVED'
    ELSE 'SETTLED'
  END;
  UPDATE trip_escrow_shortfalls
  SET outstanding_points = next_outstanding,
      status = next_status,
      settled_at = CASE WHEN next_outstanding = 0 THEN now() ELSE NULL END
  WHERE shortfall_id = NEW.shortfall_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER z_trip_escrow_shortfall_events_apply
BEFORE INSERT ON trip_escrow_shortfall_events
FOR EACH ROW EXECUTE FUNCTION apply_trip_escrow_shortfall_event();

-- A zero held amount is valid only when the exact remaining expected deposit
-- is represented by an open shortfall.  A positive held amount still needs
-- the normal DEPOSIT ledger entry, preserving the existing append-only audit.
CREATE OR REPLACE FUNCTION validate_participant_deposit_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deposit_amount integer;
  matching_ledger_count integer;
  trip_status text;
  expected_points integer;
  cohort_count integer;
  matching_shortfall boolean;
BEGIN
  IF NEW.status <> 'DEPOSITED' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT g.status,
         count(*) FILTER (WHERE p.status IN ('APPROVED', 'DEPOSITED'))::integer,
         ceil(g.estimated_fare::numeric / nullif(count(*) FILTER (WHERE p.status IN ('APPROVED', 'DEPOSITED')), 0))::integer
  INTO trip_status, cohort_count, expected_points
  FROM trip_groups g
  JOIN trip_participants p ON p.trip_id = g.trip_id
  WHERE g.trip_id = NEW.trip_id
  GROUP BY g.status, g.estimated_fare;
  SELECT amount INTO deposit_amount FROM trip_deposits
  WHERE trip_id = NEW.trip_id AND user_id = NEW.user_id FOR SHARE;
  SELECT count(*) INTO matching_ledger_count FROM point_ledger
  WHERE trip_id = NEW.trip_id AND user_id = NEW.user_id AND entry_type = 'DEPOSIT'
    AND available_delta = -deposit_amount AND held_delta = deposit_amount;
  SELECT EXISTS (
    SELECT 1 FROM trip_escrow_shortfalls s
    WHERE s.trip_id = NEW.trip_id AND s.user_id = NEW.user_id
      AND s.expected_deposit_points = expected_points
      AND s.outstanding_points = expected_points - deposit_amount
      AND s.status = 'OPEN'
  ) INTO matching_shortfall;
  IF trip_status IS DISTINCT FROM 'CLOSED'
    OR cohort_count IS NULL OR cohort_count NOT BETWEEN 2 AND 4
    OR expected_points IS NULL
    OR deposit_amount IS NULL
    OR deposit_amount > expected_points
    OR (deposit_amount > 0 AND matching_ledger_count <> 1)
    OR (deposit_amount = 0 AND matching_ledger_count <> 0)
    OR (deposit_amount < expected_points AND NOT matching_shortfall)
    OR (deposit_amount = expected_points AND matching_shortfall)
  THEN
    RAISE EXCEPTION 'deposited participant requires exact held escrow or an audited shortfall'
      USING ERRCODE = '23514';
  END IF;
  NEW.deposited_at = COALESCE(NEW.deposited_at, now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_trip_escrow_confirmation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deposited_count integer;
  invalid_count integer;
  expected_points integer;
BEGIN
  IF NEW.status <> 'CONFIRMED' OR OLD.status = 'CONFIRMED' THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE p.status = 'DEPOSITED')
  INTO deposited_count
  FROM trip_participants p WHERE p.trip_id = NEW.trip_id;
  expected_points := ceil(NEW.estimated_fare::numeric / nullif(deposited_count, 0))::integer;
  SELECT count(*) INTO invalid_count
  FROM trip_participants p
  LEFT JOIN trip_deposits d ON d.trip_id = p.trip_id AND d.user_id = p.user_id
  WHERE p.trip_id = NEW.trip_id AND p.status = 'DEPOSITED' AND (
    d.amount IS NULL OR d.amount > expected_points
    OR (d.amount > 0 AND NOT EXISTS (
      SELECT 1 FROM point_ledger l WHERE l.trip_id = p.trip_id AND l.user_id = p.user_id
        AND l.entry_type = 'DEPOSIT' AND l.available_delta = -d.amount AND l.held_delta = d.amount
    ))
    OR (d.amount = 0 AND EXISTS (
      SELECT 1 FROM point_ledger l WHERE l.trip_id = p.trip_id AND l.user_id = p.user_id AND l.entry_type = 'DEPOSIT'
    ))
    OR (d.amount < expected_points AND NOT EXISTS (
      SELECT 1 FROM trip_escrow_shortfalls s WHERE s.trip_id = p.trip_id AND s.user_id = p.user_id
        AND s.expected_deposit_points = expected_points
        AND s.outstanding_points = expected_points - d.amount AND s.status = 'OPEN'
    ))
    OR (d.amount = expected_points AND EXISTS (
      SELECT 1 FROM trip_escrow_shortfalls s WHERE s.trip_id = p.trip_id AND s.user_id = p.user_id AND s.status = 'OPEN'
    ))
  );
  IF deposited_count NOT BETWEEN 2 AND NEW.max_participants
    OR expected_points IS NULL
    OR invalid_count <> 0
    OR EXISTS (SELECT 1 FROM trip_participants WHERE trip_id = NEW.trip_id AND status = 'APPROVED')
  THEN
    RAISE EXCEPTION 'confirmed trip requires complete held escrow or audited participant shortfalls'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- An unresolved estimated-escrow commitment blocks a different trip, while
-- leaving the current confirmation transaction free to finish atomically.
CREATE OR REPLACE FUNCTION guard_escrow_shortfall_usage_eligibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user uuid;
  target_trip uuid;
BEGIN
  IF TG_TABLE_NAME = 'trip_groups' THEN
    target_user := NEW.host_user_id;
    target_trip := NEW.trip_id;
  ELSIF TG_TABLE_NAME = 'trip_participants' THEN
    IF TG_OP = 'UPDATE' AND NEW.status NOT IN ('APPLIED', 'APPROVED') THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('APPLIED', 'APPROVED') THEN RETURN NEW; END IF;
    target_user := NEW.user_id;
    target_trip := NEW.trip_id;
  ELSE
    target_user := NEW.user_id;
    target_trip := NEW.trip_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM trip_escrow_shortfalls s
    WHERE s.user_id = target_user AND s.status = 'OPEN' AND s.trip_id <> target_trip
  ) THEN
    RAISE EXCEPTION 'unresolved escrow shortfall blocks normal use outside its current trip'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_groups_guard_escrow_shortfall_usage
BEFORE INSERT ON trip_groups
FOR EACH ROW EXECUTE FUNCTION guard_escrow_shortfall_usage_eligibility();
CREATE TRIGGER trip_participants_guard_escrow_shortfall_usage
BEFORE INSERT OR UPDATE OF status ON trip_participants
FOR EACH ROW EXECUTE FUNCTION guard_escrow_shortfall_usage_eligibility();
CREATE TRIGGER trip_deposits_guard_escrow_shortfall_usage
BEFORE INSERT ON trip_deposits
FOR EACH ROW EXECUTE FUNCTION guard_escrow_shortfall_usage_eligibility();
