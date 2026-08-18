-- The date erasure actually completes (workplan 0085 T5).
--
-- `purged_at` records when the rows left the LIVE database. Every backup taken
-- before that moment still contains them, and will until it ages out of the
-- deployment's retention window. So `purged_at` is not the date erasure
-- finished, and a record that offers no other date invites everyone reading it
-- to assume otherwise.
--
-- Two columns, written at CLOSE, alongside the window the customer chose:
--
--   backup_retention_days  what this deployment's retention was AT THE TIME.
--                          Recorded rather than looked up later, because the
--                          number can change and the customer was told a
--                          specific date on a specific day.
--   backups_expire_at      the date derived from it — the promise, as made.
--
-- Nullable, because records written before this migration were made without a
-- promise about backups and inventing one for them retroactively would be
-- writing a commitment nobody gave.

ALTER TABLE public.erasure_record
  ADD COLUMN IF NOT EXISTS backup_retention_days integer,
  ADD COLUMN IF NOT EXISTS backups_expire_at timestamp with time zone;

COMMENT ON COLUMN public.erasure_record.backup_retention_days IS
  'This deployment''s backup retention window in days, as it stood when the tenant was closed. NULL for records written before workplan 0085 T5.';

COMMENT ON COLUMN public.erasure_record.backups_expire_at IS
  'When the last backup that could contain this tenant''s data ages out — i.e. when erasure completes. Derived from purge_after plus backup_retention_days at close time, and recorded because it was told to the customer as a date.';
