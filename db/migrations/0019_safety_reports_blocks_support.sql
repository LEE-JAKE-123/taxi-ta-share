-- Safety operations are intentionally separate from the financial ledger.
-- Existing trips and escrow are never changed by a report or a block.

CREATE TABLE user_blocks (
  blocker_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  blocked_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id),
  CONSTRAINT user_blocks_idempotent UNIQUE (blocker_user_id, idempotency_key)
);

CREATE INDEX user_blocks_blocked_lookup_idx
  ON user_blocks (blocked_user_id, blocker_user_id);

CREATE TABLE user_reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reported_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  trip_id uuid REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  description text NOT NULL,
  evidence_ref text,
  status text NOT NULL DEFAULT 'SUBMITTED',
  reviewed_by_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  resolution_note text,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_reports_exactly_one_target CHECK (
    (reported_user_id IS NULL) <> (trip_id IS NULL)
  ),
  CONSTRAINT user_reports_not_self CHECK (
    reported_user_id IS NULL OR reporter_user_id <> reported_user_id
  ),
  CONSTRAINT user_reports_reason_valid CHECK (
    reason_code IN ('SAFETY', 'HARASSMENT', 'NO_SHOW', 'FRAUD', 'OTHER')
  ),
  CONSTRAINT user_reports_description_valid CHECK (
    btrim(description) <> '' AND char_length(description) BETWEEN 10 AND 2000
  ),
  CONSTRAINT user_reports_evidence_valid CHECK (
    evidence_ref IS NULL OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 2000)
  ),
  CONSTRAINT user_reports_status_valid CHECK (
    status IN ('SUBMITTED', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT user_reports_review_shape_valid CHECK (
    (status = 'SUBMITTED' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND resolution_note IS NULL)
    OR (status = 'IN_REVIEW' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_note IS NULL)
    OR (status IN ('RESOLVED', 'DISMISSED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND resolution_note IS NOT NULL AND btrim(resolution_note) <> '' AND char_length(resolution_note) <= 1000)
  ),
  CONSTRAINT user_reports_idempotent UNIQUE (reporter_user_id, idempotency_key)
);

CREATE INDEX user_reports_admin_queue_idx
  ON user_reports (status, created_at, report_id);

CREATE INDEX user_reports_reported_user_idx
  ON user_reports (reported_user_id, created_at DESC)
  WHERE reported_user_id IS NOT NULL;

CREATE INDEX user_reports_trip_idx
  ON user_reports (trip_id, created_at DESC)
  WHERE trip_id IS NOT NULL;

CREATE TABLE report_review_actions (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES user_reports(report_id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('START_REVIEW', 'RESOLVE', 'DISMISS', 'SUSPEND_USER')),
  resolution_note text NOT NULL CHECK (btrim(resolution_note) <> '' AND char_length(resolution_note) <= 1000),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_review_actions_idempotent UNIQUE (admin_user_id, idempotency_key)
);

CREATE TABLE support_tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('ACCOUNT', 'MATCHING', 'POINTS', 'SAFETY', 'OTHER')),
  subject text NOT NULL CHECK (btrim(subject) <> '' AND char_length(subject) BETWEEN 2 AND 120),
  body text NOT NULL CHECK (btrim(body) <> '' AND char_length(body) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'SUBMITTED',
  reviewed_by_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  resolution_note text,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_status_valid CHECK (
    status IN ('SUBMITTED', 'IN_REVIEW', 'ANSWERED', 'CLOSED')
  ),
  CONSTRAINT support_tickets_review_shape_valid CHECK (
    (status = 'SUBMITTED' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND resolution_note IS NULL)
    OR (status = 'IN_REVIEW' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_note IS NULL)
    OR (status IN ('ANSWERED', 'CLOSED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND resolution_note IS NOT NULL AND btrim(resolution_note) <> '' AND char_length(resolution_note) <= 1000)
  ),
  CONSTRAINT support_tickets_idempotent UNIQUE (requester_user_id, idempotency_key)
);

CREATE INDEX support_tickets_admin_queue_idx
  ON support_tickets (status, created_at, ticket_id);

CREATE TABLE support_ticket_actions (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('START_REVIEW', 'ANSWER', 'CLOSE')),
  resolution_note text NOT NULL CHECK (btrim(resolution_note) <> '' AND char_length(resolution_note) <= 1000),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_actions_idempotent UNIQUE (admin_user_id, idempotency_key)
);

CREATE TABLE user_enforcement_actions (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  report_id uuid NOT NULL REFERENCES user_reports(report_id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type = 'SUSPEND'),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 1000),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_enforcement_actions_idempotent UNIQUE (admin_user_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION prevent_safety_action_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'safety review actions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER report_review_actions_prevent_mutation
BEFORE UPDATE OR DELETE ON report_review_actions
FOR EACH ROW EXECUTE FUNCTION prevent_safety_action_mutation();

CREATE TRIGGER support_ticket_actions_prevent_mutation
BEFORE UPDATE OR DELETE ON support_ticket_actions
FOR EACH ROW EXECUTE FUNCTION prevent_safety_action_mutation();

CREATE TRIGGER user_enforcement_actions_prevent_mutation
BEFORE UPDATE OR DELETE ON user_enforcement_actions
FOR EACH ROW EXECUTE FUNCTION prevent_safety_action_mutation();

CREATE OR REPLACE FUNCTION guard_user_report_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reviewer_role text;
  reviewer_status text;
BEGIN
  IF OLD.reporter_user_id IS DISTINCT FROM NEW.reporter_user_id
    OR OLD.reported_user_id IS DISTINCT FROM NEW.reported_user_id
    OR OLD.trip_id IS DISTINCT FROM NEW.trip_id
    OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.evidence_ref IS DISTINCT FROM NEW.evidence_ref
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.status IN ('RESOLVED', 'DISMISSED')
  THEN
    RAISE EXCEPTION 'submitted report content and completed review are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('IN_REVIEW', 'RESOLVED', 'DISMISSED'))
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('RESOLVED', 'DISMISSED'))
  ) THEN
    RAISE EXCEPTION 'invalid report review transition' USING ERRCODE = '23514';
  END IF;
  SELECT role, account_status INTO reviewer_role, reviewer_status
  FROM users WHERE user_id = NEW.reviewed_by_user_id FOR SHARE;
  IF reviewer_role <> 'ADMIN' OR reviewer_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'report review requires an active administrator' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_reports_guard_update
BEFORE UPDATE ON user_reports
FOR EACH ROW EXECUTE FUNCTION guard_user_report_update();

CREATE OR REPLACE FUNCTION guard_support_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reviewer_role text;
  reviewer_status text;
BEGIN
  IF OLD.requester_user_id IS DISTINCT FROM NEW.requester_user_id
    OR OLD.category IS DISTINCT FROM NEW.category
    OR OLD.subject IS DISTINCT FROM NEW.subject
    OR OLD.body IS DISTINCT FROM NEW.body
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.status IN ('ANSWERED', 'CLOSED')
  THEN
    RAISE EXCEPTION 'submitted support ticket content and completed review are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('IN_REVIEW', 'ANSWERED', 'CLOSED'))
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('ANSWERED', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'invalid support ticket transition' USING ERRCODE = '23514';
  END IF;
  SELECT role, account_status INTO reviewer_role, reviewer_status
  FROM users WHERE user_id = NEW.reviewed_by_user_id FOR SHARE;
  IF reviewer_role <> 'ADMIN' OR reviewer_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'support ticket review requires an active administrator' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_tickets_guard_update
BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION guard_support_ticket_update();

CREATE OR REPLACE FUNCTION enforce_open_trip_participation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_departure_at timestamptz;
  user_is_eligible boolean;
BEGIN
  IF NEW.status NOT IN ('APPLIED', 'APPROVED') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT status, departure_at
  INTO trip_status, trip_departure_at
  FROM trip_groups
  WHERE trip_id = NEW.trip_id
  FOR UPDATE;

  IF trip_status <> 'OPEN' OR trip_departure_at <= now() THEN
    RAISE EXCEPTION 'participation requires an open trip before departure'
      USING ERRCODE = '23514';
  END IF;

  SELECT (
    account_status = 'ACTIVE'
    AND nullif(btrim(student_id), '') IS NOT NULL
    AND nullif(btrim(name), '') IS NOT NULL
    AND nullif(btrim(school_email), '') IS NOT NULL
  )
  INTO user_is_eligible
  FROM users
  WHERE user_id = NEW.user_id
  FOR SHARE;

  IF user_is_eligible IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'participant must be active with a complete profile'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trip_participants existing
    JOIN user_blocks b ON (
      (b.blocker_user_id = NEW.user_id AND b.blocked_user_id = existing.user_id)
      OR (b.blocker_user_id = existing.user_id AND b.blocked_user_id = NEW.user_id)
    )
    WHERE existing.trip_id = NEW.trip_id
      AND existing.user_id <> NEW.user_id
      AND existing.status IN ('APPROVED', 'DEPOSITED', 'CHECKED_IN', 'NO_SHOW', 'DISPUTED', 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'blocked users cannot form a new trip participation relationship'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
