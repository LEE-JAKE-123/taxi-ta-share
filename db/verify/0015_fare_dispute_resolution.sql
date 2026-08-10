-- Post-migration inspection for 0015_fare_dispute_resolution.
-- Each query should return zero invalid rows.

SELECT d.dispute_id
FROM fare_disputes d
WHERE (d.status = 'OPEN') <> (
  d.resolved_at IS NULL
  AND d.resolution_note IS NULL
  AND d.resolved_by_user_id IS NULL
  AND d.resolution_idempotency_key IS NULL
)
OR (d.resolved_by_user_id IS NULL) <> (d.resolution_idempotency_key IS NULL);

SELECT s.trip_id
FROM trip_settlements s
JOIN trip_groups g ON g.trip_id = s.trip_id
WHERE s.resubmission_required
  AND (
    s.status <> 'PENDING_CONFIRMATION'
    OR g.status <> 'IN_PROGRESS'
    OR NOT EXISTS (
      SELECT 1
      FROM fare_disputes d
      WHERE d.trip_id = s.trip_id AND d.status = 'RESOLVED'
    )
  );
