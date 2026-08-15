-- An open obligation has no settlement timestamp.  0022 correctly models
-- that state in point_debt_obligations_status_valid, but declared the column
-- NOT NULL.  This forward-only correction makes the two rules consistent.
ALTER TABLE point_debt_obligations
  ALTER COLUMN settled_at DROP NOT NULL;
