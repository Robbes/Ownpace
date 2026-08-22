-- Who may let somebody in (workplan 0093 T6).
--
-- ## The gap
--
-- Migration 0002 gave strangers a door to knock on and deliberately gave nobody
-- the ability to answer: `app_user` has no SELECT on `access_request` at all, so
-- the requests pile up where only a DB-owner connection can read them. Its own
-- comment says the privileged path "connects as the DB OWNER, which RLS does not
-- apply to". That was the right call while nothing needed to answer.
--
-- It is the wrong call for a screen. Putting an owner-credentialed pool inside
-- the API is exactly what workplan 0011 T1 removed — after it, one bug in one
-- route bypasses every policy in the product. So the privilege goes in the
-- DATABASE instead, as a row and two policies, and the API keeps connecting as
-- `app_user` with RLS in force. Nothing gains owner credentials.
--
-- ## What an operator is
--
-- Not a tenant role. `tenant_member.role` answers "what may you do INSIDE this
-- organisation", and every policy that reads it keys on a tenant. An operator
-- acts BEFORE any tenant exists — that is the whole job — so the question it
-- answers is a different one and gets its own table rather than a magic value
-- in an existing column.
--
-- Deliberately no `tenant_id`, no role levels, and no self-service: a row here
-- is written by the owner connection (`pnpm --filter @openmig/api operator:add`)
-- and by nothing else. `app_user` is granted SELECT and nothing more, so an
-- operator cannot appoint another operator through the API. That is not a
-- feature that was skipped; it is the boundary.
--
-- ## Why you can only see YOUR OWN row
--
-- The policy below is `user_id = app.current_user`, so `app_user` reading this
-- table sees at most one row — its own. The `EXISTS` in the `access_request`
-- policies is therefore both the authorisation check AND the whole of what a
-- caller can learn: "am I an operator", never "who else is". A list of the
-- people who can provision accounts is a list of who to phish.
--
-- The comparison is TEXT, with no cast, which is what makes it safe when
-- `app.current_user` has decayed to the empty string on a pooled connection
-- (migration 0004): `user_id = ''` is false, never true, and never an error.
-- `guc-decay-under-rls.unit.test.ts` covers that direction too.

CREATE TABLE public.platform_operator (
    -- The OIDC subject, same identifier `tenant_member.user_id` holds. An
    -- operator gets theirs by signing in once and reading `GET /api/me`; there
    -- is no way to know it before they have signed in, and inventing one (an
    -- email-keyed row bound on first use) would mean anybody who can create an
    -- account with that address becomes an operator.
    user_id text NOT NULL,
    -- For the human running `operator:list`. Not an identity — the subject is.
    email text NOT NULL,
    -- Why this person. Read by whoever inherits the deployment.
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_operator_pkey PRIMARY KEY (user_id)
);

ALTER TABLE public.platform_operator ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.platform_operator FORCE ROW LEVEL SECURITY;

CREATE POLICY own_operator_row ON public.platform_operator
  FOR SELECT USING (user_id = current_setting('app.current_user'::text, true));

-- SELECT only, and spelled out rather than left to the chain's default
-- privileges, for the same belt-and-braces reason migration 0002 gives.
GRANT SELECT ON TABLE public.platform_operator TO app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_operator FROM app_user;

-- ---------------------------------------------------------------------------
-- Answering the door
-- ---------------------------------------------------------------------------
--
-- SELECT and UPDATE, never DELETE and never INSERT-by-an-operator. A request is
-- a record of somebody asking: it is decided, not erased, and `anyone_may_ask`
-- stays the only way a row is born. An operator who could delete could make a
-- refusal disappear, and the point of the queue is that it cannot.

GRANT SELECT, UPDATE ON TABLE public.access_request TO app_user;

CREATE POLICY operator_may_read ON public.access_request
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    )
  );

CREATE POLICY operator_may_decide ON public.access_request
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    )
  );
