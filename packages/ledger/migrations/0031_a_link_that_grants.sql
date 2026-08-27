-- The first bearer link in this repository (workplan 0108 T1, ADR-0035).
--
-- ## What it is for
--
-- ADR-0035 decided that **owners sign in and migrated people get links, not
-- accounts** — and that the link is not a status view: it is *"how the migrated
-- person GRANTS their own migration, which is the only place their source
-- credential is ever handled"*. Until now that sentence was aspirational:
-- 0089 T1 built the consent flow for the OWNER's session, and the refresh token
-- it produces travels through the OWNER's browser. For the person being
-- migrated that is wrong twice — they have no session, and their credential
-- must not transit anything the owner operates.
--
-- ## Why a table and not a signed nonce
--
-- 0089 T1's `ConsentFlowStore` keeps its ten-minute OAuth states in process
-- memory, which is right for something that lives ten minutes. A grant link
-- must be **revocable** (ADR-0035), listable by the owner who issued it, and
-- alive across a restart. Process memory can do none of the three.
--
-- ## The secret is hashed at rest
--
-- The URL carries `<id>.<secret>`; this table holds only `secret_hash`. A
-- leaked table must not mint working links, for the same reason a password is
-- never stored readable. Verification compares in constant time in the API.
--
-- ## Single-use is spent at the GRANT, not at the open
--
-- `used_at` is set when a refresh token is actually stored, never when the page
-- is fetched. Chat apps fetch URLs to draw previews; a link that died on
-- preview would generate support tickets with no attacker in sight. Until the
-- grant lands, opening is repeatable.
--
-- ## `purpose` reserves the second lifetime rather than inventing it later
--
-- ADR-0035 names two: credential supply (short-lived, single-use) and a
-- progress view (longer-lived, revocable). This builds `'grant'` and reserves
-- `'view'` — one mechanism, one table, so the second does not arrive as a
-- parallel invention.
--
-- ## The two policies do different jobs, and only one of them is about the bearer
--
-- `tenant_isolation_*` is the ordinary owner-side scoping: the owner who issued
-- a link may list and revoke it, inside their own tenant.
--
-- `link_sees_itself` exists because the verification read happens BEFORE any
-- tenant is known — the link holder has no session and no tenant context, and
-- the row is what would tell us which tenant to assume. So the API sets
-- `app.current_link` to the id parsed from the URL and reads exactly that row.
--
-- **That policy authorises nothing about the bearer.** Knowing an id is not
-- knowing the secret; the hash comparison in the API is what authenticates.
-- What the policy bounds is BLAST RADIUS: a verification context can read one
-- row and no other, so a mistake in a WHERE clause cannot become a walk of
-- other tenants' links.
--
-- Compared as TEXT with no cast, deliberately. `current_setting(..., true)`
-- answers `''` on a pooled connection whose previous transaction left it unset,
-- and `''::uuid` RAISES rather than matching nothing — the hazard the managed
-- chain's migration 0004 already recorded. `id::text = ''` is simply false.

CREATE TABLE public.mapping_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    -- 'grant' supplies a credential; 'view' is reserved for the progress page
    -- (ADR-0035's second lifetime) and is not issued by anything yet.
    purpose text NOT NULL,
    -- sha256 of the URL's secret half, hex. Never the secret itself.
    secret_hash text NOT NULL,
    -- The owner's subject. Kept so "who handed this out" survives the link.
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- The owner CHOOSES this at issue time (1 / 7 / 30 days, 7 pre-filled) —
    -- control on both sides rather than one comfortable default. NOT NULL:
    -- a bearer credential that never expires is not one this product issues.
    expires_at timestamp with time zone NOT NULL,
    -- Set when the grant actually lands. NULL means unspent.
    used_at timestamp with time zone,
    -- The owner's kill switch. Re-checked at the callback before anything is
    -- stored, because a kill switch that loses to a race is not one.
    revoked_at timestamp with time zone,
    CONSTRAINT mapping_link_pkey PRIMARY KEY (id),
    CONSTRAINT mapping_link_purpose_check CHECK ((purpose = ANY (ARRAY['grant'::text, 'view'::text]))),
    CONSTRAINT mapping_link_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- A deleted migration has no business keeping doors open to itself.
    CONSTRAINT mapping_link_mapping_id_fkey FOREIGN KEY (mapping_id) REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE
);

-- The owner's list is per mapping, and it is the only query shape there is.
CREATE INDEX mapping_link_mapping_idx ON public.mapping_link USING btree (mapping_id, created_at DESC);

ALTER TABLE public.mapping_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.mapping_link FORCE ROW LEVEL SECURITY;

-- NULL-SAFE FROM BIRTH, AND THAT IS NOT OPTIONAL HERE. Permissive policies are
-- OR'd and Postgres evaluates ALL of them — so every read made under
-- `app.current_link` (which sets no tenant) also runs these. On a pooled
-- connection whose previous transaction left the setting behind,
-- `current_setting(…, true)` answers `''` and a bare `''::uuid` RAISES, failing
-- the whole query with a 500 rather than matching nothing. `NULLIF(…, '')`
-- before the cast makes an unset-or-decayed setting NULL, which compares as
-- false. The managed chain's migration 0004 learned this the expensive way;
-- `guc-decay-under-rls.unit.test.ts` reproduces the decay.
CREATE POLICY tenant_isolation_select ON public.mapping_link FOR SELECT USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_insert ON public.mapping_link FOR INSERT WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_update ON public.mapping_link FOR UPDATE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_delete ON public.mapping_link FOR DELETE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The verification read, bounded to exactly the row whose id was presented.
CREATE POLICY link_sees_itself ON public.mapping_link
  FOR SELECT USING (id::text = current_setting('app.current_link'::text, true));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mapping_link TO app_user;

COMMENT ON TABLE public.mapping_link IS
  'A migrator''s bearer link to one mapping (ADR-0035, workplan 0108). The secret is hashed at rest; single-use is spent at the grant, not at the open; expiry is the owner''s choice and revocation is their kill switch. Distinct from an INVITATION, which deliberately carries no token at all because membership identity belongs to the issuer (ADR-0042) — these two must never be turned into each other.';

COMMENT ON COLUMN public.mapping_link.secret_hash IS
  'sha256 of the URL''s secret half. The secret itself is shown once, at issue, and never stored — a leaked table must not mint working links.';
