-- FR-05 / FR-31~40 / FR-50~54 / TR-01~03:
-- Report-based and administrator-designated suspension decisions are distinct.
-- Their effect is delayed until protected trips and settlement records end.

CREATE TABLE account_suspension_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  requested_by_admin_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('REPORT', 'ADMIN_DIRECT')),
  report_id uuid REFERENCES user_reports(report_id) ON DELETE RESTRICT,
  report_review_action_id uuid REFERENCES report_review_actions(action_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 1000),
  idempotency_key uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz,
  CONSTRAINT account_suspension_request_source_shape CHECK (
    (source_type = 'REPORT' AND report_id IS NOT NULL AND report_review_action_id IS NOT NULL)
    OR (source_type = 'ADMIN_DIRECT' AND report_id IS NULL AND report_review_action_id IS NULL)
  ),
  CONSTRAINT account_suspension_request_idempotent
    UNIQUE (requested_by_admin_id, idempotency_key)
);

CREATE UNIQUE INDEX account_suspension_one_pending_per_user_idx
  ON account_suspension_requests (target_user_id)
  WHERE effective_at IS NULL;

CREATE UNIQUE INDEX account_suspension_one_report_request_idx
  ON account_suspension_requests (report_id)
  WHERE report_id IS NOT NULL;

CREATE INDEX account_suspension_pending_scan_idx
  ON account_suspension_requests (requested_at, request_id)
  WHERE effective_at IS NULL;

CREATE INDEX trip_groups_host_active_suspension_idx
  ON trip_groups (host_user_id, status, trip_id)
  WHERE status IN ('OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS', 'SETTLEMENT_PENDING');

CREATE INDEX trip_participants_user_active_suspension_idx
  ON trip_participants (user_id, trip_id, status)
  WHERE status IN ('APPLIED', 'APPROVED', 'DEPOSITED', 'CHECKED_IN', 'NO_SHOW', 'DISPUTED');

CREATE OR REPLACE FUNCTION guard_account_suspension_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_role text;
  target_status text;
  admin_role text;
  admin_status text;
BEGIN
  SELECT role, account_status INTO target_role, target_status
  FROM users WHERE user_id = NEW.target_user_id FOR KEY SHARE;
  SELECT role, account_status INTO admin_role, admin_status
  FROM users WHERE user_id = NEW.requested_by_admin_id FOR KEY SHARE;

  IF target_role <> 'USER' OR target_status <> 'ACTIVE'
    OR admin_role <> 'ADMIN' OR admin_status <> 'ACTIVE'
  THEN
    RAISE EXCEPTION 'suspension request requires active USER target and ADMIN requester'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_type = 'REPORT' AND NOT EXISTS (
    SELECT 1
    FROM user_reports report
    JOIN report_review_actions review ON review.action_id = NEW.report_review_action_id
    WHERE report.report_id = NEW.report_id
      AND report.reported_user_id = NEW.target_user_id
      AND report.reason_code <> 'NO_SHOW'
      AND review.report_id = report.report_id
      AND review.admin_user_id = NEW.requested_by_admin_id
      AND review.action_type = 'SUSPEND_USER'
      AND review.resolution_note = NEW.reason
      AND review.idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'report suspension request requires matching non-no-show review'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_suspension_requests_guard_insert
BEFORE INSERT ON account_suspension_requests
FOR EACH ROW EXECUTE FUNCTION guard_account_suspension_request();

CREATE OR REPLACE FUNCTION prevent_account_suspension_request_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.target_user_id IS DISTINCT FROM NEW.target_user_id
    OR OLD.requested_by_admin_id IS DISTINCT FROM NEW.requested_by_admin_id
    OR OLD.source_type IS DISTINCT FROM NEW.source_type
    OR OLD.report_id IS DISTINCT FROM NEW.report_id
    OR OLD.report_review_action_id IS DISTINCT FROM NEW.report_review_action_id
    OR OLD.reason IS DISTINCT FROM NEW.reason
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.requested_at IS DISTINCT FROM NEW.requested_at
    OR OLD.effective_at IS NOT NULL
    OR NEW.effective_at IS NULL
  THEN
    RAISE EXCEPTION 'suspension request is immutable after creation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_suspension_requests_prevent_mutation
BEFORE UPDATE OR DELETE ON account_suspension_requests
FOR EACH ROW EXECUTE FUNCTION prevent_account_suspension_request_mutation();

CREATE OR REPLACE FUNCTION guard_pending_suspension_new_trip_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  host_id uuid;
  target_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'trip_groups' THEN
    host_id := NEW.host_user_id;
    target_id := NEW.host_user_id;
  ELSE
    SELECT host_user_id INTO host_id FROM trip_groups
    WHERE trip_id = NEW.trip_id FOR KEY SHARE;
    target_id := NEW.user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM account_suspension_requests request
    WHERE request.effective_at IS NULL
      AND request.target_user_id IN (target_id, host_id)
  ) THEN
    RAISE EXCEPTION 'pending suspension blocks new trip activity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_groups_guard_pending_suspension
BEFORE INSERT ON trip_groups
FOR EACH ROW EXECUTE FUNCTION guard_pending_suspension_new_trip_activity();

CREATE TRIGGER trip_participants_guard_pending_suspension
BEFORE INSERT OR UPDATE OF status ON trip_participants
FOR EACH ROW
WHEN (NEW.status IN ('APPLIED', 'APPROVED'))
EXECUTE FUNCTION guard_pending_suspension_new_trip_activity();

CREATE OR REPLACE FUNCTION guard_pending_suspension_point_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM account_suspension_requests request
    WHERE request.target_user_id = NEW.requester_user_id
      AND request.effective_at IS NULL
  ) THEN
    RAISE EXCEPTION 'pending suspension blocks new point requests'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_grant_requests_guard_pending_suspension
BEFORE INSERT ON point_grant_requests
FOR EACH ROW EXECUTE FUNCTION guard_pending_suspension_point_request();

CREATE OR REPLACE FUNCTION effect_due_account_suspensions_for_user(target_user uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  request_row account_suspension_requests%ROWTYPE;
BEGIN
  FOR request_row IN
    SELECT * FROM account_suspension_requests
    WHERE target_user_id = target_user AND effective_at IS NULL
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM trip_groups g
      WHERE g.host_user_id = target_user
        AND g.status IN ('OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS', 'SETTLEMENT_PENDING')
    ) OR EXISTS (
      SELECT 1 FROM trip_participants p JOIN trip_groups g ON g.trip_id = p.trip_id
      WHERE p.user_id = target_user
        AND p.status IN ('APPLIED', 'APPROVED', 'DEPOSITED', 'CHECKED_IN', 'NO_SHOW', 'DISPUTED')
        AND g.status IN ('OPEN', 'CLOSED', 'CONFIRMED', 'IN_PROGRESS', 'SETTLEMENT_PENDING')
    ) OR EXISTS (
      SELECT 1 FROM fare_disputes WHERE user_id = target_user AND status = 'OPEN'
    ) OR EXISTS (
      SELECT 1 FROM point_accounts WHERE user_id = target_user AND held_points <> 0
    ) THEN
      CONTINUE;
    END IF;

    UPDATE account_suspension_requests
    SET effective_at = now()
    WHERE request_id = request_row.request_id AND effective_at IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF request_row.source_type = 'REPORT' THEN
      INSERT INTO user_enforcement_actions (
        user_id, report_id, admin_user_id, action_type, reason, idempotency_key
      ) VALUES (
        request_row.target_user_id, request_row.report_id,
        request_row.requested_by_admin_id, 'SUSPEND', request_row.reason,
        request_row.idempotency_key
      );
    ELSE
      INSERT INTO admin_account_actions (
        target_user_id, admin_user_id, action_type, reason, idempotency_key
      ) VALUES (
        request_row.target_user_id, request_row.requested_by_admin_id,
        'SUSPEND', request_row.reason, request_row.idempotency_key
      );
    END IF;

    UPDATE users SET account_status = 'SUSPENDED'
    WHERE user_id = request_row.target_user_id AND account_status = 'ACTIVE';
    UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now())
    WHERE user_id = request_row.target_user_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION effect_due_account_suspensions_after_trip_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  participant_id uuid;
BEGIN
  IF NEW.status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED') THEN
    RETURN NULL;
  END IF;
  PERFORM effect_due_account_suspensions_for_user(NEW.host_user_id);
  FOR participant_id IN
    SELECT user_id FROM trip_participants WHERE trip_id = NEW.trip_id
  LOOP
    PERFORM effect_due_account_suspensions_for_user(participant_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trip_groups_effect_due_account_suspensions
AFTER UPDATE OF status ON trip_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION effect_due_account_suspensions_after_trip_terminal();
