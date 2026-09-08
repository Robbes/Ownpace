-- A domain that stopped on purpose says so, and says why.
--
-- ## What was on the screen before this
--
-- Three things stop a pass, and a `migration_status` row could express none of
-- them. It has five states — pending, in_progress, completed, failed, skipped
-- — and a pause is honestly none of those: nothing failed, nothing was
-- skipped, and the domain has NOT finished.
--
-- What shipped instead was `completed`. A mail pass that hit Gmail's daily
-- download ceiling (workplan 0090 T4, live since 2026-08-26) returned its
-- `budgetPause`, the dispatcher ignored it, and the row was marked completed
-- with a "last synced" time beside it — for a mailbox that is half copied and
-- will not move again for hours. The customer's screen said the migration was
-- done. That is hard rule 9 twice over: a stop reported as a finish, and a
-- reason that existed and was thrown away.
--
-- ## Why a column rather than a sixth state
--
-- `in_progress` is LITERALLY true of a paused domain — it is in progress
-- across passes, its cursors are exactly where the last pass left them, and
-- the next scheduled pass carries on from them. A sixth state would have to be
-- understood by every screen, every report and every query that reads this
-- table, to say something the existing state already says correctly. What was
-- missing was never the state. It was the REASON.
--
-- So: a nullable reason beside the state. NULL means nothing is holding this
-- domain up, which is the answer for every row written before today.
--
-- ## jsonb, and what may be inside it
--
-- The same shape choice `last_pass_metrics` made, and for the same reason: the
-- reasons are a small closed union that will grow by product decision, and a
-- column per field would make each new one a migration. It is read back
-- through `isPauseReason`, never cast — a value written by an older or newer
-- build must not reach a screen that has no sentence for it.
--
-- Metadata only, like every other column a customer-facing screen reads here:
-- a provider's ENDPOINT HOST (imap.gmail.com), a window reset time, and — for
-- an operator hold — the operator's own sentence. No address, no folder name,
-- no subject. The operator views (managed 0009) select an explicit column
-- list and do not select this one, so nothing about them changes.
--
-- ## Cleared by whatever writes the row next
--
-- `markInProgress` clears it: a pass has started, so last pass's reason is not
-- this pass's state. So do completed, failed and skipped — a row carrying both
-- a terminal state and a live pause reason would let a screen render a
-- contradiction, and there is no reading of the data that makes both true.
--
-- ## Access
--
-- `migration_status` already carries RLS, FORCE and its tenant policies. A
-- column inherits them; nothing about access is restated here.

ALTER TABLE public.migration_status
  ADD COLUMN IF NOT EXISTS paused_reason jsonb;

COMMENT ON COLUMN public.migration_status.paused_reason IS
  'Why this domain stopped on purpose, when it did — a scheduled pause, never '
  'a failure (workplan 0090 T4). NULL means nothing is holding it up. Read '
  'back through isPauseReason rather than cast. Metadata only: an endpoint '
  'host, a window reset time, an operator sentence. Cleared by whatever writes '
  'the row next, because no terminal state is also a live pause.';
