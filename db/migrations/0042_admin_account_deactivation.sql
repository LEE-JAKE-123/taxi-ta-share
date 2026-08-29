-- FR-01~05 / FR-31~31b / FR-40 / TR-02~03:
-- Administrator-initiated account deactivation is logical, audited, and must
-- never mutate points or historical trips.  It also closes the login race
-- between session creation and the administrative deactivation transaction.

CREATE TABLE admin_account_actions (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type = 'DEACTIVATE'),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 1000),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_account_actions_idempotent
    UNIQUE (admin_user_id, idempotency_key)
);

CREATE INDEX admin_account_actions_target_created_idx
  ON admin_account_actions (target_user_id, created_at DESC, action_id);

CREATE FUNCTION prevent_admin_account_action_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin account actions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_account_actions_prevent_mutation
BEFORE UPDATE OR DELETE ON admin_account_actions
FOR EACH ROW EXECUTE FUNCTION prevent_admin_account_action_mutation();

CREATE FUNCTION guard_auth_session_active_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_status text;
BEGIN
  SELECT account_status
  INTO target_status
  FROM users
  WHERE user_id = NEW.user_id
  FOR KEY SHARE;

  IF target_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'sessions require an active account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_require_active_user
BEFORE INSERT ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION guard_auth_session_active_user();
