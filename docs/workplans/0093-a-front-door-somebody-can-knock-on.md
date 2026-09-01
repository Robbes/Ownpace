# Workplan 0093 — a front door somebody can knock on

## Status — 2026-09-01 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Self-service or invite-only (owner) | ✅ **Decided 2026-08-22: invite-only** | Asking is part of the service; granting stays the owner's own act. Self-service needs a Mollie checkout in front of everything below and gains nothing the first customers need. |
| T1 Somewhere for a stranger to ask | ✅ **Done 2026-08-22** | `packages/managed/migrations/0002_a_door_somebody_can_knock_on.sql` — `access_request`, the one table in either chain with no `tenant_id` on the way in. 5 cases in `packages/managed/src/access-request-under-rls.unit.test.ts`, served as `app_user`, the role the API really runs as. |
| T2 The route anybody can reach | ✅ **Done 2026-08-22** | `POST /api/access-requests`, unauthenticated like `/health` and `/metrics` and unlike them a WRITE. `apps/api/src/knock-limit.ts` (6 unit tests) + `access-requests.integration.test.ts` (5 cases, **not run** — no docker here). |
| T3 A page to ask on | ✅ **Done 2026-08-22** | `apps/web/src/pages/RequestAccess.tsx` at `/request-access`, public and managed-only, EN + NL. 8 tests, including that a blank optional field travels as ABSENT rather than `''`, and that a `?tier=` nobody offers is ignored. |
| T4 The site's button leads there | ✅ **Done 2026-08-22** | `site/build.mjs` — every call-to-action button now links to the app; the footer's support address stays a support address. 2 guards in `site/site.unit.test.ts`, both shown to fail on revert. |
| T2b The limit that would have refused the sixth customer | ✅ **Done 2026-08-22** | CI's first run of `access-requests.integration.test.ts` failed with `expected 429 to be 400` — the suite's own sixth request. The cause was not the test: `DEFAULT_KNOCK_LIMIT.max` was 5/hour keyed on `req.ip`, which behind an ingress is the ingress, so it was **five access requests per hour for the entire service**. Raised to 60 and sized as a service-wide cap, made configurable (`ACCESS_REQUEST_MAX_PER_HOUR`, refusing a bad value rather than falling back), and `TRUST_PROXY` added so the limiter *can* be per-caller. The 429 now has its own integration file — nothing had tested it, which is why this surfaced as two confusing failures instead of one clear one. |
| T2c The limit is sized for the door it is behind | 🕓 **Deferred, owner 2026-09-01** — do it WITH the self-service change, not after | Sixty an hour service-wide is right while granting is an operator's act: every knock is a row a person reads, so the rate a person can keep up with is the right rate. Self-service ends that premise and the number goes up, sized to what the infrastructure supports. **Raising it alone is the wrong half**: the key is `req.ip`, which behind an ingress is the ingress, so a bigger GLOBAL cap is one runaway script away from refusing every real signup — the 5/hour defect of T2b further along. Set `TRUST_PROXY` so the bucket is per caller, THEN raise `ACCESS_REQUEST_MAX_PER_HOUR` against the relay's send rate and the ingress's own limits. Pinned in `apps/api/src/knock-limit.unit.test.ts`: the set of unauthenticated WRITE routes is asserted, so a self-service signup appearing goes red naming the file, and the note is read at the moment it matters rather than remembered. |
| T5 An issuer, and a sign-in that is not a paste box | ✅ **Done 2026-08-22 — [ADR-0042](../adr/0042-who-holds-the-passwords.md) accepted by the owner**, on the condition that switching stays cheap; T5b and T5c below are the two halves | The owner asked for research rather than defaulting to the arch doc's Zitadel mention. Six candidates weighed on the stated criteria; the finding that reframed it is that `auth.ts:339` already overwrites the token's `role` from `tenant_member`, so the issuer needs `sub` and `email` and nothing else — which means we are not shopping for a multi-tenant IdP at all. Proposal: Zitadel, pinned, integrated through standard OIDC ONLY so the choice is reversible; Keycloak named as the fallback that move lands on. |
| T5b The claim surface, narrowed | ✅ **Done 2026-08-22** | ADR-0042's second operative rule, implemented. `assertRequiredClaims` is `sub` + `email`; `tenantId` and `role` are optional and read only where an issuer still mints them. Tenant resolution: an explicit `X-Ownpace-Tenant` header, else the claim, else the subject's single membership — and a **refusal** when several are possible, naming the choices. Migration 0003 adds the one SELECT policy that lets a subject read their own memberships; `withSubject` sets `app.current_user` for it. `GET /api/me` answers "where may I go". 6 + 9 + 2 cases; the policy test fails four ways on an over-broad policy. |
| T5c The browser half — a button, not a paste box | ✅ **Done 2026-08-22** | `apps/web/src/services/oidc.ts` — authorization-code + PKCE (S256), **no library and no provider's URL shapes**: every endpoint read from the issuer's discovery document, which is what keeps ADR-0042's replaceability true on this side of the wire too. `/auth/callback` exchanges the code, then `GET /api/me` says which organisation — a token is not a session. The paste box stays for deployments with no issuer yet, but folds behind a disclosure and under its own label once there is one. 19 + 5 + 7 cases; `GET /api/me` gains the 7-case integration file it was missing. |
| T5d The 500 that only a served request could find | ✅ **Done 2026-08-22** | CI's first real `GET /api/me` returned **500** five times out of seven: `invalid input syntax for type uuid: ""`. Not a broken test — a broken policy. `SET LOCAL` reverts to the SESSION value, which for a setting never assigned at session level is the EMPTY STRING, so from the second transaction on a pooled connection `current_setting('app.current_tenant', true)` is `''` and `''::uuid` RAISES. Permissive policies are OR'd and all are evaluated, so a subject-scoped read of `tenant_member` ran the tenant policies too and the query failed. Migration `0004` makes those four policies `NULLIF(…, '')`-safe; `guc-decay-under-rls.unit.test.ts` reproduces the decay and fails four ways without it. |
| T6 A privileged provisioning path | ✅ **Done 2026-08-22** | And the 501's stated reason turned out to be **wrong**: scoping to the id you are about to mint satisfies `tenant_isolation_insert` exactly, so `app_user` can create a tenant with no privileged connection at all (probed, not assumed). What genuinely is privileged is READING the queue — `access_request` refuses `app_user` at the GRANT level. So the privilege went into the database as `platform_operator` + policies (migration 0005), not into the API as an owner-credentialed pool. `GET /api/access-requests`, `POST /:id/grant`, `POST /:id/decline`, behind `authenticateSubject` because an operator has no tenant. Granting writes a tenant, an owner **invitation**, and the settled request in one transaction. 12 + 8 RLS cases, 9 integration. |
| T6b An invitation you can actually accept | ✅ **Done 2026-08-22** | A gap that predates T6: `members.ts` has written `status='invited'` rows with a `pending:` placeholder since workplan 0039, its comment promising the id "is replaced with the real user id on acceptance" — and **nothing ever replaced it**. `authenticate` matches `status='active'` only, so every invitation ever written was unusable. Migration 0006 adds the two policies that let a person claim one, bounded by `app.current_email` (set only when the issuer asserted `email_verified`) on the way in and by "must become active and name this subject" on the way out. |
| T7 The owner's queue, on a screen | ✅ **Done 2026-08-22** | `apps/web/src/pages/AccessRequests.tsx` at `/access-requests`, managed-only, EN + NL. Waiting / granted / declined, each request in the asker's own words, grant with an editable organisation name, decline behind a confirm. The prerequisite is fixed: `/api/me` moved to `authenticateSubject` and now REPORTS resolution instead of refusing — 403-for-no-membership was making the product unusable for the one person meant to grant everybody else's access. 6 screen cases + 7 callback cases; 2 `/api/me` integration cases rewritten. |

## Why this exists

Workplan 0092 T4 established what the path from stranger to signed-in customer
actually was, and it was six steps of which three were the owner's inbox: the
site's only call to action was a `mailto:`, the owner ran `seed-managed.sh` on
the reference box, and a JWT valid for seven days was emailed back to be pasted
into a textarea. The owner chose invite-only on 2026-08-22, which keeps the
shape — a person decides who gets in — and moves the asking into the service.

T1–T4 are that first half, built. What is left (T5–T7) is the half that turns a
granted request into somebody who can sign in, and it forks on a decision that
has never been written down.

## Three constraints that shaped this, none of them obvious

### The form cannot live on the website

`deploy/compose/www-nginx.conf` serves the site with:

```
Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline';
                         base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`form-action 'none'` forbids every submission and `default-src 'none'` leaves no
`connect-src`, so a `fetch` is out too — and the site ships no JavaScript at all.
That CSP is not an accident to route around; it is what makes the site a
*document*. A form there would need it relaxed on every page.

So the site's button became a LINK to `app.<env>.ownpace.eu/request-access`, and
the form lives in the app — which already has JavaScript, an API client and form
plumbing, and where the request page belongs anyway: it and `/login` are the same
front door, one for people who have an account and one for people who do not.

`site.unit.test.ts` now guards both halves — that the button reaches the app, and
that no `<form>` ever appears in a built page, because that CSP refuses the
submission *silently*, with nothing logged anywhere the owner reads.

### `access_request` cannot be protected the way everything else is

Every other table in both chains is tenant-scoped and protected by
`tenant_isolation_*`. A request PRECEDES a tenant — that is what the row is — so
there is no tenant to scope it to and no policy of that shape to write. Leaving
RLS off is not an option either: `app_user` would then read every request from
any tenant-scoped request thread.

What stands in for it: **RLS on, exactly one policy, for INSERT**, plus an
explicit `REVOKE SELECT, UPDATE, DELETE … FROM app_user` because the shared
chain's `ALTER DEFAULT PRIVILEGES … GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES`
would otherwise hand it over by default. Anyone may knock; nobody holding a
tenant token can read what anybody else wrote. The privileged path connects as
the DB owner, which RLS does not apply to — the same asymmetry that makes
`POST /api/tenants` answer 501 today.

Writing the test found that the two protections are not redundant, and which one
fires: the REVOKE bites first, so a tenant-scoped read gets
`permission denied for table access_request` rather than an empty result. That is
the better failure and it is what the test asserts — an empty result is
indistinguishable from "there are no requests", so a day when both protections
had been dropped would look exactly like a quiet day.

### A public write needs four things, not one

`/health`, `/version` and `/metrics` are already unauthenticated, and the
reasoning for each is written down. This is the first unauthenticated route that
WRITES, which is the whole of the difference:

1. The database grants `INSERT` and nothing else (above).
2. Every field is length-capped in the route, before the insert. Otherwise a
   public form is a free 100kb-per-request writeable store — `express.json()`'s
   default limit being the only other ceiling.
3. A refusing rate limit. **Not** `RateBudget`, whose `acquire` waits rather
   than refuses — right for a provider quota, exactly wrong for an abuse gate,
   where waiting is a queue of attackers holding request threads open. Not
   `express-rate-limit` either: a new runtime dependency for twenty lines on a
   service whose real protection is the ingress.

   **Sized as a service-wide cap, and that took a CI failure to get right.** The
   key is `req.ip`, which without `trust proxy` is the INGRESS's address — so
   one bucket serves everybody. The first version said five an hour, reasoning
   that "too strict is the safe direction to be wrong in". It is not: five an
   hour across the whole service refuses the sixth real person that hour, and
   no log line would say so. Sixty still bounds a runaway to ~1,400 rows a day,
   which is the actual job. `TRUST_PROXY` now exists so a deployment that knows
   its ingress gets true per-caller limiting, because the old comment promised
   that and gave no way to do it.
4. **The response is identical whatever happens** — new address, known address,
   already granted. Anything else is an account-enumeration oracle. It is also
   the honest answer: from the asker's side all three genuinely are "we have it,
   a human will read it".

## T5 — researched, and the question turned out to be a different one

The owner asked (2026-08-22) for research rather than taking the arch doc's Zitadel
mention as decided: open source, low management effort, stable, scales far enough, fits
the product. [ADR-0042](../adr/0042-who-holds-the-passwords.md) is the result and is
**Proposed**, not Accepted — the decision is the owner's.

**The server half already exists.** `apps/api/src/middleware/auth.ts` verifies against a
remote JWKS with `jose`, honours `iss`/`aud`/`exp`, and prefers that over the symmetric
`JWT_SECRET` when `JWT_ISSUER` is set. `tenant_member` keys on a `text` `user_id` — an
external subject — with roles and invite status modelled. No password column anywhere,
which is the design.

**What has never been decided is which issuer.** The arch doc names Zitadel in §7.3 and
§18; there is no ADR, no row in the register, and nothing in `deploy/` mentions it.

### The finding that changed the answer

Every comparison article concludes "multi-tenant product, therefore multi-tenant IdP".
That is wrong here, and the code says so. `assertRequiredClaims` demands `sub`, `email`,
`tenantId` and `role` — and eleven lines later:

```ts
role = membership.role;                       // auth.ts:339
```

**The token's `role` is overwritten from `tenant_member` on every request.** It is
already dead weight. `tenantId` is not a fact about the user either — it is which tenant
the session is acting on, which `tenant_member` can answer from `sub`.

So the issuer must mint `sub` and `email`, both standard OIDC, and nothing else. We are
not shopping for organisations, projects or role mappings — we have those, in tables,
under RLS. We are shopping for the least trouble that is a real OIDC issuer with a login
page, which is exactly what the owner asked for.

It also means **the issuer is replaceable**, and ADR-0042 makes keeping it that way an
operative rule rather than a hope: standard OIDC only, no issuer-side tenancy, no
issuer-specific API in our code.

### What was weighed

| | License | Origin | Shape | Why it did or did not win |
|---|---|---|---|---|
| **Zitadel** | AGPL-3.0 core since v3; APIs/SDKs Apache-2.0 | 🇨🇭 | One Go binary + Postgres, ~256 MB idle | **Proposed.** Reuses the Postgres we run; Swiss jurisdiction is on-message. Against it: documented self-hosting churn — Login UI split into its own service, v1 API deprecations, config "easy to get wrong and hard to diagnose", projection replay on upgrade. Bought down by using none of the surface that churned, pinning, and a cheap exit. |
| **Keycloak** | Apache-2.0 | 🇺🇸 IBM | Java/Quarkus | **The named fallback.** Most mature, genuinely Apache — but a documented 1250 MB base plus ~300 MB non-heap is more than the rest of the managed stack together, and US governance sits badly in a product about leaving US cloud. |
| **Authentik** | MIT | 🇺🇸 | Python: server + worker + Redis + DB | Four moving parts to Zitadel's one; majors carry breaking changes with a mandatory backup and no supported downgrade. |
| **Ory** (Hydra+Kratos) | Apache-2.0 | 🇩🇪 | Two Go services | Best jurisdiction fit, and **neither ships a login UI** — you build the screens, which is the work this exists to avoid. |
| **Logto** | MPL-2.0 | — | Node + Postgres | Reasonable second; lost on jurisdiction with no operational advantage to offset it. |
| **Authelia** | Apache-2.0 | — | Go, YAML | **Disqualified on capability**: a forward-auth product whose OIDC provider is a bolt-on. |
| *Roll our own* | — | — | none | Fewest services, and refused on principle rather than effort: hashing, resets, enumeration, MFA, lockout, revocation and breach response, permanently, for a product sold as a safer place for someone's mail. |

### What was built

Zitadel in `deploy/compose/managed.yml` against the existing Postgres, provisioned by
`setup-zitadel.sh`; `JWT_ISSUER` / `JWT_AUDIENCE` on the API; the claim surface
narrowed; and — T5c — the browser half, so the paste box is no longer the way in.

### The browser half, and the two things it does not do

It uses **no OIDC library**. The flow is ~120 lines of `crypto.subtle` and `fetch`,
and the alternative is a package in the bundle on the path that authenticates people.
It also hard-codes **no endpoint**: `authorization_endpoint` and `token_endpoint` come
from the issuer's own discovery document, exactly as the API reads `jwks_uri` from it.
`no-issuer-lock-in.unit.test.ts` already scans `apps/web/src`, so a convenient
`/oauth/v2/authorize` fails the build rather than quietly pinning the product.

The client is **public** — no secret. This is a single-page app; a confidential client
would mean shipping a secret to every visitor, which is not a secret. What proves the
exchange instead is a verifier only that tab ever held, kept in `sessionStorage` rather
than `localStorage` because it is good for one exchange and a value that outlives the
flow can be replayed against a later one.

Three things are refusals rather than retries, and each has a test that fails on
removal: a **state mismatch** (without it somebody can hand a victim a callback URL
carrying the attacker's code, and the victim ends up signed in as them), a discovery
document **declaring a different issuer**, and a **second exchange of the same code** —
StrictMode double-mounts every effect, an authorization code is single-use, and the
second attempt would draw a failure over a sign-in that actually worked.

**`import.meta.env` is not shared between modules.** Vitest gives each file its own,
so a test cannot set what another module reads — which is why the config is an argument
with the build's value as its default, and the environment read is one pure function.
That is the same conclusion `edition.ts` reached from the other direction.

### Narrowing the claims turned out to need a policy

`assertRequiredClaims` is `sub` + `email` now. `role` was pure ceremony — `auth.ts`
overwrites it from `tenant_member` eleven lines after reading it. `tenantId` was the
real work, because it is not a fact about the user at all: it is which tenant the
session acts on.

Resolving it from the database ran straight into the isolation model. Every policy on
`tenant_member` is `tenant_id = current_setting('app.current_tenant')`, so reading the
table requires already knowing the tenant — and the question is precisely which tenant.
A request carrying only a subject sees no rows and cannot find out.

Two obvious answers were both wrong. **Connecting as the owner** for that one lookup
bypasses RLS entirely, and the API may not even have owner credentials — `getDbPool`
prefers `APP_DATABASE_URL`, because workplan 0011 T1 put the request path on `app_user`
so RLS is always in force. **Putting the tenant back in the token** is the thing
ADR-0042 decided against, and `auth.ts` already shows why it would be theatre.

So: one more SELECT policy (migration 0003), matching `user_id` against a new
`app.current_user` that `withSubject` sets. Policies are permissive and OR'd, so it
ADDS "my own memberships, in any tenant" and takes nothing away — and because
`current_setting(…, true)` answers NULL when unset, `user_id = NULL` is never true and
an ordinary tenant-scoped request sees exactly what it saw before. That last property
is the one worth a test rather than an argument, and it has one.

**`withSubject` is not a lighter `withTenant`.** It sets no tenant, so every other
table's policies still refuse it — and they refuse rather than return empty, because
they cast the setting to `uuid` and a GUC that has been `SET LOCAL` earlier in the
session lingers as an empty string. That is written down where a reader will hit it.

### The refusal is the interesting rule

A subject in two organisations, with no explicit choice, is the one case that cannot
be guessed. Taking the first would silently serve somebody the wrong organisation's
mail, and there is no error afterwards — it just looks like their data. So it refuses
with 400 (they are allowed in; they have not said where) and **names the choices**,
because a client that must ask a person which organisation needs the list.

`GET /api/me` is the other half: the one route that works before a tenant is known.

It is also the one the refusal has to carry, because `authenticate` refuses *before*
the route runs — so `/api/me` cannot be what tells a client its options, and the 400
body has to. `me.integration.test.ts` pins exactly that, along with the role coming
from the database on a token that claims a different one.

### What the integration test found on its first run — T5d

Five of its seven cases returned **500**. The route was right; the policy was wrong,
and the reason is worth keeping because the intuition that hides it is so natural.

`SET LOCAL` "reverts at COMMIT" — to the SESSION value. For a custom setting never
assigned at session level, that value is the **empty string**, not unset. So
`current_setting('app.current_tenant', true)` answers `''` from the second
transaction on a pooled connection onwards, and `''::uuid` is not a mismatch, it is
an **error**. Raised inside a policy, it fails the query, which is a 500.

That only bites where a table is read with no tenant set — and migration 0003 had
just created the first such table. Permissive policies are OR'd and Postgres
evaluates all of them, so the subject-scoped read ran the four tenant policies too.

**The sibling unit test could not have caught it.** `own-membership-under-rls.unit.test.ts`
runs on a PGlite connection that has never held a tenant, where the setting really is
NULL and `NULL::uuid` is fine. The decay needs one earlier tenant-scoped transaction
on the same connection — which every served request does and no unit test did. That
gap is now closed by `guc-decay-under-rls.unit.test.ts`, whose every case begins by
serving one tenant-scoped request; without that line they all pass against the broken
policies, which is exactly how this reached CI.

Migration `0004` wraps the cast in `NULLIF(…, '')` **on `tenant_member` only**. The
other 116 tenant policies guard tables reached only through `withTenant`, which always
sets a real uuid, so the empty string cannot reach their cast — and rewriting 116
security predicates to fix a condition that cannot arise is the kind of churn where
one typo silently opens a table. The rule that replaces the churn: *a table reachable
under `withSubject` must have NULL-safe tenant policies*, written down in `withSubject`
itself, where the next person will be standing when it matters.

`set_config('app.current_tenant', NULL, true)` was the other candidate fix and does
not work — it leaves the setting as `''` as well. That is asserted, so nobody has to
re-derive it.

## T6 — the privilege was not where the comments said it was

`POST /api/tenants` has answered 501 with a confident explanation: RLS "requires
the new row's id to equal `app.current_tenant`, which a freshly-created tenant
never satisfies". Migration 0002 repeats it, and concludes that provisioning must
therefore run as the DB owner.

**It is not true.** `tenant_isolation_insert` is `WITH CHECK (id =
current_setting('app.current_tenant')::uuid)` — so scoping to the id you are
*about to mint* satisfies it exactly. Probed under PGlite as `app_user` before
any of this was designed: the tenant and its first member both inserted, no
privileged connection anywhere.

What genuinely is privileged is the other half. `access_request` refuses
`app_user` at the GRANT level — `permission denied for table`, before RLS is even
consulted — because 0002 revoked SELECT deliberately. So the privileged thing was
never provisioning; it was **reading the queue and deciding**.

That inverted the design. The obvious build — an owner-credentialed pool inside
the API — would have put back exactly what workplan 0011 T1 removed, and for a
product whose pitch is custody, "one bug in one route bypasses every policy" is
the wrong trade. Instead the privilege is a row and four policies:

| | |
|---|---|
| `platform_operator` | who may answer the door. No tenant, no role levels, no self-service |
| `own_operator_row` | you can see YOUR row and no other — the check answers "am I one", never "who is" |
| `operator_may_read` / `operator_may_decide` | `access_request` becomes visible and decidable to a subject named in that table |

`app_user` gets SELECT on `platform_operator` and nothing else, so an operator
cannot appoint another one — that stays the owner's own act, over the owner
connection, through `pnpm --filter @openmig/api operator:add`. Asserted, not
just intended: the RLS suite tries the INSERT and the DELETE and gets
`permission denied` for both.

**No DELETE on `access_request` for anybody, operator included.** A request is
decided, never erased. An operator who could delete could make a refusal
disappear, and the queue's whole value as a record is that it cannot.

### Granting is three writes or none

A tenant, an owner row, and the request marked granted against that tenant id.
Split across transactions, a failure between them leaves either an organisation
nobody asked for or a request pointing at one that does not exist — so
`withSubjectAndTenant` holds both scopes for the one transaction that does all
three. The tenant it is scoped to is the one being CREATED, which is what makes
holding both unremarkable: the tenant is empty, so the tenant half of the scope
grants sight of nothing.

Said plainly rather than left for a reader: that only an operator may *read or
decide* a request is enforced by the database. That only an operator may *create
a tenant* is not — `tenant_isolation_insert` asks only that the id match the
scope. It is guarded because provisioning only ever happens inside deciding,
which is guarded. A caller that got past that would mint an EMPTY organisation
owning nothing that was anybody else's.

### What CI found, twice

The integration suite is the only place these run — no Docker in the sandbox —
and its first two runs each produced something real.

**One: an assertion that counted the wrong thing.** `expected 8 to be 1`, from
`SELECT count(*) FROM tenant` after granting. That counts every tenant every
other integration file created, not the one this grant made. The 409 assertion
above it passed, so the route was right throughout. It now asks the property
that was meant — the request still points at the organisation the first grant
provisioned.

That failure also exposed something that had not fired yet: this file's
`beforeEach` ran a blanket `DELETE FROM access_request`, and integration files
run in PARALLEL (only the `ui` project sets `fileParallelism: false`). It was
deleting rows out from under two sibling files mid-assertion, and they were
doing the same back. It passed by luck. The rate-limit file had already set the
convention — `WHERE email LIKE 'flood-%'` — so every row this file writes now
carries a `t6-` marker and every cleanup is scoped to it.

**Two: the foreign key and the check constraint were saying different things.**
`access_request.tenant_id` was `ON DELETE SET NULL`, and the row also has
`CHECK ((state = 'granted') = (tenant_id IS NOT NULL))`. Deleting a tenant a
granted request points at tries to null the column and lands on exactly the
state the CHECK forbids — so it fails, with a message naming a constraint on a
column nobody touched in a table nobody mentioned.

The database was right to refuse; the schema was wrong about why. Migration 0007
makes it `ON DELETE RESTRICT`, which is the actual intent: the queue is a
RECORD, and a request that was granted was granted — deleting the organisation
later does not unmake that. Relaxing the CHECK instead would allow a row reading
`granted` while naming nothing, which is the one thing migration 0002 went out
of its way to forbid.

The rule that falls out, worth stating because nothing in the product does this:
**decide what to do with the requests before deleting a tenant.** Non-destructive
by default (ADR-0024) means the product never deletes one; this is for an
operator clearing up by hand, and for tests, where the fix is to delete the
requests first.

## T6b — the invitation nobody could accept

Granting writes an owner row for a person who has never signed in. They have no
subject, and there is no way to know one before they do; keying the row on their
email instead would mean whoever registers that address inherits the
organisation.

`members.ts` has had the answer since workplan 0039 — `status='invited'` with a
`pending:<uuid>` placeholder, and a comment saying the placeholder "is replaced
with the real user id on acceptance."

**Nothing ever replaced it.** `authenticate` matches `status='active'` only, so
every invitation this product has ever written was a row its holder could not
use. That was invisible because nothing downstream of an invitation was tested.

Migration 0006 closes it with two policies, and NEITHER HALF IS ENOUGH ALONE:

- `see_own_invitation` + the `USING` half — the row must be an open invitation
  addressed to `app.current_email`, which `withSubject` sets only when the caller
  passed a verified address, and `auth.ts` passes one only when the issuer
  asserted `email_verified: true`. An issuer that does not assert it gets no
  claim rather than a trusting one.
- The `WITH CHECK` half — what the row becomes must be active and name THIS
  subject. Without it a claimant could rewrite a row they were allowed to touch
  into somebody else's membership.

The SELECT policy is not decoration. An `UPDATE` whose `WHERE` reads the row has
SELECT policies applied too, so without it the claim matched nothing and silently
no-opped — which is what the test caught, and why the happy path is asserted as
loudly as the refusals.

`auth.ts` attempts the claim at exactly one moment: when tenant resolution is
about to refuse with 403. That is the state a person is in on their first sign-in
after being granted, and nowhere else. A 400 (several memberships, none chosen)
does not trigger it — that request is already answerable.

## T7 — the screen, and the refusal that had to become an answer

`/api/me` used `authenticate`, and inherited its refusals: no membership → 403,
several → 400. Both are right for a tenant-scoped route and wrong for the one
route asked from OUTSIDE the boundary, because "nowhere yet" and "two, and you
have not said which" are ANSWERS to the question it exists to ask.

It also made the product unusable for a **platform operator**, who belongs to no
organisation by design — the web app could not hold a session for the one person
meant to grant everybody else's access. So the route moved to
`authenticateSubject`: same verification, same JWKS path, same 401s, no tenant
required. **Every other route keeps `authenticate` and keeps refusing** — the
400 and its list still exist wherever a tenant is genuinely required.

The response gained `operator`, which decides whether the nav offers the queue.
It is a hint and never a permission: the queue is guarded by policies on
`access_request`, so a client that got it wrong shows or hides a link and is
told nothing either way. The route is deliberately NOT gated in the router for
the same reason — a second, weaker copy of a rule the database already enforces
is the copy that rots.

Sign-in now lands somebody in one of three places, and the two that are not the
dashboard are the point: an operator goes to the queue; somebody in no
organisation and not an operator is TOLD SO, rather than being sent to a
dashboard whose first request 403s. That second case is a real state — waiting
on a grant, or holding an invitation that did not bind because the issuer never
verified their address — and the version of it that says nothing is the version
that becomes a support ticket.

The screen says two things out loud rather than implying them: granting creates
the organisation but the person becomes its owner **on first sign-in**, not on
click; and **no email goes out**, because the product does not send invitations
(the same sentence `Tenants.tsx` already has to say about inviting a member).
Somebody still has to tell them.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22): 307 files, 3452 tests.

`pnpm test:integration` ran for the first time on **PR #494**, and found T2b —
a real bug in the shipped limit, not a broken test. That is what the PR was for.
The database half of T1 was already proven locally: `access-request-under-rls.unit.test.ts`
applies both migration chains under PGlite and serves as `app_user`, which is
the role that matters.
