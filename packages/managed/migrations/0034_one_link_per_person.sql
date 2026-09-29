-- ONE LINK PER PERSON (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)).
--
-- The owner, asked after *Start a migration* sent one person two links for
-- one Google account: "yes, a per-person link instead of the per-migration
-- links". A person grants their own accounts, so the link is theirs: one
-- grant link and one progress link for all of a person's migrations.
--
-- ## Its own row, beside the person
--
-- `mapping_link` (the shared chain's 0031) cannot point at `person`: the
-- person is managed-only (ADR-0036), and the ledger every appliance applies
-- must not name a managed table. So the person's link is a managed row of its
-- own, shaped as `mapping_link` is, column for column, with the person where
-- the migration was: a hashed secret, the purpose, who made it, an expiry the
-- owner chose, spent and revoked. The appliance has one implicit person and no
-- grant links, and nothing there changes.
--
-- The person's half is a key, as `person_migration`'s is: `(person_id,
-- tenant_id)` references the person's own `(id, tenant_id)`, so a link cannot
-- name another organisation's person, whoever writes it. Deleting the person
-- deletes their links: a person who is gone has no doors left open.
--
-- ## A link sees only itself
--
-- The grant and progress pages are opened by somebody with no session, before
-- any tenant is known. The verification read runs under `app.current_link`,
-- set to the id the URL presented, and this table's own `link_sees_itself`
-- lets that read find exactly that row. It is the same setting `mapping_link`
-- reads, given a policy of its own here, as `withMappingLink`'s header asks of
-- a second table. The tenant policies are NULL-safe from birth, for the reason
-- 0004 recorded: every permissive policy is evaluated, and `''::uuid` raises.
-- The id is compared as text, so an unset or decayed setting matches nothing.
--
-- Personal data: none beyond who made the link, which is a member's subject.
-- Erasure purges the table before `person` (`PURGED_TABLES`).

CREATE TABLE public.person_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    person_id uuid NOT NULL,
    -- 'grant' supplies each account's credential; 'view' is the person's
    -- progress page (ADR-0035's two lifetimes).
    purpose text NOT NULL,
    -- sha256 of the URL's secret half, hex. Never the secret itself.
    secret_hash text NOT NULL,
    -- The member's subject, so "who handed this out" survives the link.
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- The owner's choice at issue (a grant: 1 / 7 / 30 days; a progress page:
    -- 30 / 90 / 180). NOT NULL: no bearer credential here lives for ever.
    expires_at timestamp with time zone NOT NULL,
    -- A grant link is spent when every account on it is granted.
    used_at timestamp with time zone,
    -- The owner's kill switch.
    revoked_at timestamp with time zone,
    CONSTRAINT person_link_pkey PRIMARY KEY (id),
    CONSTRAINT person_link_purpose_check CHECK ((purpose = ANY (ARRAY['grant'::text, 'view'::text]))),
    CONSTRAINT person_link_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE,
    CONSTRAINT person_link_person_fkey FOREIGN KEY (person_id, tenant_id)
      REFERENCES public.person(id, tenant_id) ON DELETE CASCADE
);

-- The owner's list is per person, and it is the only query shape there is.
CREATE INDEX person_link_person_idx ON public.person_link USING btree (person_id, created_at DESC);

ALTER TABLE public.person_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.person_link FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.person_link FOR SELECT USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_insert ON public.person_link FOR INSERT WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_update ON public.person_link FOR UPDATE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_delete ON public.person_link FOR DELETE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The verification read, bounded to exactly the row whose id was presented.
CREATE POLICY link_sees_itself ON public.person_link
  FOR SELECT USING (id::text = current_setting('app.current_link'::text, true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_link TO app_user;

COMMENT ON TABLE public.person_link IS
  'A person''s bearer link to all of their migrations (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)). Shaped as mapping_link is: the secret is hashed at rest, a grant link is spent when every account on it is granted, expiry is the owner''s choice and revocation is their kill switch. Managed-only, because person is. Purged on erasure.';

COMMENT ON COLUMN public.person_link.secret_hash IS
  'sha256 of the URL''s secret half. The secret itself is shown once, at issue, and never stored: a leaked table must not mint working links.';
