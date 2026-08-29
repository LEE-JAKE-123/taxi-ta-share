-- FR-01~05 / TR-02~03: a suspended account must not create or reactivate an
-- authenticated session through an INSERT ... ON CONFLICT retry.
--
-- Forward-only correction: allow a suspension transaction to revoke an
-- existing session after it changes the account state, while requiring an
-- ACTIVE account whenever a session would remain usable.

CREATE OR REPLACE FUNCTION guard_auth_session_active_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_status text;
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_status
  INTO target_status
  FROM users
  WHERE user_id = NEW.user_id
  FOR KEY SHARE;

  IF target_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'active sessions require an active account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER auth_sessions_require_active_user ON auth_sessions;

CREATE TRIGGER auth_sessions_require_active_user
BEFORE INSERT OR UPDATE OF user_id, revoked_at ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION guard_auth_session_active_user();
