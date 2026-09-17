-- A refusal says WHICH SIDE refused (the owner's go-ahead, 2026-09-17).
--
-- ## Nothing changes in the schema, and that is the point
--
-- Migration 0033 added `last_error_category` as plain `text` with no CHECK,
-- and said why: *"the six are product vocabulary, expected to be revisited
-- against real incidents (`unknown` staying large is the signal), and a
-- database enum makes each revision a migration with a lock. The application
-- owns the vocabulary."*
--
-- This is the first revision, and it needed no lock. The whole of it is two
-- values added to a TypeScript array and a COMMENT that stops being wrong.
-- A migration exists only because the comment enumerated the six, so the
-- column now describes itself incorrectly — which matters for a column whose
-- readers are operators looking at a database they may not have the source
-- for.
--
-- ## What went wrong, in one line
--
-- Drive answered `cannotExportFile` on a Google Doc whose owner had turned off
-- downloading. The classifier saw a 403 and the word "refused" and said
-- `target_refused`, whose remedy is "a full mailbox, a read-only folder or
-- missing permission on the target account" — so a customer was told to go and
-- audit a destination that had never been sent the file. A wrong remedy is
-- worse than `unknown`, which at least says it does not know.
--
-- ## Why the fix is not more pattern-matching
--
-- A source refusal and a target one read IDENTICALLY: a 403 is a 403. No
-- wording tells them apart, so matching harder could not have found this.
--
-- `failed_side` (migration 0040) already recorded the answer. The pass tags
-- whatever the SOURCE closure throws and whatever the TARGET closure throws,
-- at the closure, and writes that tag in the same statement as the category.
-- So the two columns are derived from one call and cannot disagree — the
-- category is now `classifyFailure(error, side)` where it was
-- `classifyFailure(error)`, and nothing else moved.
--
-- Rows written before today keep the category they were given. They are not
-- rewritten: an old row's `failed_side` may be NULL because the pass could not
-- tell, and re-reading those as source refusals would be a claim about a
-- failure nobody observed the side of. An unsided refusal still answers
-- `target_refused`, which is both the historical answer and the likely one.
--
-- ## The third value
--
-- `format_refused` is the owner's own addition on the same day: *"it also
-- makes sense a target might refuse certain fileformats/types and we need to
-- be transparrant about that."* A destination that will not store a `.svg` is
-- not a destination that is full, and "free up space" is the same wrong
-- remedy one step along. It matters for Google exports in particular, which
-- arrive as `.docx`, `.svg` and `.pdf` — files the source never had.
--
-- ## Access
--
-- Unchanged, and deliberately not restated: `migration_status` carries RLS,
-- FORCE and its tenant policies, a column inherits them, and this migration
-- alters no column at all.

COMMENT ON COLUMN public.migration_status.last_error_category IS
  'What KIND of failure last_error was, in eight values (workplan 0110 T3, '
  'extended 2026-09-17): auth_expired, rate_limited, quota_exceeded, '
  'source_refused, target_refused, format_refused, network, unknown. Beside '
  'the prose, never instead of it — last_error stays verbatim. NULL means no '
  'failure has been recorded; ''unknown'' means one was recorded and could not '
  'be classified, which is a different thing. The two refusals are told apart '
  'by failed_side, which the pass records at the closure that threw, NOT by '
  'the wording: a source refusal and a target one read identically. A refusal '
  'with failed_side NULL reads target_refused, which is the historical answer '
  'and the likely one. Safe for an operator to read where last_error is not: '
  'it carries no address, no folder name and no subject.';
