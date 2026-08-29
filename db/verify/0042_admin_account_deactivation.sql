SELECT
  to_regclass('public.admin_account_actions') IS NOT NULL
    AS admin_account_actions_exists,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'admin_account_actions'::regclass
      AND tgname = 'admin_account_actions_prevent_mutation'
      AND NOT tgisinternal
  ) AS admin_account_actions_append_only,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth_sessions'::regclass
      AND tgname = 'auth_sessions_require_active_user'
      AND NOT tgisinternal
  ) AS auth_session_active_account_guard_exists,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'admin_account_actions'
      AND indexname = 'admin_account_actions_target_created_idx'
  ) AS admin_account_action_target_index_exists;
