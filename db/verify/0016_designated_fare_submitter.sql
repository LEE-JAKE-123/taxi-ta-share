-- Post-migration inspection for 0016_designated_fare_submitter.
-- Each query should return zero invalid rows.

SELECT g.trip_id
FROM trip_groups g
LEFT JOIN trip_participants p
  ON p.trip_id = g.trip_id
 AND p.user_id = g.fare_submitter_user_id
WHERE g.fare_submitter_user_id IS NOT NULL
  AND (p.user_id IS NULL OR p.role <> 'MEMBER');

SELECT g.trip_id
FROM trip_groups g
WHERE (g.fare_submitter_set_by IS NULL) <> (g.fare_submitter_idempotency_key IS NULL)
   OR (g.fare_submitter_set_by IS NULL) <> (g.fare_submitter_set_at IS NULL);
