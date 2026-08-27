-- PRD 5.5.1 / FR-30~31b / TR-01~03:
-- New administrator grants require durable preparation, independent approval,
-- and execution. Historical ledger records remain untouched.

CREATE TABLE point_grant_execution_requests (
  execution_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_point_request_id uuid UNIQUE REFERENCES point_grant_requests(request_id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  amount integer NOT NULL,
  reason text NOT NULL,
  requested_by_admin_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_grant_execution_requests_amount_valid
    CHECK (amount BETWEEN 1 AND 1000000),
  CONSTRAINT point_grant_execution_requests_reason_valid
    CHECK (btrim(reason) <> '' AND char_length(reason) <= 200),
  CONSTRAINT point_grant_execution_requests_idempotent
    UNIQUE (requested_by_admin_id, idempotency_key)
);

CREATE INDEX point_grant_execution_requests_created_idx
  ON point_grant_execution_requests (created_at, execution_request_id);

CREATE TABLE point_grant_approval_commands (
  approval_command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_request_id uuid NOT NULL UNIQUE REFERENCES point_grant_execution_requests(execution_request_id) ON DELETE RESTRICT,
  approved_by_admin_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_grant_approval_commands_idempotent
    UNIQUE (approved_by_admin_id, idempotency_key)
);

CREATE INDEX point_grant_approval_commands_created_idx
  ON point_grant_approval_commands (approved_at, approval_command_id);

ALTER TABLE point_ledger
  ADD COLUMN grant_execution_request_id uuid,
  ADD COLUMN grant_approval_command_id uuid,
  ADD CONSTRAINT point_ledger_grant_execution_request_fk
    FOREIGN KEY (grant_execution_request_id)
    REFERENCES point_grant_execution_requests(execution_request_id) ON DELETE RESTRICT,
  ADD CONSTRAINT point_ledger_grant_approval_command_fk
    FOREIGN KEY (grant_approval_command_id)
    REFERENCES point_grant_approval_commands(approval_command_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX point_ledger_one_grant_per_execution_request_idx
  ON point_ledger (grant_execution_request_id)
  WHERE grant_execution_request_id IS NOT NULL;

CREATE UNIQUE INDEX point_ledger_one_grant_per_approval_command_idx
  ON point_ledger (grant_approval_command_id)
  WHERE grant_approval_command_id IS NOT NULL;

CREATE FUNCTION prevent_point_grant_dual_control_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'point grant approval records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION validate_point_grant_execution_request()
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
    OR target_status <> 'ACTIVE'
    OR lower(btrim(COALESCE(target_name, ''))) IN (
      'map api', 'route api', 'production verification', 'production verfication'
    )
  THEN
    RAISE EXCEPTION 'grant execution request requires an active admin and eligible active user target'
      USING ERRCODE = '23514';
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

CREATE TRIGGER point_grant_execution_requests_validate_insert
BEFORE INSERT ON point_grant_execution_requests
FOR EACH ROW EXECUTE FUNCTION validate_point_grant_execution_request();

CREATE TRIGGER point_grant_execution_requests_prevent_mutation
BEFORE UPDATE OR DELETE ON point_grant_execution_requests
FOR EACH ROW EXECUTE FUNCTION prevent_point_grant_dual_control_mutation();

CREATE FUNCTION validate_point_grant_approval_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row point_grant_execution_requests%ROWTYPE;
  approver_role text;
  approver_status text;
BEGIN
  SELECT *
  INTO execution_row
  FROM point_grant_execution_requests
  WHERE execution_request_id = NEW.execution_request_id
  FOR SHARE;

  SELECT role, account_status
  INTO approver_role, approver_status
  FROM users
  WHERE user_id = NEW.approved_by_admin_id
  FOR SHARE;

  IF execution_row.execution_request_id IS NULL
    OR approver_role <> 'ADMIN'
    OR approver_status <> 'ACTIVE'
    OR NEW.approved_by_admin_id = execution_row.requested_by_admin_id
    OR NEW.approved_by_admin_id = execution_row.target_user_id
  THEN
    RAISE EXCEPTION 'approval requires a different active administrator'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_grant_approval_commands_validate_insert
BEFORE INSERT ON point_grant_approval_commands
FOR EACH ROW EXECUTE FUNCTION validate_point_grant_approval_command();

CREATE TRIGGER point_grant_approval_commands_prevent_mutation
BEFORE UPDATE OR DELETE ON point_grant_approval_commands
FOR EACH ROW EXECUTE FUNCTION prevent_point_grant_dual_control_mutation();

CREATE OR REPLACE FUNCTION validate_sprint6_point_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_active boolean;
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
    SELECT account_status = 'ACTIVE'
    INTO target_active
    FROM users
    WHERE user_id = NEW.user_id
    FOR SHARE;

    SELECT account_status = 'ACTIVE' AND role = 'ADMIN'
    INTO actor_is_admin
    FROM users
    WHERE user_id = NEW.actor_user_id
    FOR SHARE;

    IF target_active IS DISTINCT FROM true OR actor_is_admin IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'admin grant requires an active target and active admin'
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
    THEN
      RAISE EXCEPTION 'admin grant does not match its approved execution request'
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
    SELECT account_status = 'ACTIVE'
    INTO target_active
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
      OR target_active IS DISTINCT FROM true
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

CREATE OR REPLACE FUNCTION validate_point_grant_request_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requester_eligible boolean;
  grant_row point_ledger%ROWTYPE;
  execution_row point_grant_execution_requests%ROWTYPE;
  approval_row point_grant_approval_commands%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT (
      account_status = 'ACTIVE'
      AND nullif(btrim(student_id), '') IS NOT NULL
      AND nullif(btrim(name), '') IS NOT NULL
      AND nullif(btrim(school_email), '') IS NOT NULL
    )
    INTO requester_eligible
    FROM users
    WHERE user_id = NEW.requester_user_id
    FOR SHARE;

    IF requester_eligible IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'point request requires an active user with a complete profile'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'FULFILLED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'fulfilled point requests are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status = 'FULFILLED' THEN
    SELECT *
    INTO grant_row
    FROM point_ledger
    WHERE ledger_id = NEW.fulfilled_ledger_id
    FOR SHARE;

    SELECT *
    INTO execution_row
    FROM point_grant_execution_requests
    WHERE source_point_request_id = NEW.request_id
    FOR SHARE;

    SELECT *
    INTO approval_row
    FROM point_grant_approval_commands
    WHERE execution_request_id = execution_row.execution_request_id
    FOR SHARE;

    IF execution_row.execution_request_id IS NULL
      OR approval_row.approval_command_id IS NULL
      OR grant_row.entry_type <> 'ADMIN_GRANT'
      OR grant_row.point_request_id <> NEW.request_id
      OR grant_row.user_id <> NEW.requester_user_id
      OR grant_row.actor_user_id <> NEW.fulfilled_by
      OR grant_row.available_delta <> NEW.requested_amount
      OR grant_row.grant_execution_request_id <> execution_row.execution_request_id
      OR grant_row.grant_approval_command_id <> approval_row.approval_command_id
      OR execution_row.requested_by_admin_id <> NEW.fulfilled_by
      OR approval_row.approved_by_admin_id = NEW.fulfilled_by
    THEN
      RAISE EXCEPTION 'request fulfillment must match independently approved admin grant ledger entry'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'invalid point request transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- A linked user request may remain pending while the two administrators
-- prepare and approve a grant. Once that grant is written to the append-only
-- ledger, though, its request fulfillment must be part of the same commit.
-- The deferred check closes the raw-SQL gap between the ledger insert and the
-- request update without requiring an update order within the transaction.
CREATE FUNCTION validate_linked_point_request_grant_fulfillment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row point_grant_execution_requests%ROWTYPE;
  request_row point_grant_requests%ROWTYPE;
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

  IF execution_row.source_point_request_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO request_row
  FROM point_grant_requests
  WHERE request_id = execution_row.source_point_request_id
  FOR SHARE;

  IF request_row.status <> 'FULFILLED'
    OR request_row.fulfilled_ledger_id IS DISTINCT FROM NEW.ledger_id
    OR request_row.fulfilled_by IS DISTINCT FROM NEW.actor_user_id
  THEN
    RAISE EXCEPTION 'linked point request must be fulfilled by its admin grant in the same transaction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER point_ledger_require_linked_point_request_fulfillment
AFTER INSERT ON point_ledger
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_linked_point_request_grant_fulfillment();
