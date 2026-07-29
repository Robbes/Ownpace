-- Copyright 2026 The Open Migration Stack authors (Apache-2.0)
--
-- Make `item.source_ref` findable.
--
-- The column has existed since migration 0001 with `NOT NULL DEFAULT '{}'`, and
-- nothing has ever written it — the third column in this family with that
-- history, after `collection` (0022) and the never-populated half of
-- `natural_key`. So the ledger has always known WHAT it copied and never the
-- source's own handle for it.
--
-- That handle is the missing link for authoritative deletion detection. CalDAV
-- and CardDAV both speak RFC 6578 `sync-collection`, which reports a removed
-- object as a `<response>` carrying its HREF and a 404 status. That is the
-- source telling us outright that something is gone — far better evidence than
-- the absence-counting in 0024, which has to see an item missing twice before it
-- will say anything, and can never be trusted enough to act on.
--
-- But a removed object has no body left to read, so its href is ALL we get. The
-- natural key for calendar and contacts is the iCal/vCard UID, which lives
-- inside that body. Without the href recorded at copy time there is no way back
-- from "this href is gone" to "this item is gone", and the removal report is
-- unusable.
--
-- An expression index rather than a plain one, because the href is a field
-- inside the jsonb rather than the whole value: `source_ref` is an object so
-- there is room for whatever else a future connector needs to remember (a Graph
-- id, an IMAP UIDVALIDITY pair) without another migration.
--
-- Partial, like ix_item_failed / ix_item_moved / ix_item_absent: rows written
-- before this carry `{}` and can never be looked up, so indexing them buys
-- nothing on a table that is mostly them.

CREATE INDEX IF NOT EXISTS ix_item_source_ref
  ON item (tenant_id, mapping_id, domain, (source_ref ->> 'href'))
  WHERE source_ref ->> 'href' IS NOT NULL;
