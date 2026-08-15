SELECT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE proname = 'validate_policy_v2_adjustment_financials'
    AND pg_get_functiondef(oid) LIKE '%TG_TABLE_NAME = ''point_ledger''%'
) AS policy_v2_adjustment_trigger_dispatch_valid;
