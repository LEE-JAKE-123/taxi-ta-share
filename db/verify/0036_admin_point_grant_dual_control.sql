SELECT
  to_regclass('public.point_grant_execution_requests') IS NOT NULL
    AS execution_requests_exists,
  to_regclass('public.point_grant_approval_commands') IS NOT NULL
    AS approval_commands_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_grant_execution_requests'::regclass
      AND tgname = 'point_grant_execution_requests_validate_insert'
      AND NOT tgisinternal
  ) AS execution_request_validation_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_grant_approval_commands'::regclass
      AND tgname = 'point_grant_approval_commands_validate_insert'
      AND NOT tgisinternal
  ) AS independent_approval_validation_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'point_ledger_one_grant_per_execution_request_idx'
  ) AS one_grant_per_execution_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'point_ledger_one_grant_per_approval_command_idx'
  ) AS one_grant_per_approval_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_ledger'::regclass
      AND tgname = 'point_ledger_require_linked_point_request_fulfillment'
      AND tgdeferrable AND tginitdeferred
      AND NOT tgisinternal
  ) AS linked_point_request_fulfillment_atomicity_guard_exists,
  (
    SELECT count(*) = 0
    FROM point_ledger l
    LEFT JOIN point_grant_execution_requests e
      ON e.execution_request_id = l.grant_execution_request_id
    LEFT JOIN point_grant_approval_commands a
      ON a.approval_command_id = l.grant_approval_command_id
    WHERE l.entry_type = 'ADMIN_GRANT'
      AND (
        (l.grant_execution_request_id IS NULL)
          <> (l.grant_approval_command_id IS NULL)
        OR (
          l.grant_execution_request_id IS NOT NULL
          AND (
            e.execution_request_id IS NULL
            OR a.approval_command_id IS NULL
            OR a.execution_request_id IS DISTINCT FROM e.execution_request_id
            OR l.user_id IS DISTINCT FROM e.target_user_id
            OR l.actor_user_id IS DISTINCT FROM e.requested_by_admin_id
            OR l.actor_user_id = a.approved_by_admin_id
            OR l.available_delta IS DISTINCT FROM e.amount
            OR l.reason IS DISTINCT FROM e.reason
            OR l.point_request_id IS DISTINCT FROM e.source_point_request_id
          )
        )
      )
  ) AS grant_provenance_valid,
  (
    SELECT count(*) = 0
    FROM point_grant_execution_requests e
    JOIN point_ledger l
      ON l.grant_execution_request_id = e.execution_request_id
    LEFT JOIN point_grant_requests r
      ON r.request_id = e.source_point_request_id
    WHERE e.source_point_request_id IS NOT NULL
      AND (
        r.status IS DISTINCT FROM 'FULFILLED'
        OR r.fulfilled_ledger_id IS DISTINCT FROM l.ledger_id
        OR r.fulfilled_by IS DISTINCT FROM l.actor_user_id
      )
  ) AS linked_point_request_fulfillments_valid;
