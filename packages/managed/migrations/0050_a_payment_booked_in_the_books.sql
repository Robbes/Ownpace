-- A PAYMENT BOOKED IN THE BOOKS (workplan 0111, slice 5f; the owner,
-- 2026-10-11: "Ownpace follows Mollie").
--
-- When Mollie confirms a payment, its webhook moves the invoice to paid. The
-- books do not know yet: Moneybird would remind a customer who has paid. So
-- the hourly push books the payment on its invoice in Moneybird, on the
-- financial account Mollie pays out from, under Mollie's payment id, and
-- notes when the books hold it.
--
--  - `paid_cents`: what Mollie took, in cents, as its webhook said. Not always
--    the total: a credit note decided before the payment lowers what is asked
--    (slice 7d), and the books are told what was paid, never what was owed.
--    NULL until a payment through Mollie lands.
--  - `moneybird_paid_at`: when Moneybird held the payment, booked by the push
--    or found there already. NULL while the books still have to be told.
--
-- Neither is a fact of the document, so neither is frozen with it (0045):
-- both are lifecycle columns, written once a sent invoice is paid, as
-- `paid_at` is (invoice-refusal-under-rls.unit.test.ts pins the class).

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS paid_cents bigint,
    ADD COLUMN IF NOT EXISTS moneybird_paid_at timestamptz;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_paid_cents_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_paid_cents_check CHECK (paid_cents IS NULL OR paid_cents > 0);

-- app_user updates invoice column by column (0014): the push writes these two
-- under the organisation's own row security, as it writes the lease (0047).
GRANT UPDATE (paid_cents, moneybird_paid_at) ON TABLE public.invoice TO app_user;

-- What the push looks for each hour: paid through Mollie, not yet in the books.
CREATE INDEX IF NOT EXISTS ix_invoice_payment_to_book
    ON public.invoice (tenant_id)
    WHERE status = 'paid' AND paid_cents IS NOT NULL AND moneybird_paid_at IS NULL;

COMMENT ON COLUMN public.invoice.paid_cents IS
  'What Mollie took for this invoice, in cents, from its webhook (0111 slice 5f). NULL until a payment through Mollie lands.';
COMMENT ON COLUMN public.invoice.moneybird_paid_at IS
  'When Moneybird held this invoice''s payment, booked by the push or found there (0111 slice 5f). NULL while the books still have to be told.';
