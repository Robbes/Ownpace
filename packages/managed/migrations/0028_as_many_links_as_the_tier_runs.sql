-- AS MANY LIVE LINKS AS THE TIER RUNS MIGRATIONS (workplan 0108 T8 (d); the
-- owner, 2026-09-24: "the Recommended").
--
-- A grant link is a bearer credential that asks a stranger to give Google
-- access, and until now an organisation could mint them without end. The
-- owner's answer: as many live grant links at once as the organisation's tier
-- runs migrations at the same time (Tiny 1, Small 4, Medium 20, Large 50,
-- Extra large 200), counting only the ones that can still be used, with an
-- operator override per organisation for a burst. The count and the tier are
-- read where a link is issued (`link-routes.ts`, `grant-link-allowance.ts`).
-- This table holds the override.
--
-- ## One row per organisation, written by the operator alone
--
-- `live_links` replaces the tier's number while it stands: higher for a burst,
-- or lower. `until` ends it by itself, so a burst cannot outlive its reason by
-- being forgotten; NULL keeps it until it is cleared. `set_by` and `set_at` say
-- who and when, and the operator's command writes an audit row in the same
-- transaction.
--
-- The organisation reads its own row: the issue route reads it under the
-- organisation's own policy. Nothing on the request path writes it: `app_user`
-- is granted SELECT and the rest is revoked, since the schema's default
-- privileges (ledger 0001) would grant it all. The operator writes it over the
-- owner connection (`operator.sh links`), as operators are appointed, and
-- FORCE holds even that connection to the organisation it names.

CREATE TABLE public.grant_link_allowance (
    tenant_id uuid NOT NULL,
    live_links integer NOT NULL,
    until timestamptz,
    set_by text NOT NULL,
    set_at timestamptz NOT NULL DEFAULT now(),
    note text,
    CONSTRAINT grant_link_allowance_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT grant_link_allowance_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE,
    CONSTRAINT grant_link_allowance_in_range CHECK (live_links BETWEEN 1 AND 1000),
    CONSTRAINT grant_link_allowance_note_short CHECK (note IS NULL OR length(note) <= 200)
);

ALTER TABLE public.grant_link_allowance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.grant_link_allowance FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies a subject-scoped read runs beside:
-- `''::uuid` raises, and an unset tenant must read as no rows.
CREATE POLICY tenant_isolation ON public.grant_link_allowance
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT ON public.grant_link_allowance TO app_user;
REVOKE INSERT, UPDATE, DELETE ON public.grant_link_allowance FROM app_user;
