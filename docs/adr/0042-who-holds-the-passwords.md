# ADR-0042: Who holds the passwords — an issuer we can replace

- **Status:** Accepted 2026-08-22, on the owner's condition; amended four times (latest
  2026-09-01); consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-08-22; consolidated 2026-10-03
- **Deciders:** Owner, 2026-08-22 — accepted with a condition: *confirm* the issuer is
  replaceable rather than assert it (*Decision* 4)
- **Relates to:** [workplan 0093](../workplans/0093-a-front-door-somebody-can-knock-on.md) T5
  (where it was built), [workplan 0102](../workplans/0102-who-your-account-is.md) (who your
  account is)
- **History:** the record as it read before consolidation, word for word —
  [history/0042-who-holds-the-passwords.md](./history/0042-who-holds-the-passwords.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **The managed edition authenticates against an external OIDC issuer; Ownpace stores no
  passwords** (no password column in either migration chain). **The appliance never gains an
  issuer dependency**: one owner, no accounts (hard rule 5),
  `apps/selfhost/src/no-managed-leakage.unit.test.ts`.
- **The issuer owns identity; `tenant_member` owns tenancy.** A token carries `sub` and `email`
  and nothing Ownpace-specific; tenant and role are read from `tenant_member` per request, never
  trusted from a claim: `apps/api/src/middleware/tenant-resolution.unit.test.ts`.
- **The issuer is REPLACEABLE**: the integration must stay inside plain OIDC discovery +
  authorization-code + PKCE + JWKS. No issuer-specific API, no issuer-side tenancy model, no
  issuer-side roles. Guards: `apps/api/src/middleware/no-issuer-lock-in.unit.test.ts`,
  `issuer-is-replaceable.unit.test.ts`.
- **`tenant_member.user_id` IS the token's `sub`; email is a label.** A new `sub` orphans the
  membership, so account linking is decided before a second sign-in method is offered, and none
  may become an account's only one. **Federation belongs in the issuer, never in the app**:
  `scripts/a-second-door-with-the-linking-decided.unit.test.ts` (*Decision* 3).
- **Every endpoint is DISCOVERED, never composed**: `jwks_uri` by the API; `authorization_endpoint`,
  `token_endpoint` and `end_session_endpoint` by the browser, a **PUBLIC client holding no
  secret**, whose PKCE verifier (S256) never leaves the tab that minted it. A document naming
  another `issuer` is refused (OIDC Discovery §4.3); `JWT_JWKS_URI` is an escape hatch:
  `issuer-is-replaceable.unit.test.ts`, `apps/web/src/services/oidc.unit.test.ts`.
- **Zitadel is the accepted issuer**, self-hosted on the managed Postgres. Pinned by version;
  upgrades are deliberate, never automatic (`scripts/a-pin-that-knows-it-is-behind.unit.test.ts`).
  Switching is four variables and a rebuild: `JWT_ISSUER`, `JWT_AUDIENCE`, `VITE_OIDC_ISSUER`,
  `VITE_OIDC_CLIENT_ID` (`scripts/idp-wiring.unit.test.ts`).
- **Signing out ends the ISSUER'S session, not only this tab's**: RP-Initiated Logout through the
  discovered `end_session_endpoint`, with `id_token_hint` and the registered
  `post_logout_redirect_uri`. The local half happens first and unconditionally:
  `apps/web/src/components/SignOut.tsx`, `oidc.unit.test.ts`.
- **The answer to a question you asked is not an invitation** (owner, 2026-09-01): a granted
  access request (`tenant_member.origin` `requested`, managed migration 0021) binds on the first
  sign-in with a VERIFIED address; an invitation (`invited`, the default) still asks:
  `apps/api/src/routes/access-requests-operator.integration.test.ts`.

## Context

Workplan 0092 T4 found that the path from stranger to signed-in customer ended with the owner
running `seed-managed.sh` and emailing a JWT, valid for seven days, to be pasted into a textarea
(`apps/web/src/pages/Login.tsx`). Workplan 0093 replaced the front half with a request form, a
route and a table. This ADR is the back half: what a granted request becomes, and who holds the
credentials of the person it lets in. The API already verified tokens against a remote JWKS with
`jose` whenever `JWT_ISSUER` was set, and `tenant_member` already keyed on a `text` `user_id`, an
external subject; which issuer had never been decided.

**The finding that framed the choice.** "We are multi-tenant, so we need a multi-tenant IdP" is
the usual conclusion, and it is wrong here: Ownpace already owns tenancy and enforces it in
Postgres. The token's `role` claim was overwritten from `tenant_member` on every request, and
`tenantId` is not a fact about the user but which tenant a session acts on, which `tenant_member`
answers from `sub`. So the issuer has to mint `sub` and `email` — standard OIDC — and nothing
else. What was wanted was the least trouble that is a real OIDC issuer with a login page, on the
owner's criteria (open source, low management effort, stable, scales far enough, fits the
product): discovery, authorization-code + PKCE and JWKS; a hosted login UI, so reset, MFA
enrolment and lockout screens are not ours to build; invite-based user creation (workplan 0093
T0); tens to low thousands of users; one owner-operator and an already large compose stack; and EU
jurisdiction, because a US-controlled identity layer in a product about leaving US cloud is a
contradiction a customer can point at.

## Decision

**Zitadel, self-hosted and pinned — integrated only through standard OIDC, so that the choice
can be undone.** The second half is the decision: the issuer is a component, not a foundation.

### 1. Ownpace holds no passwords

The managed edition authenticates against an external OIDC issuer. There is no password column
in either migration chain, and that is the design rather than a gap. The appliance has one owner
and no accounts (hard rule 5) and never gains an issuer dependency
(`apps/selfhost/src/no-managed-leakage.unit.test.ts`).

### 2. The issuer owns identity; `tenant_member` owns tenancy

A token carries `sub` and `email` and nothing Ownpace-specific. The API requires exactly those
two claims (`verifyManagedToken` in `apps/api/src/middleware/auth.ts`) — `email` because an
invitation is addressed to one and a first sign-in has no row to look it up in. Which tenant a
request acts on is resolved per request by `resolveTenant`: a tenant named by a header or a claim
is only a candidate, a subject with several memberships is refused with the choices, and the role
always comes from the `tenant_member` row (`tenant-resolution.unit.test.ts`).

### 3. `sub` is the identity; email is a label

`tenant_member.user_id` IS the token's `sub`: `lookupMemberships` filters on it, `resolveTenant`
refuses when it finds nothing, and email appears nowhere in that lookup. A flow that preserves
`sub` is safe; a flow that mints a new `sub` orphans the membership, and every route answers 403
to a member of an organisation their new subject cannot reach. So:

- **Changing an address inside an account is safe by construction**, and the label follows:
  `GET /api/me` reconciles `tenant_member.email` to the verified claim on rows that already carry
  the subject (`a-label-that-follows-the-claim.unit.test.ts`).
- **A second account for the same person is the failure**, so account linking is a correctness
  requirement, decided before a second sign-in method is offered: a prompt on a verified email
  match, never a silent merge (owner, 2026-08-25; workplan 0102 T2).
- **A second method never becomes an account's only one**: removing the last other method strands
  the subject, and for somebody leaving a platform, making that platform the key to their account
  rebuilds the dependency somewhere new.
- **Federation belongs in the issuer, never in the app.** Upstream providers are configured in
  the issuer by `deploy/compose/setup-zitadel.sh`, which keeps `iss` ours, `sub` ours, and the
  integration inside plain OIDC.

### 4. The issuer is replaceable — confirmed, not asserted

The integration stays inside plain OIDC discovery + authorization-code + PKCE + JWKS: no
issuer-specific API, no issuer-side tenancy model, no issuer-side roles. That is what makes the
choice reversible. `no-issuer-lock-in.unit.test.ts` scans the shipped source of `apps/api/src`,
`apps/web/src` and `packages` and fails on a provider's name or endpoint path;
`issuer-is-replaceable.unit.test.ts` drives the real verification path with Zitadel's and
Keycloak's discovery documents. Switching provider is four environment variables and a rebuild:
`JWT_ISSUER` and `JWT_AUDIENCE` for the API, `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID` for the
web build.

The owner accepted on the condition that this be confirmed, and confirming it found it false:
`getJWKS` composed `${jwtIssuer}/.well-known/jwks.json`, an Auth0/Clerk convention matching
neither Zitadel's key set (`{domain}/oauth/v2/keys`) nor Keycloak's
(`{host}/realms/{realm}/protocol/openid-connect/certs`). So **every endpoint is discovered, never
composed**: the API reads `jwks_uri` from `/.well-known/openid-configuration`, and the browser
reads `authorization_endpoint`, `token_endpoint` and `end_session_endpoint` from the same document
(`apps/web/src/services/oidc.ts`). Both refuse a document whose `issuer` is not the configured one
(OIDC Discovery §4.3), because anything able to answer at that URL — a hijacked DNS record, a
misconfigured proxy — could otherwise point verification at a key set it controls. The API
answers that with a 500, not a 401: our configuration is wrong or attacked, and no caller's token
can fix it. `JWT_JWKS_URI` skips discovery as an escape hatch, not the normal path: it pins a URL
that key rotation or an upgrade can move.

### 5. A public browser client, proven by PKCE

The web app is a single-page app, so the client is public and holds no secret
(`scripts/idp-wiring.unit.test.ts`). The code exchange is proven by a PKCE verifier (S256) that
never leaves the tab that minted it: verifier and state live in `sessionStorage`, never
`localStorage`, because they are good for one exchange in one tab and a value that outlives the
flow can be replayed against a later one (`oidc.unit.test.ts`).

### 6. Zitadel, self-hosted and pinned

Zitadel runs beside the managed stack on the Postgres it already has, in its own database
(`deploy/compose/managed.yml`). Pinned by version; upgrades are deliberate, never automatic:
Dependabot ignores the image by name, and a weekly watch keeps an issue open while the pin is
behind upstream (`scripts/a-pin-that-knows-it-is-behind.unit.test.ts`). The product uses none of
its organisations, projects, roles or management API; only `deploy/` and the docs name it.

### 7. Signing out ends the issuer's session

Clearing the app's store and `localStorage` leaves the issuer's cookie alive, so the next "Sign
in" completes without a prompt — on a shared or borrowed machine, an account handover. Signing
out (`apps/web/src/components/SignOut.tsx`) therefore also follows the discovered
`end_session_endpoint` with `id_token_hint` and the registered `post_logout_redirect_uri`: plain
RP-Initiated Logout 1.0, no issuer-specific call. The local half happens first and
unconditionally, so an issuer that publishes no such endpoint, or cannot be reached, leaves
somebody signed out here rather than stuck (`oidc.unit.test.ts`).

### 8. The answer to a question you asked is not an invitation

Anybody inside an organisation can add any address to it (`members.ts`), so an invitation is a
question (workplan 0099). A granted access request is another event: the person asked, an
operator said yes, and the organisation was created for them with them as its only owner; asking
again is asking the same question twice (owner, 2026-09-01). `tenant_member.origin` (managed
migration 0021) records which event wrote the row: `requested` binds on the first sign-in with a
VERIFIED address (`claimRequestedMembership`, run by `GET /api/me`), `invited` still asks, and the
default is `invited`, so an unrecorded origin fails towards asking. Migration 0006's policy still
authorises the binding; `origin` narrows it and grants nothing.

## Consequences

- **No credentials are stored here**, so none can leak from here, and password reset, MFA and
  lockout are somebody else's tested code. Swiss jurisdiction avoids US CLOUD Act exposure. One Go
  binary on the stack's PostgreSQL 18, about 256 MB idle. A customer who wants their own IdP later
  is a configuration change, not a project.
- **Zitadel's self-hosting churn is documented**: the Login UI split into its own service in
  v2/v3, v1 API surfaces deprecated, configuration "easy to get wrong and hard to diagnose"
  (init-time environment handling, `BASEURI` path gotchas), upgrades that replay projections for
  a time proportional to the event log; more than one write-up calls it brittle for multi-tenant
  production. Bought down three ways: none of the surface that churned is used, the version is
  pinned and upgraded deliberately against the technical advisories, and the exit is cheap.
- **Its core is AGPL-3.0** since v3 (2025-03-31); its proto definitions, APIs and SDKs stay
  Apache-2.0. Run unmodified as a separate network service, it puts no obligation on our code.
  **If we ever patch Zitadel, that patch is AGPL and must be published.** ADR-0001 and ADR-0039
  are unaffected.
- **One more service** in `deploy/compose/managed.yml`, one more database to back up, and a second
  place where a person exists — mitigated by `tenant_member` staying the authority on what they
  may do.
- **The product never creates an account at the provider.** Granting writes an invitation, so
  self-registration is on and a granted person makes their own account (workplan 0095 T0); a
  password nobody can reset or a lost second factor is handled in the provider's console, linked
  through a deployment variable rather than a composed path (`apps/web/src/services/idp-console.ts`).
- **Built**: both halves on 2026-08-22 (workplan 0093 T5–T5c), the label and the second door on
  2026-08-25 (workplan 0102 T1–T3), sign-out and `tenant_member.origin` on 2026-09-01.

## Alternatives considered

**Keycloak.** Apache-2.0, the most mature, the largest ecosystem: the "boring" choice that usually
wins on low management effort. Outweighed twice: a documented base of **1250 MB of RAM plus ~300
MB non-heap**, more than the rest of the managed stack together on a box already running
Stalwart, Postgres, Trigger.dev and ClickHouse; and Red Hat/IBM, US-governed, at the centre of a
product about leaving US cloud. **Kept as the named fallback**: with only standard OIDC, moving is
a configuration change plus a user migration.

**Authentik.** MIT, the most polished admin UI, a proxy mode we do not need. Rejected on
operations: Python across a server, a worker and Redis besides the database — four moving parts
where Zitadel is one — and majors with breaking changes, a mandatory database backup and no
supported downgrade. US-based.

**Ory (Hydra + Kratos).** Apache-2.0 and German, the best fit for the thesis. Rejected: **neither
ships a login UI**, so we would build the screens this ADR exists to avoid, as two services.

**Logto.** MPL-2.0, developer-first, built-in multi-tenancy we do not need. A reasonable second;
it lost on jurisdiction and on Zitadel reusing our Postgres, with no operational advantage to
overcome that.

**Authelia.** Apache-2.0, tiny, YAML-configured. **Disqualified on capability**: a forward-auth
product with a bolt-on OIDC provider, where we need a real issuer minting tokens for a real SPA.

**Build it ourselves — passwords in `tenant_member`.** The fewest services, refused for a reason
other than effort: owning credential storage means owning hashing, reset flows, enumeration
resistance, MFA, lockout, session revocation and breach response — permanently, as a two-person
team, for a product sold on being a safer place for someone's mail. `tenant_member.user_id` being
`text` rather than a foreign key is the schema already assuming this answer.

**Do nothing yet — build workplan 0093's T6/T7 on the symmetric `JWT_SECRET`.** Rejected:
`POST /api/tenants` answers 501 because tenant creation cannot run on a tenant-scoped connection,
so T6 needed a privileged path anyway, and that path must decide what a user IS before creating
one. Deciding that twice is the expensive way.

**An issuer that owns tenancy and roles** (tenant and role in the token). Rejected: Ownpace already
owns both, in tables under RLS with a guard; the role claim was overwritten from the database on
every request; and teaching every issuer Ownpace's tenancy model is the coupling that would make
it unswappable.

**Composing endpoint URLs from the issuer's address**, as `getJWKS` did until acceptance. Rejected:
a path shape is one provider's convention, not a standard (*Decision* 4).

**A confidential browser client.** Rejected: in a single-page app it means shipping a secret to
every visitor, which is no secret.

**"Login with Google" as application code.** Rejected: provider-specific code in the app is what
the third operative rule forbids. Configured in the issuer instead, `iss` and `sub` stay ours.

**A second sign-in method first, account linking later.** Rejected: whoever uses both doors gets
a new `sub` and is locked out of an organisation they still belong to.

**A platform as an account's only sign-in method.** Rejected: a dependency rebuilt in a new place,
for people whose reason to be here is leaving that platform.

**Binding every invitation on sight.** Rejected by workplan 0099: `members.ts` lets anybody inside
an organisation add any address, so reading your own account would join you to a stranger's
organisation. **Asking a granted requester again** was the opposite mistake: the same question
twice.

**A sign-out that clears only the tab.** Rejected: the issuer's session survives it, and on a
shared or borrowed machine the next person to press "Sign in" is in the account having proved
nothing.

## Amendment log

- **2026-08-22** — Accepted the day it was proposed, on the condition that the issuer's
  replaceability be confirmed rather than asserted (owner). Confirming it found the key-set URL
  composed by string concatenation for two providers nobody had chosen; `getJWKS` now discovers
  it and refuses a document naming another issuer. Record: *The condition, and what it found*.
- **2026-08-22** — The browser half (workplan 0093 T5c): every endpoint discovered on both sides of
  the wire, a public client proven by PKCE, and the Zitadel bullet reading "accepted", with
  switching stated as four variables and a rebuild. Record: *Operative rules*, the bullets "Every
  endpoint is DISCOVERED", "The browser client is PUBLIC" and "Zitadel is the accepted issuer".
- **2026-08-25** — Amended: `sub` is the identity and email a label, so account linking is decided
  before a second sign-in method is offered and federation stays in the issuer (workplan 0102 T0;
  the owner chose the linking, and 0102 T1–T3 built it, the same day). Record: *Amended
  2026-08-25 — `sub` is the identity, email is a label*, at the end of *Operative rules*.
- **2026-09-01** — Signing out ends the issuer's session, not only this tab's (found by the owner).
  Record: *Operative rules*, the bullet "Signing out ends the ISSUER'S session".
- **2026-09-01** — A granted access request binds on the first verified sign-in; an invitation
  still asks (owner decision; `tenant_member.origin`, managed migration 0021). Record: *Operative
  rules*, the bullet "The answer to a question you asked is not an invitation".
- **2026-10-03** — Consolidated in place ([ADR-0051](./0051-an-adr-reads-as-it-stands.md)), after
  its operative rules were cut to the budget the same day; nothing was decided. The four
  amendments, which the record kept inside its operative section, are folded into *Decision* 3,
  5, 7 and 8, and their rejected options into *Alternatives considered*. Where the record had
  fallen behind the code, this text follows the code: the stack runs PostgreSQL 18 (the record
  said 16), Zitadel has its own database rather than a schema, and the narrowed claim surface
  (workplan 0093 T5b) is described as built.

The full record, word for word as it read before this consolidation:
[history/0042-who-holds-the-passwords.md](./history/0042-who-holds-the-passwords.md).
