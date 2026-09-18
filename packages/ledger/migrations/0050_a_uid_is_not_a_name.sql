-- An item gets the name a PERSON calls it (the owner's ask, 2026-09-17).

-- ## The gap, stated exactly
--
-- On 2026-09-12 the ledger learned to actually WRITE `item.natural_key` -- the
-- column had existed since the baseline and held `''` on every row ever
-- written -- so the confirmed list could say WHICH item a row is. For a file
-- that is a path and for mail a Message-ID, and both are things a person can
-- search their old account for.
--
-- For a calendar event and a contact it is a UID, and a UID is not something
-- anybody has ever seen. The owner said so on sight: *"Why not show calander
-- item names and contact names?"*
--
-- It is not only a reading nicety. Two of his contacts were refused by a live
-- Nextcloud, and every surface that could have told him which two printed
-- `926caf98adce563`. His answer was *"I can not find these contacts, or atleast
-- i do no know how"*, which is the correct answer: there was nothing on the
-- screen to find them by.
--
-- ## Beside the key, never instead of it
--
-- `natural_key_hash` remains the handle for every lookup and every action, and
-- `natural_key` remains what the SOURCE calls the item. This column is what its
-- OWNER calls it, and it is deliberately not unique: two contacts named Jan
-- Jansen are two rows, keyed apart and labelled the same. Nothing may key,
-- match, deduplicate or decide on this value.
--
-- ## Which domains fill it
--
-- Calendar and tasks from SUMMARY, contacts from FN. Both sit on the parsed
-- item already, so nothing re-reads a body to get them.
--
-- FILES stay NULL on purpose: their key IS the path, which is the name, and a
-- second copy of it on the same row is noise.
--
-- MAIL stays NULL as a gap rather than a decision. The human label is the
-- Subject, it is not on the parsed item, and it lives in the RFC 822 bytes
-- behind RFC 2047 encoded-words and header folding. Decoding that correctly is
-- its own piece of work, and half of it -- a mojibake subject on the one
-- document somebody empties their account on the strength of -- is worse than
-- the Message-ID it would replace.
--
-- ## Rows written before today
--
-- NULL, and they stay NULL until something touches them again. There is no
-- backfill and there cannot be one: the name is in the payload at the source,
-- the ledger never kept a copy, and inventing one would be worse than the UID.
-- A screen reading NULL falls back to `natural_key`, which is exactly what it
-- shows today, so an old row loses nothing.
--
-- A FAILED row does get its name on the next attempt, which is the case that
-- prompted this: the pass has the payload in hand at the moment it records the
-- failure.
--
-- ## Bounded on the way in
--
-- `boundDisplayName` (packages/shared/src/hash.ts) collapses whitespace and
-- caps the value, so a pathological summary cannot make a row expensive to
-- read. The cap is enforced in code rather than as a column type: a CHECK that
-- refused an over-long name would turn a cosmetic problem into a failed write
-- on somebody's migration.
--
-- ## Access
--
-- `item` carries RLS, FORCE and its tenant policies; a column inherits them.
-- This value is personal data -- a person's name, an appointment's title -- and
-- it travels under exactly the rule `natural_key` travels under (operating
-- contract section 17): the owner's own session, never a 0122 view link, never
-- an operator's metadata-only view, and never inside an error message.

ALTER TABLE public.item
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN public.item.display_name IS
  'The name a PERSON calls this item: a calendar event''s SUMMARY, a contact''s FN. '
  'Beside natural_key, never instead of it, and NOT a key: it is not unique, '
  'nothing looks a row up by it, and nothing may match, deduplicate or decide on '
  'it. NULL means no name was recorded -- for a file (whose natural_key IS the '
  'name), for mail (whose Subject this code cannot yet decode), and for every row '
  'written before 2026-09-17. A screen reading NULL falls back to natural_key. '
  'Personal data: same access rule as natural_key -- the owner''s own session '
  'only, never a view link, never a metadata-only operator view, never an error '
  'message.';
