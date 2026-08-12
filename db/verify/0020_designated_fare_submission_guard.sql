-- Post-migration inspection for 0020_designated_fare_submission_guard.
-- The trigger must use the designated submitter persisted on trip_groups.

SELECT pg_get_functiondef('validate_demo_settlement_cohort()'::regprocedure)
  NOT ILIKE '%fare_submitter_user_id%' AS designated_submitter_not_allowed;
