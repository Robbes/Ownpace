# ADR-0042: Who holds the passwords — an issuer we can replace

- **Status:** Accepted 2026-08-22, on the owner's condition; amended six times (latest
  2026-10-03: a provider may be an account's only way in, a verified email links without a
  prompt, and Microsoft creates no account by itself); consolidated 2026-10-03 (ADR-0051)
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
  issuer dependency** (one owner, no accounts; hard rule 5):
  `apps/selfhost/src/no-managed-leakage.unit.test.ts`.
- **The issuer owns identity; `tenant_member` owns tenancy.** A token carries `sub` and `email`
  and nothing Ownpace-specific; tenant and role are read from `tenant_member` per request, never
  trusted from a claim: `apps/api/src/middleware/tenant-resolution.unit.test.ts`.
- **Because of that rule, the issuer is REPLACEABLE**: the integration must stay inside plain
  OIDC discovery + authorization-code + PKCE + JWKS. No issuer-specific API, no issuer-side
  tenancy model, no issuer-side roles. Guards:
  `apps/api/src/middleware/no-issuer-lock-in.unit.test.ts`, `issuer-is-replaceable.unit.test.ts`.
- **`tenant_member.user_id` IS the token's `sub`; email is a label.** A new `sub` orphans the
  membership, so linking is decided before a second method is offered: a verified email links
  unprompted; Microsoft creates no account by itself; a provider may be an account's only method
  (owner, 2026-10-03). **Federation belongs in the issuer**:
  `scripts/a-second-door-with-the-linking-decided.unit.test.ts`.
- **Every endpoint is DISCOVERED, never composed**: `jwks_uri` by the API; `authorization_endpoint`,
  `token_endpoint` and `end_session_endpoint` by the browser, a **PUBLIC client, no secret**,
  whose PKCE verifier (S256) never leaves its tab. A document naming another `issuer` is
  refused; `JWT_JWKS_URI` is the escape hatch:
  `issuer-is-replaceable.unit.test.ts`, `oidc.unit.test.ts`.
- **Zitadel is the accepted issuer**, self-hosted on the managed Postgres. Pinned by version;
  upgrades are deliberate, never automatic (`scripts/a-pin-that-knows-it-is-behind.unit.test.ts`).
  Switching is four variables and a rebuild: `JWT_ISSUER`, `JWT_AUDIENCE`, `VITE_OIDC_ISSUER`,
  `VITE_OIDC_CLIENT_ID` (`scripts/idp-wiring.unit.test.ts`).
- **Signing out ends the ISSUER'S session, not only this tab's**: RP-Initiated Logout through the
  discovered `end_session_endpoint`, with `id_token_hint` and the registered
  `post_logout_redirect_uri`. The local half happens before the browser leaves for the issuer:
  `apps/web/src/components/SignOut.tsx`, `oidc.unit.test.ts`.
- **The answer to a question you asked is not an invitation** (owner, 2026-09-01): a granted
  access request (`tenant_member.origin` `requested`, managed migration 0021) binds at the first
  VERIFIED sign-in; an invitation (`invited`, the default) still asks:
  `apps/api/src/routes/access-requests-operator.integration.test.ts`.

## Context

Workplan 0092 T4 found that a customer signed in by pasting a JWT, valid for seven days, that the
owner had minted with `seed-managed.sh` and emailed (`apps/web/src/pages/Login.tsx`). Workplan
0093 built the front half (a request form, a route, a table); this ADR is the back half, what a
granted request becomes. The API already verified tokens against a remote JWKS whenever
`JWT_ISSUER` was set; which issuer had never been decided.

**The finding that framed the choice**: "we are multi-tenant, so we need a multi-tenant IdP" is
wrong here, because Ownpace already owns tenancy and enforces it in Postgres. The token's `role`
claim was overwritten from `tenant_member` on every request, and `tenantId` only says which tenant
a session acts on, which `tenant_member` answers from `sub`. So the issuer has to mint `sub` and
`email`, standard OIDC, and nothing else: the least trouble that is a real OIDC issuer with a
login page, by the owner's criteria (open source, low management effort, stable, scales far
enough, fits the product). That meant a hosted login UI, so reset, MFA and lockout screens are
not ours to build; invite-only access (an invitation is a `tenant_member` row; the account is the
person's own); tens to low thousands of users; one owner-operator
on an already large compose stack; and EU jurisdiction, because a US-controlled identity layer in
a product about leaving US cloud is a contradiction a customer can point at.

## Decision

**Zitadel, self-hosted and pinned — integrated only through standard OIDC, so that the choice
can be undone.** The second half is the decision: the issuer is a component, not a foundation.

### 1. Ownpace holds no passwords

The managed edition authenticates against an external OIDC issuer. There is no password column
in either migration chain, and that is the design rather than a gap. The appliance has one owner
and no accounts (hard rule 5) and never gains an issuer dependency
(`apps/selfhost/src/no-managed-leakage.unit.test.ts`).

### 2. The issuer owns identity; `tenant_member` owns tenancy

A token carries `sub` and `email` and nothing Ownpace-specific; the API requires exactly those two
(`apps/api/src/middleware/auth.ts`), `email` because an invitation is addressed to one and a
first sign-in has no row to look it up in. `resolveTenant` picks the tenant per request (a
header, else a claim, else the subject's one membership, never a guess between several), and that
only decides what is checked: an active `tenant_member` row must exist, and the role is that
row's (`tenant-resolution.unit.test.ts`).

### 3. `sub` is the identity; email is a label

`tenant_member.user_id` IS the token's `sub`: `lookupMemberships` filters on it, `resolveTenant`
refuses when it finds nothing, and email is nowhere in that lookup. A flow that preserves `sub` is
safe; one that mints a new `sub` orphans the membership: the person is still a member of an
organisation their new subject cannot reach, and the API answers 403 on every route. So:

- **Changing an address inside an account is safe**, and the label follows: `GET /api/me`
  reconciles `tenant_member.email` to the verified claim on rows already carrying the subject
  (`a-label-that-follows-the-claim.unit.test.ts`).
- **Account linking is decided before a second sign-in method is offered** (owner, 2026-08-25;
  workplan 0102 T2), and **a verified email that matches links without a prompt** (owner,
  2026-10-03, taking the recommendation). The pinned Zitadel (v4.19.2, login v1, which this stack
  runs) links a single verified-email match directly (`autoLinking: EMAIL`); when several accounts
  match, nothing is linked. Whoever controls that address could already reset the account's
  password through it, so a prompt would protect nothing, and a prompt needs automatic linking off,
  after which a person who chose *create* would hold two accounts.
- **A Microsoft sign-in creates no account by itself** (owner, 2026-10-03). A Microsoft address
  arrives unverified on purpose (`emailVerified: false`, so that it cannot answer somebody else's
  invitation), so it never matches, and with automatic creation a person who already had a
  password and signed in with Microsoft was given a second account. Now Zitadel asks them to link
  to the account they have or to create one (`IDP_OPTIONS_MICROSOFT` in `setup-zitadel.sh`, pinned
  by `a-second-door-with-the-linking-decided.unit.test.ts`). The script does not update a provider
  that already exists, so an existing Microsoft provider is changed in the console. Google keeps
  automatic creation: its verified addresses match.
- **An upstream provider may be an account's only sign-in method** (owner, 2026-10-03: *"we still
  allow login with Google. People on Google might still use their account in for example Android,
  while still leaving drive."*). Leaving Google Drive is not leaving the Google account, so
  signing in with Google is not a dependency on what the person is leaving. `setup-zitadel.sh`
  keeps creating such accounts (`isCreationAllowed`, `isAutoCreation`). An account that loses its
  provider is recovered by an operator in the issuer's console, who sets a password or removes the
  link, keeping the `sub` (`docs/managed-bring-up.md` §8c-bis).
- **Federation belongs in the issuer, never in the app**: upstream providers are configured in the
  issuer (`deploy/compose/setup-zitadel.sh`), so `iss` and `sub` stay ours and the integration
  stays plain OIDC.

### 4. The issuer is replaceable — confirmed, not asserted

The integration stays inside plain OIDC discovery + authorization-code + PKCE + JWKS: no
issuer-specific API, no issuer-side tenancy model, no issuer-side roles.
`no-issuer-lock-in.unit.test.ts` fails on an identity provider's name or endpoint path in shipped
source (Zitadel, Keycloak, Auth0, Clerk, Okta, Authentik),
and `issuer-is-replaceable.unit.test.ts` drives the real verification path with Zitadel's and
Keycloak's discovery documents. Switching provider is `JWT_ISSUER` and `JWT_AUDIENCE` for the API,
`VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID` for the web build, and a rebuild.

The owner accepted on the condition that this be confirmed, and confirming it found it false:
`getJWKS` composed `${jwtIssuer}/.well-known/jwks.json`, an Auth0/Clerk convention matching
neither Zitadel's `{domain}/oauth/v2/keys` nor Keycloak's
`{host}/realms/{realm}/protocol/openid-connect/certs`. So **every endpoint is discovered, never
composed**: the API reads `jwks_uri` from `/.well-known/openid-configuration`, the browser reads
`authorization_endpoint`, `token_endpoint` and `end_session_endpoint` from it
(`apps/web/src/services/oidc.ts`), and both refuse a document naming another `issuer` (OIDC
Discovery §4.3), or a hijacked DNS record or a misconfigured proxy could point verification at a
key set it controls. The API answers that with a 500, not a 401: our configuration is wrong or
attacked, and no caller's token can fix it. `JWT_JWKS_URI` skips discovery as an escape hatch, not
the normal path, since it pins a URL that key rotation or an upgrade can move.

### 5. A public browser client, proven by PKCE

The web app is a single-page app, so the client is public and holds no secret
(`scripts/idp-wiring.unit.test.ts`). The code exchange is proven by a PKCE verifier (S256) that
never leaves the tab that minted it: verifier and state live in `sessionStorage`, never
`localStorage`, because they are good for one exchange in one tab, and a value that outlives the
flow can be replayed against a later one (`oidc.unit.test.ts`).

### 6. Zitadel, self-hosted and pinned

Zitadel runs beside the managed stack on the Postgres it already has, in its own database
(`deploy/compose/managed.yml`). Pinned by version; upgrades are deliberate, never automatic:
Dependabot ignores the image by name, and a weekly watch keeps an issue open while the pin is
behind upstream (`scripts/a-pin-that-knows-it-is-behind.unit.test.ts`). The product uses none of
its organisations, projects, roles or management API.

### 7. Signing out ends the issuer's session

Clearing the app's store and `localStorage` leaves the issuer's cookie alive, so the next "Sign
in" completes without a prompt: on a shared or borrowed machine, an account handover. Signing out
(`apps/web/src/components/SignOut.tsx`) therefore also follows the discovered
`end_session_endpoint` with `id_token_hint` and the registered `post_logout_redirect_uri`: plain
RP-Initiated Logout 1.0 with no issuer-specific call, so *Decision* 4 holds. The local half
happens before the browser leaves for the issuer, so an issuer with no such endpoint, or one that
refuses, leaves somebody signed out here rather than stuck (`oidc.unit.test.ts`); one that hangs
delays it, since discovery has no timeout.

### 8. The answer to a question you asked is not an invitation

`members.ts` lets anybody inside an organisation add any address to it, so an invitation is a
question (workplan 0099). A granted access request is another event: the person asked, an
operator said yes, and the organisation was made for them with them as its only owner, so asking
again asks twice (owner, 2026-09-01). `tenant_member.origin` (managed migration 0021) records
which: `requested` binds on the first sign-in with a VERIFIED address (`claimRequestedMembership`,
from `GET /api/me`); `invited`, the default, still asks, so an unrecorded origin fails towards
asking. Migration 0006's policy still authorises the binding; `origin` only narrows it.

## Consequences

- **No credentials are held here**, so none leak from here, and reset, MFA and lockout are
  somebody else's tested code. Swiss jurisdiction avoids US CLOUD Act exposure. One Go binary,
  about 256 MB idle, on the stack's PostgreSQL 18. A customer's own IdP later is configuration,
  not a project.
- **Self-hosted Zitadel churns**, as documented: the Login UI split into its own service in v2/v3,
  v1 APIs deprecated, configuration "easy to get wrong and hard to diagnose" (init-time
  environment handling, `BASEURI` path gotchas), upgrades replaying projections for a time
  proportional to the event log; more than one write-up calls it brittle for multi-tenant
  production. Bought down three ways: none of the churned surface (its tenancy, its management
  API) is used by the product's code — `setup-zitadel.sh` provisions through its v1 admin and
  management APIs, which is where the churn lands — the pin moves deliberately against the
  technical advisories, and the exit is cheap by construction.
- **Its core is AGPL-3.0** since v3 (2025-03-31); proto definitions, APIs and SDKs stay
  Apache-2.0. Run unmodified as a separate service it binds nothing of ours, but **a patch to
  Zitadel would be AGPL and must be published**. [ADR-0001](./0001-license-apache-2.0.md)
  (Apache-2.0) and [ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md) (no open-core)
  are unaffected.
- **One more service** in `deploy/compose/managed.yml`, one more database to back up, and a second
  place where a person exists, with `tenant_member` still the authority on what they may do.
- **The product never creates an account at the provider**: a granted person registers their own
  (workplan 0095 T0), and a lost password or second factor is mended in the provider's console.
- **Built** 2026-08-22 (workplan 0093 T5–T5c), 2026-08-25 (workplan 0102 T1–T3) and 2026-09-01
  (sign-out, `tenant_member.origin`).

## Alternatives considered

**Keycloak.** Apache-2.0, the most mature, the largest ecosystem: the "boring" choice. Outweighed
by a documented base of **1250 MB of RAM plus ~300 MB non-heap**, more than the rest of the
managed stack, on a box already running Stalwart, Postgres, Trigger.dev and ClickHouse; and by
Red Hat/IBM, US-governed, at the centre of a product about leaving US cloud. **Kept as the named
fallback** if Zitadel's churn proves worse than the mitigation: with only standard OIDC, it is a
configuration change plus a user migration away.

**Authentik.** MIT, the most polished admin UI. Rejected on operations: Python across a server, a
worker and Redis besides the database, four moving parts where Zitadel is one, and majors with
breaking changes, a mandatory database backup and no supported downgrade. US-based.

**Ory (Hydra + Kratos).** Apache-2.0 and German, the best fit for the thesis, but **neither ships
a login UI**: we would build the screens this ADR exists to avoid, as two services.

**Logto.** MPL-2.0, developer-first, a reasonable second; it lost on jurisdiction and on Zitadel
reusing our Postgres, with no operational advantage to outweigh that.

**Authelia.** Apache-2.0 and tiny, but **disqualified on capability**: a forward-auth product with a
bolt-on OIDC provider, where we need a real issuer minting tokens for a real SPA.

**Build it ourselves — passwords in `tenant_member`.** The fewest services, refused for a reason
other than effort: credential storage means owning hashing, reset flows, enumeration resistance,
MFA, lockout, session revocation and breach response, permanently, as a two-person team, for a
product sold on being a safer place for someone's mail. The `text` `user_id` already assumed this
answer.

**Do nothing yet — build workplan 0093's T6/T7 on the symmetric `JWT_SECRET`.** `POST /api/tenants`
answers 501 because tenant creation cannot run on a tenant-scoped connection, so T6 needed a
privileged path anyway, and that path must decide what a user IS. Deciding that twice is the
expensive way.

**An issuer that owns tenancy and roles**, with tenant and role in the token. Ownpace owns both
already, under RLS with a guard; the role claim was overwritten from the database anyway; and
teaching every issuer our tenancy model is the coupling that would make it unswappable.

**Composing endpoint URLs from the issuer's address**, as `getJWKS` did until acceptance: a path
shape is one provider's convention, not a standard (*Decision* 4).

**A confidential browser client**: in a single-page app it means shipping a secret to every
visitor, which is no secret.

**"Login with Google" as application code**: provider-specific code in the app, which the third
operative rule forbids. Federation belongs in the issuer, where `iss` and `sub` stay ours.

**A second sign-in method first, account linking later**: whoever uses both doors gets a new `sub`
and is locked out of an organisation they still belong to.

**A platform as an account's only sign-in method**: a dependency rebuilt in a new place, for
people whose reason to be here is leaving that platform. (Rejected, and not yet prevented: see
*Decision* 3.)

**Binding every invitation on sight**: workplan 0099's defect. Anybody inside an organisation can
add any address (`members.ts`), so reading your own account would join you to a stranger's
organisation. **Asking a granted requester again**: the same question twice.

**A sign-out that clears only the tab**: the issuer's session survives it, and on a shared or
borrowed machine that is an account handover (*Decision* 7).

**Never letting a second method become an account's only one** (the rule of 2026-08-25), held by
switching off account creation through a provider, so that a new person registers a password
first and links Google afterwards. Reversed by the owner on 2026-10-03: *"we still allow login
with Google. People on Google might still use their account in for example Android, while still
leaving drive."* **Allowing it, but forcing a password after the first sign-in** was not
available: the pinned Zitadel skips the password and passkey steps after an upstream sign-in.

**A prompt before a verified email is linked** (the rule of 2026-08-25, never held by the pinned
Zitadel). Set aside on 2026-10-03: it adds nothing that control of the address does not already
give, and the way to get it, automatic linking off, lets a person create a second account where
they meant to link.

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
  amendments, which the record kept inside its operative section, are folded into *Decision* 3
  to 8, and their rejected options into *Alternatives considered*. Where the record had
  fallen behind the code, this text follows the code: the stack runs PostgreSQL 18 (the record
  said 16), Zitadel has its own database rather than a schema, the narrowed claim surface
  (workplan 0093 T5b) is described as built, and a "Login with Google" button is said to be
  forbidden by the third operative rule, not caught by `no-issuer-lock-in.unit.test.ts`, which has
  no Google pattern (the migration code names Google throughout).
- **2026-10-03, later** — An upstream provider may be an account's only sign-in method, recovered
  by an operator in the issuer's console (owner: *"we still allow login with Google…"*), reversing
  the rule of 2026-08-25. The same reading found the linking prompt of 2026-08-25 not held by the
  pinned Zitadel, and Microsoft's unverified addresses able to make a second account; both the
  owner's to resolve. Record: *Decision* 3, and *Alternatives considered*.
- **2026-10-03, last** — A verified email links without a prompt, and a Microsoft sign-in creates
  no account by itself (owner: *"recommended"*); `setup-zitadel.sh` gives Microsoft its own
  options. Record: *Decision* 3, and *Alternatives considered*.

The full record, word for word as it read before this consolidation:
[history/0042-who-holds-the-passwords.md](./history/0042-who-holds-the-passwords.md).
