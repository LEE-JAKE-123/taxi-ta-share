SELECT
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'validate_trip_incident_review_command'
      AND pg_get_functiondef(oid) LIKE '%incident_reporter_user_id%'
      AND pg_get_functiondef(oid) LIKE '%FROM trip_incidents i%'
  ) AS incident_reviewer_variable_disambiguation_exists;
