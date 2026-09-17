-- An ITEM's failure gets a category too (the owner's ask, 2026-09-17).
--
-- ## The gap, stated exactly
--
-- Migration 0033 gave `migration_status.last_error_category` to the DOMAIN
-- level, and 0048 extended it to eight values. The ITEM level never got one.
--
-- So a migration where one whole domain fails says *"this is an expired
-- credential, reconnect the account"*, in the customer's language, on the
-- screen where they can act — and a migration where nine hundred items
-- succeed and three fail says whatever the provider said, in English, in
-- provider prose, with no remedy attached at all. The three that need a person
-- are exactly the ones with the least help.
--
-- That asymmetry is backwards. A domain-level failure is rare and usually
-- obvious (the whole thing stopped). An item-level one is the common case, it
-- is what the failures queue is FOR, and it is what a customer is looking at
-- when they ask what to do.
--
-- ## Why now, and what it retires
--
-- The Drive work of 2026-09-17 made it visible: a Google Doc whose owner
-- disabled downloading is refused per item, and the refusal had to carry the
-- sentence *"Nothing was sent to the destination for this item."* in its own
-- prose — a workaround for the fact that the row could not say
-- `source_refused` and the screen had nothing to render if it could. The
-- category makes that sentence a column instead of a string, and the remedy
-- the customer reads comes from the same eight-way vocabulary every other
-- surface uses, in both languages.
--
-- ## The same two rules as the domain level, deliberately
--
-- 1. **Beside the prose, never instead of it.** `last_error` stays verbatim:
--    an operator diagnosing a 507 needs the provider's own words, and a
--    category is a summary that cannot replace them.
-- 2. **The side decides between the two refusals**, and it is recorded
--    structurally rather than matched for. A source refusal and a target one
--    read identically — a 403 is a 403 — so the pass tags what the SOURCE
--    closure throws and what the TARGET closure throws, at the closure, and
--    the category is derived from that tag in the same statement that writes
--    the prose. The two cannot disagree.
--
-- The item level has no `failed_side` column of its own and does not gain one
-- here. The side is an input to the classification, not an output worth
-- storing twice: `source_refused` and `target_refused` ARE the side, said in
-- the vocabulary the screen speaks. A column repeating it would be a second
-- copy that can drift from the first.
--
-- ## Rows written before today
--
-- Keep NULL, and are not backfilled. The category is derived from the message
-- AND the side, and the side was never recorded for an item — so a backfill
-- could only classify on the prose, which is the exact mistake 0048 exists to
-- undo. NULL reads as "no category was computed", the screen shows the prose
-- alone as it always did, and the next attempt on that item writes a real one.
--
-- `text` with no CHECK, for the reason migration 0033 gave and 0048 proved:
-- the vocabulary is a product decision expected to be revisited, and an enum
-- makes every revision a migration with a lock. The application owns it, and
-- the read side runs every value through `isFailureCategory` so a value from
-- an older or a newer build cannot become a category the screen has no
-- sentence for.
--
-- ## Access
--
-- Unchanged. `item` carries RLS, FORCE and its tenant policies; a column
-- inherits them.

ALTER TABLE public.item
  ADD COLUMN IF NOT EXISTS last_error_category text;

COMMENT ON COLUMN public.item.last_error_category IS
  'What KIND of failure last_error was, in the same eight values the domain '
  'level uses (workplan 0110 T3, migration 0033, extended by 0048): '
  'auth_expired, rate_limited, quota_exceeded, source_refused, '
  'target_refused, format_refused, network, unknown. Beside the prose, never '
  'instead of it — last_error stays verbatim. NULL means no category was '
  'computed, which includes every row written before migration 0049; '
  '''unknown'' means one was computed and the message could not be classified, '
  'which is a different thing. The two refusals are told apart by the side the '
  'pass tagged at the closure that threw, NOT by the wording: a source refusal '
  'and a target one read identically. Safe for an operator to read where '
  'last_error is not: it carries no path, no address and no subject.';
