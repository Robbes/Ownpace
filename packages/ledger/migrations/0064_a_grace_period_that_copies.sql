-- A GRACE PERIOD THAT COPIES (workplan 0128 T2, the owner's decision of
-- 2026-09-24: "D1 a": keep copying through the grace period, "bounded by the
-- grace period, and slotless").
--
-- From the cutover's execute until its grace period ends, the migration keeps
-- being copied, under the after-cutover rules: what is new or changed at the
-- source is copied, and no deletion there is mirrored. That is what the grace
-- period promises ("both systems active"), and it is the window in which mail
-- still reaches the old server while the MX record propagates.
--
-- Only for a migration that was copying when execute ran. Execute moves a
-- paused migration to `cutover` too (ADR-0048), and one the operator had
-- stopped must not start copying again because a cutover happened. The status
-- it had is gone once it is `cutover`, so execute records the answer here, in
-- the transaction that moves the ledger to CUTOVER_IN_PROGRESS: true when the
-- migration was `active`, false for any other. The default is false, so every
-- cutover executed before this migration copies nothing, as it did.
--
-- `CUTOVER_STILL_COPIES_WHERE` (`@openmig/ledger`) reads it, with the state
-- and the grace period's end, for the managed tick and the appliance's gates.

ALTER TABLE public.cutover_state
  ADD COLUMN IF NOT EXISTS copies_through_grace boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cutover_state.copies_through_grace IS
  'Whether this cutover''s migration keeps being copied from execute until its grace period ends (workplan 0128 T2). Set at execute: true when the migration was active then, false otherwise.';
