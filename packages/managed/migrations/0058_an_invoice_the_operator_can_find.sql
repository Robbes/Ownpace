-- AN INVOICE THE OPERATOR CAN FIND (the UX sweep of 2026-10-17).
--
-- A customer on the phone quotes the number from their Billing page or their
-- PDF, "OP-2026-0012", and the operator's organisation page listed invoices by
-- period, status and total only (0009's `support_tenant_invoices`). The row
-- they meant could not be found by what they said. Money to give back and the
-- invoices an erasure kept already name numbers; this view now does too.
--
-- Two columns, both the books' own words about an invoice and nothing about
-- anyone: `invoice_number`, Moneybird's legal number (NULL until it numbers
-- the invoice, managed 0045), and `kind`, `invoice` or `credit_note`, held to
-- those two by the table's CHECK. The column list is still the boundary
-- (0110 T1): the books' ids, the reference and the evidence stay unselected.
--
-- CREATE OR REPLACE VIEW can only ADD columns, and only at the end, which is
-- what this does. The grant to `app_user` and 0027's REVOKE of INSERT, UPDATE
-- and DELETE survive the replace (`support-views.unit.test.ts` reads both from
-- the catalog).

CREATE OR REPLACE VIEW public.support_tenant_invoices AS
  SELECT
    i.tenant_id,
    i.id            AS invoice_id,
    i.period_start,
    i.period_end,
    i.status,
    i.total,
    i.currency,
    i.paid_at,
    i.invoice_number,
    i.kind
  FROM public.invoice i
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );
