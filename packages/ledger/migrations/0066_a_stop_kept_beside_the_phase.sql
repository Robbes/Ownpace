-- A DATA TYPE ITS OWNER STOPPED (workplan 0128 T4, T5 slice 3a; the owner's
-- decisions of 2026-09-24, D2 (c), D4, D5 and D6).
--
-- On a running migration each data type can be stopped and resumed: its
-- copies stay, its record stays, it no longer follows the source, and resuming
-- continues where it stopped. Mail can be stopped on the day the old mailbox
-- closes while contacts keep flowing.
--
-- A stop is not a phase. A stopped data type keeps its phase (`active`, or
-- `continuous` in the lane), and a cutover or a rollback moves its phase as
-- they move every other; the stop stays until its owner resumes it. So it is
-- kept beside the phase, in its own column, and not in `migration_status`,
-- which is pass state that every pass rewrites (D6). Both editions keep it
-- here, the appliance in its own database rather than in its configuration
-- file (D4).
--
-- NULL is running. The time is when the owner stopped it. Nothing writes it in
-- this migration: the readers learn it first (slice 3a), the doors come after
-- (slice 3b). Every gate reads it through `readPathPhases` (ledger), and the
-- slot rule through `holdsASlot` (ledger): a stopped data type keeps its slot
-- while the migration is before its cutover, and releases it in the lane
-- (D2 (c)).

ALTER TABLE public.path_lifecycle
  ADD COLUMN IF NOT EXISTS stopped_at timestamp with time zone;

COMMENT ON COLUMN public.path_lifecycle.stopped_at IS
  'When this data type''s owner stopped it (workplan 0128 T4), or NULL while it runs. A stop is kept beside the phase, not in it: a stopped data type runs no pass, keeps its copies, and keeps its slot except in the continuous lane (D2 (c)).';
