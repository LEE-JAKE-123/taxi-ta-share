-- Post-migration inspection for 0014_confirmed_cohort_settlement.
-- Each query should return zero invalid rows.

SELECT s.trip_id
FROM trip_settlements s
WHERE s.cohort_basis = 'ESCROW_CONFIRMED'
  AND s.status IN ('PENDING_CONFIRMATION', 'COMPLETED')
  AND s.participant_count <> (
    SELECT count(*)
    FROM trip_settlement_participants sp
    WHERE sp.trip_id = s.trip_id
  );

SELECT l.ledger_id
FROM point_ledger l
JOIN trip_settlements s ON s.trip_id = l.trip_id
WHERE s.cohort_basis = 'ESCROW_CONFIRMED'
  AND l.entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
  AND s.status <> 'COMPLETED';
