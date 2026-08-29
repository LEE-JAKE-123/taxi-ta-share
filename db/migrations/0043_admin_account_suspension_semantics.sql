-- FR-01~05 / TR-02~03:
-- 0042 used a DELETED lifecycle state for a reversible operational action.
-- Keep the append-only action table, but align the action with the existing
-- audited SUSPENDED account state. No account data or historical action rows
-- are rewritten by this forward-only correction.

ALTER TABLE admin_account_actions
  DROP CONSTRAINT admin_account_actions_action_type_check,
  ADD CONSTRAINT admin_account_actions_action_type_check
    CHECK (action_type IN ('DEACTIVATE', 'SUSPEND'));
