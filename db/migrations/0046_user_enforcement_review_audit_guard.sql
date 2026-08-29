-- FR-05 / TR-02~03:
-- A suspension enforcement row is valid only when its append-only report
-- review decision exists first. Keep the earlier target and role checks while
-- also binding the two audit records with the same idempotency key and note.

CREATE OR REPLACE FUNCTION guard_user_enforcement_suspension()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  report_target_user_id uuid;
  report_reason_code text;
  target_role text;
  target_status text;
  executor_role text;
  executor_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM report_review_actions
    WHERE report_id = NEW.report_id
      AND admin_user_id = NEW.admin_user_id
      AND action_type = 'SUSPEND_USER'
      AND resolution_note = NEW.reason
      AND idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'suspension requires its matching report review action'
      USING ERRCODE = '23514';
  END IF;

  SELECT reported_user_id, reason_code
  INTO report_target_user_id, report_reason_code
  FROM user_reports
  WHERE report_id = NEW.report_id
  FOR KEY SHARE;

  IF report_target_user_id IS NULL OR report_target_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'enforcement must target the user reported by its report'
      USING ERRCODE = '23514';
  END IF;

  IF report_reason_code = 'NO_SHOW' THEN
    RAISE EXCEPTION 'no-show reports require the incident review workflow'
      USING ERRCODE = '23514';
  END IF;

  SELECT role, account_status
  INTO target_role, target_status
  FROM users
  WHERE user_id = NEW.user_id
  FOR KEY SHARE;

  IF target_role <> 'USER' OR target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'suspension requires an active USER target'
      USING ERRCODE = '23514';
  END IF;

  SELECT role, account_status
  INTO executor_role, executor_status
  FROM users
  WHERE user_id = NEW.admin_user_id
  FOR KEY SHARE;

  IF executor_role <> 'ADMIN' OR executor_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'suspension requires an active ADMIN executor'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
