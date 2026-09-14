-- "5 tries" on something we tried once (owner report, 2026-09-14).
--
-- A Google Doc under `nativeFilePolicy="refuse"` showed `5 tries` on the
-- Failures page. It was attempted ONCE. Two rows beside it showed `6 tries`,
-- which is above `MAX_ITEM_ATTEMPTS` and therefore not a count of anything.
--
-- `attempt_count` was doing two jobs. It counted attempts, and it ALSO carried
-- "this is parked, stop retrying it" — because parking was implemented by
-- writing the ceiling into the counter:
--
--   insert   attempt_count = MAX_ITEM_ATTEMPTS          (park on first sight)
--   update   attempt_count = GREATEST(count + 1, MAX)   (park again later)
--
-- and `needs_decision` was then derived as `attempt_count >= MAX`. The
-- mechanism worked. What it could not do is tell the truth: the screen prints
-- `attempt_count` verbatim, so a policy refusal — a decision-class failure the
-- loop deliberately parks on FIRST sight rather than retrying five times —
-- arrived in front of the owner as five attempts against their Google account
-- that never happened. And a second park on an already-parked row walked the
-- number past the ceiling, where it means neither attempts nor parked-ness.
--
-- The two facts separate here. `attempt_count` counts attempts and nothing
-- else. `parked_at` says a person must decide, and when that became true.
--
-- ## Why a timestamp and not a boolean
--
-- "Since when" is the question an operator actually asks of a parked item, and
-- a boolean cannot answer it. `updated_at` cannot either — it moves on every
-- later write. The column is also its own audit trail for free: a row parked,
-- retried, and parked again shows the SECOND park time, which is the one that
-- matters.
--
-- ## Backfill: every row already at or above the ceiling is parked
--
-- That is exactly what the old encoding meant, so reading it forward loses
-- nothing. It DOES fold two populations together — an item genuinely retried
-- five times, and one parked on sight — and there is no way to separate them
-- after the fact, because the distinction was never recorded. New rows record
-- it. Old rows keep the count they have, which for the parked-on-sight ones
-- remains an overstatement of what we did, and the screen now says "parked"
-- rather than repeating the number as a count.
--
-- `attempt_count` is NOT rewritten by this migration. Lowering a stored number
-- because we now think it was wrong would be inventing history; leaving it is
-- the honest half, and the read side stops presenting it as a try count.

ALTER TABLE public.item
  ADD COLUMN IF NOT EXISTS parked_at timestamptz;

COMMENT ON COLUMN public.item.parked_at IS
  'When this item stopped being retried automatically and started waiting on a person. NULL = still in the automatic lane. Set by recordFailure({park:true}) for a decision-class failure (isDecisionError — a policy that answers the same way every pass), and cleared by an operator Retry alongside attempt_count = 0. Separated from attempt_count on 2026-09-14: parking used to be encoded as "write the ceiling into the counter", so a one-shot policy refusal displayed as five attempts and a second park walked it past the ceiling.';

-- Backfill: the old encoding's meaning, read forward.
UPDATE public.item
  SET parked_at = coalesce(updated_at, now())
  WHERE status = 'failed' AND attempt_count >= 5 AND parked_at IS NULL;

-- The failures queue lists one mapping's parked items first.
CREATE INDEX IF NOT EXISTS ix_item_mapping_parked
  ON public.item (mapping_id, parked_at)
  WHERE parked_at IS NOT NULL;
