-- A PASSWORD TRIED ON A LINK, AND WHOSE DESTINATION IT IS (ADR-0035; workplan
-- 0174 T1, §4.3, §5.5, §9; the owner's D1 (a) and D5 (a) of 2026-11-25).
--
-- From alpha.21 a person's grant link also asks for accounts whose credential
-- is a password, and for destinations the person owns. Two facts follow that
-- no table holds, and both are managed-only, because `person` and
-- `person_link` are (ADR-0036): rows of their own here, never a column on the
-- shared chain's `connection` (hard rule 5). The appliance has no links and
-- no such tables; `no-managed-leakage.unit.test.ts` names both.
--
-- ## The tries (D5 (a))
--
-- Five refused logins lock that account's card on that link (0174 §5.5, D4:
-- only the server refusing the login counts). Kept in the database, not in
-- process memory, because a restart or a second replica must not hand out
-- five more tries at somebody's password. One row per link and account; the
-- account is the card's `ref`, a hash, never the address. The route counts
-- with `UPDATE … SET refused = refused + 1 … RETURNING`, so two tabs racing
-- cannot get a sixth try. A new link starts at zero: that is the owner's
-- remedy. Deleting the link (with its person) deletes its tries.
--
-- ## Whose destination (D1 (a))
--
-- A password a person types for their OWN destination is merged into that
-- connection's encrypted credentials, as Cirrux Drive's grant already is, and
-- this row says which person granted it. One person per connection, because
-- the connection is the key: the doors refuse to point anybody else's
-- migration at it (0174 T5), and the rotation door refuses to replace the
-- password (D6). Deleting the connection or the person deletes the row; the
-- link it came through is history, so deleting that link only forgets which.
--
-- ## Row security
--
-- The tenant policies are NULL-safe from birth, as 0004 recorded: every
-- permissive policy is evaluated, and `''::uuid` raises. The tries table also
-- carries `link_sees_itself`'s twin, as `person_link` does (0034): a read
-- under `app.current_link` finds exactly the presented link's rows, compared
-- as text so an unset setting matches nothing. A granted connection's row
-- must name a connection and a person of the organisation it is written in,
-- as `person_migration`'s policy holds its migration (0031).
--
-- ## The erasure
--
-- Both join `PURGED_TABLES`, before `person_link`, `person` and `connection`,
-- so the receipt counts them; the purge's role, `ownpace_system` (0033), is
-- granted what 0035 granted for `person_link` and nothing more.
--
-- Personal data: none. A hash, counts and times; ids.

CREATE TABLE public.person_link_try (
    link_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    -- The card's ref (`person-grant-subject.ts`): a hash, never the address.
    account_ref text NOT NULL,
    refused integer DEFAULT 0 NOT NULL,
    last_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    CONSTRAINT person_link_try_pkey PRIMARY KEY (link_id, account_ref),
    CONSTRAINT person_link_try_refused_check CHECK ((refused >= 0)),
    CONSTRAINT person_link_try_link_fkey FOREIGN KEY (link_id) REFERENCES public.person_link(id) ON DELETE CASCADE,
    CONSTRAINT person_link_try_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE
);

CREATE INDEX person_link_try_tenant_idx ON public.person_link_try USING btree (tenant_id);

ALTER TABLE public.person_link_try ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.person_link_try FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.person_link_try FOR SELECT USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_insert ON public.person_link_try FOR INSERT WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_update ON public.person_link_try FOR UPDATE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_delete ON public.person_link_try FOR DELETE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The verification read's twin (0034): exactly the presented link's tries.
CREATE POLICY link_sees_itself ON public.person_link_try
  FOR SELECT USING (link_id::text = current_setting('app.current_link'::text, true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_link_try TO app_user;
GRANT SELECT (tenant_id), DELETE ON TABLE public.person_link_try TO ownpace_system;

COMMENT ON TABLE public.person_link_try IS
  'Refused password logins per account on a person''s grant link (ADR-0035; workplan 0174 §5.5, D4, D5): five lock that account on that link. Keyed by the card''s ref, a hash, never the address; never the password. Managed-only, because person_link is. Purged on erasure.';

CREATE TABLE public.person_granted_connection (
    connection_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    person_id uuid NOT NULL,
    -- The link the password came through; forgotten when that link goes.
    link_id uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_granted_connection_pkey PRIMARY KEY (connection_id),
    CONSTRAINT person_granted_connection_connection_fkey FOREIGN KEY (connection_id) REFERENCES public.connection(id) ON DELETE CASCADE,
    CONSTRAINT person_granted_connection_person_fkey FOREIGN KEY (person_id, tenant_id)
      REFERENCES public.person(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT person_granted_connection_link_fkey FOREIGN KEY (link_id) REFERENCES public.person_link(id) ON DELETE SET NULL
);

CREATE INDEX person_granted_connection_person_idx ON public.person_granted_connection USING btree (person_id);
CREATE INDEX person_granted_connection_tenant_idx ON public.person_granted_connection USING btree (tenant_id);
CREATE INDEX person_granted_connection_link_idx ON public.person_granted_connection USING btree (link_id);

ALTER TABLE public.person_granted_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.person_granted_connection FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.person_granted_connection FOR SELECT USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
-- A row names a connection of the organisation it is written in, as
-- `person_migration`'s policy holds its migration (0031); the person's half
-- is its key.
CREATE POLICY tenant_isolation_insert ON public.person_granted_connection FOR INSERT WITH CHECK (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
    AND EXISTS (
      SELECT 1 FROM public.connection c
       WHERE c.id = person_granted_connection.connection_id
         AND c.tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
    )
);
CREATE POLICY tenant_isolation_update ON public.person_granted_connection FOR UPDATE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid)) WITH CHECK (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
    AND EXISTS (
      SELECT 1 FROM public.connection c
       WHERE c.id = person_granted_connection.connection_id
         AND c.tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
    )
);
CREATE POLICY tenant_isolation_delete ON public.person_granted_connection FOR DELETE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_granted_connection TO app_user;
GRANT SELECT (tenant_id), DELETE ON TABLE public.person_granted_connection TO ownpace_system;

COMMENT ON TABLE public.person_granted_connection IS
  'Which person connected a destination with their own password through a grant link (ADR-0035; workplan 0174 §4.3, D1 (a)): that account receives only their migrations, and its password is theirs to change (D6). One person per connection. Managed-only, because person is. Purged on erasure.';
