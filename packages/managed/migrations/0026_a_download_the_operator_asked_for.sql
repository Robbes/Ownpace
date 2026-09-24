-- A DOWNLOAD THE OPERATOR ASKED FOR (workplan 0129 T4, the managed half; the
-- owner, 2026-09-24: "an operator-only route using your own session").
--
-- `GET /api/support/audit-export` serves an operator the audit export's lines,
-- read back from the audit log after a cursor, oldest first: the lines this
-- deployment's API already prints as each event commits, for a log store to
-- backfill what it missed (0129 D4).
--
-- ## A view, like every other operator read
--
-- An operator belongs to no organisation. Reading each one's audit log under
-- its own policy would take a caller setting `app.current_tenant` for
-- customers it does not belong to, which `withSubjectAndTenant` says not to do:
-- an operator's read of an existing tenant gets a rule in the database that
-- says so. This view is that rule. The `platform_operator` predicate is written
-- out in full, as in every support view (`support-views.unit.test.ts` fails on
-- any `support_%` view without it), so a non-operator reads no row, and an
-- operator reads every customer's in one query, in the order the cursor
-- continues in.
--
-- ## The one support view that selects `detail`
--
-- The log page may not show `audit_log.detail` (0025, the owner's D3), and
-- this view does not change that: the page reads `support_log`. The export's
-- line is made from the whole row and decides field by field what leaves
-- (`auditExportLine` in shared: an id kept, a name or an address as its
-- pseudonym, a field nobody classified left out), which is what the owner
-- decided the export carries (D4). So the row is selected whole here, and it
-- leaves only as that line: `every-audit-field-is-classified.unit.test.ts`
-- fails on any other reader of this view. The actor is the row's own, not the
-- member's address the log page shows: the line keeps an identifier and
-- pseudonymises an address, as the process's own line does.
--
-- ## Recorded, like every support read
--
-- A page downloaded is a read of every customer, so it is recorded like every
-- other support read. `audit_export` joins the closed vocabulary, and like
-- `people` and `log` it records what was asked (where the page started, and
-- its size) and how much came back (the lines served), so a backfill and a
-- survey of the whole log can be told apart. It names no tenant: it reads them
-- all. The whole list is written out again, as 0011, 0019 and 0025 did: each
-- constraint is dropped and re-added as it grows.

CREATE VIEW public.support_audit_export AS
  SELECT
    a.id,
    a.at,
    a.tenant_id,
    a.actor,
    a.action,
    a.entity,
    a.detail
  FROM public.audit_log a
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_audit_export TO app_user;

-- SELECT and nothing else. A view over one table is one Postgres writes
-- through, with the view owner's rights and past the table's own row security:
-- an INSERT here would put an audit row in any customer's log, and an UPDATE or
-- a DELETE would rewrite or erase theirs. The schema's default privileges
-- (ledger 0001) hand `app_user` all three on any view created here, so the
-- narrowing has to be a REVOKE (0012's lesson).
REVOKE INSERT, UPDATE, DELETE ON public.support_audit_export FROM app_user;

COMMENT ON VIEW public.support_audit_export IS
  'The audit export''s download for the operator (workplan 0129 T4): every customer''s audit rows, whole, because the export''s line is made from the whole row and pseudonymises it field by field (auditExportLine). Read by that download only, and recorded in support_read as audit_export. Guarded by the same platform_operator predicate as every support view.';

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
    'audit_export'::text
  ]));

ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_query_is_a_search;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_query_is_a_search
  CHECK (
    (view_name = ANY (ARRAY['people'::text, 'log'::text, 'audit_export'::text])
      AND query IS NOT NULL AND result_count IS NOT NULL)
    OR
    (view_name <> ALL (ARRAY['people'::text, 'log'::text, 'audit_export'::text])
      AND query IS NULL AND result_count IS NULL)
  );
