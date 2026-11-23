-- THE CHANGE A COPY WAITS FOR (ADR-0055 decision 5; workplan 0168 §3.1, the
-- review's finding S3).
--
-- `item.address_digest` (0072) says which confirmed rows a copy was written
-- under. A pass that finds the copy should carry another digest, and does not
-- write it, records here what it should carry: past the data type's cutover
-- with no press for the table as it is (D5), with no version to guard the
-- write (S1), after a change at the source past the cutover, or for guests a
-- target would mail (0160). The digest of no rows at all
-- (`ADDRESS_DIGEST_OF_NO_CHANGE`, `@openmig/shared`) stands for "it should
-- carry no change", after a row was deleted or sent back.
--
-- A copy whose `address_digest_due` is set and differs from its
-- `address_digest` is never a match: the confirmed list reads it as older,
-- verification sets its sample aside, and the report counts it as waiting.
-- Before this column a copy the new table would change, written before the
-- change, read as a match until a pass rewrote it, and past a cutover that
-- was until somebody pressed, indefinitely.
--
-- NULL when nothing is due: every row written before this column, every mail
-- and file row, and every copy the last pass that looked at it wrote or found
-- as the table says. A pass that writes the copy clears it. Not backfilled:
-- the next pass under a table that moved reads every copy again (a cursor is
-- stored with the table it was read under) and records what is due.
--
-- Only adding a nullable column with no default: no row is rewritten, and the
-- lock is the brief one an `ADD COLUMN` takes.

ALTER TABLE public.item ADD COLUMN address_digest_due text;

ALTER TABLE public.item ADD CONSTRAINT item_address_digest_due_check
  CHECK (((address_digest_due IS NULL) OR (address_digest_due ~ '^[0-9a-f]{64}$'::text))) NOT VALID;

COMMENT ON COLUMN public.item.address_digest_due IS
  'The digest (ADR-0055) this copy should carry under the confirmed address table the last pass that looked at it read, when that pass did not write it; SHA-256 hex, the digest of no rows when it should carry no change. NULL when nothing is due.';
