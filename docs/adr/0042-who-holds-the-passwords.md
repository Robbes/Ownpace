# ADR-0042: Who holds the passwords — an issuer we can replace

- **Status:** Accepted
- **Date:** 2026-08-22
- **Deciders:** Owner, 2026-08-22 — accepted with a condition: *confirm* the issuer is
  replaceable rather than assert it. See "The condition, and what it found".

## Operative rules

- **The managed edition authenticates against an external OIDC issuer.** Ownpace stores
  no passwords, and there is no password column in either migration chain. The
  appliance is unaffected: it has one owner and no accounts (hard rule 5).
- **The issuer owns identity; `tenant_member` owns tenancy.** A token carries `sub`
  and `email` and nothing Ownpace-specific. Which tenant a session acts on, and with
  what role, is read from `tenant_member` at request time — never trusted from a claim.
- **Because of that rule, the issuer is REPLACEABLE**, and the integration must stay
  inside plain OIDC discovery + authorization-code + PKCE + JWKS. No issuer-specific
  API, no issuer-side tenancy model, no issuer-side roles. This is what makes the
  choice below reversible, and it is the point of the ADR. **Enforced**, not
  remembered: `apps/api/src/middleware/no-issuer-lock-in.unit.test.ts` scans the
  shipped source of `apps/` and `packages/` and fails on a provider name or endpoint
  path; `issuer-is-replaceable.unit.test.ts` drives the real verification path with
  both providers' discovery documents.
- **Every endpoint is DISCOVERED, never composed** — on both sides of the wire.
  `getJWKS` reads `jwks_uri` from the issuer's `/.well-known/openid-configuration`,
  and the browser reads `authorization_endpoint` and `token_endpoint` from the same
  document (`apps/web/src/services/oidc.ts`). Both refuse a document whose `issuer`
  does not match the configured one (OIDC Discovery §4.3). `JWT_JWKS_URI` exists as an
  escape hatch and is not the normal path.
- **The browser client is PUBLIC and holds no secret.** The web app is a single-page
  app, so a confidential client would mean shipping a secret to every visitor. The code
  exchange is proven by a PKCE verifier (S256) that never leaves the tab that minted it.
- **Zitadel is the accepted issuer**, self-hosted beside the managed stack against the
  Postgres it already runs. Pinned by version; upgrades are deliberate, never automatic.
  Switching is four environment variables and a rebuild — `JWT_ISSUER`, `JWT_AUDIENCE`,
  `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID` — which was the owner's condition for
  accepting it.
- **The appliance never gains an issuer dependency**, enforced by
  `apps/selfhost/src/no-managed-leakage.unit.test.ts`.

### Amended 2026-08-25 — `sub` is the identity, email is a label

Three questions arrived at once (a second sign-in method, changing your login
address, and whether the seed-token box still has a job), and all three turn on
one rule that was implied by the operative rules above and never written down.

- **`tenant_member.user_id` IS the token's `sub`.** `lookupMemberships` filters
  on it; `resolveTenant` refuses when it finds nothing. Email appears nowhere in
  that lookup.
- **A flow that PRESERVES `sub` is safe. A flow that mints a NEW `sub` orphans
  the membership** — the person is still a member of an organisation their new
  subject cannot reach, and the API answers 403 on every route.
- So **changing somebody's email inside their existing account is safe by
  construction**, and **a second account for the same person is the failure**.
  This is the whole content of "configure account linking": not a preference,
  a correctness requirement, and it has to be decided before a second sign-in
  method is offered rather than after.
- **A second method must never become the only method on an account.** Removing
  the last remaining one strands the subject, and for somebody whose reason for
  using this product is to leave a platform, making that platform the key to
  their account is a dependency rebuilt in a new place.
- **Federation belongs in the issuer, never in the app.** "Login with Google" as
  app code is exactly what the third operative rule forbids, and
  `no-issuer-lock-in.unit.test.ts` rejects it. Upstream providers are configured
  in the issuer, which keeps `iss` ours, keeps `sub` ours, and keeps the
  integration inside plain OIDC — which is the property that makes any of this
  reversible.

Nothing in this amendment is built. It records the decision the three tasks in
`docs/workplans/0102-who-your-account-is.md` depend on.

## Context

Workplan 0092 T4 established what the path from stranger to signed-in customer actually
was: the site's only call to action was a `mailto:`, the owner ran `seed-managed.sh` on
the reference box, and a JWT valid for seven days was emailed back to be pasted into a
textarea (`apps/web/src/pages/Login.tsx`). Workplan 0093 replaced the front half — a
request form, a route, a table. This ADR is about the back half: what a granted request
becomes.

**The server side is further along than it looks.** `apps/api/src/middleware/auth.ts`
already verifies against a remote JWKS with `jose`, honours `iss`/`aud`/`exp`, and
prefers that path over the symmetric `JWT_SECRET` when `JWT_ISSUER` is set (`:215`).
`tenant_member` keys on a **`text` `user_id`** — an external subject — with roles,
invite status and `invited_at` already modelled. There is no password column anywhere,
and that is the design rather than a gap.

**What has never been decided is which issuer.** `docs/architecture/solution-architecture.md`
names Zitadel in §7.3's edition table and again in §18, but no ADR has ever decided it,
`docs/adr/README.md` has no identity row, and nothing in `deploy/` mentions Zitadel or
Keycloak. So this is a decision plus an installation, and hard rule 7 says the decision
needs an ADR.

### The finding that reframed the question

The obvious framing — "we are multi-tenant, so we need a multi-tenant IdP" — is what
every comparison article concludes, and **it is wrong here**, because Ownpace already
owns tenancy and enforces it in Postgres.

`assertRequiredClaims` demands `sub`, `email`, `tenantId` and `role`. But eleven lines
into the same file's `authenticate`:

```ts
const membership = await membershipLookup(payload.tenantId, payload.sub);
if (!membership) { /* 403 */ }
role = membership.role;                       // auth.ts:339
```

**The token's `role` claim is overwritten by the database on every single request.** It
is already dead weight. And `tenantId` is not an assertion about the user either — it is
"which tenant is this session acting on", which `tenant_member` can answer from `sub`,
with a picker only for somebody who belongs to more than one.

So the issuer needs to mint `sub` and `email`. Both are standard OIDC. Nothing else.

That collapses the decision. We are not shopping for organisations, projects, policies
or role mappings — we have those, in tables, under RLS, with a guard. We are shopping for
the **least trouble that is a real OIDC issuer with a login page**, which is exactly the
owner's stated criteria: open source, low management effort, stable, scales far enough,
fits the product.

### What was actually required

1. OIDC discovery, authorization-code + PKCE, a JWKS endpoint. (The API already
   consumes exactly this.)
2. **A hosted login UI.** We are not building password reset, MFA enrolment and lockout
   screens.
3. Invite-based user creation, to match invite-only (workplan 0093 T0).
4. Tens to low thousands of users. Not CIAM at millions.
5. One owner-operator, and a compose stack that is already large.
6. EU/sovereign, because moving people off US cloud is the product's whole thesis. A
   US-controlled identity layer in the middle of that is a contradiction a customer can
   point at.

## Decision

**Zitadel, self-hosted, pinned — and integrated only through standard OIDC so that the
choice can be undone.**

The second half is load-bearing and is the actual decision. Zitadel is the best fit on
the evidence below, but the evidence against it is real, and the way to hold both is to
make it a component rather than a foundation: `JWT_ISSUER` + `JWT_AUDIENCE` on the API,
authorization-code + PKCE in the web app, and nothing else. No Zitadel organisations, no
Zitadel projects, no Zitadel roles, no Zitadel management API in our code.

**The claim surface shrinks with it** (implementation, workplan 0093 T5/T6):
`assertRequiredClaims` should require `sub` and `email` only; `tenantId` resolves from
`tenant_member`, and `role` already does. That is a change worth making regardless of
issuer — it removes a claim the code ignores and a claim the code duplicates.

## The condition, and what it found

The owner accepted this ADR on the condition that the replaceability claim be
**confirmed rather than asserted**. Confirming it found that, as written, it was
false — and that the chosen provider would not have worked either.

`getJWKS` composed the key-set URL by string concatenation:

```ts
`${jwtIssuer}/.well-known/jwks.json`
```

with a comment naming Auth0 and Clerk and adding "for other issuers, they should
provide the JWKS endpoint". That path is those two providers' convention. It is not
a standard, and it matches **neither** provider this ADR considered:

| | `jwks_uri` |
|---|---|
| Zitadel | `{domain}/oauth/v2/keys` |
| Keycloak | `{host}/realms/{realm}/protocol/openid-connect/certs` |

So the managed authentication path worked with two providers nobody had chosen, and
would have failed on first contact with the one that was — with a message about
fetching keys, at the end of a deployment, which is the worst place to learn it.

**The fix is the standard the guess was standing in for.** Every compliant provider
publishes `/.well-known/openid-configuration` with `jwks_uri` in it. Asking removes
the last piece of provider knowledge from the codebase, which is what turns "the
issuer is replaceable" from an intention into a property. Switching provider is now
`JWT_ISSUER` and `JWT_AUDIENCE`, and two tests fail if that stops being true.

One protection came with it: the discovery document's `issuer` must equal the
configured one. Without that check, anything able to answer at the discovery URL — a
hijacked DNS record, a misconfigured proxy — points verification at a key set it
controls, and every token it mints then verifies. That is a 500 rather than a 401,
deliberately: it is our configuration being wrong or attacked, and no caller's token
can fix it.

## Consequences

**Positive.** Ownpace stores no credentials, so it cannot leak them, and password reset,
MFA and lockout are somebody else's tested code. Swiss jurisdiction avoids US CLOUD Act
exposure, which is on-message for a product selling exactly that. One Go binary against
the Postgres already in the stack: ~256 MB idle, and Postgres 14–18 covers the 16 we run.
And because the integration is standard OIDC, a customer who wants their own IdP later is
a configuration change, not a project.

**Negative, and this is the honest part.** Self-hosted Zitadel has documented operational
churn: the Login UI was split into its own service in v2/v3, v1 API surfaces were
deprecated while people were still integrating, configuration behaviour is "easy to get
wrong and hard to diagnose" (init-time environment handling, `BASEURI` path gotchas), and
an upgrade replays out-of-date projections, which takes time proportional to the event
log. More than one independent write-up calls self-hosting it brittle for multi-tenant
production use. **We buy that risk down three ways**: we use none of the surface that
churned (we do not use its tenancy or its management API); we pin the version and upgrade
deliberately, reading the technical advisories; and the exit is cheap by construction.

**The core is AGPL-3.0** as of v3 (2025-03-31); the proto definitions, APIs and SDKs stay
Apache-2.0. Running it unmodified as a separate network service alongside an Apache-2.0
codebase creates no obligation on our code — we neither modify it nor link it, and the
SDK surface we would touch is Apache anyway. Worth stating rather than discovering: **if
we ever patch Zitadel, that patch is AGPL and must be published.** ADR-0001 (Apache-2.0)
and ADR-0039 (no open-core) are unaffected.

**Neutral.** One more service in `deploy/compose/managed.yml`, one more thing to back up
(it is a schema in the existing Postgres), and a second place where a person exists —
mitigated by `tenant_member` staying the authority on what they may do.

## Alternatives considered

**Keycloak.** Genuinely Apache-2.0, the most mature option, and the largest ecosystem —
the "boring" choice, which usually wins on a low-management-effort criterion. Two things
outweighed it. Its documented base is **1250 MB of RAM plus ~300 MB non-heap**, which is
more than the rest of the managed stack put together and lands on a box already running
Stalwart, Postgres, Trigger.dev and ClickHouse. And it is Red Hat/IBM — US-governed —
which is a strange thing to put at the centre of a product whose pitch is leaving US
cloud. Kept as the named fallback: it is what we move to if Zitadel's churn proves worse
than the mitigation, and because we use only standard OIDC, that move is a config change
plus a user migration.

**Authentik.** MIT, the most polished admin UI, and a real proxy/forward-auth mode we
have no use for. Rejected on operations, which is the criterion that mattered: it is
Python across a server, a worker and Redis in addition to the database — four moving
parts where Zitadel is one — and its majors carry breaking changes with a mandatory
database backup and no supported downgrade. US-based.

**Ory (Hydra + Kratos).** Apache-2.0 and German, which fits the thesis best of all.
Rejected because Hydra is an OAuth2 server and Kratos is an identity API, and **neither
ships a login UI** — you build the screens. That is precisely the work this ADR exists to
avoid, and it would be two services rather than one.

**Logto.** MPL-2.0, developer-first, good UI, built-in multi-tenancy we do not need.
A reasonable second choice; it lost to Zitadel on jurisdiction and on Zitadel reusing our
existing Postgres, and there was no operational advantage large enough to overcome that.

**Authelia.** Apache-2.0, tiny, YAML-configured. **Disqualified on capability, not
preference**: it is a forward-auth product whose OIDC provider is a bolt-on, and we need
a real issuer minting real tokens for a real SPA.

**Build it ourselves — passwords in `tenant_member`.** Genuinely the lowest number of
services, and the reason it is refused is not effort. Owning credential storage means
owning hashing choices, reset flows, enumeration resistance, MFA, lockout, session
revocation and breach response — permanently, as a two-person team, for a product sold on
being a safer place for someone's mail. Every one of those is a place to be quietly wrong.
`tenant_member.user_id` being `text` rather than a foreign key is the existing schema
already assuming this answer.

**Do nothing yet — build 0093's T6/T7 against the symmetric `JWT_SECRET`.** Tempting,
and rejected for one reason: `POST /api/tenants` answers 501 because tenant creation
cannot run on a tenant-scoped connection, so T6 needs a privileged path either way, and
that path has to decide what a user IS before it can create one. Deciding that twice is
the expensive way.
