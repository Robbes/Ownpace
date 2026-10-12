-- A CREDIT RUNNING OUT, SAID ONCE (workplan 0111 T11, slice Y3; the owner,
-- 2026-10-12: "Send an email a month before the credit runs out? Yes, one
-- email").
--
-- A year paid ahead is credit (managed 0056): each month takes what it costs
-- from it, and once it is spent the months are invoiced again, month by month.
-- That is news to whoever pays: the month before the first month the credit
-- does not pay in full, the organisation's owners and admins are told, once,
-- what is left, what that month costs, and that another year can be bought.
--
-- ## A notice said is a row, one per year
--
-- The month task (managed-month-invoices.ts) claims a row before it mails, so
-- the notice is said once however often the task runs: keyed by the latest
-- year bought, whose credit is running out. Another year bought is a new key,
-- so when its credit runs low that is news again; the same year's is not. A
-- withdrawal leaves the rows: the years before it count for nothing, and a
-- year bought after it has a reference of its own.
--
-- ## Who reads and writes it
--
-- The month task, in the organisation's own scope (`app_user`), and the purge
-- of a closed organisation, by `tenant_id` (`PURGED_TABLES` in
-- offboarding.ts). No personal data: a reference, a month and what was said.

CREATE TABLE IF NOT EXISTS public.credit_notice (
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- The latest year bought when the notice was said: its invoice's reference,
    -- `ownpace-{org}-y-{n}` (managed 0056).
    year_reference text NOT NULL,
    -- The first month the credit does not pay in full: its first day, UTC.
    month date NOT NULL,
    -- What was said: the credit left, the tier, what that month costs, at
    -- which rate.
    evidence jsonb NOT NULL,
    noticed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_notice_month_check CHECK (EXTRACT(DAY FROM month) = 1),
    -- Once per year bought.
    CONSTRAINT credit_notice_pkey PRIMARY KEY (tenant_id, year_reference)
);

ALTER TABLE public.credit_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.credit_notice FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows.
DROP POLICY IF EXISTS tenant_isolation_select ON public.credit_notice;
CREATE POLICY tenant_isolation_select ON public.credit_notice FOR SELECT
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.credit_notice;
CREATE POLICY tenant_isolation_insert ON public.credit_notice FOR INSERT
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The month task claims a notice and reads whether it was said. A notice said
-- is not unsaid, so UPDATE and DELETE are taken back, as 0056 takes them back
-- from a draw.
GRANT SELECT, INSERT ON TABLE public.credit_notice TO app_user;
REVOKE UPDATE, DELETE ON TABLE public.credit_notice FROM app_user;

-- The purge deletes an organisation's rows by the column it picks them with.
GRANT SELECT (tenant_id), DELETE ON TABLE public.credit_notice TO ownpace_system;

COMMENT ON TABLE public.credit_notice IS
  'The email that a year''s credit is running out (workplan 0111 T11, slice Y3), once said: one row per year bought, claimed before the mail, the month before the first month the credit does not pay in full. Append-only.';
