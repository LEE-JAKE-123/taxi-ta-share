-- Open obligations must be able to keep settled_at NULL; settled/waived rows
-- remain governed by point_debt_obligations_status_valid.
SELECT is_nullable = 'YES' AS point_debt_settled_at_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'point_debt_obligations'
  AND column_name = 'settled_at';
