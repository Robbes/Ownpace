-- Copyright 2026 The Open Migration Stack authors (Apache-2.0)
--
-- `item.status = 'adopted'`: the item was already on the target under our own
-- natural key, so the sync recorded it and wrote NOTHING.
--
-- Adoption was previously indistinguishable from an ordinary idempotent skip.
-- Both return `created: false` and both landed as 'updated', so a migration
-- into an account that already held the customer's data reported exactly the
-- same numbers as a clean re-run of a finished one — "0 created, 500 skipped"
-- either way. Whether those 500 items are ours or were already there is a
-- question the operator has to be able to answer before cutover, and until now
-- the ledger could not.
--
-- Text column with a CHECK, so the allowed set has to be widened here as well
-- as in the Drizzle schema.

ALTER TABLE item DROP CONSTRAINT IF EXISTS item_status_check;

ALTER TABLE item
  ADD CONSTRAINT item_status_check
  CHECK (status IN (
    'pending',
    'copied',
    'updated',
    'adopted',
    'skipped',
    'failed',
    'deleted_source',
    'tombstoned'
  ));
