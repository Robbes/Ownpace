-- A REFUND FOLLOWED TO ITS END (workplan 0111, T7, slice 7d; terms §7:
-- "whatever you paid above it we refund within 14 days, by the means of
-- payment you used").
--
-- 0052 writes a refund down the moment Mollie accepts it, and the push books
-- it on the credit note in the books. Accepted is not paid out: Mollie keeps a
-- refund `queued` until its balance covers it, then `pending` and
-- `processing`, and only `refunded` means the money went back. A refund can
-- also end `failed` (the means of payment no longer takes it) or `canceled`.
-- So each hour the push asks Mollie where each refund is (`refund-follow.ts`),
-- until it ends:
--
--  - `refund_status`: what Mollie said last; null until it is first asked.
--  - `refund_ended_at`: when it was first seen ended, `refunded`, `failed` or
--    `canceled`. Set exactly when the status is one of those, and from then
--    neither moves: the end is written once.
--  - `refund_late_said_at`: when the operator was told the refund had not ended
--    seven days after it was made, half of the fourteen the terms promise.
--    Written once, so it is said once.
--
-- A refund that ended `failed` or `canceled` is said to the operator once, for
-- a transfer by hand, and is not booked in the books if it was not yet. None
-- is a fact of the document: lifecycle columns, granted to app_user column by
-- column (0014), and pinned in invoice-refusal-under-rls.unit.test.ts.

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS refund_status text,
    ADD COLUMN IF NOT EXISTS refund_ended_at timestamptz,
    ADD COLUMN IF NOT EXISTS refund_late_said_at timestamptz;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_refund_followed_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_refund_followed_check CHECK (
        (refund_status IS NULL OR (refund_id IS NOT NULL AND refund_status IN
            ('queued', 'pending', 'processing', 'refunded', 'failed', 'canceled')))
        AND ((refund_ended_at IS NOT NULL) = (refund_status IS NOT NULL AND refund_status IN ('refunded', 'failed', 'canceled')))
        AND (refund_late_said_at IS NULL OR refund_id IS NOT NULL));

-- The end, and the late word, written once.
CREATE OR REPLACE FUNCTION public.invoice_refund_followed_once() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.refund_ended_at IS NOT NULL AND (
       NEW.refund_status IS DISTINCT FROM OLD.refund_status
    OR NEW.refund_ended_at IS DISTINCT FROM OLD.refund_ended_at) THEN
    RAISE EXCEPTION 'invoice %: its refund has ended, and its end is written once (0111 slice 7d)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.refund_late_said_at IS NOT NULL AND NEW.refund_late_said_at IS DISTINCT FROM OLD.refund_late_said_at THEN
    RAISE EXCEPTION 'invoice %: its late refund was said, and that is written once (0111 slice 7d)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_refund_followed_once ON public.invoice;
CREATE TRIGGER invoice_refund_followed_once BEFORE UPDATE ON public.invoice
    FOR EACH ROW EXECUTE FUNCTION public.invoice_refund_followed_once();

GRANT UPDATE (refund_status, refund_ended_at, refund_late_said_at) ON TABLE public.invoice TO app_user;

-- What the push asks Mollie about each hour: a refund that has not ended.
CREATE INDEX IF NOT EXISTS ix_invoice_refund_to_follow
    ON public.invoice (tenant_id)
    WHERE refund_id IS NOT NULL AND refund_ended_at IS NULL;

COMMENT ON COLUMN public.invoice.refund_status IS
  'Mollie''s last word on refund_id: queued, pending, processing, refunded, failed or canceled; null until first asked (0111 slice 7d).';
COMMENT ON COLUMN public.invoice.refund_ended_at IS
  'When the refund was first seen ended (refunded, failed or canceled). Written once.';
COMMENT ON COLUMN public.invoice.refund_late_said_at IS
  'When the operator was told the refund had not ended seven days after it was made. Written once.';
