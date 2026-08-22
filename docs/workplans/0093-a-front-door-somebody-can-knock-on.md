# Workplan 0093 — a front door somebody can knock on

## Status — 2026-08-22 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Self-service or invite-only (owner) | ✅ **Decided 2026-08-22: invite-only** | Asking is part of the service; granting stays the owner's own act. Self-service needs a Mollie checkout in front of everything below and gains nothing the first customers need. |
| T1 Somewhere for a stranger to ask | ✅ **Done 2026-08-22** | `packages/managed/migrations/0002_a_door_somebody_can_knock_on.sql` — `access_request`, the one table in either chain with no `tenant_id` on the way in. 5 cases in `packages/managed/src/access-request-under-rls.unit.test.ts`, served as `app_user`, the role the API really runs as. |
| T2 The route anybody can reach | ✅ **Done 2026-08-22** | `POST /api/access-requests`, unauthenticated like `/health` and `/metrics` and unlike them a WRITE. `apps/api/src/knock-limit.ts` (6 unit tests) + `access-requests.integration.test.ts` (5 cases, **not run** — no docker here). |
| T3 A page to ask on | ✅ **Done 2026-08-22** | `apps/web/src/pages/RequestAccess.tsx` at `/request-access`, public and managed-only, EN + NL. 8 tests, including that a blank optional field travels as ABSENT rather than `''`, and that a `?tier=` nobody offers is ignored. |
| T4 The site's button leads there | ✅ **Done 2026-08-22** | `site/build.mjs` — every call-to-action button now links to the app; the footer's support address stays a support address. 2 guards in `site/site.unit.test.ts`, both shown to fail on revert. |
| T2b The limit that would have refused the sixth customer | ✅ **Done 2026-08-22** | CI's first run of `access-requests.integration.test.ts` failed with `expected 429 to be 400` — the suite's own sixth request. The cause was not the test: `DEFAULT_KNOCK_LIMIT.max` was 5/hour keyed on `req.ip`, which behind an ingress is the ingress, so it was **five access requests per hour for the entire service**. Raised to 60 and sized as a service-wide cap, made configurable (`ACCESS_REQUEST_MAX_PER_HOUR`, refusing a bad value rather than falling back), and `TRUST_PROXY` added so the limiter *can* be per-caller. The 429 now has its own integration file — nothing had tested it, which is why this surfaced as two confusing failures instead of one clear one. |
| T5 An issuer, and a sign-in that is not a paste box | ✅ **Done 2026-08-22 — [ADR-0042](../adr/0042-who-holds-the-passwords.md) accepted by the owner**, on the condition that switching stays cheap; T5b and T5c below are the two halves | The owner asked for research rather than defaulting to the arch doc's Zitadel mention. Six candidates weighed on the stated criteria; the finding that reframed it is that `auth.ts:339` already overwrites the token's `role` from `tenant_member`, so the issuer needs `sub` and `email` and nothing else — which means we are not shopping for a multi-tenant IdP at all. Proposal: Zitadel, pinned, integrated through standard OIDC ONLY so the choice is reversible; Keycloak named as the fallback that move lands on. |
| T5b The claim surface, narrowed | ✅ **Done 2026-08-22** | ADR-0042's second operative rule, implemented. `assertRequiredClaims` is `sub` + `email`; `tenantId` and `role` are optional and read only where an issuer still mints them. Tenant resolution: an explicit `X-Ownpace-Tenant` header, else the claim, else the subject's single membership — and a **refusal** when several are possible, naming the choices. Migration 0003 adds the one SELECT policy that lets a subject read their own memberships; `withSubject` sets `app.current_user` for it. `GET /api/me` answers "where may I go". 6 + 9 + 2 cases; the policy test fails four ways on an over-broad policy. |
| T5c The browser half — a button, not a paste box | ✅ **Done 2026-08-22** | `apps/web/src/services/oidc.ts` — authorization-code + PKCE (S256), **no library and no provider's URL shapes**: every endpoint read from the issuer's discovery document, which is what keeps ADR-0042's replaceability true on this side of the wire too. `/auth/callback` exchanges the code, then `GET /api/me` says which organisation — a token is not a session. The paste box stays for deployments with no issuer yet, but folds behind a disclosure and under its own label once there is one. 19 + 5 + 7 cases; `GET /api/me` gains the 7-case integration file it was missing. |
| T6 A privileged provisioning path | 📋 Planned — **unblocked**, T5 is done | Granting a request means creating a `tenant` + an owner `tenant_member`, which cannot happen on a tenant-scoped connection — `POST /api/tenants` answers **501** saying exactly that. |
| T7 The owner's queue | 📋 Planned (needs T6) | Reading `access_request` and deciding on it. Deliberately last: a queue you cannot act on is a list. |

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

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22): 307 files, 3452 tests.

`pnpm test:integration` ran for the first time on **PR #494**, and found T2b —
a real bug in the shipped limit, not a broken test. That is what the PR was for.
The database half of T1 was already proven locally: `access-request-under-rls.unit.test.ts`
applies both migration chains under PGlite and serves as `app_user`, which is
the role that matters.
