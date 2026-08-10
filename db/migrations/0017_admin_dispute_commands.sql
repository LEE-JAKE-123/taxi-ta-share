-- Administrator dispute decisions are append-only. The user explicitly
-- authorized a narrowly scoped operational override: an active administrator
-- may revise an unfinalized fare proposal, or finalize the last open dispute.

ALTER TABLE fare_disputes
  ADD COLUMN fare_revision smallint;

UPDATE fare_disputes d
SET fare_revision = s.fare_revision
FROM trip_settlements s
WHERE s.trip_id = d.trip_id
  AND d.fare_revision IS NULL;

ALTER TABLE fare_disputes
  ALTER COLUMN fare_revision SET NOT NULL,
  ADD CONSTRAINT fare_disputes_fare_revision_valid CHECK (fare_revision > 0);

CREATE TABLE admin_dispute_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  dispute_id uuid NOT NULL REFERENCES fare_disputes(dispute_id) ON DELETE RESTRICT,
  fare_revision smallint NOT NULL CHECK (fare_revision > 0),
  command_type text NOT NULL CHECK (command_type IN ('ADJUST_FARE', 'FORCE_SETTLE')),
  previous_actual_fare integer NOT NULL CHECK (previous_actual_fare BETWEEN 1 AND 1000000),
  revised_actual_fare integer NOT NULL CHECK (revised_actual_fare BETWEEN 1 AND 1000000),
  participant_count smallint NOT NULL CHECK (participant_count BETWEEN 2 AND 4),
  final_share integer NOT NULL CHECK (final_share = ceil(revised_actual_fare::numeric / participant_count)::integer),
  confirmation_count smallint NOT NULL CHECK (confirmation_count BETWEEN 0 AND participant_count),
  confirmation_deadline timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 1000),
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_dispute_commands_idempotent UNIQUE (admin_user_id, idempotency_key),
  CONSTRAINT admin_dispute_commands_adjusts_amount CHECK (
    (command_type = 'ADJUST_FARE' AND revised_actual_fare <> previous_actual_fare)
    OR (command_type = 'FORCE_SETTLE' AND revised_actual_fare = previous_actual_fare)
  )
);

CREATE UNIQUE INDEX admin_dispute_commands_one_force_per_revision_idx
  ON admin_dispute_commands (trip_id, fare_revision)
  WHERE command_type = 'FORCE_SETTLE';

CREATE OR REPLACE FUNCTION prevent_admin_dispute_command_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin dispute commands are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_dispute_commands_prevent_mutation
BEFORE UPDATE OR DELETE ON admin_dispute_commands
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_dispute_command_mutation();

ALTER TABLE trip_settlements
  ADD COLUMN settled_by_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN settlement_mode text,
  ADD COLUMN admin_dispute_command_id uuid REFERENCES admin_dispute_commands(command_id) ON DELETE RESTRICT,
  ADD CONSTRAINT trip_settlements_settlement_mode_valid CHECK (
    settlement_mode IS NULL OR settlement_mode IN ('HOST', 'ADMIN_FORCE')
  ),
  ADD CONSTRAINT trip_settlements_settlement_provenance_valid CHECK (
    (status <> 'COMPLETED' AND settled_by_user_id IS NULL AND settlement_mode IS NULL AND admin_dispute_command_id IS NULL)
    OR (status = 'COMPLETED' AND settlement_mode = 'HOST' AND settled_by_user_id IS NOT NULL AND admin_dispute_command_id IS NULL)
    OR (status = 'COMPLETED' AND settlement_mode = 'ADMIN_FORCE' AND settled_by_user_id IS NOT NULL AND admin_dispute_command_id IS NOT NULL)
    OR (status = 'COMPLETED' AND settlement_mode IS NULL AND settled_by_user_id IS NULL AND admin_dispute_command_id IS NULL)
  );

CREATE OR REPLACE FUNCTION validate_fare_dispute_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  settlement_status text;
  submitted_by uuid;
  confirmation_deadline timestamptz;
  settlement_revision smallint;
  has_confirmation boolean;
BEGIN
  SELECT g.status, s.status, s.submitted_by, s.confirmation_deadline,
         s.fare_revision,
         EXISTS (
           SELECT 1 FROM fare_confirmations c
           WHERE c.trip_id = NEW.trip_id AND c.user_id = NEW.user_id
         )
  INTO trip_status, settlement_status, submitted_by, confirmation_deadline,
       settlement_revision, has_confirmation
  FROM trip_groups g
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  JOIN trip_deposits d ON d.trip_id = g.trip_id AND d.user_id = NEW.user_id
  WHERE g.trip_id = NEW.trip_id
  FOR UPDATE OF g, s, d;

  IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_status <> 'PENDING_CONFIRMATION'
    OR submitted_by = NEW.user_id OR confirmation_deadline <= now()
    OR has_confirmation OR NEW.fare_revision <> settlement_revision
  THEN
    RAISE EXCEPTION 'fare dispute requires the current pending settlement revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

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
    OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision
  THEN
    RAISE EXCEPTION 'fare dispute resolution is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('RESOLVED', 'REJECTED', 'WITHDRAWN')
    OR NEW.resolved_at IS NULL OR NEW.resolution_note IS NULL
    OR btrim(NEW.resolution_note) = '' OR NEW.resolved_by_user_id IS NULL
    OR NEW.resolution_idempotency_key IS NULL
  THEN
    RAISE EXCEPTION 'fare dispute resolution requires status, actor, note, and idempotency key'
      USING ERRCODE = '23514';
  END IF;
  SELECT g.status, s.status, s.confirmation_deadline
  INTO trip_status, settlement_status, confirmation_deadline
  FROM trip_groups g JOIN trip_settlements s ON s.trip_id = g.trip_id
  WHERE g.trip_id = OLD.trip_id FOR UPDATE OF g, s;
  IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_status <> 'PENDING_CONFIRMATION'
  THEN
    RAISE EXCEPTION 'fare dispute resolution requires a pending settlement' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'WITHDRAWN' THEN
    IF confirmation_deadline <= now() OR NEW.resolved_by_user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'only the disputing participant can withdraw a fare dispute' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT role, account_status INTO resolver_role, resolver_status
  FROM users WHERE user_id = NEW.resolved_by_user_id FOR SHARE;
  IF resolver_role <> 'ADMIN' OR resolver_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'fare dispute resolution requires an active administrator' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_trip_settlement_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_host uuid;
  has_current_resolved_dispute boolean;
  has_valid_force_command boolean;
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed settlements are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT g.status, g.host_user_id,
         EXISTS (SELECT 1 FROM fare_disputes d WHERE d.trip_id = OLD.trip_id AND d.status = 'RESOLVED' AND d.fare_revision = OLD.fare_revision)
  INTO trip_status, trip_host, has_current_resolved_dispute
  FROM trip_groups g WHERE g.trip_id = OLD.trip_id FOR SHARE;
  IF NOT OLD.resubmission_required AND NEW.resubmission_required THEN
    IF trip_status <> 'SETTLEMENT_PENDING' OR NOT has_current_resolved_dispute
      OR NEW.status IS DISTINCT FROM OLD.status OR NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
      OR NEW.participant_count IS DISTINCT FROM OLD.participant_count OR NEW.final_share IS DISTINCT FROM OLD.final_share
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.fare_submission_idempotency_key IS DISTINCT FROM OLD.fare_submission_idempotency_key
      OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
      OR NEW.cohort_basis IS DISTINCT FROM OLD.cohort_basis OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision
      OR NEW.settled_by_user_id IS DISTINCT FROM OLD.settled_by_user_id OR NEW.settlement_mode IS DISTINCT FROM OLD.settlement_mode
      OR NEW.admin_dispute_command_id IS DISTINCT FROM OLD.admin_dispute_command_id
    THEN RAISE EXCEPTION 'only a current resolved dispute can invalidate a pending fare submission' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.resubmission_required AND NOT NEW.resubmission_required THEN
    IF trip_status <> 'IN_PROGRESS' OR NEW.status <> 'PENDING_CONFIRMATION'
      OR NEW.participant_count IS DISTINCT FROM OLD.participant_count OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.cohort_basis <> 'ESCROW_CONFIRMED' OR NEW.final_share <> ceil(NEW.actual_fare::numeric / NEW.participant_count)::integer
      OR NEW.fare_revision <> OLD.fare_revision + 1 OR NEW.settlement_idempotency_key IS NOT NULL OR NEW.settled_at IS NOT NULL
      OR NEW.settled_by_user_id IS NOT NULL OR NEW.settlement_mode IS NOT NULL OR NEW.admin_dispute_command_id IS NOT NULL
    THEN RAISE EXCEPTION 'fare resubmission must replace an unresolved pending proposal' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM admin_dispute_commands c JOIN users u ON u.user_id = c.admin_user_id
    WHERE c.command_id = NEW.admin_dispute_command_id AND c.trip_id = OLD.trip_id
      AND c.fare_revision = OLD.fare_revision AND c.command_type = 'FORCE_SETTLE'
      AND c.admin_user_id = NEW.settled_by_user_id AND u.role = 'ADMIN' AND u.account_status = 'ACTIVE'
  ) INTO has_valid_force_command;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
    OR NEW.participant_count IS DISTINCT FROM OLD.participant_count OR NEW.final_share IS DISTINCT FROM OLD.final_share
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.fare_submission_idempotency_key IS DISTINCT FROM OLD.fare_submission_idempotency_key
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
    OR NEW.cohort_basis IS DISTINCT FROM OLD.cohort_basis OR NEW.resubmission_required IS DISTINCT FROM OLD.resubmission_required
    OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision OR NEW.status <> 'COMPLETED'
    OR NEW.settlement_idempotency_key IS NULL OR NEW.settled_at IS NULL
    OR NOT ((NEW.settlement_mode = 'HOST' AND NEW.settled_by_user_id = trip_host AND NEW.admin_dispute_command_id IS NULL)
      OR (NEW.settlement_mode = 'ADMIN_FORCE' AND has_valid_force_command))
  THEN RAISE EXCEPTION 'invalid settlement completion update' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_boarded_settlement_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_host uuid;
  trip_status text;
  settlement_status text;
  cohort_basis text;
  settlement_revision smallint;
  deposit_amount integer;
  share_amount integer;
  is_confirmed_cohort boolean;
  actor_is_allowed boolean;
BEGIN
  IF NEW.entry_type NOT IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT') THEN RETURN NEW; END IF;
  SELECT g.host_user_id, g.status, s.status, s.cohort_basis, s.fare_revision, d.amount, s.final_share, sp.user_id IS NOT NULL
  INTO trip_host, trip_status, settlement_status, cohort_basis, settlement_revision, deposit_amount, share_amount, is_confirmed_cohort
  FROM trip_groups g JOIN trip_deposits d ON d.trip_id = g.trip_id AND d.user_id = NEW.user_id
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  LEFT JOIN trip_settlement_participants sp ON sp.trip_id = d.trip_id AND sp.user_id = d.user_id
  WHERE g.trip_id = NEW.trip_id FOR SHARE OF g, d, s;
  SELECT NEW.actor_user_id = trip_host OR EXISTS (
    SELECT 1 FROM admin_dispute_commands c JOIN users u ON u.user_id = c.admin_user_id
    WHERE c.trip_id = NEW.trip_id AND c.fare_revision = settlement_revision
      AND c.command_type = 'FORCE_SETTLE' AND c.admin_user_id = NEW.actor_user_id
      AND u.role = 'ADMIN' AND u.account_status = 'ACTIVE'
  ) INTO actor_is_allowed;
  IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING' OR settlement_status <> 'PENDING_CONFIRMATION'
    OR cohort_basis <> 'ESCROW_CONFIRMED' OR is_confirmed_cohort IS DISTINCT FROM true OR NOT actor_is_allowed
    OR (NEW.entry_type = 'SETTLEMENT_CHARGE' AND (NEW.available_delta <> 0 OR NEW.held_delta <> -least(deposit_amount, share_amount)))
    OR (NEW.entry_type = 'REFUND' AND (deposit_amount <= share_amount OR NEW.available_delta <> deposit_amount - share_amount OR NEW.held_delta <> -NEW.available_delta))
    OR (NEW.entry_type = 'ADDITIONAL_DEBIT' AND (deposit_amount >= share_amount OR NEW.available_delta <> -(share_amount - deposit_amount) OR NEW.held_delta <> 0))
  THEN RAISE EXCEPTION 'settlement ledger entry does not match the confirmed cohort' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
