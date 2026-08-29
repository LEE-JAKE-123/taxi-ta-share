SELECT
  to_regclass('public.account_suspension_requests') IS NOT NULL
    AS suspension_requests_exist,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'account_suspension_requests'
      AND indexname = 'account_suspension_one_pending_per_user_idx'
  ) AS one_pending_suspension_per_user,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'account_suspension_requests'::regclass
      AND tgname = 'account_suspension_requests_guard_insert'
      AND NOT tgisinternal
  ) AS suspension_request_source_guard_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'trip_groups'::regclass
      AND tgname = 'trip_groups_effect_due_account_suspensions'
      AND tgdeferrable
      AND tginitdeferred
      AND NOT tgisinternal
  ) AS terminal_trip_suspension_effect_guard_exists,
  to_regprocedure('effect_due_account_suspensions_for_user(uuid)') IS NOT NULL
    AS deferred_suspension_effect_function_exists;
