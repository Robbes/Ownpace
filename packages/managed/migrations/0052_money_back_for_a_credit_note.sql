-- MONEY BACK FOR A CREDIT NOTE (workplan 0111, T7, slice 7d, its second half;
-- terms §7: "whatever you paid above it we refund within 14 days, by the
-- means of payment you used").
--
-- A credit note takes an amount off the invoice it corrects. Once it is issued
-- in the books, the hourly push makes that amount real, one way, once
-- (`money-back.ts`):
--
--  - `refunded`: the invoice was paid through Mollie, and more was paid than
--    is owed now. The difference goes back through Mollie, as a refund of
--    that payment (`refund_id`, Mollie's `re_…`; `refund_cents`), and then
--    the books are told, as a payment on the credit note (`moneybird_paid_at`,
--    0050's column, which on a credit note is the refund booked).
--  - `settled`: nothing was paid above what is owed, so the credit note is
--    set against the invoice in the books, and nothing moves.
--  - `by_hand`: the invoice was paid, but not through Mollie (a bank transfer
--    the books saw, slice 5f): the money goes back by transfer, by hand, and
--    the operator is told.
--
-- `money_back` and `money_back_at` say which, and when. Written once: a second
-- refund for one credit note is money paid twice, so the database refuses to
-- change any of them once `money_back` is set, and refuses them on anything
-- but a credit note. None is a fact of the document, so none is frozen with it
-- (0045): they are lifecycle columns, granted to app_user column by column
-- (0014), and pinned in invoice-refusal-under-rls.unit.test.ts.

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS money_back text,
    ADD COLUMN IF NOT EXISTS money_back_at timestamptz,
    ADD COLUMN IF NOT EXISTS refund_id text,
    ADD COLUMN IF NOT EXISTS refund_cents bigint;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_money_back_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_money_back_check CHECK (
        (money_back IS NULL AND money_back_at IS NULL AND refund_id IS NULL AND refund_cents IS NULL)
        OR (kind = 'credit_note' AND money_back_at IS NOT NULL AND (
            (money_back = 'refunded' AND refund_id IS NOT NULL AND refund_cents > 0)
            OR (money_back IN ('settled', 'by_hand') AND refund_id IS NULL AND refund_cents IS NULL))));

-- One Mollie refund is one credit note's.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_refund_id ON public.invoice (refund_id) WHERE refund_id IS NOT NULL;

-- Written once.
CREATE OR REPLACE FUNCTION public.invoice_money_back_once() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.money_back IS NOT NULL AND (
       NEW.money_back IS DISTINCT FROM OLD.money_back
    OR NEW.money_back_at IS DISTINCT FROM OLD.money_back_at
    OR NEW.refund_id IS DISTINCT FROM OLD.refund_id
    OR NEW.refund_cents IS DISTINCT FROM OLD.refund_cents) THEN
    RAISE EXCEPTION 'invoice %: its money back is written once (0111 slice 7d)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_money_back_once ON public.invoice;
CREATE TRIGGER invoice_money_back_once BEFORE UPDATE ON public.invoice
    FOR EACH ROW EXECUTE FUNCTION public.invoice_money_back_once();

GRANT UPDATE (money_back, money_back_at, refund_id, refund_cents) ON TABLE public.invoice TO app_user;

-- What the push looks for each hour: an issued credit note whose money has not
-- moved yet, and a refund the books have not been told of.
CREATE INDEX IF NOT EXISTS ix_invoice_money_back_due
    ON public.invoice (tenant_id)
    WHERE kind = 'credit_note' AND status = 'sent' AND money_back IS NULL;
CREATE INDEX IF NOT EXISTS ix_invoice_refund_to_book
    ON public.invoice (tenant_id)
    WHERE money_back = 'refunded' AND moneybird_paid_at IS NULL;

COMMENT ON COLUMN public.invoice.money_back IS
  'On a credit note: how its amount was made real, once (0111 slice 7d): refunded through Mollie, settled against its invoice in the books, or by hand.';
COMMENT ON COLUMN public.invoice.money_back_at IS
  'When money_back was decided and done.';
COMMENT ON COLUMN public.invoice.refund_id IS
  'Mollie''s refund id, re_…, when the credit note''s amount went back through Mollie.';
COMMENT ON COLUMN public.invoice.refund_cents IS
  'What went back through Mollie, in cents.';
