-- A COPY DELETED, ITS NUMBER KEPT (workplan 0111 T10; ADR-0044; the owner,
-- 2026-10-03: "delete the copy, keep the numbers").
--
-- 0011 kept every invoice of an erased organisation, detached, because Ownpace
-- was the record and Dutch tax law keeps invoices for years. Since 0111,
-- Moneybird is the record: it numbers each invoice and credit note and keeps
-- them for the retention period, and the `invoice` row is our copy. A copy
-- kept after an erasure is personal data kept for convenience, so the purge
-- now deletes every invoice and credit note the books hold (it has a
-- `moneybird_id`), and every draft, and keeps only their Moneybird numbers, in
-- `erasure_record.invoice_numbers`: a number finds the document in the books
-- without naming a person. An issued invoice the books do not hold (one from
-- before them) is the only record of itself, and is still detached and kept.
--
-- ## Only an erasure deletes an invoice
--
-- The purge runs as the tasks' system role, which so far could not delete an
-- invoice at all (0033). It gets DELETE now, held to one rule by the trigger
-- below: the two roles the service runs as, `app_user` and `ownpace_system`,
-- delete an invoice only while its organisation is being erased (`deleting`,
-- which the purge task sets before it purges) and only one the books hold, or
-- a draft. That
-- closes `app_user`'s DELETE from 0001 too, which nothing used and nothing
-- held to anything. The owner's connection (migrations, an operator at the
-- database) is not held to it, and nor is a cascade, which Postgres runs as
-- the table's owner. Not a SECURITY DEFINER function: the system role may run
-- none (a-system-role-that-is-not-the-owner.integration.test.ts).

ALTER TABLE public.erasure_record
    ADD COLUMN IF NOT EXISTS invoice_numbers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.erasure_record.invoice_numbers IS
  'The Moneybird numbers of the invoices and credit notes the purge deleted (0111 T10): the copies go, the numbers stay, so each can be found in the books. Never a name, an amount or a line.';

CREATE OR REPLACE FUNCTION public.invoice_deleted_only_by_an_erasure() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('app_user', 'ownpace_system') THEN
    RETURN OLD;
  END IF;
  IF (OLD.moneybird_id IS NOT NULL OR OLD.status = 'draft')
     AND EXISTS (SELECT 1 FROM public.tenant t WHERE t.id = OLD.tenant_id AND t.status = 'deleting') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'invoice %: only its organisation''s erasure deletes an invoice, and only a copy the books hold, or a draft (0111 T10)', OLD.id
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS invoice_deleted_only_by_an_erasure ON public.invoice;
CREATE TRIGGER invoice_deleted_only_by_an_erasure BEFORE DELETE ON public.invoice
    FOR EACH ROW EXECUTE FUNCTION public.invoice_deleted_only_by_an_erasure();

-- The purge: which invoices the books hold, their numbers, and the delete.
-- Still never an amount, a payment or a line.
GRANT SELECT (kind, moneybird_id, invoice_number) ON TABLE public.invoice TO ownpace_system;
GRANT DELETE ON TABLE public.invoice TO ownpace_system;
GRANT UPDATE (invoice_numbers) ON TABLE public.erasure_record TO ownpace_system;

-- The operator's answer to "what about my invoices?": these numbers, held in
-- the books. Keyed on the erasure's hash like 0011's view, and read by the same
-- screen (`/support/retained-invoices`), recorded once as `retained_invoices`.
CREATE OR REPLACE VIEW public.support_erased_invoice_numbers AS
  SELECT
    e.tenant_ref,
    e.requested_at AS erasure_requested_at,
    e.purged_at,
    e.invoice_numbers
  FROM public.erasure_record e
  WHERE cardinality(e.invoice_numbers) > 0
    AND EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    );

GRANT SELECT ON public.support_erased_invoice_numbers TO app_user;
REVOKE INSERT, UPDATE, DELETE ON public.support_erased_invoice_numbers FROM app_user;

COMMENT ON VIEW public.support_erased_invoice_numbers IS
  'The Moneybird numbers of the invoices an erasure deleted (0111 T10), per erasure, keyed on its hash. Guarded by the same platform_operator predicate as every support view.';
