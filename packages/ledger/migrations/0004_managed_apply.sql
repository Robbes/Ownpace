-- What the managed edition needs before `apply` can exist there (0017 T4).
--
-- 1. Somewhere for the ENABLE flag to live. `allowApplyDeletions` is the first
--    of `apply`'s seven gates — off unless the mapping opts in, because a
--    destructive capability that is on unless disabled is one somebody gets by
--    accident. On the appliance it lives in the mapping's config file; managed
--    mappings live in this database, so the flag becomes a column. DEFAULT
--    FALSE, NOT NULL: every existing mapping stays unable to remove anything,
--    exactly as it was, and there is no NULL to argue about.
--
-- 2. Somewhere for a RECEIPT to live. The managed route evaluates the
--    ledger-side gates synchronously (a refusal is an answer to the operator's
--    question and comes back on the request they made) and enqueues only a
--    removal it has decided is permitted — so the job's outcome needs a row a
--    poller can read: applied with how final that was, refused with the gate
--    that fired at removal time (the target-side gates cannot be checked from
--    a request thread), or failed with the reason. The appliance answers all
--    of this synchronously and needs none of it.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN allow_apply_deletions boolean DEFAULT false NOT NULL;

CREATE TABLE public.apply_receipt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    natural_key_hash text NOT NULL,
    state text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    -- Exactly one of these three families is filled, by state:
    kind text,    -- applied: how final the removal was ('deleted' | 'binned')
    code text,    -- refused: the stable refusal code, for a UI to switch on
    reason text,  -- refused: the operator-facing sentence; failed: the error
    CONSTRAINT apply_receipt_pkey PRIMARY KEY (id),
    CONSTRAINT apply_receipt_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'applied'::text, 'refused'::text, 'failed'::text]))),
    -- A queued row has no outcome yet; a terminal row must say when it ended.
    CONSTRAINT apply_receipt_finished_check CHECK (((state = 'queued'::text) = (finished_at IS NULL))),
    CONSTRAINT apply_receipt_mapping_id_fkey FOREIGN KEY (mapping_id) REFERENCES public.mailbox_mapping(id),
    CONSTRAINT apply_receipt_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id)
);

-- The poller's query: the latest receipt for one item.
CREATE INDEX apply_receipt_item_idx
  ON public.apply_receipt (tenant_id, mapping_id, natural_key_hash, requested_at DESC);

-- Same tenant-isolation posture as every other table; the force-rls catalog
-- audit fails by name on any RLS table whose owner stays exempt.
ALTER TABLE public.apply_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.apply_receipt FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.apply_receipt FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_insert ON public.apply_receipt FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_update ON public.apply_receipt FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_delete ON public.apply_receipt FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.apply_receipt TO app_user;
