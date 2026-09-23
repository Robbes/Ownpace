-- A FAILURE WITH ITS REFERENCE (workplan 0129 T1's promise, and 0130 T3's need).
--
-- When a data type's pass fails, the application records the failure for the
-- operator's log page with a reference number (0059), and the log line that
-- carries the error's text carries the same reference. The customer never saw
-- it: the failure line on their progress page showed the category and the
-- remedy, and nothing a person could quote. 0129's design says the failure
-- line shows it, and 0130's report form carries it, so a customer's report and
-- the operator's log row find each other without anybody reading a message.
--
-- So the status row keeps the reference of the failure it describes, beside
-- the category, written in the same statement. A pass that succeeds, or starts
-- again, clears both: a reference to a failure that is over would send
-- somebody looking for the wrong one.
--
-- Eight hex characters or nothing, the shape `app_event.reference` has, so the
-- column cannot carry a message by accident any more than that one can.

ALTER TABLE public.migration_status
  ADD COLUMN IF NOT EXISTS last_error_reference text;

ALTER TABLE public.migration_status
  DROP CONSTRAINT IF EXISTS migration_status_last_error_reference_check;

ALTER TABLE public.migration_status
  ADD CONSTRAINT migration_status_last_error_reference_check
  CHECK (last_error_reference IS NULL OR last_error_reference ~ '^[0-9a-f]{8}$');

COMMENT ON COLUMN public.migration_status.last_error_reference IS
  'The reference of the failure this row describes, as recorded in app_event and on the log line with the error''s text (workplan 0129). Cleared when the data type succeeds or starts again.';
