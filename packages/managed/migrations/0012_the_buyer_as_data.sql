-- The buyer, as data (workplan 0111 T1).
--
-- Migration 0001's own comment admitted the invoice rows were "amounts and no
-- identity", and `tenant` carries only a name, a status and settings — so until
-- this file, THE BUYER DID NOT EXIST AS DATA anywhere in this product. Every
-- task after T1 in workplan 0111 (VIES, the VAT treatment, the Moneybird push)
-- needs to know who is being billed and where they are; none of it can be
-- right while that is nowhere.
--
-- ## Consumer-shaped first
--
-- The owner's decision of 2026-08-28: the primary market is CONSUMERS —
-- families rationalising themselves onto EU services — with EU businesses the
-- minority. So the row defaults to a natural person (`kind = 'consumer'`), and
-- the business case is the VARIANT: `vat_number` may only be present when
-- `kind = 'business'`, enforced here rather than in the route, because a
-- consumer row carrying a VAT number is a contradiction whichever code path
-- wrote it. The reverse — a business without a VAT number — stays LEGAL: not
-- every EU business is VAT-registered, and reverse charge simply does not
-- apply to one that is not.
--
-- ## What is deliberately NOT here
--
--  - **No VIES consultation.** Whether a VAT number is REAL is workplan 0111
--    T2; this table stores what the customer said, and nothing may treat an
--    unchecked number as a defence.
--  - **No consumer-country evidence.** The place-of-supply evidence rule
--    (282/2011 art. 24b) is T3's subject. `country_code` is the customer's
--    stated billing country, which is one piece of evidence, not the decision.
--  - **No VAT rate.** ADR-0044: no VAT percentage lives in product code or
--    schema; the treatment is selected per invoice from the bookkeeping
--    system's own tax tables (T3).
--
-- ## One row per tenant, and absence is honest
--
-- Keyed on `tenant_id` directly, like `tenant_pricing`: the buyer behind an
-- organisation is one fact, and NO ROW means "not yet provided" — a state the
-- billing page shows as such, and which T4 must refuse to invoice against. A
-- nullable column soup on `tenant` was the alternative, and `tenant` is the
-- one table the appliance certainly has (ADR-0036): the buyer exists only
-- where somebody is being charged, so the row is managed-chain data.
--
-- ## Erasure
--
-- `offboarding.ts` names `billing_party` in PURGED_TABLES: for a consumer this
-- row is a person's name and home address, which is exactly what an erasure
-- erases. What an invoice needs to keep saying about who it billed is captured
-- ONTO the invoice (the detach stamps the buyer's name, this migration's
-- sibling change in `purgeTenant`), and the legal document itself lives in the
-- bookkeeping system (ADR-0044) — the living row has no reason to survive its
-- subject.

CREATE TABLE IF NOT EXISTS public.billing_party (
    tenant_id uuid NOT NULL PRIMARY KEY REFERENCES public.tenant(id) ON DELETE CASCADE,
    kind text DEFAULT 'consumer'::text NOT NULL,
    -- The name invoices are addressed to: a person's full name, or a legal
    -- entity's registered name. NOT the tenant's display name, which is a
    -- label somebody typed for a workspace ("Jansen thuis") and never chose
    -- as the name on a tax document.
    name text NOT NULL,
    address_line1 text NOT NULL,
    address_line2 text,
    postal_code text NOT NULL,
    city text NOT NULL,
    -- ISO 3166-1 alpha-2, uppercase — the shape every downstream consumer
    -- (VIES prefixes, OSS reporting, the bookkeeping API) speaks. The CHECK
    -- pins the shape only; whether the country is a real one the route's
    -- validation and T3's evidence work decide.
    country_code text NOT NULL,
    vat_number text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_party_kind_check
        CHECK ((kind = ANY (ARRAY['consumer'::text, 'business'::text]))),
    CONSTRAINT billing_party_country_code_check
        CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    -- The business case is the variant: a consumer cannot carry a VAT number.
    CONSTRAINT billing_party_vat_number_check
        CHECK ((kind = 'business'::text OR vat_number IS NULL))
);

ALTER TABLE public.billing_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.billing_party FORCE ROW LEVEL SECURITY;

-- The four tenant_isolation policies, exactly as every other tenant table has
-- them (managed 0001's pattern). DROP IF EXISTS first, so this file is the
-- authority on the definition rather than whatever wrote it.
DROP POLICY IF EXISTS tenant_isolation_select ON public.billing_party;
CREATE POLICY tenant_isolation_select ON public.billing_party FOR SELECT
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.billing_party;
CREATE POLICY tenant_isolation_insert ON public.billing_party FOR INSERT
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_update ON public.billing_party;
CREATE POLICY tenant_isolation_update ON public.billing_party FOR UPDATE
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid))
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_delete ON public.billing_party;
CREATE POLICY tenant_isolation_delete ON public.billing_party FOR DELETE
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

-- Spelled out rather than left to the baseline's ALTER DEFAULT PRIVILEGES
-- (managed 0002's doctrine) — and NARROWER than the default: no DELETE. The
-- product offers no path that removes a buyer's details (correcting them is an
-- UPDATE; switching business back to consumer is an UPDATE that nulls the VAT
-- number), and the one legitimate delete — the erasure purge — runs on the
-- owner connection. Because default privileges already granted all four, the
-- narrowing has to be a REVOKE; a narrower GRANT would change nothing
-- (erasure_record learned this first, in as many words).
GRANT SELECT,INSERT,UPDATE ON TABLE public.billing_party TO app_user;
REVOKE DELETE ON TABLE public.billing_party FROM app_user;

COMMENT ON TABLE public.billing_party IS
  'Who invoices are addressed to (workplan 0111 T1). Consumer-shaped first: kind defaults to consumer and vat_number is only legal on a business. One row per tenant; NO ROW = not yet provided, and nothing may be invoiced against it. Purged on erasure — for a consumer this is a person''s name and home address; the invoice keeps its own copy of what it needs (ADR-0044).';

COMMENT ON COLUMN public.billing_party.vat_number IS
  'As stated by the customer, business kind only. NOT validated here: whether it is real is a VIES consultation (workplan 0111 T2), and an unchecked number must never be treated as a defence.';
