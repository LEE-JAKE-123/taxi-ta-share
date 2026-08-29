SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'point_grant_execution_requests'
      AND column_name = 'purpose'
  ) AS settlement_assistance_purpose_exists,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'point_debt_events'
      AND column_name = 'grant_execution_request_id'
  ) AS repayment_assistance_link_exists,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'point_ledger'::regclass
      AND tgname = 'point_ledger_require_suspended_debt_repayment'
      AND NOT tgisinternal
  ) AS full_repayment_constraint_exists,
  position(
    'SETTLEMENT_DEBT_REPAYMENT'
    IN pg_get_functiondef('validate_point_grant_execution_request()'::regprocedure)
  ) > 0 AS suspended_debt_assistance_purpose_guarded,
  position(
    'repaid_amount <> NEW.available_delta'
    IN pg_get_functiondef('validate_suspended_debt_repayment_grant()'::regprocedure)
  ) > 0 AS assistance_requires_full_repayment,
  position(
    'debt.status = ''OPEN'''
    IN pg_get_functiondef('validate_suspended_debt_repayment_grant()'::regprocedure)
  ) > 0 AS assistance_clears_all_open_debt;
