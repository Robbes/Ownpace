-- Copyright 2026 The Open Migration Stack authors (Apache-2.0)
--
-- Items the SOURCE no longer has, and whether the owner has decided about them.
--
-- §11.1 says deletions are never AUTO-propagated, and hard rule 2 forbids the
-- tool deleting on its own. Neither says the owner may not decide. Until now the
-- pass counted a disappearance as `drift` and forgot it by the end of the run,
-- so "your old system had 400 files, your new one has 460, and 60 of those you
-- deleted months ago" was a fact nobody could act on — or even see.
--
-- Two columns, and the first is the interesting one:
--
--   absent_passes           how many CONSECUTIVE complete scans have failed to
--                           find this item. Reset to 0 the moment it comes back.
--
--   deletion_acknowledged_at  when the owner decided to keep the target's copy
--                           anyway. NULL = still open.
--
-- WHY A COUNTER AND NOT A FLAG. We never observe a deletion; we observe an
-- ABSENCE, and absence has innocent causes — a folder briefly missing from
-- discovery, a permissions blip, a throttled listing, an IMAP UIDVALIDITY reset,
-- a source connector having a bad ten minutes. Any of those can present as "all
-- of it is gone". A single absent listing is not evidence, and the cost of
-- believing one is unbounded: a false delete destroys data, while a false retain
-- leaves clutter. Those are not comparable, so the counter buys the cheapest
-- possible insurance — the item has to vanish repeatedly, across scans that were
-- each complete enough to be trusted, before anyone is even asked about it.
--
-- Deliberately NOT a timestamp of first absence: passes, not minutes. A stack
-- that was down for a day and comes back must not find a queue full of
-- "confirmed" deletions it never actually confirmed.
--
-- Nothing here deletes anything. The queue is insight plus one decision — keep
-- the target's copy — and acting on the other answer is a separate, explicitly
-- destructive path that does not exist yet.

ALTER TABLE item ADD COLUMN IF NOT EXISTS absent_passes integer NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN IF NOT EXISTS deletion_acknowledged_at timestamptz;

-- Read per (tenant, mapping, domain) and always filtered to rows that have gone
-- missing, which on a healthy migration is none of them. Same reasoning as
-- ix_item_failed (0021) and ix_item_moved (0022).
CREATE INDEX IF NOT EXISTS ix_item_absent
  ON item (tenant_id, mapping_id, domain)
  WHERE absent_passes > 0;
