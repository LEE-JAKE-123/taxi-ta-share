-- Post-migration inspection for policy-v2 settlement guards.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trip_settlements'
      AND column_name = 'provisional_deadline_command_id'
  ) AS provisional_command_column_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trip_settlements'
      AND column_name = 'finalization_deadline_command_id'
  ) AS finalization_command_column_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trip_settlements_provisional_command_unique_idx'
  ) AS provisional_command_unique_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trip_settlements_finalization_command_unique_idx'
  ) AS finalization_command_unique_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'fare_disputes_v2_open_lookup_idx'
  ) AS v2_open_dispute_index_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_debt_events'::regclass
      AND tgname = 'point_debt_events_validate_policy_v2'
      AND NOT tgisinternal
  ) AS v2_debt_command_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_settlements'::regclass
      AND tgname = 'trip_settlements_validate_policy_v2_financials'
      AND NOT tgisinternal
  ) AS v2_financial_constraint_exists,
  position(
    'PROVISIONAL_SETTLE'
    IN pg_get_constraintdef(
      (SELECT oid FROM pg_constraint
       WHERE conrelid = 'system_deadline_commands'::regclass
         AND conname = 'system_deadline_commands_command_type_check')
    )
  ) > 0 AS provisional_command_type_allowed,
  position(
    'FINALIZE_SETTLEMENT'
    IN pg_get_constraintdef(
      (SELECT oid FROM pg_constraint
       WHERE conrelid = 'system_deadline_commands'::regclass
         AND conname = 'system_deadline_commands_command_type_check')
    )
  ) > 0 AS finalization_command_type_allowed;

SELECT count(*) AS invalid_policy_v2_provenance_rows
FROM trip_settlements s
LEFT JOIN system_deadline_commands p
  ON p.command_id = s.provisional_deadline_command_id
LEFT JOIN system_deadline_commands f
  ON f.command_id = s.finalization_deadline_command_id
WHERE s.allocation_policy = 'HOST_APPROVAL_ORDER'
  AND (
    (s.status = 'PENDING_CONFIRMATION' AND (
      s.provisional_deadline_command_id IS NOT NULL
      OR s.finalization_deadline_command_id IS NOT NULL
    ))
    OR (s.status = 'PROVISIONALLY_SETTLED' AND (
      p.command_id IS NULL OR p.trip_id <> s.trip_id
      OR p.fare_revision <> s.fare_revision
      OR p.command_type <> 'PROVISIONAL_SETTLE'
      OR s.finalization_deadline_command_id IS NOT NULL
    ))
    OR (s.status = 'COMPLETED' AND (
      p.command_id IS NULL OR f.command_id IS NULL
      OR p.trip_id <> s.trip_id OR f.trip_id <> s.trip_id
      OR p.fare_revision <> s.fare_revision OR f.fare_revision <> s.fare_revision
      OR p.command_type <> 'PROVISIONAL_SETTLE'
      OR f.command_type <> 'FINALIZE_SETTLEMENT'
    ))
  );

SELECT count(*) AS policy_v2_financial_decomposition_mismatches
FROM trip_settlements s
JOIN trip_settlement_participants sp ON sp.trip_id = s.trip_id
LEFT JOIN LATERAL (
  SELECT
    coalesce(sum(-l.held_delta) FILTER (WHERE l.entry_type = 'SETTLEMENT_CHARGE'), 0)::integer AS charged,
    coalesce(sum(l.available_delta) FILTER (WHERE l.entry_type = 'REFUND'), 0)::integer AS refunded,
    coalesce(sum(-l.available_delta) FILTER (WHERE l.entry_type = 'ADDITIONAL_DEBIT'), 0)::integer AS debited
  FROM point_ledger l
  WHERE l.trip_id = sp.trip_id AND l.user_id = sp.user_id
    AND l.system_deadline_command_id = s.provisional_deadline_command_id
    AND l.entry_type IN ('SETTLEMENT_CHARGE', 'REFUND', 'ADDITIONAL_DEBIT')
) ledger ON true
LEFT JOIN LATERAL (
  SELECT coalesce(sum(e.debt_delta) FILTER (WHERE e.event_type = 'INCUR'), 0)::integer AS incurred
  FROM point_debt_obligations o
  JOIN point_debt_events e ON e.debt_id = o.debt_id
  WHERE o.trip_id = sp.trip_id AND o.user_id = sp.user_id
    AND o.fare_revision = s.fare_revision
    AND e.system_deadline_command_id = s.provisional_deadline_command_id
) debt ON true
WHERE s.allocation_policy = 'HOST_APPROVAL_ORDER'
  AND s.status IN ('PROVISIONALLY_SETTLED', 'COMPLETED')
  AND (
    ledger.charged <> least(sp.deposit_amount, sp.allocated_share)
    OR ledger.refunded <> greatest(sp.deposit_amount - sp.allocated_share, 0)
    OR ledger.debited + debt.incurred <> greatest(sp.allocated_share - sp.deposit_amount, 0)
  );
