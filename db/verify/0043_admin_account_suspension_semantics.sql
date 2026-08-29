SELECT
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'admin_account_actions'::regclass
      AND conname = 'admin_account_actions_action_type_check'
      AND pg_get_constraintdef(oid) LIKE '%SUSPEND%'
  ) AS admin_account_suspension_action_allowed;
