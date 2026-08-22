-- Somewhere for a stranger to ask (workplan 0093 T1).
--
-- Until now the whole path from visitor to customer was: the website's only
-- call to action is a `mailto:`, a human reads the email, the owner runs
-- `seed-managed.sh` on the reference box, and a JWT that expires in seven days
-- is emailed back to be pasted into a textarea. This table is the first step of
-- replacing that with something the service itself can carry — invite-only
-- (owner decision, 2026-08-22), so a request is a REQUEST and provisioning is
-- still the owner's act.
--
-- ## Why it has no tenant_id, and what stands in for RLS
--
-- Every other table in both chains is tenant-scoped, and `tenant_isolation_*`
-- is how they are protected. A request PRECEDES a tenant — that is the whole
-- point of it — so there is no tenant to scope it to and no policy of that
-- shape to write. The protection has to be a different one, and leaving RLS
-- off is not it: `app_user` would then read every request from any
-- tenant-scoped request thread.
--
-- So: RLS on, and exactly ONE policy, for INSERT. Anyone may knock; nobody
-- holding a tenant token may read what anybody else wrote, because there is no
-- SELECT policy for the row to satisfy. The privileged provisioning path
-- connects as the DB OWNER, which RLS does not apply to, and that asymmetry is
-- the access rule rather than a loophole — it is the same one that makes
-- `POST /api/tenants` answer 501 today (a tenant cannot be created from a
-- tenant-scoped connection, so creating one is necessarily privileged).
--
-- The GRANTs are spelled out rather than left to the shared chain's
-- `ALTER DEFAULT PRIVILEGES … GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES`,
-- which would otherwise hand `app_user` SELECT on this table by default. Belt
-- and braces on purpose: the policy alone would be enough, and a reader
-- checking whether tenant-scoped code can read access requests should not have
-- to know that.
--
-- ## What it deliberately does not hold
--
-- No credentials, no mailbox names, no provider tokens (hard rule 3, §17).
-- What a person types into a public form is contact details and a sentence
-- about what they want to move. `note` is capped by the route, not here, so
-- that a cap can change without a migration.
--
-- Ordering: this chain runs AFTER the shared one, so `public.tenant` exists —
-- which is what lets `tenant_id` below reference it once a request is granted.

CREATE TABLE public.access_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    -- Everything else a person may leave out. A form that demands a company
    -- name from a family moving one mailbox is asking the wrong question.
    name text,
    organisation text,
    -- What they said they are moving, in their own words. Read by a human.
    note text,
    -- The tier they think they need (ADR-0014's five), or null. Indicative:
    -- the tier is DERIVED from what actually runs, never picked (ADR-0014).
    tier text,
    -- 'nl' or 'en' — which language the page was in when they wrote. The reply
    -- should be in the language they asked in (ADR-0013).
    locale text DEFAULT 'en' NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    -- Set when the request is granted: the tenant that was provisioned for it.
    -- Null in every other state, which the CHECK below pins.
    tenant_id uuid,
    decided_by text,
    decided_at timestamp with time zone,
    /* Why it was declined, or a note about the grant. Read by a human. */
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_request_pkey PRIMARY KEY (id),
    CONSTRAINT access_request_tenant_fkey FOREIGN KEY (tenant_id)
        REFERENCES public.tenant(id) ON DELETE SET NULL,
    CONSTRAINT access_request_state_check
        CHECK ((state = ANY (ARRAY['open'::text, 'granted'::text, 'declined'::text]))),
    -- An open request has no decision on it; a settled one says whose and when.
    CONSTRAINT access_request_decided_check
        CHECK (((state = 'open'::text) = (decided_at IS NULL))),
    -- A tenant is the RESULT of granting: a granted request names the tenant it
    -- provisioned, and one that was never granted cannot name one. Both halves,
    -- as an equivalence — written first as
    -- `state = 'granted' OR tenant_id IS NULL`, which is satisfied by ANY
    -- granted row and so allowed exactly the lie it was meant to forbid.
    CONSTRAINT access_request_granted_tenant_check
        CHECK (((state = 'granted'::text) = (tenant_id IS NOT NULL))),
    CONSTRAINT access_request_locale_check
        CHECK ((locale = ANY (ARRAY['en'::text, 'nl'::text])))
);

-- The owner's queue is "what is still open, oldest first".
CREATE INDEX ix_access_request_open
  ON public.access_request (created_at) WHERE (state = 'open');

-- Not UNIQUE on email: somebody who asked a year ago may ask again, and a
-- second request from the same address is information rather than an error.
CREATE INDEX ix_access_request_email ON public.access_request (email);

ALTER TABLE public.access_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.access_request FORCE ROW LEVEL SECURITY;

-- The only policy there is. Knocking is allowed; reading is not.
CREATE POLICY anyone_may_ask ON public.access_request FOR INSERT WITH CHECK (true);

GRANT INSERT ON TABLE public.access_request TO app_user;
REVOKE SELECT, UPDATE, DELETE ON TABLE public.access_request FROM app_user;
