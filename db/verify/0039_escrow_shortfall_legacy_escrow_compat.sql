SELECT
  to_regprocedure('validate_participant_deposit_completion()') IS NOT NULL
    AS deposit_completion_guard_exists,
  to_regprocedure('validate_trip_escrow_confirmation()') IS NOT NULL
    AS escrow_confirmation_guard_exists;
