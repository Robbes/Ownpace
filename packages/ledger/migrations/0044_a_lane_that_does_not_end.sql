-- The continuous lane, as a value in both lifecycle vocabularies
-- (workplan 0117 T1; owner decision D6, 2026-09-10).
--
-- ## What this adds, and why it is two constraints rather than one
--
-- `continuous` is a mapping that keeps copying after cutover and deletes
-- nothing — 0117 §4A's phase separation, with the drain half deferred by D1.
-- It has to exist in BOTH closed vocabularies this repository keeps, and the
-- second is the one that is easy to miss:
--
--   * `mailbox_mapping.status` (0001's baseline) — what the routes and the
--     appliance read to decide whether a mapping runs;
--   * `path_lifecycle.state` (migration 0035) — what BILLING reads. ADR-0014
--     charges for paths running at the same time, and `holdsASlot`
--     (`path-lifecycle-store.ts`) is the one rule the tier calculator, the
--     honesty surface and any future invoice agree on.
--
-- Add the value to only the first and the lane runs while the billing ledger
-- believes those paths ended at cutover — an unmetered resource that costs
-- real bytes every pass. Which is exactly the question D6 asked.
--
-- ## D6, taken 2026-09-10: it holds a slot
--
-- The owner's answer: *"a. yes it holds a slot"*. So `holdsASlot` returns true
-- for `continuous`, and a tenant running a belt keeps occupying the tier that
-- belt sits in. The machine really is working for them, month after month, and
-- the alternative was a resource nobody meters.
--
-- ADR-0014 is amended in the same commit, because `PATH_STATES` is documented
-- there as "ADR-0014's five" and this makes it six. A pricing axis built for a
-- job that ends acquires one that does not, and that belongs in the record
-- rather than in a constant.
--
-- **The obligation that comes with it is not the schema's**: somebody who
-- believes the price ends when the migration ends and finds a tier still
-- charging has a fair complaint. They have to be told before they enter the
-- lane. That sentence is T5's, and T1 must not ship a door without it.
--
-- ## Nothing enters this state yet
--
-- Deliberately. This migration widens two vocabularies and moves no rows; the
-- appliance still runs only `active` mappings and no route can set
-- `continuous`. The lane running, and the door to it, are the next two
-- slices — split so that the billing vocabulary and the deletion rule land
-- and are reviewable BEFORE anything can be put into a phase that keeps
-- reading somebody's account after they have left it.

ALTER TABLE public.mailbox_mapping
  DROP CONSTRAINT IF EXISTS mailbox_mapping_status_check;
ALTER TABLE public.mailbox_mapping
  ADD CONSTRAINT mailbox_mapping_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'cutover'::text, 'done'::text, 'continuous'::text]));

ALTER TABLE public.path_lifecycle
  DROP CONSTRAINT IF EXISTS path_lifecycle_state_check;
ALTER TABLE public.path_lifecycle
  ADD CONSTRAINT path_lifecycle_state_check
  CHECK (state = ANY (ARRAY['ready'::text, 'active'::text, 'paused'::text, 'cutover'::text, 'done'::text, 'continuous'::text]));

COMMENT ON CONSTRAINT path_lifecycle_state_check ON public.path_lifecycle IS
  'ADR-0014''s states, six since 2026-09-10. `continuous` is the lane that keeps copying after cutover (0117 T1) and it HOLDS A SLOT (owner decision D6) — the tier is capacity, and a path that never ends never gives its capacity back. `holdsASlot` in path-lifecycle-store.ts is the authority; this list is the database refusing anything outside it.';
