-- WHOSE ADDRESS CHANGES (ADR-0055; workplan 0168 T2, §4.2, §5).
--
-- The shared chain's `address_change` (ledger 0071) is the organisation's
-- table of addresses that change, old to new. On managed a row may say WHOSE
-- old address it is: a person of the organisation (ADR-0050). That link is
-- managed-only, because `person` is, so it is a row of its own here and never
-- a column there (hard rule 5). The appliance has one implicit person and no
-- such table, and `no-managed-leakage.unit.test.ts` names it.
--
-- ## One person per row at most, and either side's delete takes only the link
--
-- Keyed by the row it is about, `(tenant_id, old_key)`, so a row has at most
-- one person. Deleting the address change deletes its link (the cascade), and
-- so does deleting the person: the address change itself stays, because other
-- people's copies depend on it (0168 §5). The person's key is
-- `(person_id, tenant_id)`, as `person_link`'s is, so a link cannot name
-- another organisation's person.
--
-- ## What the operator sees: counts (0168 D7)
--
-- Support's screens show how many rows an organisation has and how many are
-- confirmed, never an address. `support_tenant_address_changes` is those two
-- numbers per organisation, behind the same `platform_operator` predicate as
-- every support view, and its column list is the boundary.
--
-- ## The erasure
--
-- Both tables join `PURGED_TABLES`, so the purge, which runs as
-- `ownpace_system` (managed 0033), is granted what it needs to delete them:
-- the tenant column to find the rows, and DELETE.

CREATE TABLE public.address_change_person (
    tenant_id uuid NOT NULL,
    old_key text NOT NULL,
    person_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT address_change_person_pkey PRIMARY KEY (tenant_id, old_key),
    CONSTRAINT address_change_person_change_fkey FOREIGN KEY (tenant_id, old_key)
      REFERENCES public.address_change(tenant_id, old_key) ON DELETE CASCADE,
    CONSTRAINT address_change_person_person_fkey FOREIGN KEY (person_id, tenant_id)
      REFERENCES public.person(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX address_change_person_person_idx ON public.address_change_person USING btree (person_id);

ALTER TABLE public.address_change_person ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.address_change_person FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.address_change_person FOR SELECT USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_insert ON public.address_change_person FOR INSERT WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_update ON public.address_change_person FOR UPDATE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_delete ON public.address_change_person FOR DELETE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.address_change_person TO app_user;

GRANT SELECT (tenant_id), DELETE ON TABLE public.address_change_person TO ownpace_system;
GRANT SELECT (tenant_id), DELETE ON TABLE public.address_change TO ownpace_system;

COMMENT ON TABLE public.address_change_person IS
  'Whose old address an address change is (ADR-0055; workplan 0168 §4.2): at most one person per row. Managed-only, because person is. Deleting either side deletes only this link. Purged on erasure.';

CREATE OR REPLACE VIEW public.support_tenant_address_changes AS
  SELECT
    t.id AS tenant_id,
    (SELECT count(*) FROM public.address_change a WHERE a.tenant_id = t.id)::integer AS row_count,
    (SELECT count(*) FROM public.address_change a
      WHERE a.tenant_id = t.id AND a.state = 'confirmed')::integer AS confirmed_count
  FROM public.tenant t
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_tenant_address_changes TO app_user;

-- A view is read, and nothing else (managed 0027): the table's default
-- privileges would give `app_user` the writes too, and a view this simple is
-- one a DELETE would reach the tenant through.
REVOKE INSERT, UPDATE, DELETE ON public.support_tenant_address_changes FROM app_user;

COMMENT ON VIEW public.support_tenant_address_changes IS
  'An organisation''s address changes, counted, for the operator''s screen (workplan 0168 D7): how many rows and how many confirmed, never an address. Guarded by the same platform_operator predicate as every support view.';
