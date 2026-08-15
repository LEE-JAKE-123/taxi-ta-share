-- Forward-only schema foundation for DEC-011/013/014.
--
-- All rows created before this migration remain LEGACY_CEIL.  This migration
-- deliberately does not replace the legacy settlement/ledger triggers: the
-- server transaction which writes the policy-v2 provisional settlement is a
-- subsequent change.  In particular, no historical settlement or ledger row
-- is rewritten here.

ALTER TABLE point_accounts
  ADD COLUMN debt_points bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT point_accounts_debt_nonnegative CHECK (debt_points >= 0);

ALTER TABLE trip_settlements
  ADD COLUMN agreement_deadline timestamptz,
  ADD COLUMN dispute_deadline timestamptz,
  ADD COLUMN provisionally_settled_at timestamptz,
  ADD COLUMN allocation_policy text NOT NULL DEFAULT 'LEGACY_CEIL',
  ADD CONSTRAINT trip_settlements_allocation_policy_valid
    CHECK (allocation_policy IN ('LEGACY_CEIL', 'HOST_APPROVAL_ORDER')),
  ADD CONSTRAINT trip_settlements_policy_v2_deadlines_valid CHECK (
    (
      allocation_policy = 'LEGACY_CEIL'
      AND agreement_deadline IS NULL
      AND dispute_deadline IS NULL
      AND provisionally_settled_at IS NULL
    )
    OR (
      allocation_policy = 'HOST_APPROVAL_ORDER'
      -- FR-52/DEC-011: these are fixed durations, not caller-selected dates.
      AND confirmation_deadline = submitted_at + interval '10 minutes'
      AND agreement_deadline = submitted_at + interval '10 minutes'
      AND dispute_deadline = submitted_at + interval '24 hours'
      AND (
        (status = 'PENDING_CONFIRMATION' AND provisionally_settled_at IS NULL)
        OR (
          status IN ('PROVISIONALLY_SETTLED', 'COMPLETED')
          AND provisionally_settled_at IS NOT NULL
          AND provisionally_settled_at >= submitted_at
        )
      )
    )
  );

ALTER TABLE trip_settlements
  DROP CONSTRAINT trip_settlements_status_valid,
  ADD CONSTRAINT trip_settlements_status_valid
    CHECK (status IN ('PENDING_CONFIRMATION', 'PROVISIONALLY_SETTLED', 'COMPLETED'));

ALTER TABLE trip_settlement_participants
  ADD COLUMN allocation_rank smallint,
  ADD COLUMN allocated_share integer,
  ADD CONSTRAINT trip_settlement_participants_allocation_valid CHECK (
    (allocation_rank IS NULL AND allocated_share IS NULL)
    OR (
      allocation_rank BETWEEN 1 AND 4
      AND allocated_share BETWEEN 0 AND 1000000
    )
  );

CREATE UNIQUE INDEX trip_settlement_participants_allocation_rank_unique_idx
  ON trip_settlement_participants (trip_id, allocation_rank)
  WHERE allocation_rank IS NOT NULL;

-- These are the access paths for the 10-minute provisional worker and the
-- 24-hour finalization worker.  Legacy rows are intentionally excluded.
CREATE INDEX trip_settlements_policy_v2_agreement_due_idx
  ON trip_settlements (agreement_deadline, trip_id)
  WHERE allocation_policy = 'HOST_APPROVAL_ORDER'
    AND status = 'PENDING_CONFIRMATION';

CREATE INDEX trip_settlements_policy_v2_dispute_due_idx
  ON trip_settlements (dispute_deadline, trip_id)
  WHERE allocation_policy = 'HOST_APPROVAL_ORDER'
    AND status = 'PROVISIONALLY_SETTLED';

-- DEFERRABLE validation lets a single transaction insert the settlement and
-- its immutable participant snapshots in either normal multi-row order.  It
-- does not alter the legacy snapshot trigger or settlement update guard.
CREATE OR REPLACE FUNCTION validate_host_approval_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_trip_id uuid := NEW.trip_id;
  settlement_policy text;
  expected_count smallint;
  fare integer;
  snapshot_count integer;
  ranked_count integer;
  total_allocated integer;
  ranks_match_approval_order boolean;
  shares_match_policy boolean;
BEGIN
  SELECT allocation_policy, participant_count, actual_fare
  INTO settlement_policy, expected_count, fare
  FROM trip_settlements
  WHERE trip_id = settlement_trip_id;

  IF NOT FOUND OR settlement_policy = 'LEGACY_CEIL' THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE sp.allocation_rank IS NOT NULL AND sp.allocated_share IS NOT NULL),
    coalesce(sum(sp.allocated_share), 0)
  INTO snapshot_count, ranked_count, total_allocated
  FROM trip_settlement_participants sp
  WHERE sp.trip_id = settlement_trip_id;

  SELECT coalesce(bool_and(snapshot.allocation_rank = snapshot.expected_rank), false)
  INTO ranks_match_approval_order
  FROM (
    SELECT
      sp.allocation_rank,
      row_number() OVER (
        ORDER BY
          CASE WHEN p.role = 'HOST' THEN 0 ELSE 1 END,
          p.approved_at ASC NULLS LAST,
          p.user_id ASC
      )::smallint AS expected_rank
    FROM trip_settlement_participants sp
    JOIN trip_participants p
      ON (p.trip_id, p.user_id) = (sp.trip_id, sp.user_id)
    WHERE sp.trip_id = settlement_trip_id
  ) snapshot;

  SELECT coalesce(bool_and(
    sp.allocated_share = (fare / expected_count)
      + CASE WHEN sp.allocation_rank > expected_count - (fare % expected_count)
        THEN 1 ELSE 0 END
  ), false)
  INTO shares_match_policy
  FROM trip_settlement_participants sp
  WHERE sp.trip_id = settlement_trip_id;

  IF snapshot_count <> expected_count
    OR ranked_count <> expected_count
    OR total_allocated <> fare
    OR NOT ranks_match_approval_order
    OR NOT shares_match_policy
  THEN
    RAISE EXCEPTION 'policy-v2 allocations must exactly match the approved settlement cohort'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trip_settlements_validate_host_approval_allocation
AFTER INSERT OR UPDATE OF allocation_policy, participant_count, actual_fare
ON trip_settlements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_host_approval_allocation();

CREATE CONSTRAINT TRIGGER trip_settlement_participants_validate_host_approval_allocation
AFTER INSERT
ON trip_settlement_participants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_host_approval_allocation();

CREATE TABLE point_debt_obligations (
  debt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES trip_groups(trip_id) ON DELETE RESTRICT,
  fare_revision smallint NOT NULL CHECK (fare_revision >= 1),
  principal_points integer NOT NULL DEFAULT 0
    CHECK (principal_points BETWEEN 0 AND 1000000),
  outstanding_points integer NOT NULL DEFAULT 0
    CHECK (outstanding_points BETWEEN 0 AND 1000000),
  status text NOT NULL DEFAULT 'SETTLED'
    CHECK (status IN ('OPEN', 'SETTLED', 'WAIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_debt_obligations_one_per_user_trip_revision
    UNIQUE (trip_id, user_id, fare_revision),
  CONSTRAINT point_debt_obligations_balance_valid
    CHECK (outstanding_points <= principal_points),
  CONSTRAINT point_debt_obligations_status_valid CHECK (
    (status = 'OPEN' AND outstanding_points > 0 AND settled_at IS NULL)
    OR (
      status IN ('SETTLED', 'WAIVED')
      AND outstanding_points = 0
      AND settled_at IS NOT NULL
    )
  )
);

CREATE INDEX point_debt_obligations_user_open_idx
  ON point_debt_obligations (user_id, created_at, debt_id)
  WHERE status = 'OPEN';

CREATE INDEX point_debt_obligations_trip_revision_idx
  ON point_debt_obligations (trip_id, fare_revision, user_id);

CREATE TABLE point_debt_events (
  debt_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES point_debt_obligations(debt_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN ('INCUR', 'REPAYMENT', 'WAIVER', 'DISPUTE_ADJUSTMENT')),
  debt_delta integer NOT NULL CHECK (debt_delta BETWEEN -1000000 AND 1000000 AND debt_delta <> 0),
  actor_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_debt_events_shape_valid CHECK (
    (event_type = 'INCUR' AND debt_delta > 0)
    OR (event_type IN ('REPAYMENT', 'WAIVER') AND debt_delta < 0)
    OR event_type = 'DISPUTE_ADJUSTMENT'
  )
);

CREATE INDEX point_debt_events_debt_created_idx
  ON point_debt_events (debt_id, created_at, debt_event_id);

CREATE INDEX point_debt_events_user_created_idx
  ON point_debt_events (user_id, created_at, debt_event_id);

CREATE OR REPLACE FUNCTION prevent_point_debt_obligation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.principal_points <> 0
      OR NEW.outstanding_points <> 0
      OR NEW.status <> 'SETTLED'
      OR NEW.settled_at IS NULL
    THEN
      RAISE EXCEPTION 'a debt obligation must begin as a zero settled projection'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'point debt obligations are projected from append-only events'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_debt_obligations_prevent_mutation
BEFORE INSERT OR UPDATE OR DELETE ON point_debt_obligations
FOR EACH ROW EXECUTE FUNCTION prevent_point_debt_obligation_mutation();

CREATE OR REPLACE FUNCTION prevent_direct_debt_projection_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- apply_point_debt_event() is the only supported nested write path.
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'debt projection is updated only from debt events'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER point_accounts_prevent_direct_debt_mutation
BEFORE UPDATE OF debt_points ON point_accounts
FOR EACH ROW EXECUTE FUNCTION prevent_direct_debt_projection_mutation();

CREATE OR REPLACE FUNCTION prevent_point_debt_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'point debt events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER point_debt_events_prevent_mutation
BEFORE UPDATE OR DELETE ON point_debt_events
FOR EACH ROW EXECUTE FUNCTION prevent_point_debt_event_mutation();

CREATE OR REPLACE FUNCTION apply_point_debt_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obligation point_debt_obligations%ROWTYPE;
  next_outstanding integer;
  next_principal integer;
  next_status text;
BEGIN
  SELECT * INTO obligation
  FROM point_debt_obligations
  WHERE debt_id = NEW.debt_id
  FOR UPDATE;

  IF NOT FOUND OR obligation.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'debt event must reference its owner obligation'
      USING ERRCODE = '23514';
  END IF;

  IF obligation.principal_points = 0 AND NEW.event_type <> 'INCUR' THEN
    RAISE EXCEPTION 'a debt obligation must begin with an incur event'
      USING ERRCODE = '23514';
  END IF;

  next_outstanding := obligation.outstanding_points + NEW.debt_delta;
  next_principal := obligation.principal_points
    + CASE
        WHEN NEW.event_type IN ('INCUR', 'DISPUTE_ADJUSTMENT') AND NEW.debt_delta > 0
          THEN NEW.debt_delta
        ELSE 0
      END;

  IF next_outstanding < 0
    OR next_outstanding > next_principal
    OR next_principal > 1000000
  THEN
    RAISE EXCEPTION 'debt event exceeds the outstanding obligation'
      USING ERRCODE = '23514';
  END IF;

  next_status := CASE
    WHEN next_outstanding > 0 THEN 'OPEN'
    WHEN NEW.event_type = 'WAIVER' THEN 'WAIVED'
    ELSE 'SETTLED'
  END;

  UPDATE point_debt_obligations
  SET principal_points = next_principal,
      outstanding_points = next_outstanding,
      status = next_status,
      settled_at = CASE WHEN next_outstanding = 0 THEN now() ELSE NULL END
  WHERE debt_id = NEW.debt_id;

  UPDATE point_accounts
  SET debt_points = debt_points + NEW.debt_delta,
      updated_at = now()
  WHERE user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'point account missing for debt owner' USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER point_debt_events_apply_to_account
BEFORE INSERT ON point_debt_events
FOR EACH ROW EXECUTE FUNCTION apply_point_debt_event();
