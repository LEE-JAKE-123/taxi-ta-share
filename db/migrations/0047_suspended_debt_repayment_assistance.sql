-- FR-05, FR-31~40, FR-50~54, TR-01~03:
-- A safety-suspended user may receive only a dual-controlled settlement
-- assistance grant. It is fully consumed by existing final point debt in the
-- same transaction; it never restores general account access or creates a
-- spendable surplus.

ALTER TABLE point_grant_execution_requests
  ADD COLUMN purpose text NOT NULL DEFAULT 'GENERAL',
  ADD CONSTRAINT point_grant_execution_requests_purpose_valid
    CHECK (purpose IN ('GENERAL', 'SETTLEMENT_DEBT_REPAYMENT'));

ALTER TABLE point_debt_events
  ADD COLUMN grant_execution_request_id uuid
    REFERENCES point_grant_execution_requests(execution_request_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT point_debt_events_grant_execution_shape_valid
    CHECK (
      grant_execution_request_id IS NULL
      OR event_type = 'REPAYMENT'
    );

CREATE INDEX point_debt_events_grant_execution_request_idx
  ON point_debt_events (grant_execution_request_id)
  WHERE grant_execution_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_point_grant_execution_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requester_role text;
  requester_status text;
  target_role text;
  target_status text;
  target_name text;
  source_row point_grant_requests%ROWTYPE;
BEGIN
  SELECT role, account_status
  INTO requester_role, requester_status
  FROM users
  WHERE user_id = NEW.requested_by_admin_id
  FOR SHARE;

  SELECT role, account_status, name
  INTO target_role, target_status, target_name
  FROM users
  WHERE user_id = NEW.target_user_id
  FOR SHARE;

  IF requester_role <> 'ADMIN'
    OR requester_status <> 'ACTIVE'
    OR target_role <> 'USER'
    OR lower(btrim(COALESCE(target_name, ''))) IN (
      'map api', 'route api', 'production verification', 'production verfication'
    )
  THEN
    RAISE EXCEPTION 'grant execution request requires an active admin and eligible user target'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.purpose = 'GENERAL' THEN
    IF target_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'general grant execution request requires an active user target'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.purpose = 'SETTLEMENT_DEBT_REPAYMENT' THEN
    IF target_status <> 'SUSPENDED'
      OR NEW.source_point_request_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM point_debt_obligations d
        WHERE d.user_id = NEW.target_user_id
          AND d.status = 'OPEN'
      )
    THEN
      RAISE EXCEPTION 'settlement debt repayment requires a suspended user with open final debt'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown point grant purpose' USING ERRCODE = '23514';
  END IF;

  IF NEW.source_point_request_id IS NOT NULL THEN
    SELECT *
    INTO source_row
    FROM point_grant_requests
    WHERE request_id = NEW.source_point_request_id
    FOR UPDATE;

    IF NOT FOUND
      OR source_row.status <> 'PENDING'
      OR source_row.requester_user_id <> NEW.target_user_id
      OR source_row.requested_amount <> NEW.amount
      OR source_row.reason <> NEW.reason
    THEN
      RAISE EXCEPTION 'execution request must exactly match one pending user point request'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_sprint6_point_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_status text;
  actor_is_admin boolean;
  request_row point_grant_requests%ROWTYPE;
  execution_row point_grant_execution_requests%ROWTYPE;
  approval_row point_grant_approval_commands%ROWTYPE;
  trip_status text;
  trip_host uuid;
  participant_status text;
  deposit_amount integer;
BEGIN
  IF NEW.entry_type = 'ADMIN_GRANT' THEN
    SELECT account_status
    INTO target_status
    FROM users
    WHERE user_id = NEW.user_id
    FOR SHARE;

    SELECT account_status = 'ACTIVE' AND role = 'ADMIN'
    INTO actor_is_admin
    FROM users
    WHERE user_id = NEW.actor_user_id
    FOR SHARE;

    IF actor_is_admin IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'admin grant requires an active admin'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.grant_execution_request_id IS NULL
      OR NEW.grant_approval_command_id IS NULL
    THEN
      RAISE EXCEPTION 'new admin grants require execution request and independent approval provenance'
        USING ERRCODE = '23514';
    END IF;

    SELECT *
    INTO execution_row
    FROM point_grant_execution_requests
    WHERE execution_request_id = NEW.grant_execution_request_id
    FOR SHARE;

    SELECT *
    INTO approval_row
    FROM point_grant_approval_commands
    WHERE approval_command_id = NEW.grant_approval_command_id
    FOR SHARE;

    IF execution_row.execution_request_id IS NULL
      OR approval_row.approval_command_id IS NULL
      OR approval_row.execution_request_id <> execution_row.execution_request_id
      OR execution_row.target_user_id <> NEW.user_id
      OR execution_row.amount <> NEW.available_delta
      OR execution_row.reason <> NEW.reason
      OR execution_row.requested_by_admin_id <> NEW.actor_user_id
      OR approval_row.approved_by_admin_id = NEW.actor_user_id
      OR (
        execution_row.purpose = 'GENERAL'
        AND target_status <> 'ACTIVE'
      )
      OR (
        execution_row.purpose = 'SETTLEMENT_DEBT_REPAYMENT'
        AND target_status <> 'SUSPENDED'
      )
    THEN
      RAISE EXCEPTION 'admin grant does not match its approved execution request'
        USING ERRCODE = '23514';
    END IF;

    IF execution_row.purpose = 'SETTLEMENT_DEBT_REPAYMENT'
      AND (
        execution_row.source_point_request_id IS NOT NULL
        OR NEW.point_request_id IS NOT NULL
      )
    THEN
      RAISE EXCEPTION 'settlement debt repayment must not use a user point request'
        USING ERRCODE = '23514';
    END IF;

    IF execution_row.source_point_request_id IS NULL THEN
      IF NEW.point_request_id IS NOT NULL THEN
        RAISE EXCEPTION 'direct grant must not reference a user point request'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT *
      INTO request_row
      FROM point_grant_requests
      WHERE request_id = execution_row.source_point_request_id
      FOR UPDATE;

      IF NOT FOUND
        OR request_row.status <> 'PENDING'
        OR NEW.point_request_id <> request_row.request_id
        OR request_row.requester_user_id <> NEW.user_id
        OR request_row.requested_amount <> NEW.available_delta
        OR request_row.reason <> NEW.reason
      THEN
        RAISE EXCEPTION 'grant does not match a pending approved point request'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.point_request_id IS NOT NULL
    OR NEW.grant_execution_request_id IS NOT NULL
    OR NEW.grant_approval_command_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'only admin grants may reference grant workflow records'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.entry_type = 'DEPOSIT' THEN
    SELECT account_status
    INTO target_status
    FROM users
    WHERE user_id = NEW.user_id
    FOR SHARE;

    SELECT g.status, g.host_user_id, p.status, d.amount
    INTO trip_status, trip_host, participant_status, deposit_amount
    FROM trip_groups g
    JOIN trip_participants p
      ON p.trip_id = g.trip_id
     AND p.user_id = NEW.user_id
    JOIN trip_deposits d
      ON d.trip_id = p.trip_id
     AND d.user_id = p.user_id
    WHERE g.trip_id = NEW.trip_id
    FOR UPDATE OF g, p;

    IF NOT FOUND
      OR target_status <> 'ACTIVE'
      OR trip_status <> 'CLOSED'
      OR trip_host <> NEW.actor_user_id
      OR participant_status NOT IN ('APPROVED', 'DEPOSITED')
      OR deposit_amount <> NEW.held_delta
      OR deposit_amount <> -NEW.available_delta
    THEN
      RAISE EXCEPTION 'deposit ledger must match a closed trip participant deposit'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_point_debt_repayment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger_user uuid;
  ledger_trip uuid;
  ledger_actor uuid;
  ledger_entry_type text;
  ledger_amount integer;
  debt_trip uuid;
  grant_target_user uuid;
  grant_executor uuid;
  grant_purpose text;
  grant_source_request uuid;
BEGIN
  IF NEW.event_type <> 'REPAYMENT' THEN RETURN NEW; END IF;
  SELECT l.user_id, l.trip_id, l.actor_user_id, l.entry_type,
         l.available_delta, o.trip_id
  INTO ledger_user, ledger_trip, ledger_actor, ledger_entry_type,
       ledger_amount, debt_trip
  FROM point_ledger l
  JOIN point_debt_obligations o ON o.debt_id = NEW.debt_id
  WHERE l.ledger_id = NEW.repayment_ledger_id
  FOR SHARE OF l, o;
  IF NOT FOUND
    OR ledger_entry_type <> 'DEBT_REPAYMENT'
    OR ledger_user <> NEW.user_id
    OR ledger_trip <> debt_trip
    OR ledger_actor IS DISTINCT FROM NEW.actor_user_id
    OR ledger_amount <> NEW.debt_delta
    OR ledger_amount >= 0
    OR NEW.policy_v2_adjustment_command_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'debt repayment requires a matching DEBT_REPAYMENT ledger entry'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.grant_execution_request_id IS NOT NULL THEN
    SELECT target_user_id, requested_by_admin_id, purpose, source_point_request_id
    INTO grant_target_user, grant_executor, grant_purpose, grant_source_request
    FROM point_grant_execution_requests
    WHERE execution_request_id = NEW.grant_execution_request_id
    FOR SHARE;

    IF NOT FOUND
      OR grant_purpose <> 'SETTLEMENT_DEBT_REPAYMENT'
      OR grant_source_request IS NOT NULL
      OR grant_target_user <> NEW.user_id
      OR grant_executor <> NEW.actor_user_id
    THEN
      RAISE EXCEPTION 'repayment assistance must match its suspended-user execution request'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_suspended_debt_repayment_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row point_grant_execution_requests%ROWTYPE;
  repaid_amount integer;
BEGIN
  IF NEW.entry_type <> 'ADMIN_GRANT'
    OR NEW.grant_execution_request_id IS NULL
  THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO execution_row
  FROM point_grant_execution_requests
  WHERE execution_request_id = NEW.grant_execution_request_id
  FOR SHARE;

  IF execution_row.purpose <> 'SETTLEMENT_DEBT_REPAYMENT' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(-event.debt_delta), 0)::integer
  INTO repaid_amount
  FROM point_debt_events event
  JOIN point_debt_obligations debt ON debt.debt_id = event.debt_id
  WHERE event.grant_execution_request_id = execution_row.execution_request_id
    AND event.event_type = 'REPAYMENT'
    AND event.user_id = NEW.user_id
    AND event.actor_user_id = NEW.actor_user_id
    AND debt.user_id = NEW.user_id;

  IF execution_row.target_user_id <> NEW.user_id
    OR execution_row.requested_by_admin_id <> NEW.actor_user_id
    OR execution_row.source_point_request_id IS NOT NULL
    OR repaid_amount <> NEW.available_delta
    OR EXISTS (
      SELECT 1
      FROM point_debt_obligations debt
      WHERE debt.user_id = NEW.user_id
        AND debt.status = 'OPEN'
    )
  THEN
    RAISE EXCEPTION 'suspended-user settlement assistance must be fully consumed by linked debt repayments'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER point_ledger_require_suspended_debt_repayment
AFTER INSERT ON point_ledger
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_suspended_debt_repayment_grant();
