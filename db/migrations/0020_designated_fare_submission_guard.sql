-- FR-50: the host or the currently designated, escrow-confirmed member may
-- submit the actual fare after departure. The designation itself is immutable
-- once the trip leaves CONFIRMED (0016).

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
    OR (
      NEW.submitted_by <> trip_host
      AND NEW.submitted_by IS DISTINCT FROM designated_submitter
    )
    OR NEW.cohort_basis <> 'ESCROW_CONFIRMED'
    OR cohort_count NOT BETWEEN 2 AND 4
    OR NEW.participant_count <> cohort_count
    OR NEW.final_share <> ceil(NEW.actual_fare::numeric / cohort_count)::integer
  THEN
    RAISE EXCEPTION 'settlement must use the in-progress escrow-confirmed cohort and an authorized fare submitter'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
