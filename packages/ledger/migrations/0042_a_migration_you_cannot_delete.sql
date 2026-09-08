-- Two of eighteen references never said what happens when a mapping goes.
--
-- ## What the customer saw
--
-- Delete on a migration answered a 500: "Something went wrong deleting this
-- migration — this is a fault on our side, not something your input caused.
-- Reference 81f9ee6d." There is no way past it from the screen, and there is
-- no second door: a migration that has ever been verified could not be
-- deleted at all.
--
-- Under it, on the real database:
--
--   ERROR:  update or delete on table "mailbox_mapping" violates foreign key
--           constraint "verification_run_mapping_id_fkey" on table
--           "verification_run"
--
-- ## Why only these two
--
-- Eighteen foreign keys reference `mailbox_mapping`. Sixteen cascade, one
-- (`run`) sets null because a run is metered and outlives the mapping it
-- measured. These two named no action at all, and Postgres reads an omitted
-- action as NO ACTION — restrict. Nobody chose that; it is the default you
-- get by not writing anything, which is exactly why the guard added with this
-- migration refuses a reference that leaves the question unanswered.
--
-- ## verification_run
--
-- Its sibling `verification` — the per-domain results of the same activity —
-- has cascaded since it was created. A verification run of a mapping that no
-- longer exists is not a record of anything, and no query can reach it: every
-- read is keyed by mapping. It joins the sixteen.
--
-- ## apply_receipt, which took longer to answer
--
-- This one records a DESTRUCTIVE action — an item removed from the target,
-- or the old copy of a relocated one. Cascading it is deleting the record
-- that we deleted somebody's mail, so it is worth being slow about.
--
-- It cascades, for three reasons and one repair:
--
--  1. The table is the managed poller's outcome row plus per-item idempotency
--     (0017 T4), and every read of it in the codebase is keyed by
--     `mapping_id`. Keeping the row with a null mapping would leave something
--     nothing can find — dead weight, not a record.
--  2. `mapping_id` is NOT NULL, so keeping receipts would mean making the
--     column nullable, and the idempotency lookup would then miss them.
--  3. The table designed to outlive its subject is `audit_log`: no foreign
--     key to anything but the tenant, an `entity_id` that is a bare uuid, and
--     retention deliberately does not prune it.
--
-- The repair is the reason this is defensible at all. The automatic path
-- (`autoApplyRelocations`, workplan 0048) already writes an `audit_log` row
-- for every removal it makes. The path a HUMAN presses wrote only the
-- receipt — so the machine's destructive actions were better recorded than a
-- named operator's. That gap is closed in the same change: both apply routes
-- now write the audit row at the moment a person orders the removal. The
-- durable attribution survives this cascade; only the poller's operational
-- row goes with the mapping.
--
-- ## What this does not change
--
-- Nothing about access: both tables already carry RLS, FORCE and their tenant
-- policies, and a constraint is not a policy. No data moves. Rows that exist
-- today are untouched; the migration only restates what happens to them when
-- their mapping is deleted.

ALTER TABLE public.verification_run
  DROP CONSTRAINT IF EXISTS verification_run_mapping_id_fkey;

ALTER TABLE public.verification_run
  ADD CONSTRAINT verification_run_mapping_id_fkey
  FOREIGN KEY (mapping_id) REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE;

ALTER TABLE public.apply_receipt
  DROP CONSTRAINT IF EXISTS apply_receipt_mapping_id_fkey;

ALTER TABLE public.apply_receipt
  ADD CONSTRAINT apply_receipt_mapping_id_fkey
  FOREIGN KEY (mapping_id) REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT verification_run_mapping_id_fkey ON public.verification_run IS
  'Cascades, like the sibling verification table: a verification run of a '
  'mapping that no longer exists is not a record of anything, and every read '
  'of this table is keyed by mapping.';

COMMENT ON CONSTRAINT apply_receipt_mapping_id_fkey ON public.apply_receipt IS
  'Cascades. The receipt is the poller''s outcome row and per-item '
  'idempotency, both mapping-scoped; the durable record that a destructive '
  'action was ordered lives in audit_log, which has no foreign key to a '
  'mapping and is not pruned.';
