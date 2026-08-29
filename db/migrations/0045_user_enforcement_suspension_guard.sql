-- FR-05 / FR-33~40 / FR-50~54 / TR-01~03:
-- A report-based suspension is an emergency access-control measure only.
-- It must be tied to the reported, active USER account and may not turn a
-- NO_SHOW incident into an immediate account sanction. This guard deliberately
-- does not touch trip, escrow, ledger, debt, dispute, or settlement records.

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

CREATE TRIGGER user_enforcement_actions_guard_suspension
BEFORE INSERT ON user_enforcement_actions
FOR EACH ROW EXECUTE FUNCTION guard_user_enforcement_suspension();
