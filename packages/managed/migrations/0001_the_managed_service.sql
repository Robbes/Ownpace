-- The managed edition's own schema (ADR-0036).
--
-- ## Why this is a second chain and not more files in the first one
--
-- Everything here exists because there is a CUSTOMER on the other side: an
-- invoice, a payment method, the metered rows an invoice is built from, seats,
-- the prices somebody agreed to, the window they chose before we delete them.
-- An appliance has an OWNER, not customers. It would create every one of these
-- tables, never write a row to any of them, and carry a typed handle on each
-- that shared code could name by mistake.
--
-- The two chains have separate bookkeeping (`managed_schema_migrations`) and
-- separate advisory locks. That is not tidiness — see `migrate.ts`: the
-- downgrade guard refuses to start when the highest recorded version exceeds
-- the highest one on disk, and the two chains' versions were never ordered
-- against each other. One ledger has that guard comparing numbers with nothing
-- in common, and which side it breaks depends on how this file was named.
--
-- ## Where this text came from
--
-- Sections 1 and 2 are the objects that left `0001_baseline.sql`, `0025` and
-- `0026`, moved rather than rewritten. Nothing about them changed; they are
-- simply applied by a different chain now. Sections 3 and 4 are new, and each
-- replaces a set of columns that used to sit on `tenant` — a core table the
-- appliance owns, which is why they could not stay.
--
-- Ordering: this chain runs AFTER the shared one, so `public.tenant` exists.


-- ===========================================================================
-- 1. The tables, exactly as they left the shared baseline
-- ===========================================================================
--
-- Name: invoice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    subtotal numeric DEFAULT 0 NOT NULL,
    tax_rate numeric DEFAULT 0 NOT NULL,
    tax_amount numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'EUR'::text NOT NULL,
    payment_method text,
    payment_id text,
    paid_at timestamp with time zone,
    due_date date,
    sent_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'overdue'::text, 'void'::text])))
);

ALTER TABLE ONLY public.invoice FORCE ROW LEVEL SECURITY;


--
-- Name: payment_method; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_method (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    mollie_id text NOT NULL,
    type text NOT NULL,
    brand text,
    last_four text,
    expiry_month integer,
    expiry_year integer,
    is_default boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_method_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])))
);

ALTER TABLE ONLY public.payment_method FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_at timestamp with time zone,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_member_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text]))),
    CONSTRAINT tenant_member_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'suspended'::text, 'removed'::text])))
);

ALTER TABLE ONLY public.tenant_member FORCE ROW LEVEL SECURITY;


--
-- Name: usage_metric; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_metric (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    metric_type text NOT NULL,
    resource text,
    quantity numeric DEFAULT 0 NOT NULL,
    unit text NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    total_cost numeric DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_metric_metric_type_check CHECK ((metric_type = ANY (ARRAY['storage'::text, 'egress'::text, 'compute'::text, 'api_calls'::text])))
);

ALTER TABLE ONLY public.usage_metric FORCE ROW LEVEL SECURITY;


--
-- Name: invoice invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_pkey PRIMARY KEY (id);


--
-- Name: invoice invoice_tenant_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_tenant_id_period_start_key UNIQUE (tenant_id, period_start);


--
-- Name: payment_method payment_method_mollie_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT payment_method_mollie_id_key UNIQUE (mollie_id);


--
-- Name: payment_method payment_method_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT payment_method_pkey PRIMARY KEY (id);


--
-- Name: tenant_member tenant_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_member
    ADD CONSTRAINT tenant_member_pkey PRIMARY KEY (id);


--
-- Name: tenant_member tenant_member_tenant_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_member
    ADD CONSTRAINT tenant_member_tenant_id_user_id_key UNIQUE (tenant_id, user_id);


--
-- Name: usage_metric usage_metric_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_metric
    ADD CONSTRAINT usage_metric_pkey PRIMARY KEY (id);


--
-- Name: usage_metric usage_metric_tenant_id_period_start_metric_type_resource_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_metric
    ADD CONSTRAINT usage_metric_tenant_id_period_start_metric_type_resource_key UNIQUE (tenant_id, period_start, metric_type, resource);


--
-- Name: ix_invoice_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_invoice_status ON public.invoice USING btree (status, period_start);


--
-- Name: ix_invoice_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_invoice_tenant ON public.invoice USING btree (tenant_id, period_start DESC);


--
-- Name: ix_payment_method_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_payment_method_tenant ON public.payment_method USING btree (tenant_id);


--
-- Name: ix_tenant_member_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_member_tenant ON public.tenant_member USING btree (tenant_id);


--
-- Name: ix_tenant_member_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_member_user ON public.tenant_member USING btree (user_id);


--
-- Name: ix_usage_period_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_usage_period_type ON public.usage_metric USING btree (period_start, metric_type);


--
-- Name: ix_usage_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_usage_tenant_period ON public.usage_metric USING btree (tenant_id, period_start DESC);


--
-- Name: invoice invoice_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: payment_method payment_method_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT payment_method_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: tenant_member tenant_member_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_member
    ADD CONSTRAINT tenant_member_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: usage_metric usage_metric_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_metric
    ADD CONSTRAINT usage_metric_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: invoice; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_method; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_method ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice tenant_isolation_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_delete ON public.invoice FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: payment_method tenant_isolation_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_delete ON public.payment_method FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: tenant_member tenant_isolation_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_delete ON public.tenant_member FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: usage_metric tenant_isolation_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_delete ON public.usage_metric FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: invoice tenant_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_insert ON public.invoice FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: payment_method tenant_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_insert ON public.payment_method FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: tenant_member tenant_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_insert ON public.tenant_member FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: usage_metric tenant_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_insert ON public.usage_metric FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: invoice tenant_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_select ON public.invoice FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: payment_method tenant_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_select ON public.payment_method FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: tenant_member tenant_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_select ON public.tenant_member FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: usage_metric tenant_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_select ON public.usage_metric FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: invoice tenant_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_update ON public.invoice FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: payment_method tenant_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_update ON public.payment_method FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: tenant_member tenant_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_update ON public.tenant_member FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: usage_metric tenant_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_update ON public.usage_metric FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: tenant_member; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_member ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_metric; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_metric ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE invoice; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoice TO app_user;


--
-- Name: TABLE payment_method; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payment_method TO app_user;


--
-- Name: TABLE tenant_member; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_member TO app_user;


--
-- Name: TABLE usage_metric; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.usage_metric TO app_user;


-- ===========================================================================
-- 2. What 0025 and 0026 did to them, kept with the reasons attached
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- An invoice must be able to outlive the tenant it billed. (was 0025)
-- ---------------------------------------------------------------------------
--
-- It could not before: `invoice.tenant_id` was NOT NULL and cascaded, so
-- erasing a tenant erased its invoices.
--
-- Detaching alone is not enough, and this is the part that is easy to miss:
-- **the invoice carried no identity of its own.** It had `tenant_id` and
-- amounts, and nothing else — so an invoice detached from its tenant could not
-- say who it was for. `billed_to_name` is captured at issue time, which is
-- also simply correct: an invoice records a moment, and a customer renaming
-- their company later must not silently rewrite invoices already issued.
--
-- NOT a claim that these are now legally complete invoices. There is still no
-- invoice number, no address and no VAT identification number anywhere in this
-- schema. That is real work and it belongs to workplan 0086 T5, which is about
-- being allowed to take money at all.

ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS billed_to_name text;

ALTER TABLE public.invoice ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_tenant_id_fkey;
ALTER TABLE public.invoice
  ADD CONSTRAINT invoice_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoice.tenant_id IS
  'NULL once the tenant has been erased. The invoice survives on purpose — tax retention outlives the customer relationship — and billed_to_name is what it says about who it was for.';

-- RLS on `invoice` is keyed on `tenant_id`, so a detached invoice is invisible
-- to every tenant-scoped reader. That is the correct outcome: nobody browsing
-- as a tenant should see the invoices of an erased one. Operator access to
-- them is out-of-band, through the owner connection, which is the same trust
-- boundary the sync tick documents.


-- ---------------------------------------------------------------------------
-- The record that an erasure happened — without re-creating what it erased.
-- (was 0025, plus 0026's two columns)
-- ---------------------------------------------------------------------------
--
-- This is the part most likely to be got wrong, and the failure is subtle: the
-- obvious implementation keeps the tenant id and the email of whoever asked,
-- which is a record OF A PERSON — the thing we just promised to delete.
--
-- So `tenant_ref` is a one-way hash of the tenant id, never the id. An auditor
-- holding the id can compute the hash and confirm we erased what we said, when
-- we said. Anybody who does not already know the id learns nothing, and the
-- table cannot be turned back into a list of former customers.
--
-- No tenant foreign key, deliberately — a record that cascades away with the
-- thing it describes is not a record. And no RLS, for the same reason
-- `rate_budget` has none: it is read by system-level code with no tenant
-- context, and a policy on `app.current_tenant` would hide every row from the
-- only code that reads it.
--
-- `purged_at` records when the rows left the LIVE database. Every backup taken
-- before that moment still contains them, and will until it ages out of the
-- deployment's retention window. So `purged_at` is not the date erasure
-- finished, and a record that offers no other date invites everyone reading it
-- to assume otherwise — hence `backup_retention_days` (what the retention was
-- AT THE TIME, recorded rather than looked up later, because the number can
-- change and the customer was told a specific date on a specific day) and
-- `backups_expire_at` (the promise, as made).

CREATE TABLE IF NOT EXISTS public.erasure_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    -- sha256 of the tenant id. NOT the id.
    tenant_ref text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    window_days integer NOT NULL,
    backup_retention_days integer,
    backups_expire_at timestamp with time zone,
    purged_at timestamp with time zone,
    -- Which invoices were kept, so the retention decision is auditable.
    retained_invoice_ids uuid[] NOT NULL DEFAULT '{}',
    -- Per connection kind: revoked, failed, or not attempted. A credential we
    -- deleted but could not revoke is still live at the provider, and saying so
    -- is the difference between a receipt and a reassurance.
    revocations jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Rows removed per table: the receipt, and what the test asserts against.
    purged_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_erasure_record_ref ON public.erasure_record (tenant_ref);

COMMENT ON TABLE public.erasure_record IS
  'Proof that an erasure happened, holding no personal data of its own. tenant_ref is a one-way hash of the tenant id: an auditor holding the id can verify the record; the table cannot be read back into a list of former customers. Deliberately without a tenant foreign key (a record that cascades away with its subject is not a record) and without RLS (read by system-level code that has no tenant context).';

-- The request path may write this, but never destroy it. An erasure record
-- exists to prove an erasure happened; **a request path that can delete it can
-- erase the evidence that it erased something.** The purge job updates it
-- through the owner connection, which default privileges do not constrain, so
-- nothing this product needs is lost.
GRANT SELECT,INSERT,UPDATE ON TABLE public.erasure_record TO app_user;
REVOKE DELETE ON TABLE public.erasure_record FROM app_user;


-- ===========================================================================
-- 3. What a tenant agreed to pay (was `tenant.pricing`, migration 0007)
-- ===========================================================================
--
-- A ROW, not a column on `tenant`, and that is the only thing that changed.
-- `tenant` is the RLS anchor every other table keys on, so it is core by
-- definition and cannot move; a price on it put money in the one table the
-- appliance certainly has.
--
-- The reasoning the column carried is unchanged and still the point. Prices
-- were a hardcoded constant. Making them operator-configurable creates a hazard
-- that did not exist while they were frozen in code: editing the price list
-- would re-price every existing customer's open invoice, retroactively, with
-- nothing anywhere saying it had happened.
--
-- So the template and the agreement are different things and live in different
-- places. The template is the `PRICING_*` environment; the agreement is this
-- table, written once per tenant and never following the template back.
-- `resolveTenantPricing` writes it the first time a tenant is priced, so every
-- tenant ends up with an answer to "what did we agree" that is a stored fact
-- rather than whatever the config said most recently.
--
-- ABSENCE IS THE "NOT YET AGREED" STATE. As a column this was a nullable jsonb
-- and NULL had to be documented to mean "no agreement yet, not free" — a
-- distinction a `NOT NULL` reader could get wrong. A missing row cannot be
-- misread as a price of zero.
--
-- VAT is deliberately absent: a tax rate is set by a government and changes for
-- everyone at once. Pinning it per tenant would encode "this customer keeps the
-- old VAT rate", which is not a discount, it is a tax error.

CREATE TABLE IF NOT EXISTS public.tenant_pricing (
    tenant_id uuid NOT NULL PRIMARY KEY REFERENCES public.tenant(id) ON DELETE CASCADE,
    pricing jsonb NOT NULL,
    agreed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.tenant_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.tenant_pricing FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.tenant_pricing FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_insert ON public.tenant_pricing FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_update ON public.tenant_pricing FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_delete ON public.tenant_pricing FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_pricing TO app_user;

COMMENT ON TABLE public.tenant_pricing IS
  'The prices this tenant agreed to, in integer cents (baseFee, storagePricePerGB, egressPricePerGB, computePricePerHour). Pinned once from the operator template; never follows it afterwards. NO ROW = not yet agreed.';


-- ===========================================================================
-- 4. When we promised to delete them (was tenant.closed_at / purge_after /
--    closed_by, migration 0025)
-- ===========================================================================
--
-- `tenant.status` KEEPS its `closed` and `deleting` values and stays in the
-- shared chain. A CHECK constraint is a statement about what is ALLOWED, and an
-- allowed-but-unused value costs an appliance nothing; moving it here would
-- mean this chain rewriting a constraint the other chain owns, which is a
-- cross-chain dependency and a far worse thing to have than an unused enum
-- value.
--
-- The DATES are different. They are a promise made to a customer — the window
-- they chose, when it runs out, who asked. An appliance's operator is the
-- customer, has root, and needs no window in which we might change our minds
-- on their behalf.
--
-- Absence means not closed, for the same reason as section 3: three nullable
-- columns on `tenant` made "closed" a state you had to reconstruct from a
-- combination of fields, and a row that exists or does not cannot be half-set.

CREATE TABLE IF NOT EXISTS public.tenant_closure (
    tenant_id uuid NOT NULL PRIMARY KEY REFERENCES public.tenant(id) ON DELETE CASCADE,
    closed_at timestamp with time zone NOT NULL,
    -- When the purge becomes due. Set at close time from the window the
    -- customer chose (immediate, 7, 30 or 90 days) — immediate means now(), so
    -- one code path serves every window and there is no separate "delete
    -- straight away" branch to get wrong.
    purge_after timestamp with time zone NOT NULL,
    closed_by text
);

CREATE INDEX IF NOT EXISTS ix_tenant_closure_due ON public.tenant_closure (purge_after);

ALTER TABLE public.tenant_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.tenant_closure FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.tenant_closure FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_insert ON public.tenant_closure FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_update ON public.tenant_closure FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_delete ON public.tenant_closure FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_closure TO app_user;

COMMENT ON TABLE public.tenant_closure IS
  'A closed tenant''s dates: when it was closed, when the purge becomes due, and who asked. No row = not closed. Managed only — the appliance ends itself with forget-me, which revokes and does not wait.';
