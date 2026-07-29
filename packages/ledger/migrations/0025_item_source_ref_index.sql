-- Copyright 2026 The Open Migration Stack authors (Apache-2.0)
--
-- The SOURCE's own handle for an item, findable.
--
-- `item.source_ref` (jsonb) has existed since migration 0001 and nothing has
-- ever written it — the third column in this family with that history, after
-- `collection` (0022) and `target_version` (0023). So the ledger has always
-- known WHAT it copied and never the source's own name for it.
--
-- That name is the missing link for authoritative deletion detection. CalDAV and
-- CardDAV both speak RFC 6578 `sync-collection`, which reports a removed object
-- as a `<response>` carrying its HREF and a 404 status: the source saying
-- outright that something is gone, rather than the absence-counting in 0024
-- which has to watch an item vanish twice and can never be trusted enough to act
-- on. But a removed object has no body left, so the href is ALL that arrives —
-- and the natural key for those domains is the UID, which lives inside the body.
-- Without the href recorded at copy time there is no way back from "this href is
-- gone" to "this item is gone".
--
-- ITS OWN TEXT COLUMN, not a field inside the existing jsonb. The first version
-- of this did use jsonb with an expression index on `(source_ref ->> 'href')`,
-- and the lookup came back empty against a real database while typecheck and the
-- in-memory fake were both happy — the same shape of failure this project has
-- now paid for several times. A path expression through a jsonb column, written
-- by one ORM code path and read by another, is more cleverness than a lookup key
-- deserves. `source_ref` stays as the untouched grab-bag it always was; this is
-- a plain column with a plain btree index and a plain equality test.
--
-- NULL means "not recorded": every row written before this, and any source with
-- no stable per-item handle (mail, in the current shape). Those items cannot be
-- matched against a removal report and fall back to absence-counting, which is
-- the honest answer rather than a guess.

ALTER TABLE item ADD COLUMN IF NOT EXISTS source_ref_href text;

-- Read per (tenant, mapping, domain) plus the href. Partial, like its siblings
-- ix_item_failed / ix_item_moved / ix_item_absent: rows with no recorded href
-- can never be looked up, so indexing them buys nothing on a table that is
-- mostly them until a migration has run for a while.
CREATE INDEX IF NOT EXISTS ix_item_source_ref
  ON item (tenant_id, mapping_id, domain, source_ref_href)
  WHERE source_ref_href IS NOT NULL;
