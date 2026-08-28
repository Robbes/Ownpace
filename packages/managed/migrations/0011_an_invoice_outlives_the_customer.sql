-- Copyright 2026 The Ownpace authors (Apache-2.0)
--
-- The invoices an erasure kept, and the operator who could not reach them.
-- (Workplan 0110, following T4. Owner's decision of 2026-08-28.)
--
-- ## The hole this closes
--
-- `purgeTenant` detaches invoices before it deletes anything: it stamps
-- `billed_to_name` from the tenant that is about to stop existing, sets
-- `tenant_id = NULL`, and records the surviving ids in
-- `erasure_record.retained_invoice_ids`. That is the GDPR art. 17(3)(b)
-- carve-out working exactly as intended — Dutch tax retention outlives the
-- customer relationship, so the invoice stays.
--
-- And then nobody could look at it.
--
-- Every route that reads invoices reads `support_tenant_invoices` (0009)
-- filtered `WHERE tenant_id = $1`. A detached invoice has no tenant_id, and
-- the tenant whose page would have carried it has been deleted. So the rows
-- that were deliberately kept for an administrative obligation were, from the
-- product's point of view, gone: retrievable only by someone with a database
-- prompt. Migration 0001 said as much in a comment — *"Operator access to them
-- is out-of-band, through the owner connection"* — which was an accurate
-- description of a gap, not a design.
--
-- ## Keyed on the hash, because that is all there is
--
-- The natural key here is `erasure_record.tenant_ref`: the sha256 of the
-- tenant id, never the id. That is not an inconvenience to work around, it is
-- the point — `erasure_record` holds a hash precisely so the table cannot be
-- read back into a list of former customers. So this view groups by the same
-- hash, and what it can say about WHO an invoice was for is `billed_to_name`,
-- captured at issue time, and nothing else.
--
-- An operator therefore cannot go from this view to a person. They can answer
-- "here are the invoices we are obliged to keep, and what each one says about
-- itself", which is the administrative question, and cannot answer "who used
-- to be a customer", which is the question the erasure was supposed to close.
--
-- ## Why nothing needs an `IS NULL` filter
--
-- `retained_invoice_ids` is written only by `purgeTenant`, at purge time,
-- after the detach. A tenant that is closed but not yet purged has an
-- `erasure_record` with an EMPTY array, so the lateral yields no rows and its
-- invoices stay where they belong — on the live tenant's own page, because
-- that tenant still exists. The two surfaces cannot double-count, and that
-- falls out of when the array is written rather than out of a predicate
-- somebody has to remember.

CREATE OR REPLACE VIEW public.support_retained_invoices AS
  SELECT
    e.tenant_ref,
    e.requested_at AS erasure_requested_at,
    e.purged_at,
    i.id            AS invoice_id,
    i.billed_to_name,
    i.period_start,
    i.period_end,
    i.status,
    i.total,
    i.currency,
    i.paid_at
  FROM public.erasure_record e
  CROSS JOIN LATERAL unnest(e.retained_invoice_ids) AS r(invoice_id)
  JOIN public.invoice i ON i.id = r.invoice_id
  -- The same predicate every support view carries. Authorisation is the
  -- database's, in one place; a non-operator gets zero rows rather than a 403,
  -- and no route re-checks this and then trusts its own answer.
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

-- The grant every view in 0009 carries, and the reason it is not optional:
-- `withSubject` runs as `app_user`, so without this the route fails with
-- "permission denied for view" in any real deployment. PGlite tolerated its
-- absence while this was being written, which is exactly the kind of gap that
-- reaches production green.
GRANT SELECT ON public.support_retained_invoices TO app_user;

COMMENT ON VIEW public.support_retained_invoices IS
  'Invoices that survived an erasure, reachable by the tenant_ref hash rather '
  'than by a tenant that no longer exists (workplan 0110). Kept for tax '
  'retention; carries billed_to_name and never a route back to a person.';

-- ---------------------------------------------------------------------------
-- A fourth screen, which the CHECK was written to make somebody think about.
--
-- 0009 constrained `support_read.view_name` to three values and said why in as
-- many words: *"a fourth is a design change, not a copy edit"*. This is that
-- design change, made deliberately and with the owner's decision behind it, so
-- the constraint is widened rather than worked around — and it stays a closed
-- vocabulary, so the log can still be counted rather than grepped.
--
-- The read is recorded with a NULL `tenant_id`, like the tenant LIST and for
-- the same reason: there is no tenant to name. There is not even one to point
-- at — this is a read ABOUT customers who have been erased, and writing a hash
-- into a column typed `uuid` to make it look otherwise would be a lie the
-- schema would then have to keep.

ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_view_name_check;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_view_name_check
  CHECK (view_name = ANY (ARRAY[
    'tenants'::text,
    'tenant'::text,
    'migration'::text,
    'retained_invoices'::text
  ]));
