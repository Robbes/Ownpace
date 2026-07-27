-- Discovery: record items the source holds but cannot migrate.
--
-- `items` is the MIGRATABLE total — the number the customer approves at the
-- confirm screen. Anything the source cannot key (mail with no Message-ID) was
-- previously dropped with no trace: absent from this count, absent from the
-- ledger, and absent from the target listing, so both halves of the
-- verification gate agreed on nothing and reported PASS. This column is the
-- rest of the truth.
--
-- Nullable rather than DEFAULT 0: null means "this discovery run predates the
-- column and did not look", which is not the same claim as "there were none".

ALTER TABLE migration_discovery
  ADD COLUMN IF NOT EXISTS unmigratable_items integer;
