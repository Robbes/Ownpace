-- Copyright 2026 The Open Migration Stack authors (Apache-2.0)
--
-- `item.status = 'left_behind'`: the owner looked at an item that could not be
-- migrated and decided to proceed without it.
--
-- Needed because per-item failure isolation gives failures somewhere to
-- accumulate. Before it, one unreadable item aborted its whole domain pass, so
-- a permanently-broken item was not a state to manage — it was an outage. Now
-- the pass carries on and the item sits in the ledger as `failed`, retried on
-- each pass until `MAX_ITEM_ATTEMPTS`, after which it is parked and waits for a
-- person.
--
-- A parked item needs exactly two answers, and they are different enough to
-- need different storage:
--
--   RETRY   — "the cause is fixed now". Resets attempt_count; the row stays
--             `failed` and the next pass tries again. No new status.
--   ACCEPT  — "migrate without it". This one is a DECISION, it is durable, and
--             it must survive every later pass without being retried and
--             without being reported as an open problem. That is this status.
--
-- Why it is not simply deleting the row: the row is the record that we tried,
-- how many times, and what the server said. §11.2 puts owner decisions in a
-- queue with an audit trail; a deleted row would make the item look like one
-- the source never had, and the next pass would pick it up and fail again.
--
-- Verification treats it as knowingly excluded rather than missing (see
-- verification-queries.ts). Everything else — 'failed' included — still counts
-- as missing on the target, because it is: the operator has to see that before
-- cutover, and only an explicit accept may quiet it.

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
    'left_behind',
    'deleted_source',
    'tombstoned'
  ));

-- The failure queue is read per (tenant, mapping, domain) and always filtered
-- to the unresolved states, so it gets its own partial index rather than
-- riding on ix_item_status: on a finished migration the failed rows are a
-- handful out of hundreds of thousands.
CREATE INDEX IF NOT EXISTS ix_item_failed
  ON item (tenant_id, mapping_id, domain)
  WHERE status = 'failed';
