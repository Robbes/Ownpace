-- Make the verification schema fit the verification contract (workplan 0017 T6/T3).
--
-- Two gaps, both found while designing the start + poll pair:
--
-- 1. `verification.status` allows three values where the contract has five.
--    `DataTypeVerificationStatus` includes SKIPPED (the owner turned the domain
--    off — their call, does not block cutover, but nobody checked it) and
--    NOT_VERIFIABLE (the domain is ON and the target cannot be read — nobody
--    checked, and that is not a pass and not a warning). Those are exactly the
--    two the Verify screen refuses to soften, and the CHECK constraint made
--    them unstorable. Persisting NOT_VERIFIABLE as 'fail' to fit was named in
--    the workplan as the shortcut not to take: it would turn "nobody looked"
--    into "it is broken", which misdirects the operator at cutover time.
--
-- 2. There is nowhere to keep a RUN. The `verification` table holds per-domain
--    results; the contract's `VerificationRunReport` is about the run itself —
--    running since when, finished when, failed WHY — and the managed edition
--    must persist that (its API and worker are different processes, and a
--    poller may land on any replica). The appliance keeps its report in
--    memory on purpose; this table is the managed half of that documented
--    asymmetry.
--
-- The `report` column is the contract's `VerifyResponse` as jsonb, whole. The
-- per-domain `verification` rows remain the queryable, normalised record the
-- cutover gate reads; this is the wire shape a poller gets back, stored rather
-- than reassembled so that what `GET .../verify/report` serves is what the run
-- produced — byte for byte, hash-stable, no drift between writer and reader.

ALTER TABLE public.verification DROP CONSTRAINT verification_status_check;
ALTER TABLE public.verification ADD CONSTRAINT verification_status_check
  CHECK ((status = ANY (ARRAY['pass'::text, 'warn'::text, 'fail'::text, 'skipped'::text, 'not_verifiable'::text])));

CREATE TABLE public.verification_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    state text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    error text,
    report jsonb,
    CONSTRAINT verification_run_pkey PRIMARY KEY (id),
    CONSTRAINT verification_run_state_check CHECK ((state = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text]))),
    -- A terminal row says when it ended; a running row must not pretend to.
    CONSTRAINT verification_run_finished_check CHECK (((state = 'running'::text) = (finished_at IS NULL))),
    CONSTRAINT verification_run_mapping_id_fkey FOREIGN KEY (mapping_id) REFERENCES public.mailbox_mapping(id),
    CONSTRAINT verification_run_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id)
);

-- The poller's query: the latest run for a mapping.
CREATE INDEX verification_run_mapping_started_idx
  ON public.verification_run (tenant_id, mapping_id, started_at DESC);

-- Same tenant-isolation posture as every other table, FORCE included —
-- `force-rls.unit.test.ts` audits the catalogs and fails BY NAME on any RLS
-- table whose owner stays exempt, so forgetting FORCE here is a red test, not
-- a repeat of the 0002 stragglers.
ALTER TABLE public.verification_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.verification_run FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.verification_run FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_insert ON public.verification_run FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_update ON public.verification_run FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_delete ON public.verification_run FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.verification_run TO app_user;
