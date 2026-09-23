-- A NAME THE DOCUMENT OUTGREW (workplan 0042 T8 (b), the owner's decision of
-- 2026-09-23: one record per Google document, whatever its export format).
--
-- A Google Doc, Sheet or Slides deck has no file name of its own. The export
-- policy decides the suffix (`Report` when refused, `Report.docx`, `Report.odt`),
-- and a file's name is its natural key. So switching the policy gives every
-- native document a new key. The document itself is found again under its new
-- name; a row that FAILED under the old one, most often a refused Slides deck,
-- was never listed again and stayed on the Failures screen for good.
--
-- `superseded` is how such a row ends. Its name was one this document had
-- under another export policy, and the same document is now recorded under the
-- name the current policy gives it. Like `left_behind` it is terminal, not an
-- open problem and not on the target. Unlike `left_behind` it records no
-- decision, so if the name itself comes back (the policy switched back), the
-- row is tried again like any other. `superseded_by_natural_key_hash` names the
-- row that took over, and `superseded_at` says when.
--
-- Only rows that never reached the target are superseded by this change. A
-- copy that IS on the target under an old name is bytes the owner may want,
-- and the second half of 0042 T8 (b) answers what happens to it.

ALTER TABLE public.item
  DROP CONSTRAINT IF EXISTS item_status_check;
ALTER TABLE public.item
  ADD CONSTRAINT item_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'copied'::text, 'updated'::text, 'adopted'::text, 'skipped'::text, 'failed'::text, 'left_behind'::text, 'deleted_source'::text, 'tombstoned'::text, 'superseded'::text]));

ALTER TABLE public.item ADD COLUMN superseded_by_natural_key_hash text;
ALTER TABLE public.item ADD COLUMN superseded_at timestamp with time zone;
