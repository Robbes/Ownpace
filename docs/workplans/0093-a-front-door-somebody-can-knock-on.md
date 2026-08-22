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
| T5 An issuer, and a sign-in that is not a paste box | 🔬 **Researched 2026-08-22 — [ADR-0042](../adr/0042-who-holds-the-passwords.md) proposed, awaiting the owner** | The owner asked for research rather than defaulting to the arch doc's Zitadel mention. Six candidates weighed on the stated criteria; the finding that reframed it is that `auth.ts:339` already overwrites the token's `role` from `tenant_member`, so the issuer needs `sub` and `email` and nothing else — which means we are not shopping for a multi-tenant IdP at all. Proposal: Zitadel, pinned, integrated through standard OIDC ONLY so the choice is reversible; Keycloak named as the fallback that move lands on. |
| T6 A privileged provisioning path | 📋 Planned (needs T5) | Granting a request means creating a `tenant` + an owner `tenant_member`, which cannot happen on a tenant-scoped connection — `POST /api/tenants` answers **501** saying exactly that. |
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

### What T5 becomes once the owner decides

Zitadel in `deploy/compose/managed.yml` against the existing Postgres; `JWT_ISSUER` and
`JWT_AUDIENCE` on the API; authorization-code + PKCE in `apps/web` replacing the paste
box; and `assertRequiredClaims` narrowed to `sub` + `email`, which is worth doing
whichever issuer wins — it drops a claim the code ignores and a claim the code already
duplicates.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22).

`pnpm test:integration` ran for the first time on **PR #494**, and found T2b —
a real bug in the shipped limit, not a broken test. That is what the PR was for.
The database half of T1 was already proven locally: `access-request-under-rls.unit.test.ts`
applies both migration chains under PGlite and serves as `app_user`, which is
the role that matters.
