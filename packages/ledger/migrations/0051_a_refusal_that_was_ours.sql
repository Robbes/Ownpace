-- A NINTH CATEGORY: the refusal this migration made itself (owner's choice,
-- 2026-09-18, workplan 0125 T4).
--
-- ## Nothing changes in the schema, and that is the point — again
--
-- Migration 0033 added `last_error_category` as plain `text` with no CHECK,
-- and said why: *"the six are product vocabulary, expected to be revisited
-- against real incidents (`unknown` staying large is the signal), and a
-- database enum makes each revision a migration with a lock. The application
-- owns the vocabulary."*
--
-- 0048 was the first revision and needed no lock: *"two values added to a
-- TypeScript array and a COMMENT that stops being wrong."* This is the second
-- and takes the same shape. A migration exists only because both comments
-- enumerate the values, so two columns now describe themselves incorrectly —
-- which matters for columns whose readers are operators looking at a database
-- they may not have the source for.
--
-- ## What went wrong, in one line
--
-- Thirty of the owner's files sat `failed` on a live Google migration and all
-- thirty read `unknown`, whose remedy is *"send it to us and we will look"*.
-- They were not one thing: nine are Google types Drive will not export in any
-- format, and twenty-one were refused by this migration's own
-- `nativeFilePolicy`. Accept leaving it behind, and change a setting. Opposite
-- remedies — and the Failures page, which groups by kind x category and offers
-- one press per group, had them under one button.
--
-- ## Why the fix is not more pattern-matching
--
-- `classifyFailure` is a regex over message text, and its module's defence of
-- that is sound for OTHER PEOPLE'S errors: the signals matched are protocol
-- vocabulary somebody specified, and the worst case is `unknown`.
--
-- None of it covers an error this codebase built itself. `NativeFileRefused`
-- branches on exactly why the file is not going — the policy, a type Drive
-- cannot render, a measured-unstable export — and then throws prose for the
-- classifier to guess at. Guessing at your own output is not classification.
--
-- So the category is STATED by the thrower and preferred over a matched one,
-- which is 0048's move one field along: it carried `failed_side` from the
-- closure that threw rather than matching harder, because *"a source refusal
-- and a target one read IDENTICALLY"*. The same sentence applies here with
-- more force: the two halves of those thirty files read identically because
-- WE wrote both.
--
-- `policy_refused` is claimed only when another export policy is measured
-- stable for the type in hand. A group whose remedy is *change the export
-- policy* must not hold an item no policy can carry, or it reproduces the
-- one-button-two-remedies defect at a smaller size; those stay
-- `source_refused`, where the remedy is to accept leaving them behind.
--
-- ## Rows written before today
--
-- Keep the category they were given, and are not rewritten. That is 0048's
-- rule and right for the same reason: the category is now derived partly from
-- something the ERROR OBJECT carried, and that object is long gone. A backfill
-- could only re-read the prose, which is the exact mistake this migration
-- exists to undo. The owner's thirty stay `unknown` until they are next
-- attempted, and reclassify then.
--
-- ## Access
--
-- Unchanged, and deliberately not restated: `migration_status` and `item` both
-- carry RLS, FORCE and their tenant policies, a column inherits them, and this
-- migration alters no column at all.

COMMENT ON COLUMN public.migration_status.last_error_category IS
  'What KIND of failure last_error was, in nine values (workplan 0110 T3, '
  'extended 2026-09-17 and 2026-09-18): auth_expired, rate_limited, '
  'quota_exceeded, policy_refused, source_refused, target_refused, '
  'format_refused, network, unknown. Beside the prose, never instead of it — '
  'last_error stays verbatim. NULL means no failure has been recorded; '
  '''unknown'' means one was recorded and could not be classified, which is a '
  'different thing. The two provider refusals are told apart by failed_side, '
  'which the pass records at the closure that threw, NOT by the wording: a '
  'source refusal and a target one read identically. A refusal with '
  'failed_side NULL reads target_refused, which is the historical answer and '
  'the likely one. ''policy_refused'' is never matched from wording at all: it '
  'is stated by this product''s own code when THIS MIGRATION declined an item '
  'the source would have handed over, and it means a setting on the mapping '
  'is what changes the answer. Safe for an operator to read where last_error '
  'is not: it carries no address, no folder name and no subject.';

COMMENT ON COLUMN public.item.last_error_category IS
  'What KIND of failure last_error was, in the same nine values the domain '
  'level uses (workplan 0110 T3, migration 0033, extended by 0048 and 0051): '
  'auth_expired, rate_limited, quota_exceeded, policy_refused, '
  'source_refused, target_refused, format_refused, network, unknown. Beside '
  'the prose, never instead of it — last_error stays verbatim. NULL means no '
  'category was computed, which includes every row written before migration '
  '0049; ''unknown'' means one was computed and the message could not be '
  'classified, which is a different thing. The two provider refusals are told '
  'apart by the side the pass tagged at the closure that threw, NOT by the '
  'wording: a source refusal and a target one read identically. '
  '''policy_refused'' is not matched from wording at all — it is stated by the '
  'code that refused, and marks an item THIS MIGRATION declined under its own '
  'export policy while the source would have handed it over, so a setting is '
  'the remedy and the item becomes eligible again when it changes. Safe for '
  'an operator to read where last_error is not: it carries no path, no '
  'address and no subject.';
