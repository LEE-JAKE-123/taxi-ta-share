SELECT count(*) AS invalid_host_memos
FROM trip_groups
WHERE host_memo IS NOT NULL
  AND (
    host_memo ~ E'^\\s*$'
    OR char_length(host_memo) > 60
  );
