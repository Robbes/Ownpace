-- THE COPY LEFT AFTER THE SWITCH (ADR-0055 decision 6; workplan 0168, the
-- owner's decision of 2026-11-23, option (b): "2) b.").
--
-- Past a data type's cutover a change at the source overwrites no copy
-- (ADR-0048, the owner's "Stop overwriting" of 2026-10-05): the pass counts it
-- `changedAfterCutover` and leaves the copy as it is. When the address table
-- moved for that copy as well, the pass marks the change it waits for
-- (`address_digest_due`, 0074), and until now every reader counted it as
-- waiting for *Apply the new addresses here too*. The press never rewrites it,
-- since that rewrite would carry the source's later change too, so it waited
-- for something that never comes.
--
-- The owner chose to leave such a copy as it is and say so. This column is
-- when a pass first left it so: set with `address_digest_due` by the pass
-- that leaves it, cleared with it by a pass that finds nothing due or writes
-- the copy. A copy that waits for a change (`address_digest_due` set and
-- different from `address_digest`) with this column set is counted apart as
-- left: never as waiting, never claimed by the press, and never holding a
-- cutover, which has already happened.
--
-- NULL on every existing row: not backfilled. The next pass past the cutover
-- reads such a copy again (its source version moved) and sets it.
--
-- Only adding a nullable column with no default: no row is rewritten, and the
-- lock is the brief one an `ADD COLUMN` takes.

ALTER TABLE public.item ADD COLUMN address_left_at timestamp with time zone;

COMMENT ON COLUMN public.item.address_left_at IS
  'When a pass past the data type''s cutover first left this copy as it is because its source changed after the switch, while an address change was due for it (ADR-0055 decision 6, option (b)). NULL otherwise.';
