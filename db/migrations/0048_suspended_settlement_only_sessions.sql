-- FR-05, FR-31~40, FR-50~54 / TR-01~03:
-- A suspended user may authenticate only into a separate, immutable
-- settlement-only session. Full sessions remain exclusive to active accounts.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth_sessions session
    JOIN users user_account ON user_account.user_id = session.user_id
    WHERE session.revoked_at IS NULL
      AND user_account.account_status IS DISTINCT FROM 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'cannot scope existing usable sessions for non-active accounts';
  END IF;
END;
$$;

ALTER TABLE auth_sessions
  ADD COLUMN access_scope text NOT NULL DEFAULT 'FULL',
  ADD CONSTRAINT auth_sessions_access_scope_valid
    CHECK (access_scope IN ('FULL', 'SETTLEMENT_ONLY'));

CREATE OR REPLACE FUNCTION guard_auth_session_active_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_status text;
  target_role text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.access_scope IS DISTINCT FROM OLD.access_scope
  THEN
    RAISE EXCEPTION 'session access scope is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_status, role
  INTO target_status, target_role
  FROM users
  WHERE user_id = NEW.user_id
  FOR SHARE;

  IF NEW.access_scope = 'FULL' THEN
    IF target_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'full sessions require an active account'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.access_scope = 'SETTLEMENT_ONLY' THEN
    IF target_status IS DISTINCT FROM 'SUSPENDED'
      OR target_role IS DISTINCT FROM 'USER'
    THEN
      RAISE EXCEPTION 'settlement-only sessions require a suspended user account'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown session access scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER auth_sessions_require_active_user ON auth_sessions;

CREATE TRIGGER auth_sessions_require_active_user
BEFORE INSERT OR UPDATE OF user_id, revoked_at, access_scope ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION guard_auth_session_active_user();

CREATE OR REPLACE FUNCTION guard_user_usable_session_compatibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth_sessions session
    WHERE session.user_id = NEW.user_id
      AND session.revoked_at IS NULL
      AND (
        (session.access_scope = 'FULL' AND NEW.account_status IS DISTINCT FROM 'ACTIVE')
        OR (
          session.access_scope = 'SETTLEMENT_ONLY'
          AND (
            NEW.account_status IS DISTINCT FROM 'SUSPENDED'
            OR NEW.role IS DISTINCT FROM 'USER'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'account state is incompatible with a usable session'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_require_compatible_auth_sessions
AFTER UPDATE OF account_status, role ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_user_usable_session_compatibility();
