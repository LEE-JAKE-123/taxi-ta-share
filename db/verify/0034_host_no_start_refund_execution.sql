SELECT
  to_regclass('public.trip_incident_no_start_refund_executions') IS NOT NULL
    AS no_start_refund_executions_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_no_start_refund_executions'::regclass
      AND tgname = 'trip_incident_no_start_refund_executions_validate_insert'
      AND NOT tgisinternal
  ) AS no_start_refund_execution_authority_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_no_start_refund_executions'::regclass
      AND tgname = 'trip_incident_no_start_refund_executions_prevent_mutation'
      AND NOT tgisinternal
  ) AS no_start_refund_execution_immutability_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_incident_no_start_refund_executions'::regclass
      AND tgname = 'trip_incident_no_start_refund_executions_require_refunds'
      AND tgdeferrable AND tginitdeferred
      AND NOT tgisinternal
  ) AS no_start_refund_execution_atomicity_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'point_ledger_one_no_start_refund_per_execution_user_idx'
  ) AS no_start_refund_execution_ledger_unique_exists,
  (
    SELECT count(*) = 0
    FROM trip_incident_no_start_refund_executions e
    JOIN trip_groups g ON g.trip_id = e.trip_id
    WHERE g.status <> 'CANCELLED'
       OR g.closure_type <> 'CANCELLED'
       OR g.cancellation_idempotency_key <> e.idempotency_key
       OR EXISTS (
         SELECT 1
         FROM trip_participants p
         JOIN trip_deposits d
           ON d.trip_id = p.trip_id AND d.user_id = p.user_id
         LEFT JOIN point_ledger l
           ON l.no_start_refund_execution_id = e.execution_id
          AND l.user_id = p.user_id
         WHERE p.trip_id = e.trip_id
           AND p.role = 'MEMBER'
           AND (
             p.status <> 'DEPOSITED'
             OR l.entry_type IS DISTINCT FROM 'REFUND'
             OR l.available_delta IS DISTINCT FROM d.amount
             OR l.held_delta IS DISTINCT FROM -d.amount
             OR l.actor_user_id IS DISTINCT FROM e.executed_by
           )
       )
       OR EXISTS (
         SELECT 1
         FROM point_ledger l
         LEFT JOIN trip_participants p
           ON p.trip_id = e.trip_id AND p.user_id = l.user_id
         WHERE l.no_start_refund_execution_id = e.execution_id
           AND p.role IS DISTINCT FROM 'MEMBER'
       )
  ) AS no_start_refund_execution_provenance_valid;
