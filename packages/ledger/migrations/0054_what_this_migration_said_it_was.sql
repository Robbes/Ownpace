-- WHAT THIS MIGRATION SAID IT WAS, last time it booted (workplan 0125 T2).
--
-- ## The guard the appliance never had
--
-- T1 gave both editions a rule about what a live migration may change about
-- itself: the export policy may change, the source's root folder and type, the
-- target's type and account may not, and every refusal names what to do
-- instead. The managed edition enforces it at its edit route, because a change
-- there arrives as a REQUEST and the old values are in the database beside it.
--
-- The appliance has no edit route. Its config is a file its operator owns, so
-- it can change anything at all — including the things a ledger full of items
-- cannot survive. Change `source.type` on a live migration, restart, and
-- nothing stops it: the next pass compares what a different provider says
-- against natural keys produced by the old one, recognises nothing, and copies
-- the whole account again beside the first copy.
--
-- ## Why a column, and why the appliance had nothing to compare against
--
-- The appliance persists the tenant, the mapping id, the source and target
-- user and the pattern. Not the source type, not the target type, not the root
-- folder, not the export policy. The mapping FILE is its record of itself, so
-- "the mapping it is loading" and "what it was last time" were the same
-- string, and there was nothing a comparison could be made against.
--
-- The owner chose (2026-09-19) to persist the revision-relevant fields rather
-- than compare only what already persists. The cheaper option — compare
-- `mailbox.address` alone — needs no migration and cannot see a source or
-- target TYPE change at all, which is the case T2 leads with: it would guard
-- the cheap thing and leave the dangerous one open.
--
-- ## NULL means the first boot since this shipped, and it RECORDS
--
-- Hard rule 9, in the place it matters most here. A NULL column is not "this
-- mapping has never changed" — it is "nobody has written down what it was".
-- An appliance upgrading into this column has a running migration and no
-- snapshot, and refusing it at boot would strand a migration that has done
-- nothing wrong on the strength of a comparison that was never made. So the
-- first boot writes the snapshot and refuses nothing; the boot after that has
-- something honest to compare against.
--
-- ## One jsonb, keyed by the dotted paths the rule already speaks
--
-- `mayRevise` is keyed by `source.type`, `target.account` and the rest —
-- deliberately neither edition's own spelling, so one rule serves both. The
-- snapshot uses the same keys, so what is compared and what answers are the
-- same vocabulary and cannot drift into needing a translation.
--
-- A column rather than a table: this IS a fact about the mapping, it is one
-- row per mapping either way, and a table would add a second thing to keep in
-- step with `mailbox_mapping`'s lifecycle for no answer it could give better.
--
-- ## Access
--
-- Unchanged. `mailbox_mapping` carries its tenant policies; a column inherits
-- them. Nothing here is a credential: the snapshot holds a provider KIND, a
-- folder id, an account name and a format choice — the same facts the mapping
-- file states in plain text on the operator's own disk.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN IF NOT EXISTS revision_state jsonb;

COMMENT ON COLUMN public.mailbox_mapping.revision_state IS
  'What this migration said it was the last time it was loaded (workplan 0125 '
  'T2), keyed by the dotted field paths `mayRevise` speaks — so a boot can '
  'compare what the config declares NOW against what it declared then, and '
  'refuse the changes T1 refuses before a pass runs. NULL means no snapshot '
  'has been written yet, never that nothing changed: the first boot after this '
  'column shipped records and refuses nothing, because a comparison that was '
  'never made must not strand a running migration.';
