-- Somewhere to record a confirmation pass (workplan 0117 T2, slice 3).
--
-- Slice 2 built the pass: it re-reads an item on the target and turns what the
-- target did into a `TargetAnswer`. Until now that answer had nowhere to go, so
-- the pass could be run and its findings survived exactly as long as the
-- process did. This is where they land.
--
-- ## The one decision worth arguing with: this stores EVIDENCE, not the CLAIM
--
-- `item.confirmed_answer` holds what the TARGET said — present and matching,
-- present and different, present but uncomparable, absent, or unreachable. It
-- does NOT hold the row state a person eventually reads (`verified`, `yours`,
-- `missing`, `unchecked`, …). That word is derived at read time by `rowFor`
-- (`confirmed-list.ts`), from this answer plus the ledger status, every time.
--
-- Storing the derived word would be faster and it would be wrong, and this
-- plan has already proved why on itself: slice 1 shipped seven row states, and
-- building the pass in slice 2 found an eighth the vocabulary could not say
-- (`unchecked`, for a target that could not be asked). Had slice 1's derived
-- words been written into rows, every timestamp from before that fix would
-- still read `missing` — *we placed it and it is gone* — for what was a
-- network blip. On the one document somebody deletes their originals from.
--
-- Evidence is what we observed and does not go stale. A claim is an
-- interpretation, and interpretations here are still being corrected.
--
-- ## `confirm` is a seventh run kind, not a seventh table
--
-- D7(a) made this *"a job the person starts and we report on"*, and `run` /
-- `run_event` is already that: a row per execution, `trigger = 'manual'` for
-- one a person pressed, a status that always closes (0120), and an event log
-- for what it found. A parallel table would duplicate all of it and diverge.
--
-- **`confirm` is deliberately NOT added to `BILLABLE_RUN_KINDS`**
-- (`usage-metering.ts:186`, which bills `initial_copy` and `incremental` only).
-- The pass re-reads the whole target and that is real compute, so the reflex is
-- to meter it — but `verify` is not metered either, and this is verification.
-- Charging for it would put a price on the moment somebody is deciding whether
-- their data is safe to delete, which is the one moment in this product where a
-- meter running would change the answer a person gives.
--
-- ## What still does not exist after this
--
-- Nothing starts a confirmation run: there is no route and no job. This adds
-- the vocabulary and the place, so the pass's findings and the run that
-- produced them are reviewable BEFORE anything can offer somebody a button
-- whose output they will delete on the strength of.

-- ------------------------------------------------------------ the run kind --
ALTER TABLE public.run
  DROP CONSTRAINT IF EXISTS run_kind_check;
ALTER TABLE public.run
  ADD CONSTRAINT run_kind_check
  CHECK (kind = ANY (ARRAY['initial_copy'::text, 'incremental'::text, 'cutover'::text, 'verify'::text, 'discovery'::text, 'backup'::text, 'confirm'::text]));

COMMENT ON CONSTRAINT run_kind_check ON public.run IS
  'Seven kinds since 2026-09-10. `confirm` is workplan 0117 T2''s confirmation pass — a job the person starts (D7(a)) that re-reads every item on the target. It is NOT in BILLABLE_RUN_KINDS and must not be: `verify` is unmetered for the same reason, and a meter running while somebody decides whether their data is safe to delete would change the answer they give.';

-- --------------------------------------------------- what the target said --
ALTER TABLE public.item
  ADD COLUMN IF NOT EXISTS confirmed_answer text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by_run uuid;

ALTER TABLE public.item
  DROP CONSTRAINT IF EXISTS item_confirmed_answer_check;
ALTER TABLE public.item
  ADD CONSTRAINT item_confirmed_answer_check
  CHECK (confirmed_answer IS NULL OR confirmed_answer = ANY (ARRAY['match'::text, 'differs'::text, 'uncomparable'::text, 'absent'::text, 'unreachable'::text]));

-- ON DELETE SET NULL, not CASCADE: a run row swept away later must not take
-- the finding with it. What the target said outlives the bookkeeping of which
-- execution asked, and an item silently losing its answer would read as never
-- confirmed.
ALTER TABLE public.item
  DROP CONSTRAINT IF EXISTS item_confirmed_by_run_fkey;
ALTER TABLE public.item
  ADD CONSTRAINT item_confirmed_by_run_fkey
  FOREIGN KEY (confirmed_by_run) REFERENCES public.run(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.item.confirmed_answer IS
  'What the TARGET said when a confirmation pass last re-read this item (workplan 0117 T2). NULL = never asked. This is EVIDENCE, not the row state a person reads: `rowFor` in confirmed-list.ts derives `verified` / `yours` / `missing` / `unchecked` from this plus `status`, at read time, every time. Storing the derived word would freeze an interpretation — slice 1 shipped seven row states and slice 2 found an eighth, and rows written under the old vocabulary would still be claiming the wrong thing.';

COMMENT ON COLUMN public.item.confirmed_at IS
  'When the target was asked, not when it answered anything in particular. Paired with `confirmed_answer`: an answer with no timestamp is a bug, and a person deciding whether to delete needs to know how old the evidence is.';

-- The list this feeds is per mapping, filtered by what the target said.
CREATE INDEX IF NOT EXISTS ix_item_mapping_confirmed
  ON public.item (mapping_id, confirmed_answer);
