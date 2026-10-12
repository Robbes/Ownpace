-- A YEAR PAID AHEAD (workplan 0111 T11; ADR-0014, Amendment 2026-10-04; terms
-- §8; the owner, 2026-10-12: a year starts with the first month not yet
-- invoiced; credit that runs out within the year makes that month's rest half
-- price, then monthly; a year for the tier the month bills or a higher one;
-- one email a month before the credit runs out).
--
-- A year is credit, paid ahead at six months' price and billed at its start:
-- one invoice like any other (`invoice`, its reference `ownpace-{org}-y-{n}`,
-- pushed to the books as every draft is). Each month of its twelve then takes
-- its own tier at half its monthly price, and what is left after them pays the
-- months that follow at the full monthly price, until it runs out. A month the
-- credit pays makes no invoice: free means no invoice, and so does paid ahead.
-- What it took is written here, one row per step of the month, as an invoice
-- would have been: the credit left is what the years gave less what was drawn.
--
-- ## A draw is a row, one per step
--
-- The month task (month-invoice.ts) decides a month's step as it always did,
-- at half price when the month is one of a year's and credit is left, and
-- draws what the credit covers. A draw names the step as its invoice's
-- reference would (the month and the tier), so a second run finds it and draws
-- nothing twice; what the credit does not cover is invoiced, under the step's
-- usual reference, in the same transaction. Append-only: credit taken is
-- money spent, and an edited draw would change what a customer paid.
--
-- ## Who reads and writes it
--
-- The month task and the Billing page, in the organisation's own scope
-- (`app_user`). The retention task reads which months were drawn, as it reads
-- which were invoiced, so a month paid from credit is a month billed. The purge
-- of a closed organisation deletes the rows by `tenant_id` (`PURGED_TABLES`).

CREATE TABLE IF NOT EXISTS public.credit_draw (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- The month drawn for: its first day, UTC (managed 0015's months).
    month date NOT NULL,
    -- The tier the step bills, as the month's invoice reference names it. Free
    -- draws nothing: free means no bill, not one paid from credit.
    tier_id text NOT NULL,
    -- What it took from the credit, in cents, VAT included, as published.
    cents integer NOT NULL,
    -- `half`: a month of a year, at half its tier's monthly price; `full`: a
    -- month after the year's twelve, or one the credit ran out before.
    rate text NOT NULL,
    -- What the draw was decided from: the price, the step, the credit before.
    evidence jsonb NOT NULL,
    drawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_draw_tier_check CHECK (tier_id IN ('small', 'medium', 'large', 'xl')),
    CONSTRAINT credit_draw_cents_check CHECK (cents > 0),
    CONSTRAINT credit_draw_rate_check CHECK (rate IN ('half', 'full')),
    CONSTRAINT credit_draw_month_check CHECK (EXTRACT(DAY FROM month) = 1),
    -- One draw per step, as one invoice per step (managed 0046).
    CONSTRAINT credit_draw_step_key UNIQUE (tenant_id, month, tier_id)
);

ALTER TABLE public.credit_draw ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.credit_draw FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows.
DROP POLICY IF EXISTS tenant_isolation_select ON public.credit_draw;
CREATE POLICY tenant_isolation_select ON public.credit_draw FOR SELECT
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.credit_draw;
CREATE POLICY tenant_isolation_insert ON public.credit_draw FOR INSERT
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The month task appends and reads; the Billing page reads. The baseline
-- grants UPDATE and DELETE by default, so they are taken back, as 0044 takes
-- them back from a pick.
GRANT SELECT, INSERT ON TABLE public.credit_draw TO app_user;
REVOKE UPDATE, DELETE ON TABLE public.credit_draw FROM app_user;

-- The retention task: which months were drawn. The purge: the rows, by the
-- column it picks them with. Never the amounts.
GRANT SELECT (tenant_id, month), DELETE ON TABLE public.credit_draw TO ownpace_system;

COMMENT ON TABLE public.credit_draw IS
  'What a month took from the credit of a year paid ahead (workplan 0111 T11, ADR-0014 2026-10-04): one row per step of the month, at half the monthly price within a year''s twelve months, at the full price after them. The credit left is what the year invoices gave less what was drawn. Append-only.';
