-- Policy-v2 settlement guards for FR-36~40, FR-52~54 and TR-01~03.
--
-- This is deliberately forward-only.  Legacy ceiling-split settlements retain
-- their existing completion provenance and immutable ledger rows.  Policy-v2
-- uses two separate, append-only system commands: one for the provisional
-- financial settlement and one for finalisation after the dispute window.

ALTER TABLE system_deadline_commands
  DROP CONSTRAINT system_deadline_commands_command_type_check,
  ADD CONSTRAINT system_deadline_commands_command_type_check
    CHECK (command_type IN (
      'SETTLE_DEADLINE',
      'PROVISIONAL_SETTLE',
      'FINALIZE_SETTLEMENT'
    ));

ALTER TABLE trip_settlements
  ADD COLUMN provisional_deadline_command_id uuid
    REFERENCES system_deadline_commands(command_id) ON DELETE RESTRICT,
  ADD COLUMN finalization_deadline_command_id uuid
    REFERENCES system_deadline_commands(command_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX trip_settlements_provisional_command_unique_idx
  ON trip_settlements (provisional_deadline_command_id)
  WHERE provisional_deadline_command_id IS NOT NULL;

CREATE UNIQUE INDEX trip_settlements_finalization_command_unique_idx
  ON trip_settlements (finalization_deadline_command_id)
  WHERE finalization_deadline_command_id IS NOT NULL;

ALTER TABLE trip_settlements
  DROP CONSTRAINT trip_settlements_settlement_mode_valid,
  DROP CONSTRAINT trip_settlements_settlement_provenance_valid,
  ADD CONSTRAINT trip_settlements_settlement_mode_valid CHECK (
    settlement_mode IS NULL OR settlement_mode IN (
      'HOST',
      'ADMIN_FORCE',
      'SYSTEM_DEADLINE',
      'SYSTEM_PROVISIONAL',
      'SYSTEM_FINALIZE'
    )
  ),
  ADD CONSTRAINT trip_settlements_settlement_provenance_valid CHECK (
    -- Legacy pending rows and historical legacy completions remain valid.
    (
      allocation_policy = 'LEGACY_CEIL'
      AND status <> 'COMPLETED'
      AND settled_by_user_id IS NULL
      AND settlement_mode IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NULL
      AND finalization_deadline_command_id IS NULL
    )
    OR (
      allocation_policy = 'LEGACY_CEIL'
      AND status = 'COMPLETED'
      AND settlement_mode = 'HOST'
      AND settled_by_user_id IS NOT NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NULL
      AND finalization_deadline_command_id IS NULL
    )
    OR (
      allocation_policy = 'LEGACY_CEIL'
      AND status = 'COMPLETED'
      AND settlement_mode = 'ADMIN_FORCE'
      AND settled_by_user_id IS NOT NULL
      AND admin_dispute_command_id IS NOT NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NULL
      AND finalization_deadline_command_id IS NULL
    )
    OR (
      allocation_policy = 'LEGACY_CEIL'
      AND status = 'COMPLETED'
      AND settlement_mode = 'SYSTEM_DEADLINE'
      AND settled_by_user_id IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NOT NULL
      AND provisional_deadline_command_id IS NULL
      AND finalization_deadline_command_id IS NULL
    )
    OR (
      allocation_policy = 'LEGACY_CEIL'
      AND status = 'COMPLETED'
      AND settlement_mode IS NULL
      AND settled_by_user_id IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NULL
      AND finalization_deadline_command_id IS NULL
    )
    OR (
      allocation_policy = 'HOST_APPROVAL_ORDER'
      AND status = 'PENDING_CONFIRMATION'
      AND settled_by_user_id IS NULL
      AND settlement_mode IS NULL
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NULL
      AND finalization_deadline_command_id IS NULL
      AND settlement_idempotency_key IS NULL
      AND settled_at IS NULL
    )
    OR (
      allocation_policy = 'HOST_APPROVAL_ORDER'
      AND status = 'PROVISIONALLY_SETTLED'
      AND settled_by_user_id IS NULL
      AND settlement_mode = 'SYSTEM_PROVISIONAL'
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NOT NULL
      AND finalization_deadline_command_id IS NULL
      AND settlement_idempotency_key IS NULL
      AND settled_at IS NULL
    )
    OR (
      allocation_policy = 'HOST_APPROVAL_ORDER'
      AND status = 'COMPLETED'
      AND settled_by_user_id IS NULL
      AND settlement_mode = 'SYSTEM_FINALIZE'
      AND admin_dispute_command_id IS NULL
      AND system_deadline_command_id IS NULL
      AND provisional_deadline_command_id IS NOT NULL
      AND finalization_deadline_command_id IS NOT NULL
      AND settlement_idempotency_key IS NOT NULL
      AND settled_at IS NOT NULL
    )
  );

-- Debt incurred by policy-v2 provisional settlement is independently auditable
-- and tied to the same command as its ledger entries.  Existing debt events
-- have a NULL command and are intentionally not rewritten.
ALTER TABLE point_debt_events
  ADD COLUMN system_deadline_command_id uuid
    REFERENCES system_deadline_commands(command_id) ON DELETE RESTRICT;

CREATE INDEX point_debt_events_system_command_idx
  ON point_debt_events (system_deadline_command_id, debt_event_id)
  WHERE system_deadline_command_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_policy_v2_debt_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_policy text;
  settlement_revision smallint;
  command_is_provisional boolean;
BEGIN
  SELECT s.allocation_policy, s.fare_revision
  INTO settlement_policy, settlement_revision
  FROM point_debt_obligations o
  JOIN trip_settlements s ON s.trip_id = o.trip_id
  WHERE o.debt_id = NEW.debt_id
  FOR SHARE OF o, s;

  IF NOT FOUND OR settlement_policy <> 'HOST_APPROVAL_ORDER' THEN
    IF NEW.system_deadline_command_id IS NOT NULL THEN
      RAISE EXCEPTION 'only policy-v2 debt events may reference a system command'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM system_deadline_commands c
    WHERE c.command_id = NEW.system_deadline_command_id
      AND c.trip_id = (SELECT trip_id FROM point_debt_obligations WHERE debt_id = NEW.debt_id)
      AND c.fare_revision = settlement_revision
      AND c.command_type = 'PROVISIONAL_SETTLE'
  ) INTO command_is_provisional;

  IF NEW.event_type = 'INCUR' AND command_is_provisional THEN
    RETURN NEW;
  END IF;

  IF NEW.system_deadline_command_id IS NOT NULL THEN
    RAISE EXCEPTION 'policy-v2 system debt events require the provisional settlement command'
      USING ERRCODE = '23514';
  END IF;

  -- Repayments and waivers can happen later under their own authorised paths,
  -- but they cannot manufacture the initial policy-v2 obligation.
  IF NEW.event_type = 'INCUR' THEN
    RAISE EXCEPTION 'policy-v2 debt incur requires the provisional settlement command'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_debt_events_validate_policy_v2
BEFORE INSERT ON point_debt_events
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_debt_event();

CREATE OR REPLACE FUNCTION guard_trip_settlement_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_host uuid;
  all_participants_confirmed boolean;
  has_open_dispute boolean;
  has_current_resolved_dispute boolean;
  has_valid_force_command boolean;
  has_valid_system_command boolean;
  has_valid_provisional_command boolean;
  has_valid_finalization_command boolean;
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed settlements are immutable' USING ERRCODE = '55000';
  END IF;

  SELECT g.status, g.host_user_id,
         NOT EXISTS (
           SELECT 1
           FROM trip_settlement_participants sp
           LEFT JOIN fare_confirmations c
             ON c.trip_id = sp.trip_id AND c.user_id = sp.user_id
           WHERE sp.trip_id = OLD.trip_id AND c.user_id IS NULL
         ),
         EXISTS (
           SELECT 1 FROM fare_disputes d
           WHERE d.trip_id = OLD.trip_id
             AND d.fare_revision = OLD.fare_revision
             AND d.status = 'OPEN'
         ),
         EXISTS (
           SELECT 1 FROM fare_disputes d
           WHERE d.trip_id = OLD.trip_id
             AND d.fare_revision = OLD.fare_revision
             AND d.status = 'RESOLVED'
         )
  INTO trip_status, trip_host, all_participants_confirmed, has_open_dispute,
       has_current_resolved_dispute
  FROM trip_groups g
  WHERE g.trip_id = OLD.trip_id
  FOR SHARE;

  -- Policy-v2 is a closed state machine.  It has no resubmission branch after
  -- funds/debt have been provisionally recorded; an adjusted-fare remedy needs
  -- its own compensating-ledger command and is intentionally fail-closed here.
  IF OLD.allocation_policy = 'HOST_APPROVAL_ORDER' THEN
    IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING' THEN
      RAISE EXCEPTION 'policy-v2 settlement transition requires settlement-pending trip'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.trip_id IS DISTINCT FROM OLD.trip_id
      OR NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
      OR NEW.participant_count IS DISTINCT FROM OLD.participant_count
      OR NEW.final_share IS DISTINCT FROM OLD.final_share
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.fare_submission_idempotency_key IS DISTINCT FROM OLD.fare_submission_idempotency_key
      OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
      OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
      OR NEW.agreement_deadline IS DISTINCT FROM OLD.agreement_deadline
      OR NEW.dispute_deadline IS DISTINCT FROM OLD.dispute_deadline
      OR NEW.cohort_basis IS DISTINCT FROM OLD.cohort_basis
      OR NEW.allocation_policy IS DISTINCT FROM OLD.allocation_policy
      OR NEW.resubmission_required IS DISTINCT FROM OLD.resubmission_required
      OR NEW.fare_revision IS DISTINCT FROM OLD.fare_revision
    THEN
      RAISE EXCEPTION 'policy-v2 settlement proposal fields are immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'PENDING_CONFIRMATION'
      AND NEW.status = 'PROVISIONALLY_SETTLED'
    THEN
      SELECT EXISTS (
        SELECT 1 FROM system_deadline_commands c
        WHERE c.command_id = NEW.provisional_deadline_command_id
          AND c.trip_id = OLD.trip_id
          AND c.fare_revision = OLD.fare_revision
          AND c.command_type = 'PROVISIONAL_SETTLE'
      ) INTO has_valid_provisional_command;

      IF OLD.resubmission_required
        OR has_open_dispute
        OR NOT (all_participants_confirmed OR OLD.agreement_deadline <= now())
        OR NOT has_valid_provisional_command
        OR NEW.finalization_deadline_command_id IS NOT NULL
        OR NEW.system_deadline_command_id IS NOT NULL
        OR NEW.settled_by_user_id IS NOT NULL
        OR NEW.admin_dispute_command_id IS NOT NULL
        OR NEW.settlement_mode <> 'SYSTEM_PROVISIONAL'
        OR NEW.settlement_idempotency_key IS NOT NULL
        OR NEW.settled_at IS NOT NULL
      THEN
        RAISE EXCEPTION 'invalid policy-v2 provisional settlement transition'
          USING ERRCODE = '23514';
      END IF;
      NEW.provisionally_settled_at := now();
      RETURN NEW;
    END IF;

    IF OLD.status = 'PROVISIONALLY_SETTLED'
      AND NEW.status = 'COMPLETED'
    THEN
      SELECT EXISTS (
        SELECT 1 FROM system_deadline_commands c
        WHERE c.command_id = OLD.provisional_deadline_command_id
          AND c.trip_id = OLD.trip_id
          AND c.fare_revision = OLD.fare_revision
          AND c.command_type = 'PROVISIONAL_SETTLE'
      ) INTO has_valid_provisional_command;
      SELECT EXISTS (
        SELECT 1 FROM system_deadline_commands c
        WHERE c.command_id = NEW.finalization_deadline_command_id
          AND c.trip_id = OLD.trip_id
          AND c.fare_revision = OLD.fare_revision
          AND c.command_type = 'FINALIZE_SETTLEMENT'
      ) INTO has_valid_finalization_command;

      IF has_open_dispute
        OR OLD.dispute_deadline > now()
        OR NOT has_valid_provisional_command
        OR NOT has_valid_finalization_command
        OR NEW.provisional_deadline_command_id IS DISTINCT FROM OLD.provisional_deadline_command_id
        OR NEW.provisionally_settled_at IS DISTINCT FROM OLD.provisionally_settled_at
        OR NEW.system_deadline_command_id IS NOT NULL
        OR NEW.settled_by_user_id IS NOT NULL
        OR NEW.admin_dispute_command_id IS NOT NULL
        OR NEW.settlement_mode <> 'SYSTEM_FINALIZE'
        OR NEW.settlement_idempotency_key IS NULL
      THEN
        RAISE EXCEPTION 'invalid policy-v2 final settlement transition'
          USING ERRCODE = '23514';
      END IF;
      NEW.settled_at := now();
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid policy-v2 settlement state transition'
      USING ERRCODE = '23514';
  END IF;

  -- Preserve the established legacy guard exactly for LEGACY_CEIL rows.
  IF NOT OLD.resubmission_required AND NEW.resubmission_required THEN
    IF NOT has_current_resolved_dispute
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

  IF settlement_status = 'PENDING_CONFIRMATION'
    AND confirmation_deadline > now()
    AND NOT has_confirmation
  THEN
    RETURN NEW;
  END IF;

  IF settlement_policy = 'HOST_APPROVAL_ORDER'
    AND settlement_status = 'PROVISIONALLY_SETTLED'
    AND dispute_deadline > now()
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'fare dispute is outside the settlement dispute window'
    USING ERRCODE = '23514';
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
  settlement_policy text;
  confirmation_deadline timestamptz;
  dispute_deadline timestamptz;
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

  SELECT g.status, s.status, s.allocation_policy, s.confirmation_deadline,
         s.dispute_deadline
  INTO trip_status, settlement_status, settlement_policy, confirmation_deadline,
       dispute_deadline
  FROM trip_groups g
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  WHERE g.trip_id = OLD.trip_id
  FOR UPDATE OF g, s;

  IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING' THEN
    RAISE EXCEPTION 'fare dispute resolution requires a settlement-pending trip'
      USING ERRCODE = '23514';
  END IF;

  IF settlement_policy = 'HOST_APPROVAL_ORDER'
    AND settlement_status = 'PROVISIONALLY_SETTLED'
  THEN
    -- A changed fare after provisional financial posting requires a dedicated
    -- compensating-ledger command.  Until that command exists, it is safer to
    -- reject rather than silently mark the dispute resolved.
    IF NEW.status = 'RESOLVED' THEN
      RAISE EXCEPTION 'policy-v2 post-provisional fare adjustments are not yet supported'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status = 'WITHDRAWN' THEN
      IF dispute_deadline <= now() OR NEW.resolved_by_user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'only the disputing participant can withdraw before the dispute deadline'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- REJECTED requires an active administrator below; it remains possible
    -- after the 24-hour filing window so an already-open dispute can be closed.
  ELSIF settlement_status = 'PENDING_CONFIRMATION' THEN
    IF NEW.status = 'WITHDRAWN' THEN
      IF confirmation_deadline <= now() OR NEW.resolved_by_user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'only the disputing participant can withdraw a fare dispute'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    RAISE EXCEPTION 'fare dispute resolution requires a pending or provisional settlement'
      USING ERRCODE = '23514';
  END IF;

  SELECT role, account_status INTO resolver_role, resolver_status
  FROM users WHERE user_id = NEW.resolved_by_user_id FOR SHARE;
  IF resolver_role <> 'ADMIN' OR resolver_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'fare dispute resolution requires an active administrator'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Ledger writes for policy-v2 remain server-only and require the provisional
-- command.  The deferred aggregate trigger below proves the complete
-- deposit/refund/debit/debt decomposition before the status transition commits.
CREATE OR REPLACE FUNCTION validate_boarded_settlement_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_host uuid;
  trip_status text;
  settlement_status text;
  settlement_policy text;
  cohort_basis text;
  settlement_revision smallint;
  deposit_amount integer;
  share_amount integer;
  is_confirmed_cohort boolean;
  actor_is_allowed boolean;
  provisional_command_valid boolean;
BEGIN
  IF NEW.entry_type NOT IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT') THEN RETURN NEW; END IF;
  SELECT g.host_user_id, g.status, s.status, s.allocation_policy, s.cohort_basis,
         s.fare_revision, d.amount,
         CASE WHEN s.allocation_policy = 'HOST_APPROVAL_ORDER'
           THEN sp.allocated_share ELSE s.final_share END,
         sp.user_id IS NOT NULL
  INTO trip_host, trip_status, settlement_status, settlement_policy, cohort_basis,
       settlement_revision, deposit_amount, share_amount, is_confirmed_cohort
  FROM trip_groups g
  JOIN trip_deposits d ON d.trip_id = g.trip_id AND d.user_id = NEW.user_id
  JOIN trip_settlements s ON s.trip_id = g.trip_id
  LEFT JOIN trip_settlement_participants sp ON sp.trip_id = d.trip_id AND sp.user_id = d.user_id
  WHERE g.trip_id = NEW.trip_id FOR SHARE OF g, d, s;

  IF settlement_policy = 'HOST_APPROVAL_ORDER' THEN
    SELECT EXISTS (
      SELECT 1 FROM system_deadline_commands c
      WHERE c.command_id = NEW.system_deadline_command_id
        AND c.trip_id = NEW.trip_id
        AND c.fare_revision = settlement_revision
        AND c.command_type = 'PROVISIONAL_SETTLE'
    ) INTO provisional_command_valid;
    IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING'
      OR settlement_status NOT IN ('PENDING_CONFIRMATION', 'PROVISIONALLY_SETTLED')
      OR cohort_basis <> 'ESCROW_CONFIRMED' OR is_confirmed_cohort IS DISTINCT FROM true
      OR NEW.actor_user_id IS NOT NULL OR NOT provisional_command_valid
      OR (NEW.entry_type = 'SETTLEMENT_CHARGE' AND (
        share_amount <= 0 OR NEW.available_delta <> 0
        OR NEW.held_delta <> -least(deposit_amount, share_amount)
      ))
      OR (NEW.entry_type = 'REFUND' AND (
        deposit_amount <= share_amount OR NEW.available_delta <> deposit_amount - share_amount
        OR NEW.held_delta <> -NEW.available_delta
      ))
      OR (NEW.entry_type = 'ADDITIONAL_DEBIT' AND (
        deposit_amount >= share_amount OR NEW.available_delta >= 0
        OR NEW.available_delta < -(share_amount - deposit_amount)
        OR NEW.held_delta <> 0
      ))
    THEN
      RAISE EXCEPTION 'policy-v2 settlement ledger entry does not match its allocated share'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION validate_policy_v2_settlement_financials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_trip_id uuid;
  settlement_row trip_settlements%ROWTYPE;
  invalid_rows integer;
BEGIN
  IF TG_TABLE_NAME = 'point_debt_events' THEN
    SELECT o.trip_id INTO affected_trip_id
    FROM point_debt_obligations o
    WHERE o.debt_id = COALESCE(NEW.debt_id, OLD.debt_id);
  ELSE
    affected_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
  END IF;

  SELECT * INTO settlement_row
  FROM trip_settlements
  WHERE trip_id = affected_trip_id;

  IF NOT FOUND OR settlement_row.allocation_policy <> 'HOST_APPROVAL_ORDER'
    OR settlement_row.status = 'PENDING_CONFIRMATION'
  THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO invalid_rows
  FROM trip_settlement_participants sp
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(-l.held_delta) FILTER (WHERE l.entry_type = 'SETTLEMENT_CHARGE'), 0)::integer AS charged,
      coalesce(sum(l.available_delta) FILTER (WHERE l.entry_type = 'REFUND'), 0)::integer AS refunded,
      coalesce(sum(-l.available_delta) FILTER (WHERE l.entry_type = 'ADDITIONAL_DEBIT'), 0)::integer AS debited
    FROM point_ledger l
    WHERE l.trip_id = sp.trip_id
      AND l.user_id = sp.user_id
      AND l.system_deadline_command_id = settlement_row.provisional_deadline_command_id
      AND l.entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
  ) ledger ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(e.debt_delta) FILTER (WHERE e.event_type = 'INCUR'), 0)::integer AS incurred
    FROM point_debt_obligations o
    JOIN point_debt_events e ON e.debt_id = o.debt_id
    WHERE o.trip_id = sp.trip_id
      AND o.user_id = sp.user_id
      AND o.fare_revision = settlement_row.fare_revision
      AND e.system_deadline_command_id = settlement_row.provisional_deadline_command_id
  ) debt ON true
  WHERE sp.trip_id = affected_trip_id
    AND (
      ledger.charged <> least(sp.deposit_amount, sp.allocated_share)
      OR ledger.refunded <> greatest(sp.deposit_amount - sp.allocated_share, 0)
      OR ledger.debited + debt.incurred <> greatest(sp.allocated_share - sp.deposit_amount, 0)
    );

  IF invalid_rows <> 0 THEN
    RAISE EXCEPTION 'policy-v2 provisional settlement must have an exact ledger and debt decomposition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trip_settlements_validate_policy_v2_financials
AFTER UPDATE ON trip_settlements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_settlement_financials();

CREATE CONSTRAINT TRIGGER point_ledger_validate_policy_v2_financials
AFTER INSERT ON point_ledger
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_settlement_financials();

CREATE CONSTRAINT TRIGGER point_debt_events_validate_policy_v2_financials
AFTER INSERT ON point_debt_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_settlement_financials();

CREATE INDEX fare_disputes_v2_open_lookup_idx
  ON fare_disputes (trip_id, fare_revision, user_id)
  WHERE status = 'OPEN';
