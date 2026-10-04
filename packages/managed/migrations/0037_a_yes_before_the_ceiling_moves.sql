-- A yes before the ceiling moves (workplan 0109 T6, ADR-0014's amendment of
-- 2026-10-03).
--
-- Every step up is consented and paid for: at the data ceiling the customer
-- chooses between moving up a tier and a one-off top-up, and nothing moves the
-- ceiling without that yes. This table is the yes. ADR-0014's consequence 5
-- named its shape before it existed: "the allowance — a sum of granted bands,
-- so a top-up adds a row and nothing is rewound".
--
-- ## One row per yes, and never an edit
--
-- A row is a decision the customer made, with the price they were shown when
-- they made it: the invoice that charges it is built later (0109 T5, 0111),
-- and it must charge what was agreed, not what the list says by then. So the
-- row is INSERTed and never touched again:
--
--   GRANT SELECT,INSERT — and REVOKE UPDATE and DELETE, the same doubled
--   narrowing `vat_consultation` and `erasure_record` carry and for the same
--   reason: the baseline's ALTER DEFAULT PRIVILEGES hands every new table all
--   four verbs, so a narrower GRANT alone would change nothing.
--
-- The meter (`bytes_moved`) is never touched by a yes either: a top-up raises
-- the ceiling, it never rewinds the count (ADR-0014, "a higher ceiling, never
-- a rewound meter"), so a past month stays reconstructible.
--
-- ## What a row is
--
-- `kind = 'tier'`: the customer moved up to `tier_id`. The ceiling is the
-- highest tier moved up to, so a later yes to a lower tier changes nothing
-- (the data axis never falls). `kind = 'top_up'`: the customer bought another
-- band of `tier_id`, the tier they were on, which adds `band_gb` to the
-- ceiling for good: a purchase never expires.
--
-- Tiny is no row. It is where every organisation starts, and it is free, so
-- nobody says yes to it; and it has no top-up (its fee is nothing), which the
-- CHECK below makes the database's rule too.
--
-- `price_eur` is what the customer was shown: for a move up, the difference in
-- setup fees (ADR-0014: "stepping up later costs the difference in setup,
-- once"); for a top-up, the price of a band under the list in force. Whole
-- euros, like every price in the published table.
--
-- ## Erasure
--
-- Purged (`PURGED_TABLES`), like the meter and the peak: an agreement with a
-- customer who is gone has nobody to apply to, and a retained invoice carries
-- what it charged on its own document. The system role that runs the purge is
-- granted DELETE below and nothing it could read a decision from.

CREATE TABLE IF NOT EXISTS public.data_allowance (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    kind text NOT NULL,
    tier_id text NOT NULL,
    -- The band this yes adds to the ceiling, in decimal GB (1 TB = 1000 GB,
    -- the published table's unit). For a move up, the tier's own band.
    band_gb integer NOT NULL,
    price_eur integer NOT NULL,
    -- Who said yes: the signed-in member's id, as the audit log names them.
    consented_by text NOT NULL,
    consented_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_allowance_kind_check CHECK (kind IN ('tier', 'top_up')),
    -- Tiny is never a row: nobody moves up to it, and it has no top-up.
    CONSTRAINT data_allowance_tier_check CHECK (tier_id IN ('small', 'medium', 'large', 'xl')),
    CONSTRAINT data_allowance_band_check CHECK (band_gb > 0),
    CONSTRAINT data_allowance_price_check CHECK (price_eur >= 0)
);

CREATE INDEX IF NOT EXISTS data_allowance_tenant_idx ON public.data_allowance (tenant_id, consented_at);

ALTER TABLE public.data_allowance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.data_allowance FORCE ROW LEVEL SECURITY;

-- Read and written by the tenant's own members only. No UPDATE or DELETE
-- policy: app_user holds neither verb (below), and the purge's role bypasses
-- row security by design (managed 0033).
DROP POLICY IF EXISTS tenant_isolation_select ON public.data_allowance;
CREATE POLICY tenant_isolation_select ON public.data_allowance FOR SELECT
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.data_allowance;
CREATE POLICY tenant_isolation_insert ON public.data_allowance FOR INSERT
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

GRANT SELECT,INSERT ON TABLE public.data_allowance TO app_user;
REVOKE UPDATE,DELETE ON TABLE public.data_allowance FROM app_user;

-- The purge of closed organisations runs as `ownpace_system` (managed 0033),
-- which holds nothing until a migration grants it: DELETE, and the one column
-- it picks the rows by.
GRANT SELECT (tenant_id), DELETE ON TABLE public.data_allowance TO ownpace_system;

COMMENT ON TABLE public.data_allowance IS
  'Each yes to a step up at the data ceiling (0109 T6, ADR-0014 2026-10-03): a move up to a tier, or a top-up band. Append-only; the ceiling is the highest tier moved up to plus every band bought. Tiny is no row.';
