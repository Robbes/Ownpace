-- AN ORGANISATION MARKED AS A TEST (workplan 0162 T1, §3; the owner's
-- decisions of 2026-11-20, §2; ADR-0053).
--
-- An appointed operator marks an organisation as a test from Support, with a
-- marker, `[Ownpace-test]` unless they type another (§2 (a), (b)). Every
-- migration made in it afterwards copies the marker onto its own row,
-- `mailbox_mapping.test_marker` (ledger migration 0070), in the transaction
-- that creates it, and from then on copies only the items whose own title
-- contains it. The marker on the organisation is the switch; the marker on
-- each migration is what every reader of its source reads, and it never
-- changes.
--
-- ## A row of its own, in the managed chain
--
-- The appliance has no operator and no test organisation (§3: self-host is not
-- in T1), so this lives where only a managed deployment applies it, and as a
-- row beside `tenant`, never a column on it (AGENTS.md hard rule 5, ADR-0036):
-- a row here is an organisation that is a test, and no row is one that is not.
--
-- ## Only while it holds no migration
--
-- An organisation becomes a test, or stops being one, only while it holds no
-- migration (§2 (b)): a migration made before the mark would copy everything
-- in what the operator now calls a test, and one made under the mark keeps it
-- whatever happens here (§2 (c)). The doors that write this row
-- (`POST` and `DELETE /api/support/tenants/{tenantId}/test`) refuse while any
-- `mailbox_mapping` row names the organisation, whatever its status, which is
-- how `support_tenants.migration_count` and `operator.sh clean empty-tenant`
-- count what an organisation holds. They take the organisation's migrations
-- lock first, the advisory lock `POST /api/migrations` takes before it counts
-- (`holdTheCap`), so a mark and a create are decided one after the other.
--
-- ## Its form
--
-- The column's CHECK is 0070's, so any marker stored here can be copied onto
-- a migration: 3 to 64 characters, none of them a control character, named by
-- code point so Postgres and PGlite refuse the same ones. And trimmed: a
-- marker with a space at either end would match a title nobody typed. The
-- route reads the typed marker more strictly first (`readTestMarker`, shared):
-- trimmed, and every character printable.
--
-- ## Who reads and writes it
--
-- The API as `app_user`, in the organisation's own scope. Reading is the
-- organisation's own: the create door reads the marker in the organisation's
-- scope, where no operator is anywhere near, so SELECT asks only for the
-- tenant. Writing is an appointed operator's, and the database says so itself,
-- as 0023 does for a platform hold and 0055 for money given back: INSERT,
-- UPDATE and DELETE each also ask that `app.current_user` names a row of
-- `platform_operator`, and a row is written only in the operator's own name
-- (`marked_by`). The two doors set `app.current_user` in their own
-- transaction, the one that asks `platform_operator` and writes, so the check
-- and the write are one transaction; an `app_user` in the organisation's scope
-- who is not an operator writes nothing here, whatever the API does. The
-- purge of a closed organisation deletes by `tenant_id` as `ownpace_system`,
-- which reads past row security (`PURGED_TABLES` in offboarding.ts). And the
-- operator's two support views below serve the organisation's marker and each
-- migration's own. A marker is the operator's own setting, no personal data:
-- who set it is the operator's subject, as on every audit row they write.
--
-- ## The two views
--
-- `support_tenants` and `support_tenant_migrations` gain one column each,
-- appended, because `CREATE OR REPLACE VIEW` may add columns at the end and
-- never reorder them (0010's rule). Each is written out in full, with the
-- `platform_operator` predicate, as every support view is
-- (`support-views.unit.test.ts`), and `CREATE OR REPLACE` keeps its grants,
-- 0027's revocation of every write among them.

CREATE TABLE IF NOT EXISTS public.test_organisation (
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- The text an item's own title must contain to be copied, ignoring case.
    marker text NOT NULL,
    -- The operator's subject (`platform_operator.user_id`).
    marked_by text NOT NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT test_organisation_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT test_organisation_marker_check CHECK (
      char_length(marker) BETWEEN 3 AND 64
      AND marker !~ '[\x01-\x1f\x7f-\x9f]'
      AND marker = btrim(marker)
    )
);

ALTER TABLE public.test_organisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.test_organisation FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows.
-- Reading is the organisation's own: the create door reads its marker here.
DROP POLICY IF EXISTS tenant_isolation_select ON public.test_organisation;
CREATE POLICY tenant_isolation_select ON public.test_organisation FOR SELECT
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- Writing is an appointed operator's, in the organisation's scope, and a row
-- is written only in the operator's own name.
DROP POLICY IF EXISTS operator_marks_a_test ON public.test_organisation;
CREATE POLICY operator_marks_a_test ON public.test_organisation FOR INSERT
    WITH CHECK (
      tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
      AND marked_by = current_setting('app.current_user'::text, true)
      AND EXISTS (
        SELECT 1 FROM public.platform_operator
         WHERE user_id = current_setting('app.current_user'::text, true)
      )
    );
DROP POLICY IF EXISTS operator_changes_a_test ON public.test_organisation;
CREATE POLICY operator_changes_a_test ON public.test_organisation FOR UPDATE
    USING (
      tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
      AND EXISTS (
        SELECT 1 FROM public.platform_operator
         WHERE user_id = current_setting('app.current_user'::text, true)
      )
    )
    WITH CHECK (
      tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
      AND marked_by = current_setting('app.current_user'::text, true)
      AND EXISTS (
        SELECT 1 FROM public.platform_operator
         WHERE user_id = current_setting('app.current_user'::text, true)
      )
    );
DROP POLICY IF EXISTS operator_clears_a_test ON public.test_organisation;
CREATE POLICY operator_clears_a_test ON public.test_organisation FOR DELETE
    USING (
      tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
      AND EXISTS (
        SELECT 1 FROM public.platform_operator
         WHERE user_id = current_setting('app.current_user'::text, true)
      )
    );

-- The doors set it (a second set replaces the marker) and clear it, as the
-- policies above allow an operator only, and the create door reads it.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.test_organisation TO app_user;

-- The purge deletes an organisation's row by the column it picks it with.
GRANT SELECT (tenant_id), DELETE ON TABLE public.test_organisation TO ownpace_system;

COMMENT ON TABLE public.test_organisation IS
  'An organisation an appointed operator marked as a test, with its marker (workplan 0162 T1, ADR-0053): one row per test organisation, none for every other. Written only by an appointed operator, in their own name (the policies ask platform_operator), and only while the organisation holds no migration. Each migration made in it copies the marker onto mailbox_mapping.test_marker when it is created, and never loses it.';

CREATE OR REPLACE VIEW public.support_tenants AS
  SELECT
    t.id            AS tenant_id,
    t.name          AS tenant_name,
    t.status        AS tenant_status,
    t.created_at    AS joined_at,
    (SELECT count(*) FROM public.mailbox_mapping m WHERE m.tenant_id = t.id)
                    AS migration_count,
    (SELECT count(*) FROM public.migration_status s
      WHERE s.tenant_id = t.id AND s.state = 'failed')
                    AS failing_domain_count,
    (SELECT count(*) FROM public.decision d
      WHERE d.tenant_id = t.id AND d.status = 'pending')
                    AS pending_decision_count,
    (SELECT count(*) FROM public.connection c WHERE c.tenant_id = t.id)
                    AS connection_count,
    (SELECT count(*) FROM public.tenant_member tm
      WHERE tm.tenant_id = t.id AND tm.status = 'active')
                    AS member_count,
    (SELECT max(r.created_at) FROM public.run r WHERE r.tenant_id = t.id)
                    AS last_pass_at,
    tc.closed_at    AS closed_at,
    tc.purge_after  AS purge_after,
    -- Appended by this migration: the organisation's marker, NULL for an
    -- organisation that is not a test.
    tor.marker      AS test_marker
  FROM public.tenant t
  LEFT JOIN public.tenant_closure tc ON tc.tenant_id = t.id
  LEFT JOIN public.test_organisation tor ON tor.tenant_id = t.id
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

COMMENT ON VIEW public.support_tenants IS
  'Level 1 of the operator surface (workplan 0110 T2, T5; 0139 T7 (b); 0162 T1): every '
  'organisation, metadata only. `pending_decision_count` is a COUNT and never the '
  'decisions themselves; their summary and detail carry addresses. `member_count` '
  'counts ACTIVE members only, and `last_pass_at` is the latest pass, not the audit '
  'log''s last line, which the digest writes too. `closed_at` and `purge_after` are '
  'NULL while the organisation is open, and `test_marker` while it is not a test.';

CREATE OR REPLACE VIEW public.support_tenant_migrations AS
  SELECT
    m.tenant_id,
    m.id            AS mapping_id,
    m.name,
    m.status        AS lifecycle,
    m.mode,
    m.pattern,
    m.schedule,
    m.created_at,
    m.updated_at,
    -- THIS migration's own pending decisions. Scoped by mapping_id AND
    -- tenant_id: the column is nullable and a join on it alone would count a
    -- tenant-level decision against every migration the tenant has.
    (SELECT count(*) FROM public.decision d
      WHERE d.tenant_id = m.tenant_id AND d.mapping_id = m.id AND d.status = 'pending')
                    AS pending_decision_count,
    -- Appended by this migration: the migration's own marker (ledger 0070),
    -- NULL for a migration that is not a test.
    m.test_marker   AS test_marker
  FROM public.mailbox_mapping m
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

COMMENT ON VIEW public.support_tenant_migrations IS
  'Level 2/3 of the operator surface (workplan 0110 T2, T5; 0162 T1): one migration, '
  'metadata only. `pending_decision_count` counts THIS mapping''s pending '
  'decisions; the tenant view''s counts every one the organisation has, '
  'including those belonging to no migration. The two are not meant to agree. '
  '`test_marker` is the migration''s own marker, NULL for one that is not a test.';
