-- The provider setup checklist's rows (workplan 0061).
--
-- What a person must do IN THE PROVIDER — create an app, grant scopes, get an
-- administrator to authorise it, obtain a token — is the part of a migration
-- this product does not control, involves other consoles and often other
-- people, and therefore the part that gets interrupted. Until now it was one
-- amber paragraph in a wizard that keeps its state in memory: reach the
-- credentials step, discover a Box admin has to authorise the app, come back
-- tomorrow, start from an empty form.
--
-- STATE ONLY. The steps themselves are defined in code
-- (`packages/shared/src/provider-setup.ts`) and keyed by `step_key`, so steps
-- can be added, reworded or reordered without a data migration. A key that
-- leaves the code orphans its rows; the reader stops showing them, which is
-- harmless and much cheaper than migrating every time a provider renames a
-- console button.
--
-- PER TENANT, not per mapping and not per user. A Box platform app is created
-- once for the organisation, not once per mailbox — and the point of storing
-- this at all is that a colleague can pick up where someone else stopped.
--
-- Three states, mirroring share_grant's shape (workplan 0052):
--   open    — still to do
--   done    — done in the provider, ticked off here
--   skipped — deliberately not applicable (recorded, not silently absent)
-- `open` is the only state with no decider; the CHECK below pins that, so a
-- settled row always says whose decision it was and when.

CREATE TABLE public.setup_step (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    side text NOT NULL,
    provider text NOT NULL,
    step_key text NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    decided_by text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT setup_step_pkey PRIMARY KEY (id),
    CONSTRAINT setup_step_side_check CHECK ((side = ANY (ARRAY['source'::text, 'target'::text]))),
    CONSTRAINT setup_step_state_check CHECK ((state = ANY (ARRAY['open'::text, 'done'::text, 'skipped'::text]))),
    -- An open row has no decision on it; a settled row must say whose and when.
    CONSTRAINT setup_step_decided_check CHECK (((state = 'open'::text) = (decided_at IS NULL)))
);

-- One row per step per provider per side per tenant; ticking upserts against it.
CREATE UNIQUE INDEX uk_setup_step_identity
  ON public.setup_step (tenant_id, side, provider, step_key);

ALTER TABLE public.setup_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.setup_step FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.setup_step FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_insert ON public.setup_step FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_update ON public.setup_step FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_delete ON public.setup_step FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.setup_step TO app_user;
