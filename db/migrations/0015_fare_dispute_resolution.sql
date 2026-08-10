-- Forward-only dispute resolution. A RESOLVED dispute invalidates only an
-- unfinalized fare proposal; it never rewrites ledger entries or a completed
-- settlement.

ALTER TABLE fare_disputes
  ADD COLUMN resolved_by_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN resolution_idempotency_key uuid;

ALTER TABLE fare_disputes
  DROP CONSTRAINT fare_disputes_status_valid,
  DROP CONSTRAINT fare_disputes_resolution_valid,
  ADD CONSTRAINT fare_disputes_status_valid
    CHECK (status IN ('OPEN', 'RESOLVED', 'REJECTED', 'WITHDRAWN')),
  ADD CONSTRAINT fare_disputes_resolution_valid CHECK (
    (status = 'OPEN'
      AND resolved_at IS NULL
      AND resolution_note IS NULL
      AND resolved_by_user_id IS NULL
      AND resolution_idempotency_key IS NULL)
    OR (
      status IN ('RESOLVED', 'REJECTED', 'WITHDRAWN')
      AND resolved_at IS NOT NULL
      AND resolution_note IS NOT NULL
      AND btrim(resolution_note) <> ''
      -- RESOLVED/REJECTED rows pre-dating this migration may have an
      -- audited note but no actor/key. New resolutions are guarded below.
      AND (resolved_by_user_id IS NULL) = (resolution_idempotency_key IS NULL)
    )
  );

CREATE UNIQUE INDEX fare_disputes_resolution_idempotent_idx
  ON fare_disputes (resolved_by_user_id, resolution_idempotency_key)
  WHERE resolution_idempotency_key IS NOT NULL;

ALTER TABLE trip_settlements
  ADD COLUMN resubmission_required boolean NOT NULL DEFAULT false,
  ADD COLUMN fare_revision smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT trip_settlements_fare_revision_valid CHECK (fare_revision > 0);

CREATE OR REPLACE FUNCTION validate_fare_dispute_resolution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolver_role text;
  resolver_status text;
  trip_status text;
  settlement_status text;
  confirmation_deadline timestamptz;
BEGIN
  IF OLD.status <> 'OPEN'
    OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'fare dispute resolution is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status NOT IN ('RESOLVED', 'REJECTED', 'WITHDRAWN')
    OR NEW.resolved_at IS NULL
    OR NEW.resolution_note IS NULL
    OR btrim(NEW.resolution_note) = ''
    OR NEW.resolved_by_user_id IS NULL
    OR NEW.resolution_idempotency_key IS NULL
  THEN
    RAISE EXCEPTION 'fare dispute resolution requires status, actor, note, and idempotency key'
      USING ERRCODE = '23514';
  END IF;

  SELECT g.status, s.status, s.confirmation_deadline
  INTO trip_status, settlement_status, confirmation_deadline
  FROM trip_groups g
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  WHERE g.trip_id = OLD.trip_id
  FOR UPDATE OF g, s;

  IF NOT FOUND
    OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_status <> 'PENDING_CONFIRMATION'
  THEN
    RAISE EXCEPTION 'fare dispute resolution requires a pending settlement'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'WITHDRAWN' THEN
    IF confirmation_deadline <= now()
      OR NEW.resolved_by_user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'only the disputing participant can withdraw a fare dispute'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT role, account_status
  INTO resolver_role, resolver_status
  FROM users
  WHERE user_id = NEW.resolved_by_user_id
  FOR SHARE;

  IF resolver_role <> 'ADMIN' OR resolver_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'fare dispute resolution requires an active administrator'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fare_disputes_validate_resolution ON fare_disputes;
CREATE TRIGGER fare_disputes_validate_resolution
BEFORE UPDATE ON fare_disputes
FOR EACH ROW
EXECUTE FUNCTION validate_fare_dispute_resolution();

CREATE OR REPLACE FUNCTION prevent_trip_settlement_participant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  can_replace_snapshot boolean;
BEGIN
  SELECT s.status = 'PENDING_CONFIRMATION' AND s.resubmission_required
  INTO can_replace_snapshot
  FROM trip_settlements s
  WHERE s.trip_id = OLD.trip_id
  FOR SHARE;

  IF TG_OP = 'DELETE' AND can_replace_snapshot THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'settlement participant snapshots are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_trip_settlement_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  has_resolved_dispute boolean;
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed settlements are immutable'
      USING ERRCODE = '55000';
  END IF;

  SELECT g.status,
         EXISTS (
           SELECT 1 FROM fare_disputes d
           WHERE d.trip_id = OLD.trip_id AND d.status = 'RESOLVED'
         )
  INTO trip_status, has_resolved_dispute
  FROM trip_groups g
  WHERE g.trip_id = OLD.trip_id
  FOR SHARE;

  IF NOT OLD.resubmission_required AND NEW.resubmission_required THEN
    IF trip_status <> 'SETTLEMENT_PENDING'
      OR NOT has_resolved_dispute
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
      OR NEW.participant_count IS DISTINCT FROM OLD.participant_count
      OR NEW.final_share IS DISTINCT FROM OLD.final_share
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.fare_submission_idempotency_key IS DISTINCT FROM OLD.fare_submission_idempotency_key
      OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
      OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
      OR NEW.cohort_basis IS DISTINCT FROM OLD.cohort_basis
      OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision
    THEN
      RAISE EXCEPTION 'only a resolved dispute can invalidate a pending fare submission'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.resubmission_required AND NOT NEW.resubmission_required THEN
    IF trip_status <> 'IN_PROGRESS'
      OR NEW.status <> 'PENDING_CONFIRMATION'
      OR NEW.participant_count IS DISTINCT FROM OLD.participant_count
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.cohort_basis <> 'ESCROW_CONFIRMED'
      OR NEW.final_share <> ceil(NEW.actual_fare::numeric / NEW.participant_count)::integer
      OR NEW.fare_revision <> OLD.fare_revision + 1
      OR NEW.settlement_idempotency_key IS NOT NULL
      OR NEW.settled_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'fare resubmission must replace an unresolved pending proposal'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id
    OR NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
    OR NEW.participant_count IS DISTINCT FROM OLD.participant_count
    OR NEW.final_share IS DISTINCT FROM OLD.final_share
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.fare_submission_idempotency_key IS DISTINCT FROM OLD.fare_submission_idempotency_key
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
    OR NEW.cohort_basis IS DISTINCT FROM OLD.cohort_basis
    OR NEW.resubmission_required IS DISTINCT FROM OLD.resubmission_required
    OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision
    OR NEW.status <> 'COMPLETED'
    OR NEW.settlement_idempotency_key IS NULL
    OR NEW.settled_at IS NULL
  THEN
    RAISE EXCEPTION 'invalid settlement completion update'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
