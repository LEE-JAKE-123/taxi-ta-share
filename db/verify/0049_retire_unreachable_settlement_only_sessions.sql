SELECT
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_sessions'
      AND column_name = 'access_scope'
  ) AS settlement_only_scope_retired,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'auth_sessions'::regclass
      AND tgname = 'auth_sessions_require_active_user'
      AND NOT tgisinternal
      AND pg_get_triggerdef(oid) NOT LIKE '%access_scope%'
  ) AS active_session_guard_restored;
