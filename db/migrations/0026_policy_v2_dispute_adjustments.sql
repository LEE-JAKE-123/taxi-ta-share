-- FR-35~40, FR-52~54, TR-01~03: a post-provisional fare adjustment never
-- rewrites the original settlement snapshot or ledger.  It records one
-- administrator command plus deterministic per-user compensation instead.

CREATE TABLE policy_v2_adjustment_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  dispute_id uuid NOT NULL REFERENCES fare_disputes(dispute_id) ON DELETE RESTRICT,
  fare_revision smallint NOT NULL CHECK (fare_revision > 0),
  previous_actual_fare integer NOT NULL CHECK (previous_actual_fare BETWEEN 1 AND 1000000),
  revised_actual_fare integer NOT NULL CHECK (revised_actual_fare BETWEEN 1 AND 1000000),
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 1000),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_v2_adjustment_changes_fare
    CHECK (previous_actual_fare <> revised_actual_fare),
  CONSTRAINT policy_v2_adjustment_one_per_dispute UNIQUE (dispute_id),
  CONSTRAINT policy_v2_adjustment_one_per_revision UNIQUE (trip_id, fare_revision),
  CONSTRAINT policy_v2_adjustment_idempotent UNIQUE (admin_user_id, idempotency_key)
);

CREATE TABLE policy_v2_adjustment_allocations (
  command_id uuid NOT NULL REFERENCES policy_v2_adjustment_commands(command_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  previous_share integer NOT NULL CHECK (previous_share BETWEEN 0 AND 1000000),
  revised_share integer NOT NULL CHECK (revised_share BETWEEN 0 AND 1000000),
  PRIMARY KEY (command_id, user_id)
);

ALTER TABLE point_ledger
  ADD COLUMN policy_v2_adjustment_command_id uuid
    REFERENCES policy_v2_adjustment_commands(command_id) ON DELETE RESTRICT;

ALTER TABLE point_debt_events
  ADD COLUMN policy_v2_adjustment_command_id uuid
    REFERENCES policy_v2_adjustment_commands(command_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX point_ledger_policy_v2_adjustment_entry_unique_idx
  ON point_ledger (policy_v2_adjustment_command_id, user_id, entry_type)
  WHERE policy_v2_adjustment_command_id IS NOT NULL;

CREATE UNIQUE INDEX point_debt_events_policy_v2_adjustment_entry_unique_idx
  ON point_debt_events (policy_v2_adjustment_command_id, user_id)
  WHERE policy_v2_adjustment_command_id IS NOT NULL;

ALTER TABLE point_ledger
  DROP CONSTRAINT point_ledger_entry_type_valid,
  DROP CONSTRAINT point_ledger_shape_valid,
  DROP CONSTRAINT point_ledger_actor_or_system_command_valid,
  ADD CONSTRAINT point_ledger_entry_type_valid CHECK (entry_type IN (
    'ADMIN_GRANT', 'DEPOSIT', 'SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT',
    'FARE_ADJUSTMENT_REFUND', 'FARE_ADJUSTMENT_DEBIT'
  )),
  ADD CONSTRAINT point_ledger_shape_valid CHECK (
    (entry_type = 'ADMIN_GRANT' AND available_delta > 0 AND held_delta = 0 AND trip_id IS NULL)
    OR (entry_type = 'DEPOSIT' AND available_delta < 0 AND held_delta = -available_delta AND trip_id IS NOT NULL)
    OR (entry_type = 'SETTLEMENT_CHARGE' AND available_delta = 0 AND held_delta < 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'REFUND' AND available_delta > 0 AND held_delta = -available_delta AND trip_id IS NOT NULL)
    OR (entry_type = 'ADDITIONAL_DEBIT' AND available_delta < 0 AND held_delta = 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'FARE_ADJUSTMENT_REFUND' AND available_delta > 0 AND held_delta = 0 AND trip_id IS NOT NULL)
    OR (entry_type = 'FARE_ADJUSTMENT_DEBIT' AND available_delta < 0 AND held_delta = 0 AND trip_id IS NOT NULL)
  ),
  ADD CONSTRAINT point_ledger_actor_or_system_command_valid CHECK (
    (
      policy_v2_adjustment_command_id IS NOT NULL
      AND actor_user_id IS NOT NULL
      AND system_deadline_command_id IS NULL
      AND entry_type IN ('FARE_ADJUSTMENT_REFUND', 'FARE_ADJUSTMENT_DEBIT')
    )
    OR (
      policy_v2_adjustment_command_id IS NULL
      AND (
        (actor_user_id IS NOT NULL AND system_deadline_command_id IS NULL)
        OR (
          actor_user_id IS NULL
          AND system_deadline_command_id IS NOT NULL
          AND entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION prevent_policy_v2_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'policy-v2 adjustment records are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER policy_v2_adjustment_commands_prevent_mutation
BEFORE UPDATE OR DELETE ON policy_v2_adjustment_commands
FOR EACH ROW EXECUTE FUNCTION prevent_policy_v2_adjustment_mutation();

CREATE TRIGGER policy_v2_adjustment_allocations_prevent_mutation
BEFORE UPDATE OR DELETE ON policy_v2_adjustment_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_policy_v2_adjustment_mutation();

CREATE OR REPLACE FUNCTION validate_policy_v2_adjustment_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  dispute_status text;
  dispute_revision smallint;
  dispute_resolver uuid;
  settlement_status text;
  settlement_policy text;
  settlement_fare integer;
  settlement_revision smallint;
  trip_status text;
  admin_role text;
  admin_status text;
BEGIN
  SELECT d.status, d.fare_revision, d.resolved_by_user_id,
         s.status, s.allocation_policy, s.actual_fare, s.fare_revision, g.status,
         u.role, u.account_status
  INTO dispute_status, dispute_revision, dispute_resolver,
       settlement_status, settlement_policy, settlement_fare, settlement_revision, trip_status,
       admin_role, admin_status
  FROM fare_disputes d
  JOIN trip_settlements s ON s.trip_id = d.trip_id
  JOIN trip_groups g ON g.trip_id = d.trip_id
  JOIN users u ON u.user_id = NEW.admin_user_id
  WHERE d.dispute_id = NEW.dispute_id AND d.trip_id = NEW.trip_id
  FOR SHARE OF d, s, g, u;

  IF NOT FOUND
    OR dispute_status <> 'RESOLVED'
    OR dispute_resolver IS DISTINCT FROM NEW.admin_user_id
    OR trip_status <> 'SETTLEMENT_PENDING'
    OR settlement_policy <> 'HOST_APPROVAL_ORDER'
    OR settlement_status <> 'PROVISIONALLY_SETTLED'
    OR dispute_revision <> NEW.fare_revision
    OR settlement_revision <> NEW.fare_revision
    OR settlement_fare <> NEW.previous_actual_fare
    OR admin_role <> 'ADMIN'
    OR admin_status <> 'ACTIVE'
    OR EXISTS (
      SELECT 1 FROM fare_disputes other
      WHERE other.trip_id = NEW.trip_id
        AND other.fare_revision = NEW.fare_revision
        AND other.status = 'OPEN'
    )
  THEN
    RAISE EXCEPTION 'policy-v2 adjustment command requires a resolved current dispute and no other open dispute'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_v2_adjustment_commands_validate
BEFORE INSERT ON policy_v2_adjustment_commands
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_command();

CREATE OR REPLACE FUNCTION validate_policy_v2_adjustment_allocations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  adjustment_id uuid := COALESCE(NEW.command_id, OLD.command_id);
  trip uuid;
  revision smallint;
  revised_fare integer;
  participant_total smallint;
  snapshot_count integer;
  invalid_count integer;
BEGIN
  SELECT trip_id, fare_revision, revised_actual_fare
  INTO trip, revision, revised_fare
  FROM policy_v2_adjustment_commands
  WHERE command_id = adjustment_id;
  SELECT participant_count INTO participant_total
  FROM trip_settlements WHERE trip_id = trip AND fare_revision = revision;

  SELECT count(*) INTO snapshot_count
  FROM policy_v2_adjustment_allocations WHERE command_id = adjustment_id;

  SELECT count(*) INTO invalid_count
  FROM policy_v2_adjustment_allocations a
  JOIN trip_settlement_participants sp
    ON sp.trip_id = trip AND sp.user_id = a.user_id
  WHERE a.command_id = adjustment_id
    AND (
      a.previous_share <> sp.allocated_share
      OR a.revised_share <> (revised_fare / participant_total)
        + CASE WHEN sp.allocation_rank > participant_total - (revised_fare % participant_total)
          THEN 1 ELSE 0 END
    );

  IF snapshot_count <> participant_total
    OR invalid_count <> 0
    OR (SELECT coalesce(sum(revised_share), 0) FROM policy_v2_adjustment_allocations
        WHERE command_id = adjustment_id) <> revised_fare
  THEN
    RAISE EXCEPTION 'policy-v2 adjustment allocations must exactly match the immutable cohort and rank order'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER policy_v2_adjustment_commands_validate_allocations
AFTER INSERT ON policy_v2_adjustment_commands
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_allocations();

CREATE CONSTRAINT TRIGGER policy_v2_adjustment_allocations_validate
AFTER INSERT ON policy_v2_adjustment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_allocations();

CREATE OR REPLACE FUNCTION validate_policy_v2_resolved_dispute_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_v2_provisional boolean;
BEGIN
  IF NEW.status <> 'RESOLVED' THEN RETURN NULL; END IF;
  SELECT s.allocation_policy = 'HOST_APPROVAL_ORDER'
           AND s.status = 'PROVISIONALLY_SETTLED'
  INTO is_v2_provisional
  FROM trip_settlements s WHERE s.trip_id = NEW.trip_id;
  IF is_v2_provisional AND NOT EXISTS (
    SELECT 1 FROM policy_v2_adjustment_commands c
    WHERE c.dispute_id = NEW.dispute_id
  ) THEN
    RAISE EXCEPTION 'a resolved policy-v2 dispute requires an append-only adjustment command'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER fare_disputes_validate_policy_v2_resolved_command
AFTER UPDATE OF status ON fare_disputes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_resolved_dispute_command();

CREATE OR REPLACE FUNCTION validate_policy_v2_adjustment_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  delta integer;
  command_admin uuid;
  command_trip uuid;
  command_revision smallint;
  settlement_status text;
BEGIN
  IF NEW.entry_type NOT IN ('FARE_ADJUSTMENT_REFUND', 'FARE_ADJUSTMENT_DEBIT') THEN
    RETURN NEW;
  END IF;
  SELECT a.revised_share - a.previous_share, c.admin_user_id, c.trip_id,
         c.fare_revision, s.status
  INTO delta, command_admin, command_trip, command_revision, settlement_status
  FROM policy_v2_adjustment_allocations a
  JOIN policy_v2_adjustment_commands c ON c.command_id = a.command_id
  JOIN trip_settlements s ON s.trip_id = c.trip_id
  WHERE a.command_id = NEW.policy_v2_adjustment_command_id
    AND a.user_id = NEW.user_id
  FOR SHARE OF a, c, s;

  IF NOT FOUND OR NEW.trip_id <> command_trip OR NEW.actor_user_id <> command_admin
    OR NEW.system_deadline_command_id IS NOT NULL OR settlement_status <> 'PROVISIONALLY_SETTLED'
    OR (NEW.entry_type = 'FARE_ADJUSTMENT_DEBIT' AND (
      delta <= 0 OR NEW.available_delta >= 0 OR -NEW.available_delta > delta OR NEW.held_delta <> 0
    ))
    OR (NEW.entry_type = 'FARE_ADJUSTMENT_REFUND' AND (
      delta >= 0 OR NEW.available_delta <= 0 OR NEW.available_delta > -delta OR NEW.held_delta <> 0
    ))
  THEN
    RAISE EXCEPTION 'policy-v2 adjustment ledger entry does not match its compensation allocation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_ledger_validate_policy_v2_adjustment
BEFORE INSERT ON point_ledger
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_ledger_entry();

CREATE OR REPLACE FUNCTION validate_policy_v2_adjustment_debt_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  delta integer;
  command_admin uuid;
  command_trip uuid;
  command_revision smallint;
  debt_trip uuid;
  debt_revision smallint;
BEGIN
  IF NEW.policy_v2_adjustment_command_id IS NULL THEN
    IF NEW.event_type = 'DISPUTE_ADJUSTMENT' AND EXISTS (
      SELECT 1 FROM point_debt_obligations o
      JOIN trip_settlements s ON s.trip_id = o.trip_id
      WHERE o.debt_id = NEW.debt_id
        AND s.allocation_policy = 'HOST_APPROVAL_ORDER'
    ) THEN
      RAISE EXCEPTION 'policy-v2 debt adjustment requires an adjustment command'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT a.revised_share - a.previous_share, c.admin_user_id, c.trip_id,
         c.fare_revision, o.trip_id, o.fare_revision
  INTO delta, command_admin, command_trip, command_revision, debt_trip, debt_revision
  FROM policy_v2_adjustment_allocations a
  JOIN policy_v2_adjustment_commands c ON c.command_id = a.command_id
  JOIN point_debt_obligations o ON o.debt_id = NEW.debt_id
  WHERE a.command_id = NEW.policy_v2_adjustment_command_id
    AND a.user_id = NEW.user_id
  FOR SHARE OF a, c, o;

  IF NOT FOUND OR NEW.event_type <> 'DISPUTE_ADJUSTMENT'
    OR NEW.actor_user_id <> command_admin
    OR debt_trip <> command_trip OR debt_revision <> command_revision
    OR (delta > 0 AND (NEW.debt_delta <= 0 OR NEW.debt_delta > delta))
    OR (delta < 0 AND (NEW.debt_delta >= 0 OR -NEW.debt_delta > -delta))
    OR delta = 0
  THEN
    RAISE EXCEPTION 'policy-v2 adjustment debt event does not match its compensation allocation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_debt_events_validate_policy_v2_adjustment
BEFORE INSERT ON point_debt_events
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_debt_event();

CREATE OR REPLACE FUNCTION validate_policy_v2_adjustment_financials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  adjustment_id uuid;
  invalid_rows integer;
BEGIN
  adjustment_id := COALESCE(
    CASE WHEN TG_TABLE_NAME = 'policy_v2_adjustment_commands' THEN NEW.command_id END,
    CASE WHEN TG_TABLE_NAME = 'policy_v2_adjustment_allocations' THEN NEW.command_id END,
    CASE WHEN TG_TABLE_NAME = 'point_ledger' THEN NEW.policy_v2_adjustment_command_id END,
    CASE WHEN TG_TABLE_NAME = 'point_debt_events' THEN NEW.policy_v2_adjustment_command_id END
  );
  IF adjustment_id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO invalid_rows
  FROM policy_v2_adjustment_allocations a
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(-l.available_delta) FILTER (WHERE l.entry_type = 'FARE_ADJUSTMENT_DEBIT'), 0)::integer AS debited,
      coalesce(sum(l.available_delta) FILTER (WHERE l.entry_type = 'FARE_ADJUSTMENT_REFUND'), 0)::integer AS refunded
    FROM point_ledger l
    WHERE l.policy_v2_adjustment_command_id = adjustment_id AND l.user_id = a.user_id
  ) ledger ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(e.debt_delta), 0)::integer AS debt_delta
    FROM point_debt_events e
    WHERE e.policy_v2_adjustment_command_id = adjustment_id AND e.user_id = a.user_id
  ) debt ON true
  WHERE a.command_id = adjustment_id
    AND (
      (a.revised_share > a.previous_share AND (
        ledger.refunded <> 0 OR ledger.debited + debt.debt_delta <> a.revised_share - a.previous_share
      ))
      OR (a.revised_share < a.previous_share AND (
        ledger.debited <> 0 OR ledger.refunded - debt.debt_delta <> a.previous_share - a.revised_share
      ))
      OR (a.revised_share = a.previous_share AND (
        ledger.debited <> 0 OR ledger.refunded <> 0 OR debt.debt_delta <> 0
      ))
    );
  IF invalid_rows <> 0 THEN
    RAISE EXCEPTION 'policy-v2 adjustment must exactly decompose every participant compensation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER policy_v2_adjustment_commands_validate_financials
AFTER INSERT ON policy_v2_adjustment_commands
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_financials();
CREATE CONSTRAINT TRIGGER policy_v2_adjustment_allocations_validate_financials
AFTER INSERT ON policy_v2_adjustment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_financials();
CREATE CONSTRAINT TRIGGER point_ledger_validate_policy_v2_adjustment_financials
AFTER INSERT ON point_ledger
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_financials();
CREATE CONSTRAINT TRIGGER point_debt_events_validate_policy_v2_adjustment_financials
AFTER INSERT ON point_debt_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_adjustment_financials();

CREATE OR REPLACE FUNCTION validate_policy_v2_finalization_adjustments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.allocation_policy = 'HOST_APPROVAL_ORDER'
    AND OLD.status = 'PROVISIONALLY_SETTLED'
    AND NEW.status = 'COMPLETED'
    AND EXISTS (
      SELECT 1 FROM fare_disputes d
      WHERE d.trip_id = OLD.trip_id
        AND d.fare_revision = OLD.fare_revision
        AND d.status = 'RESOLVED'
        AND NOT EXISTS (
          SELECT 1 FROM policy_v2_adjustment_commands c
          WHERE c.dispute_id = d.dispute_id
        )
    )
  THEN
    RAISE EXCEPTION 'policy-v2 finalization requires every resolved dispute to have a compensation command'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_settlements_validate_policy_v2_finalization_adjustments
BEFORE UPDATE ON trip_settlements
FOR EACH ROW EXECUTE FUNCTION validate_policy_v2_finalization_adjustments();

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
  THEN RAISE EXCEPTION 'fare dispute resolution is immutable' USING ERRCODE = '55000'; END IF;
  IF NEW.status NOT IN ('RESOLVED', 'REJECTED', 'WITHDRAWN')
    OR NEW.resolved_at IS NULL OR NEW.resolution_note IS NULL
    OR btrim(NEW.resolution_note) = '' OR NEW.resolved_by_user_id IS NULL
    OR NEW.resolution_idempotency_key IS NULL
  THEN RAISE EXCEPTION 'fare dispute resolution requires status, actor, note, and idempotency key' USING ERRCODE = '23514'; END IF;

  SELECT g.status, s.status, s.allocation_policy, s.confirmation_deadline, s.dispute_deadline
  INTO trip_status, settlement_status, settlement_policy, confirmation_deadline, dispute_deadline
  FROM trip_groups g JOIN trip_settlements s ON s.trip_id = g.trip_id
  WHERE g.trip_id = OLD.trip_id FOR UPDATE OF g, s;
  IF NOT FOUND OR trip_status <> 'SETTLEMENT_PENDING' THEN
    RAISE EXCEPTION 'fare dispute resolution requires a settlement-pending trip' USING ERRCODE = '23514';
  END IF;

  IF settlement_policy = 'HOST_APPROVAL_ORDER'
    AND settlement_status = 'PROVISIONALLY_SETTLED'
  THEN
    IF NEW.status = 'WITHDRAWN' THEN
      IF dispute_deadline <= now() OR NEW.resolved_by_user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'only the disputing participant can withdraw before the dispute deadline' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    SELECT role, account_status INTO resolver_role, resolver_status
    FROM users WHERE user_id = NEW.resolved_by_user_id FOR SHARE;
    IF resolver_role <> 'ADMIN' OR resolver_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'fare dispute resolution requires an active administrator' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF settlement_status = 'PENDING_CONFIRMATION' THEN
    IF NEW.status = 'WITHDRAWN' THEN
      IF confirmation_deadline <= now() OR NEW.resolved_by_user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'only the disputing participant can withdraw a fare dispute' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    RAISE EXCEPTION 'fare dispute resolution requires a pending or provisional settlement' USING ERRCODE = '23514';
  END IF;

  SELECT role, account_status INTO resolver_role, resolver_status
  FROM users WHERE user_id = NEW.resolved_by_user_id FOR SHARE;
  IF resolver_role <> 'ADMIN' OR resolver_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'fare dispute resolution requires an active administrator' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
