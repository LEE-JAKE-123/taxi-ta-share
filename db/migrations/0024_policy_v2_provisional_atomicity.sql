-- Complete the policy-v2 provisional execution boundary for FR-35~40,
-- FR-52~54, and TR-01~03.  This migration is intentionally additive: 0022
-- and 0023 are already applied to the isolated E2E database.

-- A provisional/final command cannot become an orphan.  The command, its
-- settlement provenance, and the state transition must commit together.
CREATE OR REPLACE FUNCTION validate_policy_v2_system_command_linkage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_status text;
  settlement_policy text;
  provisional_command_id uuid;
  finalization_command_id uuid;
BEGIN
  IF NEW.command_type NOT IN ('PROVISIONAL_SETTLE', 'FINALIZE_SETTLEMENT') THEN
    RETURN NULL;
  END IF;

  SELECT status, allocation_policy, provisional_deadline_command_id,
         finalization_deadline_command_id
  INTO settlement_status, settlement_policy, provisional_command_id,
       finalization_command_id
  FROM trip_settlements
  WHERE trip_id = NEW.trip_id AND fare_revision = NEW.fare_revision;

  IF NOT FOUND OR settlement_policy <> 'HOST_APPROVAL_ORDER' THEN
    RAISE EXCEPTION 'policy-v2 system command must reference a policy-v2 settlement'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.command_type = 'PROVISIONAL_SETTLE' AND (
    settlement_status NOT IN ('PROVISIONALLY_SETTLED', 'COMPLETED')
    OR provisional_command_id IS DISTINCT FROM NEW.command_id
  ) THEN
    RAISE EXCEPTION 'provisional command must be consumed by its settlement transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.command_type = 'FINALIZE_SETTLEMENT' AND (
    settlement_status <> 'COMPLETED'
    OR finalization_command_id IS DISTINCT FROM NEW.command_id
  ) THEN
    RAISE EXCEPTION 'finalization command must be consumed by settlement completion'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER system_deadline_commands_validate_policy_v2_linkage
AFTER INSERT ON system_deadline_commands
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_system_command_linkage();

-- Financial rows are only legal after the policy-v2 settlement transition has
-- occurred in the same transaction.  The deferred aggregate guard in 0023
-- then proves the complete per-user decomposition at commit.
CREATE OR REPLACE FUNCTION guard_policy_v2_ledger_provisional_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_policy text;
  settlement_status text;
BEGIN
  IF NEW.entry_type NOT IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT') THEN
    RETURN NEW;
  END IF;
  SELECT allocation_policy, status
  INTO settlement_policy, settlement_status
  FROM trip_settlements
  WHERE trip_id = NEW.trip_id
  FOR SHARE;
  IF settlement_policy = 'HOST_APPROVAL_ORDER'
    AND settlement_status <> 'PROVISIONALLY_SETTLED'
  THEN
    RAISE EXCEPTION 'policy-v2 financial ledger requires a provisional settlement'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_ledger_guard_policy_v2_provisional_state
BEFORE INSERT ON point_ledger
FOR EACH ROW EXECUTE FUNCTION guard_policy_v2_ledger_provisional_state();

CREATE OR REPLACE FUNCTION guard_policy_v2_debt_provisional_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_policy text;
  settlement_status text;
BEGIN
  IF NEW.event_type <> 'INCUR' THEN
    RETURN NEW;
  END IF;
  SELECT s.allocation_policy, s.status
  INTO settlement_policy, settlement_status
  FROM point_debt_obligations o
  JOIN trip_settlements s ON s.trip_id = o.trip_id
  WHERE o.debt_id = NEW.debt_id
  FOR SHARE OF o, s;
  IF settlement_policy = 'HOST_APPROVAL_ORDER'
    AND settlement_status <> 'PROVISIONALLY_SETTLED'
  THEN
    RAISE EXCEPTION 'policy-v2 debt incur requires a provisional settlement'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_debt_events_guard_policy_v2_provisional_state
BEFORE INSERT ON point_debt_events
FOR EACH ROW EXECUTE FUNCTION guard_policy_v2_debt_provisional_state();

-- The user's 10-minute consent window and 24-hour dispute window are
-- independent.  A consent does not waive the right to dispute before the
-- dispute deadline, whether the worker has already provisionally settled or
-- not.  Legacy rows retain their existing confirmation-only rule.
CREATE OR REPLACE FUNCTION validate_fare_dispute_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  settlement_status text;
  settlement_policy text;
  submitted_by uuid;
  confirmation_deadline timestamptz;
  dispute_deadline timestamptz;
  settlement_revision smallint;
  has_confirmation boolean;
BEGIN
  SELECT g.status, s.status, s.allocation_policy, s.submitted_by,
         s.confirmation_deadline, s.dispute_deadline, s.fare_revision,
         EXISTS (
           SELECT 1 FROM fare_confirmations c
           WHERE c.trip_id = NEW.trip_id AND c.user_id = NEW.user_id
         )
  INTO trip_status, settlement_status, settlement_policy, submitted_by,
       confirmation_deadline, dispute_deadline, settlement_revision,
       has_confirmation
  FROM trip_groups g
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  JOIN trip_deposits d ON d.trip_id = g.trip_id AND d.user_id = NEW.user_id
  JOIN trip_settlement_participants sp ON sp.trip_id = d.trip_id AND sp.user_id = d.user_id
  WHERE g.trip_id = NEW.trip_id
  FOR UPDATE OF g, s, d;

  IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING'
    OR submitted_by = NEW.user_id OR NEW.fare_revision <> settlement_revision
  THEN
    RAISE EXCEPTION 'fare dispute requires a current settlement participant'
      USING ERRCODE = '23514';
  END IF;

  IF settlement_policy = 'HOST_APPROVAL_ORDER'
    AND settlement_status IN ('PENDING_CONFIRMATION', 'PROVISIONALLY_SETTLED')
    AND dispute_deadline > now()
  THEN
    RETURN NEW;
  END IF;

  IF settlement_status = 'PENDING_CONFIRMATION'
    AND confirmation_deadline > now()
    AND NOT has_confirmation
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'fare dispute is outside the settlement dispute window'
    USING ERRCODE = '23514';
END;
$$;

-- The fare-submission cohort guard is extended for policy-v2 snapshots while
-- retaining the legacy ceiling share as a compatibility field.  Individual
-- amounts are validated by the immutable allocation snapshot in 0022.
CREATE OR REPLACE FUNCTION validate_demo_settlement_cohort()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_host uuid;
  designated_submitter uuid;
  cohort_count integer;
BEGIN
  SELECT status, host_user_id, fare_submitter_user_id
  INTO trip_status, trip_host, designated_submitter
  FROM trip_groups
  WHERE trip_id = NEW.trip_id
  FOR SHARE;

  SELECT count(*) INTO cohort_count
  FROM trip_deposits
  WHERE trip_id = NEW.trip_id;

  IF trip_status <> 'IN_PROGRESS'
    OR (NEW.submitted_by <> trip_host AND NEW.submitted_by IS DISTINCT FROM designated_submitter)
    OR NEW.cohort_basis <> 'ESCROW_CONFIRMED'
    OR cohort_count NOT BETWEEN 2 AND 4
    OR NEW.participant_count <> cohort_count
    OR NEW.final_share <> ceil(NEW.actual_fare::numeric / cohort_count)::integer
    OR NEW.allocation_policy NOT IN ('LEGACY_CEIL', 'HOST_APPROVAL_ORDER')
  THEN
    RAISE EXCEPTION 'settlement must use the in-progress escrow-confirmed cohort and an authorized fare submitter'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
