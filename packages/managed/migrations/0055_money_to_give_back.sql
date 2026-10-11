-- MONEY TO GIVE BACK, WHERE THE OPERATOR SEES IT (workplan 0111; the owner,
-- 2026-10-11: "yes, build the support list and the email too").
--
-- The hourly push says three things that ask the operator to act: a credit
-- note to pay back by hand (paid, but not through Mollie; 0052), a refund
-- Mollie ended failed or canceled (0053), and a refund still going a week
-- after it was made (0053). Each was a line on the output of the run that
-- said it, and a task run's container is removed when the run ends, output
-- and all. So the money terms §7 promises back within 14 days could be owed
-- with nobody told. Each is now:
--
-- - **listed** on the support screen, from what the invoice table already
--   records (`support_money_to_give_back`): nothing new is written to know
--   it, so the list cannot miss one the push wrote down;
-- - **marked** by the operator once paid back by transfer
--   (`money_given_back`): who and when, once, never changed;
-- - **mailed** to `NOTIFY_TO` when the push says it (the worker; no schema).
--
-- A late refund needs no mark: it leaves the list when Mollie ends it, as
-- refunded, or comes back on it as failed or canceled.

CREATE TABLE IF NOT EXISTS public.money_given_back (
    -- The credit note. Gone with it: an erasure deletes our copy of a credit
    -- note the books hold (0054), and the mark is about that copy. The books
    -- keep the payment booked on it.
    invoice_id uuid PRIMARY KEY REFERENCES public.invoice (id) ON DELETE CASCADE,
    given_back_at timestamptz NOT NULL DEFAULT now(),
    -- The operator's subject, as `platform_operator.user_id` holds it.
    given_back_by text NOT NULL
);

ALTER TABLE public.money_given_back ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.money_given_back FORCE ROW LEVEL SECURITY;

-- The operator predicate every support view carries, and the hold's (0023).
CREATE POLICY operator_reads_money_given_back ON public.money_given_back
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    ));

-- An operator marks in their own name, and nobody else's.
CREATE POLICY operator_marks_money_given_back ON public.money_given_back
    FOR INSERT
    WITH CHECK (
      given_back_by = current_setting('app.current_user'::text, true)
      AND EXISTS (
        SELECT 1 FROM public.platform_operator
         WHERE user_id = current_setting('app.current_user'::text, true)
      )
    );

GRANT SELECT, INSERT ON TABLE public.money_given_back TO app_user;
-- A mark is never changed or taken back: it is the record that the money went.
REVOKE UPDATE, DELETE ON TABLE public.money_given_back FROM app_user;

COMMENT ON TABLE public.money_given_back IS
  'An operator''s mark that a credit note''s money was paid back by hand (0111; 2026-10-11): who and when, once, never changed. Gone with the credit note''s copy on erasure.';

-- What the operator owes back by hand, or watches. `reason`:
--   by_hand          paid, but not through Mollie: the credit note's amount;
--   refund_failed    Mollie's refund ended failed: the refund's amount;
--   refund_canceled  Mollie's refund ended canceled: the refund's amount;
--   refund_late      a refund still going a week after it was made.
-- `said_at` is when the push wrote it down. `refund_in_the_books` says a
-- failed refund was booked on its credit note, and must come off it.
CREATE OR REPLACE VIEW public.support_money_to_give_back AS
  SELECT
    c.id               AS credit_note_id,
    c.tenant_id,
    t.name             AS organisation,
    c.invoice_number   AS credit_note_number,
    o.invoice_number   AS invoice_number,
    CASE
      WHEN c.money_back = 'by_hand' THEN 'by_hand'
      WHEN c.refund_status IN ('failed', 'canceled') THEN 'refund_' || c.refund_status
      ELSE 'refund_late'
    END                AS reason,
    CASE WHEN c.money_back = 'by_hand' THEN -c.total ELSE c.refund_cents END AS cents,
    c.currency,
    c.refund_id,
    c.refund_status,
    (c.moneybird_paid_at IS NOT NULL) AS refund_in_the_books,
    CASE
      WHEN c.money_back = 'by_hand' THEN c.money_back_at
      WHEN c.refund_status IN ('failed', 'canceled') THEN c.refund_ended_at
      ELSE c.refund_late_said_at
    END                AS said_at,
    g.given_back_at,
    p.email            AS given_back_by
  FROM public.invoice c
  JOIN public.invoice o ON o.id = c.credited_invoice_id
  JOIN public.tenant t ON t.id = c.tenant_id
  LEFT JOIN public.money_given_back g ON g.invoice_id = c.id
  LEFT JOIN public.platform_operator p ON p.user_id = g.given_back_by
  WHERE c.kind = 'credit_note'
    AND (c.money_back = 'by_hand'
         OR c.refund_status IN ('failed', 'canceled')
         OR (c.refund_late_said_at IS NOT NULL AND c.refund_ended_at IS NULL))
    AND EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    );

GRANT SELECT ON public.support_money_to_give_back TO app_user;
-- A view over one table is one Postgres writes through (0026's reason).
REVOKE INSERT, UPDATE, DELETE ON public.support_money_to_give_back FROM app_user;

COMMENT ON VIEW public.support_money_to_give_back IS
  'Credit notes whose money the operator gives back by hand or watches (0111; 2026-10-11): paid but not through Mollie, a refund that failed or was canceled, a refund still going a week on. Guarded by the platform_operator predicate every support view carries.';

-- The read is recorded, as every support screen's is: one more name in the
-- closed vocabulary (0011's reason), not a search.
ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_view_name_check;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_view_name_check
  CHECK (view_name = ANY (ARRAY[
    'tenants'::text,
    'tenant'::text,
    'migration'::text,
    'retained_invoices'::text,
    'people'::text,
    'person'::text,
    'log'::text,
    'audit_export'::text,
    'money_to_give_back'::text
  ]));
