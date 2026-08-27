-- FR-33~40 / TR-01~03 follow-up for 0037.  An OPEN shortfall has no terminal
-- timestamp, and a zero held member is protected by its WAIVE event rather
-- than an impossible zero-value REFUND ledger row.

ALTER TABLE trip_escrow_shortfalls
  ALTER COLUMN settled_at DROP NOT NULL;

CREATE OR REPLACE FUNCTION validate_trip_incident_no_start_refund_execution_applied()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_status text;
  trip_closed_at timestamptz;
  trip_cancelled_at timestamptz;
  trip_closure_type text;
  cancellation_key uuid;
  has_settlement boolean;
BEGIN
  SELECT status, closed_at, cancelled_at, closure_type, cancellation_idempotency_key
  INTO trip_status, trip_closed_at, trip_cancelled_at, trip_closure_type, cancellation_key
  FROM trip_groups WHERE trip_id = NEW.trip_id FOR SHARE;

  SELECT EXISTS (SELECT 1 FROM trip_settlements WHERE trip_id = NEW.trip_id)
  INTO has_settlement;

  IF trip_status <> 'CANCELLED'
    OR trip_closed_at IS NULL
    OR trip_cancelled_at IS NULL
    OR trip_closure_type <> 'CANCELLED'
    OR cancellation_key IS DISTINCT FROM NEW.idempotency_key
    OR has_settlement
    OR EXISTS (
      SELECT 1
      FROM trip_participants p
      JOIN trip_deposits d ON d.trip_id = p.trip_id AND d.user_id = p.user_id
      LEFT JOIN point_ledger l
        ON l.no_start_refund_execution_id = NEW.execution_id AND l.user_id = p.user_id
      LEFT JOIN trip_escrow_shortfalls s
        ON s.trip_id = p.trip_id AND s.user_id = p.user_id
      LEFT JOIN trip_escrow_shortfall_events e
        ON e.no_start_refund_execution_id = NEW.execution_id
       AND e.shortfall_id = s.shortfall_id
       AND e.user_id = p.user_id
       AND e.event_type = 'WAIVE'
      WHERE p.trip_id = NEW.trip_id AND p.role = 'MEMBER' AND (
        p.status <> 'DEPOSITED'
        OR (d.amount > 0 AND (
          l.ledger_id IS NULL OR l.entry_type <> 'REFUND' OR l.trip_id <> NEW.trip_id
          OR l.available_delta <> d.amount OR l.held_delta <> -d.amount
          OR l.actor_user_id <> NEW.executed_by
        ))
        OR (d.amount = 0 AND l.ledger_id IS NOT NULL)
        OR (s.shortfall_id IS NOT NULL AND (
          s.status <> 'WAIVED' OR s.outstanding_points <> 0
          OR e.shortfall_event_id IS NULL OR e.points_delta <> -s.expected_deposit_points + d.amount
        ))
      )
    )
    OR EXISTS (
      SELECT 1 FROM point_ledger l
      LEFT JOIN trip_participants p ON p.trip_id = NEW.trip_id AND p.user_id = l.user_id
      LEFT JOIN trip_deposits d ON d.trip_id = p.trip_id AND d.user_id = p.user_id
      WHERE l.no_start_refund_execution_id = NEW.execution_id
        AND (p.role IS DISTINCT FROM 'MEMBER' OR d.user_id IS NULL OR d.amount <= 0)
    )
    OR EXISTS (
      SELECT 1 FROM trip_escrow_shortfall_events e
      LEFT JOIN trip_escrow_shortfalls s ON s.shortfall_id = e.shortfall_id
      LEFT JOIN trip_participants p ON p.trip_id = NEW.trip_id AND p.user_id = e.user_id
      WHERE e.no_start_refund_execution_id = NEW.execution_id
        AND (s.trip_id IS DISTINCT FROM NEW.trip_id OR p.role IS DISTINCT FROM 'MEMBER')
    )
  THEN
    RAISE EXCEPTION 'host no-start refund execution must refund held escrow and waive every member escrow shortfall'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
