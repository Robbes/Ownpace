-- Copyright 2026 The Open Migration Stack authors (Apache-2.0)
--
-- Where the SOURCE now lists an item we already copied, and whether the owner
-- has seen it.
--
-- Migration 0021 gave failures somewhere to accumulate so a person could decide
-- about them. This is the same move for the other §11.2 decision: an item the
-- owner relocated on the source after the migration started.
--
-- Detection landed without storage, and that made the report a log line. A pass
-- counted the divergence, printed it, and forgot it — so an operator who was
-- not watching the container output at that moment never learned, and there was
-- no way to say "I have dealt with this, stop telling me". A queue you cannot
-- come back to is not a queue.
--
-- Two columns, because a move is two separate facts:
--
--   moved_to_collection  WHERE the source lists it now. NULL means "not
--                        moved" — which is also every row written before this
--                        migration, and correctly so. `collection` keeps
--                        saying where we copied it FROM, because that is still
--                        where the target's copy actually is; overwriting that
--                        would make the ledger describe a target that does not
--                        exist.
--
--   move_acknowledged_at WHEN the owner decided to leave the target's layout
--                        alone. NULL means still open. It is a timestamp
--                        rather than a flag because §11.2 wants an audit trail
--                        of decisions, and "when did I dismiss this" is the
--                        question that gets asked afterwards.
--
-- Acknowledgement is per DESTINATION, not per item: if the same item is moved
-- again, to somewhere else, `move_acknowledged_at` is cleared and the owner is
-- asked about the new arrangement. A decision about one layout is not consent
-- to every future one.
--
-- Nothing here moves or deletes anything on the target. §11.1 leaves topology
-- to the owner, and the delete half of a move is forbidden outright by hard
-- rule 2; acting on one of these is a separate, explicitly destructive
-- operation that does not exist yet.

ALTER TABLE item ADD COLUMN IF NOT EXISTS moved_to_collection text;
ALTER TABLE item ADD COLUMN IF NOT EXISTS move_acknowledged_at timestamptz;

-- The move queue is read per (tenant, mapping, domain) and always filtered to
-- rows that have one, which on a healthy migration is nearly none of them.
-- Same reasoning as ix_item_failed in 0021: a partial index stays small enough
-- to be worth having on a table with hundreds of thousands of rows.
CREATE INDEX IF NOT EXISTS ix_item_moved
  ON item (tenant_id, mapping_id, domain)
  WHERE moved_to_collection IS NOT NULL;
