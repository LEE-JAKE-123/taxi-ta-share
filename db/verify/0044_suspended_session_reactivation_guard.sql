SELECT
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth_sessions'::regclass
      AND tgname = 'auth_sessions_require_active_user'
      AND NOT tgisinternal
      AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE OF user_id, revoked_at%'
  ) AS auth_session_reactivation_guard_exists,
  position(
    'NEW.revoked_at IS NOT NULL'
    IN pg_get_functiondef('guard_auth_session_active_user()'::regprocedure)
  ) > 0 AS revoked_session_updates_allowed,
  position(
    'account_status'
    IN pg_get_functiondef('guard_auth_session_active_user()'::regprocedure)
  ) > 0 AS usable_sessions_require_active_account;
