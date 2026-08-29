SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_sessions'
      AND column_name = 'access_scope'
  ) AS session_access_scope_exists,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth_sessions'::regclass
      AND tgname = 'auth_sessions_require_active_user'
      AND NOT tgisinternal
      AND pg_get_triggerdef(oid) LIKE '%access_scope%'
  ) AS scoped_session_guard_exists,
  position(
    'SETTLEMENT_ONLY'
    IN pg_get_functiondef('guard_auth_session_active_user()'::regprocedure)
  ) > 0 AS settlement_only_session_guarded,
  position(
    'session access scope is immutable'
    IN pg_get_functiondef('guard_auth_session_active_user()'::regprocedure)
  ) > 0 AS session_scope_is_immutable,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'users'::regclass
      AND tgname = 'users_require_compatible_auth_sessions'
      AND NOT tgisinternal
      AND tgdeferrable
      AND tginitdeferred
  ) AS account_transition_session_guard_exists;
