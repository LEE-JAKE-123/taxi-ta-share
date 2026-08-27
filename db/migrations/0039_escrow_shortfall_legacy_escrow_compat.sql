-- FR-33~40 / TR-01~03: retain the pre-0037 audit-valid full-escrow path.
-- A positive DEPOSIT ledger is still sufficient for an existing full held
-- escrow, even if the historical snapshot differs from the current fare
-- division.  Only a partial or zero held deposit needs an OPEN shortfall
-- projection with the exact current expected gap.

CREATE OR REPLACE FUNCTION validate_participant_deposit_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deposit_amount integer;
  matching_ledger_count integer;
  trip_status text;
  expected_points integer;
  cohort_count integer;
  matching_shortfall boolean;
  has_open_shortfall boolean;
BEGIN
  IF NEW.status <> 'DEPOSITED' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT g.status,
         count(*) FILTER (WHERE p.status IN ('APPROVED', 'DEPOSITED'))::integer,
         ceil(g.estimated_fare::numeric / nullif(count(*) FILTER (WHERE p.status IN ('APPROVED', 'DEPOSITED')), 0))::integer
  INTO trip_status, cohort_count, expected_points
  FROM trip_groups g
  JOIN trip_participants p ON p.trip_id = g.trip_id
  WHERE g.trip_id = NEW.trip_id
  GROUP BY g.status, g.estimated_fare;

  SELECT amount INTO deposit_amount FROM trip_deposits
  WHERE trip_id = NEW.trip_id AND user_id = NEW.user_id FOR SHARE;

  SELECT count(*) INTO matching_ledger_count FROM point_ledger
  WHERE trip_id = NEW.trip_id AND user_id = NEW.user_id AND entry_type = 'DEPOSIT'
    AND available_delta = -deposit_amount AND held_delta = deposit_amount;

  SELECT EXISTS (
    SELECT 1 FROM trip_escrow_shortfalls s
    WHERE s.trip_id = NEW.trip_id AND s.user_id = NEW.user_id
      AND s.expected_deposit_points = expected_points
      AND s.outstanding_points = expected_points - deposit_amount
      AND s.status = 'OPEN'
  ) INTO matching_shortfall;

  SELECT EXISTS (
    SELECT 1 FROM trip_escrow_shortfalls s
    WHERE s.trip_id = NEW.trip_id AND s.user_id = NEW.user_id AND s.status = 'OPEN'
  ) INTO has_open_shortfall;

  IF trip_status IS DISTINCT FROM 'CLOSED'
    OR cohort_count IS NULL OR cohort_count NOT BETWEEN 2 AND 4
    OR expected_points IS NULL
    OR deposit_amount IS NULL
    OR (deposit_amount > 0 AND matching_ledger_count <> 1)
    OR (deposit_amount = 0 AND matching_ledger_count <> 0)
    OR (deposit_amount = 0 AND NOT matching_shortfall)
    OR (deposit_amount > 0 AND has_open_shortfall
      AND (deposit_amount >= expected_points OR NOT matching_shortfall))
  THEN
    RAISE EXCEPTION 'deposited participant requires an audited held escrow or exact shortfall'
      USING ERRCODE = '23514';
  END IF;

  NEW.deposited_at = COALESCE(NEW.deposited_at, now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_trip_escrow_confirmation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deposited_count integer;
  invalid_count integer;
  expected_points integer;
BEGIN
  IF NEW.status <> 'CONFIRMED' OR OLD.status = 'CONFIRMED' THEN RETURN NEW; END IF;

  SELECT count(*) FILTER (WHERE p.status = 'DEPOSITED')
  INTO deposited_count
  FROM trip_participants p WHERE p.trip_id = NEW.trip_id;

  expected_points := ceil(NEW.estimated_fare::numeric / nullif(deposited_count, 0))::integer;

  SELECT count(*) INTO invalid_count
  FROM trip_participants p
  LEFT JOIN trip_deposits d ON d.trip_id = p.trip_id AND d.user_id = p.user_id
  WHERE p.trip_id = NEW.trip_id AND p.status = 'DEPOSITED' AND (
    d.amount IS NULL
    OR (d.amount > 0 AND NOT EXISTS (
      SELECT 1 FROM point_ledger l WHERE l.trip_id = p.trip_id AND l.user_id = p.user_id
        AND l.entry_type = 'DEPOSIT' AND l.available_delta = -d.amount AND l.held_delta = d.amount
    ))
    OR (d.amount = 0 AND EXISTS (
      SELECT 1 FROM point_ledger l WHERE l.trip_id = p.trip_id AND l.user_id = p.user_id
        AND l.entry_type = 'DEPOSIT'
    ))
    OR (d.amount = 0 AND NOT EXISTS (
      SELECT 1 FROM trip_escrow_shortfalls s WHERE s.trip_id = p.trip_id AND s.user_id = p.user_id
        AND s.expected_deposit_points = expected_points
        AND s.outstanding_points = expected_points AND s.status = 'OPEN'
    ))
    OR (d.amount > 0 AND EXISTS (
      SELECT 1 FROM trip_escrow_shortfalls s WHERE s.trip_id = p.trip_id AND s.user_id = p.user_id
        AND s.status = 'OPEN'
        AND (d.amount >= expected_points
          OR s.expected_deposit_points <> expected_points
          OR s.outstanding_points <> expected_points - d.amount)
    ))
  );

  IF deposited_count NOT BETWEEN 2 AND NEW.max_participants
    OR expected_points IS NULL
    OR invalid_count <> 0
    OR EXISTS (SELECT 1 FROM trip_participants WHERE trip_id = NEW.trip_id AND status = 'APPROVED')
  THEN
    RAISE EXCEPTION 'confirmed trip requires audited held escrow or participant shortfalls'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
