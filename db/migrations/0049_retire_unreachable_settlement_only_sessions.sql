-- FR-05 / FR-31~40 / TR-02~03:
-- 0048 introduced a session scope the application never issued or authorized.
-- Deferred suspension keeps a user ACTIVE until their protected settlements
-- finish, so this forward migration removes that unreachable access surface.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth_sessions
    WHERE access_scope = 'SETTLEMENT_ONLY'
      AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot retire settlement-only sessions while usable sessions exist';
  END IF;
END;
$$;

DROP TRIGGER users_require_compatible_auth_sessions ON users;
DROP TRIGGER auth_sessions_require_active_user ON auth_sessions;

ALTER TABLE auth_sessions DROP COLUMN access_scope;

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

CREATE TRIGGER auth_sessions_require_active_user
BEFORE INSERT OR UPDATE OF user_id, revoked_at ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION guard_auth_session_active_user();

CREATE OR REPLACE FUNCTION guard_user_usable_session_compatibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_status IS DISTINCT FROM 'ACTIVE'
    AND EXISTS (
      SELECT 1
      FROM auth_sessions session
      WHERE session.user_id = NEW.user_id
        AND session.revoked_at IS NULL
    )
  THEN
    RAISE EXCEPTION 'account state is incompatible with a usable session'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_require_compatible_auth_sessions
AFTER UPDATE OF account_status ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_user_usable_session_compatibility();
