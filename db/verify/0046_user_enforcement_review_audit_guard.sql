SELECT
  position(
    'report_review_actions'
    IN pg_get_functiondef('guard_user_enforcement_suspension()'::regprocedure)
  ) > 0 AS enforcement_requires_report_review_action,
  position(
    'action_type = ''SUSPEND_USER'''
    IN pg_get_functiondef('guard_user_enforcement_suspension()'::regprocedure)
  ) > 0 AS enforcement_requires_suspend_review_action,
  position(
    'idempotency_key = NEW.idempotency_key'
    IN pg_get_functiondef('guard_user_enforcement_suspension()'::regprocedure)
  ) > 0 AS enforcement_requires_matching_idempotency_key;
