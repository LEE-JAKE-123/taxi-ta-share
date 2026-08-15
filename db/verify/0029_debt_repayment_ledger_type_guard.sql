SELECT
  position(
    $$OR ledger_entry_type <> 'DEBT_REPAYMENT'$$
    IN pg_get_functiondef('validate_point_debt_repayment()'::regprocedure)
  ) > 0 AS debt_repayment_ledger_type_guard_valid,
  (
    SELECT count(*) = 0
    FROM point_debt_events e
    LEFT JOIN point_ledger l ON l.ledger_id = e.repayment_ledger_id
    WHERE e.event_type = 'REPAYMENT'
      AND l.entry_type IS DISTINCT FROM 'DEBT_REPAYMENT'
  ) AS debt_repayment_links_valid;
