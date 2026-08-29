SELECT
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'user_enforcement_actions'::regclass
      AND tgname = 'user_enforcement_actions_guard_suspension'
      AND NOT tgisinternal
  ) AS enforcement_suspension_guard_exists,
  position(
    'NO_SHOW'
    IN pg_get_functiondef('guard_user_enforcement_suspension()'::regprocedure)
  ) > 0 AS no_show_immediate_suspension_rejected,
  position(
    'target_role <> ''USER'''
    IN pg_get_functiondef('guard_user_enforcement_suspension()'::regprocedure)
  ) > 0 AS only_user_targets_allowed,
  position(
    'executor_role <> ''ADMIN'''
    IN pg_get_functiondef('guard_user_enforcement_suspension()'::regprocedure)
  ) > 0 AS active_admin_executor_required;
