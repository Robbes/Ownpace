-- Where a domain pass spent its wall time, so §19's dashboard can show
-- throughput rather than only counts.
--
-- jsonb rather than a column per field, matching `run.stats`: the shape is a
-- report, not a query surface, and adding a phase later must not need a
-- migration. Nullable — a domain that has never completed a pass has no
-- metrics, and inventing zeros would read as "instant" on a dashboard.
--
-- Contains NO personal data: item counts and durations only, never folder
-- names or addresses (§17 treats those as personal data).
ALTER TABLE migration_status
  ADD COLUMN IF NOT EXISTS last_pass_metrics jsonb;
