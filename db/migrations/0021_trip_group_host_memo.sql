ALTER TABLE trip_groups
  ADD COLUMN host_memo text,
  ADD CONSTRAINT trip_groups_host_memo_valid CHECK (
    host_memo IS NULL OR (
      host_memo !~ E'^\\s*$'
      AND char_length(host_memo) <= 60
    )
  );
