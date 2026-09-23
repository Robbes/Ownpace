-- A DATA TYPE SWITCHED OFF IS STOPPED, NOT SKIPPED (workplan 0125 T7, the
-- owner's decision of 2026-09-23: *"don't refuse but do the 3 steps"*).
--
-- An appliance's mapping file can switch a data type off after it has copied
-- things (`domains.<kind>.enabled: false`). Nothing is lost: the copies and
-- their ledger rows stay, and switching it back on continues where it stopped.
-- What was wrong is that it was silent. Every pass wrote `skipped`, the word
-- for a data type the migration never had, so a calendar with four hundred
-- copies that no longer follow the source read exactly like one nobody asked
-- for.
--
-- `stopped` is the word for the first: switched off, with copies on the
-- target. `skipped` keeps its meaning, switched off with nothing copied. The
-- status store picks between the two in one statement, from the same items
-- `itemsSynced` counts.
--
-- WIDENING ONLY, the shape of 0036: every existing value stays valid, no row
-- is read or written, and the constraint is dropped and recreated inside this
-- migration's own transaction. The old build never writes the new value, and
-- the new build applies this before its first pass.

ALTER TABLE public.migration_status DROP CONSTRAINT IF EXISTS migration_status_state_check;
ALTER TABLE public.migration_status ADD CONSTRAINT migration_status_state_check CHECK (
  state = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'skipped'::text, 'stopped'::text])
);
