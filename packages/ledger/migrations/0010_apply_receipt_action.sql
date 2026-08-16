-- Which destructive action a receipt records (ADR-0030, managed edition).
--
-- `apply_receipt` was built for one action, because one was all the managed
-- edition had: removing the target's copy of an item the source DELETED. The
-- relocation apply (ADR-0030) is the second — removing the target's OLD copy of
-- a file the source moved or renamed, admissible because the same bytes are on
-- the target under the new key — and one item can legitimately be in BOTH
-- queues at once (renamed, then the new name deleted). Without a discriminator,
-- the route's join-don't-stack check would join a queued DELETION when asked
-- about a RELOCATION, and a poller would render one action's outcome as the
-- other's.
--
-- DEFAULT 'deletion' is a statement of fact about every existing row: the only
-- job that has ever landed a receipt is run-apply-deletion.

ALTER TABLE public.apply_receipt
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'deletion';

ALTER TABLE public.apply_receipt
  ADD CONSTRAINT apply_receipt_action_check CHECK (action IN ('deletion', 'relocation'));

COMMENT ON COLUMN public.apply_receipt.action IS
  'Which destructive action this receipt records: removing a deleted item''s copy (deletion, ADR-0024) or a relocated item''s old copy (relocation, ADR-0030). One item can be in both queues at once, so receipts must say which question they answer.';
