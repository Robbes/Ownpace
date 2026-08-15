-- Where a relocated item went, by KEY rather than by folder (ADR-0030).
--
-- `moved_to_collection` has recorded moves since migration 0022, and it cannot
-- describe the commonest reorganisation there is: renaming a file in place.
-- The collection does not change, so the column has nothing to say, and the
-- pass fell back to reporting the old path as an unexplained absence — then, two
-- clean scans later, as a DELETION of a file that is plainly still there under
-- another name. `move-detection.unit.test.ts` pins that, and it is what this
-- column exists to end.
--
-- It also carries the safety argument for the new `apply`. A relocation may
-- have the target's OLD copy removed, and the only reason that is not a
-- deletion is that the same bytes are already on the target under this key —
-- written by us, in the pass that noticed. The key has to be WRITTEN DOWN for
-- an apply days later to be able to check that, which is exactly what
-- ADR-0024's evidence gates are for.
--
-- NULL means "no relocation recorded", which covers every existing row and
-- every mail or calendar move: those keep their natural key when they move, so
-- there is no second key to name and nothing to apply.
--
-- Additive and nullable. Nothing is backfilled: a row that moved before this
-- migration has no arrival key recorded and never will, because the correlation
-- that produced it happened in a pass that is over. Those moves stay
-- acknowledge-only, which is what they have always been.

ALTER TABLE public.item ADD COLUMN IF NOT EXISTS moved_to_natural_key_hash text;

COMMENT ON COLUMN public.item.moved_to_natural_key_hash IS
  'The natural key hash the source now lists this item under, when the move changed the key itself (a file moved or renamed, correlated by content hash). NULL = not a relocation. Set alongside moved_to_collection; required by applyRelocation. ADR-0030.';
