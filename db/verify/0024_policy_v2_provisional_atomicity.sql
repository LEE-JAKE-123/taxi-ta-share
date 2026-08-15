-- Post-migration inspection for policy-v2 atomic provisional execution.
SELECT
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'system_deadline_commands'::regclass
      AND tgname = 'system_deadline_commands_validate_policy_v2_linkage'
      AND NOT tgisinternal
  ) AS policy_v2_command_linkage_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_ledger'::regclass
      AND tgname = 'point_ledger_guard_policy_v2_provisional_state'
      AND NOT tgisinternal
  ) AS policy_v2_ledger_state_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_debt_events'::regclass
      AND tgname = 'point_debt_events_guard_policy_v2_provisional_state'
      AND NOT tgisinternal
  ) AS policy_v2_debt_state_guard_exists;

SELECT count(*) AS invalid_policy_v2_command_linkages
FROM system_deadline_commands c
LEFT JOIN trip_settlements s
  ON s.trip_id = c.trip_id AND s.fare_revision = c.fare_revision
WHERE c.command_type IN ('PROVISIONAL_SETTLE', 'FINALIZE_SETTLEMENT')
  AND (
    s.trip_id IS NULL
    OR s.allocation_policy <> 'HOST_APPROVAL_ORDER'
    OR (c.command_type = 'PROVISIONAL_SETTLE' AND (
      s.status NOT IN ('PROVISIONALLY_SETTLED', 'COMPLETED')
      OR s.provisional_deadline_command_id IS DISTINCT FROM c.command_id
    ))
    OR (c.command_type = 'FINALIZE_SETTLEMENT' AND (
      s.status <> 'COMPLETED'
      OR s.finalization_deadline_command_id IS DISTINCT FROM c.command_id
    ))
  );
