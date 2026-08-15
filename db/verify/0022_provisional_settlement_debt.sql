-- Post-migration inspection for DEC-011/013/014 schema foundations.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'point_accounts'
      AND column_name = 'debt_points'
  ) AS debt_projection_exists,
  to_regclass('public.point_debt_obligations') IS NOT NULL AS debt_obligations_exists,
  to_regclass('public.point_debt_events') IS NOT NULL AS debt_events_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'point_debt_obligations_user_open_idx'
  ) AS debt_open_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'point_debt_events_user_created_idx'
  ) AS debt_events_user_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'trip_settlement_participants_allocation_rank_unique_idx'
  ) AS allocation_rank_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'trip_settlements_policy_v2_agreement_due_idx'
  ) AS agreement_due_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'trip_settlements_policy_v2_dispute_due_idx'
  ) AS dispute_due_index_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_debt_events'::regclass
      AND tgname = 'point_debt_events_prevent_mutation'
      AND NOT tgisinternal
  ) AS debt_events_append_only,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_accounts'::regclass
      AND tgname = 'point_accounts_prevent_direct_debt_mutation'
      AND NOT tgisinternal
  ) AS direct_debt_projection_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'point_debt_events'::regclass
      AND tgname = 'point_debt_events_apply_to_account'
      AND NOT tgisinternal
  ) AS debt_projection_trigger_exists;

SELECT count(*) AS invalid_policy_v2_settlements
FROM trip_settlements s
WHERE (s.allocation_policy = 'LEGACY_CEIL' AND (
    s.agreement_deadline IS NOT NULL
    OR s.dispute_deadline IS NOT NULL
    OR s.provisionally_settled_at IS NOT NULL
  ))
  OR (s.allocation_policy = 'HOST_APPROVAL_ORDER' AND (
    s.confirmation_deadline <> s.submitted_at + interval '10 minutes'
    OR s.agreement_deadline <> s.submitted_at + interval '10 minutes'
    OR s.dispute_deadline <> s.submitted_at + interval '24 hours'
    OR (
      s.status = 'PENDING_CONFIRMATION'
      AND s.provisionally_settled_at IS NOT NULL
    )
    OR (
      s.status IN ('PROVISIONALLY_SETTLED', 'COMPLETED')
      AND (
        s.provisionally_settled_at IS NULL
        OR s.provisionally_settled_at < s.submitted_at
      )
    )
  ));

SELECT count(*) AS invalid_policy_v2_allocations
FROM trip_settlements s
WHERE s.allocation_policy = 'HOST_APPROVAL_ORDER'
  AND EXISTS (
    SELECT 1
    FROM (
      SELECT
        count(*) AS snapshot_count,
        count(*) FILTER (
          WHERE sp.allocation_rank IS NOT NULL AND sp.allocated_share IS NOT NULL
        ) AS ranked_count,
        coalesce(sum(sp.allocated_share), 0) AS allocated_total
      FROM trip_settlement_participants sp
      WHERE sp.trip_id = s.trip_id
    ) allocation
    WHERE allocation.snapshot_count <> s.participant_count
      OR allocation.ranked_count <> s.participant_count
      OR allocation.allocated_total <> s.actual_fare
  );

SELECT count(*) AS invalid_debt_projection_rows
FROM point_accounts a
LEFT JOIN (
  SELECT user_id, coalesce(sum(outstanding_points), 0)::bigint AS outstanding_points
  FROM point_debt_obligations
  GROUP BY user_id
) d ON d.user_id = a.user_id
WHERE a.debt_points < 0
   OR a.debt_points <> coalesce(d.outstanding_points, 0);
