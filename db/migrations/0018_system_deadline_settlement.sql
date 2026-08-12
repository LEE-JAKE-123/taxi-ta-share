-- System deadline settlement is an auditable, server-only execution path.
-- It never impersonates a host or administrator. A command row and all
-- ledger/state updates commit together, so a failed attempt leaves no record
-- that could be mistaken for a completed financial action.

CREATE TABLE system_deadline_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  fare_revision smallint NOT NULL CHECK (fare_revision > 0),
  command_type text NOT NULL CHECK (command_type = 'SETTLE_DEADLINE'),
  execution_key text NOT NULL CHECK (btrim(execution_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_deadline_commands_one_per_revision
    UNIQUE (trip_id, fare_revision, command_type),
  CONSTRAINT system_deadline_commands_execution_key_unique
    UNIQUE (execution_key)
);

CREATE OR REPLACE FUNCTION prevent_system_deadline_command_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'system deadline commands are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER system_deadline_commands_prevent_mutation
BEFORE UPDATE OR DELETE ON system_deadline_commands
FOR EACH ROW
EXECUTE FUNCTION prevent_system_deadline_command_mutation();

ALTER TABLE trip_settlements
  ADD COLUMN system_deadline_command_id uuid
    REFERENCES system_deadline_commands(command_id) ON DELETE RESTRICT;

ALTER TABLE point_ledger
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD COLUMN system_deadline_command_id uuid
    REFERENCES system_deadline_commands(command_id) ON DELETE RESTRICT;

ALTER TABLE point_ledger
  ADD CONSTRAINT point_ledger_actor_or_system_command_valid CHECK (
    (actor_user_id IS NOT NULL AND system_deadline_command_id IS NULL)
    OR (
      actor_user_id IS NULL
      AND system_deadline_command_id IS NOT NULL
      AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
    )
  );

ALTER TABLE trip_settlements
  DROP CONSTRAINT trip_settlements_settlement_mode_valid,
  DROP CONSTRAINT trip_settlements_settlement_provenance_valid,
  ADD CONSTRAINT trip_settlements_settlement_mode_valid CHECK (
    settlement_mode IS NULL OR settlement_mode IN ('HOST', 'ADMIN_FORCE', 'SYSTEM_DEADLINE')
  ),
  ADD CONSTRAINT trip_settlements_settlement_provenance_valid CHECK (
    (
      status <> 'COMPLETED'
      AND settled_by_user_id IS NULL
      AND settlement_mode IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
    )
    OR (
      status = 'COMPLETED'
      AND settlement_mode = 'HOST'
      AND settled_by_user_id IS NOT NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
    )
    OR (
      status = 'COMPLETED'
      AND settlement_mode = 'ADMIN_FORCE'
      AND settled_by_user_id IS NOT NULL
      AND admin_dispute_command_id IS NOT NULL
      AND system_deadline_command_id IS NULL
    )
    OR (
      status = 'COMPLETED'
      AND settlement_mode = 'SYSTEM_DEADLINE'
      AND settled_by_user_id IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NOT NULL
    )
    OR (
      -- Completed settlements created before provenance columns were added
      -- remain immutable legacy records.  Preserve this branch so applying
      -- this forward migration does not reject existing production data.
      status = 'COMPLETED'
      AND settlement_mode IS NULL
      AND settled_by_user_id IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
    )
  );

CREATE INDEX trip_settlements_pending_deadline_idx
  ON trip_settlements (confirmation_deadline, trip_id)
  WHERE status = 'PENDING_CONFIRMATION';

CREATE OR REPLACE FUNCTION guard_trip_settlement_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_host uuid;
  has_current_resolved_dispute boolean;
  has_valid_force_command boolean;
  has_valid_system_command boolean;
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
      OR NEW.system_deadline_command_id IS DISTINCT FROM OLD.system_deadline_command_id
    THEN RAISE EXCEPTION 'only a current resolved dispute can invalidate a pending fare submission' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.resubmission_required AND NOT NEW.resubmission_required THEN
    IF trip_status <> 'IN_PROGRESS' OR NEW.status <> 'PENDING_CONFIRMATION'
      OR NEW.participant_count IS DISTINCT FROM OLD.participant_count OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.cohort_basis <> 'ESCROW_CONFIRMED' OR NEW.final_share <> ceil(NEW.actual_fare::numeric / NEW.participant_count)::integer
      OR NEW.fare_revision <> OLD.fare_revision + 1 OR NEW.settlement_idempotency_key IS NOT NULL OR NEW.settled_at IS NOT NULL
      OR NEW.settled_by_user_id IS NOT NULL OR NEW.settlement_mode IS NOT NULL OR NEW.admin_dispute_command_id IS NOT NULL
      OR NEW.system_deadline_command_id IS NOT NULL
    THEN RAISE EXCEPTION 'fare resubmission must replace an unresolved pending proposal' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM admin_dispute_commands c JOIN users u ON u.user_id = c.admin_user_id
    WHERE c.command_id = NEW.admin_dispute_command_id AND c.trip_id = OLD.trip_id
      AND c.fare_revision = OLD.fare_revision AND c.command_type = 'FORCE_SETTLE'
      AND c.admin_user_id = NEW.settled_by_user_id AND u.role = 'ADMIN' AND u.account_status = 'ACTIVE'
  ) INTO has_valid_force_command;
  SELECT EXISTS (
    SELECT 1 FROM system_deadline_commands c
    WHERE c.command_id = NEW.system_deadline_command_id AND c.trip_id = OLD.trip_id
      AND c.fare_revision = OLD.fare_revision AND c.command_type = 'SETTLE_DEADLINE'
  ) INTO has_valid_system_command;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
    OR NEW.participant_count IS DISTINCT FROM OLD.participant_count OR NEW.final_share IS DISTINCT FROM OLD.final_share
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.fare_submission_idempotency_key IS DISTINCT FROM OLD.fare_submission_idempotency_key
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
    OR NEW.cohort_basis IS DISTINCT FROM OLD.cohort_basis OR NEW.resubmission_required IS DISTINCT FROM OLD.resubmission_required
    OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision OR NEW.status <> 'COMPLETED'
    OR NEW.settlement_idempotency_key IS NULL OR NEW.settled_at IS NULL
    OR NOT (
      (NEW.settlement_mode = 'HOST' AND NEW.settled_by_user_id = trip_host AND NEW.admin_dispute_command_id IS NULL AND NEW.system_deadline_command_id IS NULL)
      OR (NEW.settlement_mode = 'ADMIN_FORCE' AND has_valid_force_command AND NEW.system_deadline_command_id IS NULL)
      OR (NEW.settlement_mode = 'SYSTEM_DEADLINE' AND NEW.settled_by_user_id IS NULL AND NEW.admin_dispute_command_id IS NULL AND has_valid_system_command)
    )
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
  ) OR EXISTS (
    SELECT 1 FROM system_deadline_commands c
    WHERE c.command_id = NEW.system_deadline_command_id AND c.trip_id = NEW.trip_id
      AND c.fare_revision = settlement_revision AND c.command_type = 'SETTLE_DEADLINE'
      AND NEW.actor_user_id IS NULL
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
