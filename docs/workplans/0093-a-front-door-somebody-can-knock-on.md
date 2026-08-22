# Workplan 0093 — a front door somebody can knock on

## Status — 2026-08-22 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Self-service or invite-only (owner) | ✅ **Decided 2026-08-22: invite-only** | Asking is part of the service; granting stays the owner's own act. Self-service needs a Mollie checkout in front of everything below and gains nothing the first customers need. |
| T1 Somewhere for a stranger to ask | ✅ **Done 2026-08-22** | `packages/managed/migrations/0002_a_door_somebody_can_knock_on.sql` — `access_request`, the one table in either chain with no `tenant_id` on the way in. 5 cases in `packages/managed/src/access-request-under-rls.unit.test.ts`, served as `app_user`, the role the API really runs as. |
| T2 The route anybody can reach | ✅ **Done 2026-08-22** | `POST /api/access-requests`, unauthenticated like `/health` and `/metrics` and unlike them a WRITE. `apps/api/src/knock-limit.ts` (6 unit tests) + `access-requests.integration.test.ts` (5 cases, **not run** — no docker here). |
| T3 A page to ask on | ✅ **Done 2026-08-22** | `apps/web/src/pages/RequestAccess.tsx` at `/request-access`, public and managed-only, EN + NL. 8 tests, including that a blank optional field travels as ABSENT rather than `''`, and that a `?tier=` nobody offers is ignored. |
| T4 The site's button leads there | ✅ **Done 2026-08-22** | `site/build.mjs` — every call-to-action button now links to the app; the footer's support address stays a support address. 2 guards in `site/site.unit.test.ts`, both shown to fail on revert. |
| T5 An issuer, and a sign-in that is not a paste box | 📋 Planned (**owner decision**) | The arch doc names **Zitadel** (§7.3, §18) and no ADR has ever decided it. Nothing in `deploy/` mentions it. This is where the next session starts. |
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
3. A refusing per-IP rate limit. **Not** `RateBudget`, whose `acquire` waits
   rather than refuses — right for a provider quota, exactly wrong for an abuse
   gate, where waiting is a queue of attackers holding request threads open. Not
   `express-rate-limit` either: a new runtime dependency for twenty lines on a
   service whose real protection is the ingress. `knock-limit.ts` says all of
   this, including that it is per-process and therefore N times looser with N
   replicas.
4. **The response is identical whatever happens** — new address, known address,
   already granted. Anything else is an account-enumeration oracle. It is also
   the honest answer: from the asker's side all three genuinely are "we have it,
   a human will read it".

## T5 — the decision the next session needs

**The server half of real sign-in already exists.** `apps/api/src/middleware/auth.ts`
verifies against a remote JWKS with `jose`, honours `iss`/`aud`/`exp`, and takes
precedence over the symmetric `JWT_SECRET` when `JWT_ISSUER` is set.
`tenant_member` keys on a **`text` `user_id`** — an external subject — with roles,
invite status and `invited_at` already modelled. There is no password column
anywhere in the schema, and that is the design, not a gap: identity belongs to an
IdP.

**What has never been decided is which one.** The arch doc names Zitadel in §7.3's
edition table ("IdP/SSO (Zitadel)") and again in §18, but there is no ADR — and
`docs/adr/README.md` has no identity row at all. Nothing in `deploy/` mentions
Zitadel or Keycloak. So T5 is not "install the decided thing", it is a decision
plus an installation, and per hard rule 7 the decision needs an ADR.

Three things it has to answer, and only the first is about the product:

- **Which issuer**, and self-hosted beside the stack or managed. Both named
  options are EU and Apache/AGPL; the cost is operational, not licensing.
- **What happens on first sign-in of a granted request.** `tenant_member` already
  carries the shape: a row with `status: 'invited'` and
  `userId: 'pending:<uuid>'`, waiting for a real subject. Nothing today converts
  it — `members.ts` creates such rows and no code path ever accepts one. That
  acceptance is T6's real content, and it is missing for the second person in a
  tenant too, not just the first.
- **Whether the appliance is touched at all.** It should not be. It has one owner
  and no accounts, by design (hard rule 5), and `/request-access` is already
  `ManagedOnly`.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22).

`pnpm test:integration` NOT run: no docker daemon in this sandbox
(`dial unix /var/run/docker.sock`). `access-requests.integration.test.ts` is new
and entirely unrun; it needs a Testcontainers run before T2 is called proven end
to end. The database half of T1 IS proven — `access-request-under-rls.unit.test.ts`
applies both migration chains under PGlite and serves as `app_user`.
