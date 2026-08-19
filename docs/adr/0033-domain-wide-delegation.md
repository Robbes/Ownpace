# ADR-0033: Whole-tenant Google migration — domain-wide delegation, opt-in and stated

- **Status:** Accepted (owner decision, 2026-08-17 — "accept, proceed") — first slice
  built the same day
- **Date:** 2026-08-16
- **Deciders:** owner
- **Relates to:** ADR-0006 (the O365 access model — this is its Google twin, and the
  reasoning discipline is deliberately the same), workplans 0042/0044/0045 (the four
  per-user Google sources this would scale), `docs/google-workspace-setup.md` (which has
  carried a "needs an ADR" note since Gmail landed).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- Google **DWD is a second credential mode, opt-in** — per-user refresh tokens remain the default and documented first path.
- One subject per mapping (blast radius unchanged); dedicated service account; **only the enumerated scopes the chosen products need**; revoke the delegation at cutover.
- Refusals name the Admin-console delegation with Google's own words verbatim; no bulk mapping-from-directory (open question, Pattern D shape); **Google is never a target**.

## Context

Every Google source this product has — Drive, Gmail, Calendar, Contacts — authenticates
with a **per-user OAuth refresh token**: the account's owner clicks through consent once
per product, and the token can read that account and nothing else. That is the right
default: smallest possible standing access, revocable per person, no admin involvement.

It does not scale to a tenant. A 40-seat Workspace migrating mail, files and calendars is
**120 consent ceremonies**, each producing a secret somebody has to transport into a
mapping. The operator doing that has every incentive to cut corners (one shared browser
profile, tokens over chat) — the security of per-user consent evaporates exactly when the
seat count makes it annoying.

Google's answer for this is **domain-wide delegation (DWD)**: a Workspace admin authorises
a service account's client-id for an enumerated list of scopes, once, in the Admin
console; the tool then mints tokens impersonating any user in the domain
(`sub=anna@domain`). One admin action instead of 120 ceremonies.

## The question

May open-migrate hold a credential that can read **every user in the domain** — and if
so, under what constraints?

## Why this is ADR-shaped and not a feature request

ADR-0006/the `Files.Read.All` decision set the house discipline: a standing tenant-wide
grant is never a default, is taken **knowingly** or not at all, and the tool must be
honest about what cannot be narrowed. Google's DWD is narrowed **by scope only** — the
admin enumerates scopes, but there is no per-user fencing (no equivalent of Exchange's
Application Access Policy). A DWD key with `https://mail.google.com/` can read the CEO's
mailbox, full stop. The decision is whether that trade is acceptable for a migration
tool whose whole job is to read every mailbox anyway — and who gets to make it.

## Decision (proposed)

### 1. DWD is a second credential mode, never a replacement

Per-user refresh tokens stay the default and the documented first path. DWD is opt-in,
for Workspace tenants with an admin in the loop: a new credential shape
(`serviceAccountKey` + per-mapping `subject`) accepted by the same four source
factories. A mapping still names **one** subject — the blast radius of a mapping never
changes; what widens is the credential behind it, and only for deployments that chose it.

### 2. The admin action is the consent, and the docs treat it with the same weight

`google-workspace-setup.md` gains the DWD runbook: create a dedicated service account
(nothing else on it), authorise ONLY the scopes the chosen products need (the same three
scopes the per-user flow uses — never `cloud-platform`, never a superset "to be safe"),
and revoke the authorisation at cutover — the credential's lifetime is the migration's.

### 3. Refusals name the delegation, not the symptom

A DWD token minted for an unauthorised scope or an out-of-domain subject fails with
Google's `unauthorized_client` — a sentence that sends an operator to the wrong place.
The factories refuse BEFORE minting when the config cannot work (missing key fields,
subject not an email), and translate the mint-time failure by naming the Admin-console
authorisation as the thing to check, with Google's own words kept verbatim beside it
(hard rule 9).

### 4. What this deliberately does not do

No auto-discovery-and-migrate-everyone: mappings are still created one subject at a
time (the wizard or config file names each), because "the admin consented to reading
everyone" and "the owner decided to migrate Anna" remain different decisions. Bulk
mapping creation from a directory listing is a separate, later question with its own
consent story (Pattern D's discovery-then-person idiom is the likely shape).

## Consequences

- A service-account private key becomes the most sensitive secret this product stores
  (today's worst is one user's refresh token). It rides the existing secret machinery
  (SecretStore managed, env on the appliance), and the docs say plainly: dedicated
  account, minimal scopes, revoke at cutover.
- The four Google factories grow a second credential branch and a JWT-bearer token
  provider (RS256 assertion with `sub`) beside the existing refresh-token provider.
- Stage proof extends: DWD-minted tokens must be proven against real endpoints for each
  product (Gmail's IMAP XOAUTH2 accepts them; that claim rides the owner runbook like
  everything Google-shaped).

## What acceptance would build (first slice)

1. The JWT-bearer token provider + credential shape, refusals per §3, unit-tested
   against a fake token endpoint.
2. `buildGoogle*SourceFrom` branches on credential mode; config + create API + wizard
   accept the DWD shape (admin-facing copy stating the grant's width).
3. The setup-doc runbook (§2), including the revoke-at-cutover step.

## Build record (2026-08-17, workplan 0053)

Built as accepted: `GoogleJwtBearerProvider` (RS256 assertion with `sub`, refusals at
construction naming what is wrong with the paste, `unauthorized_client`/`invalid_grant`
translated to the Admin-console action with Google's words verbatim beside them); one
shared mode-selector (`google-dwd.ts`) used by all four source factories, so per-user
refresh tokens stay the untouched default and a `serviceAccountKey` selects DWD; the
appliance reads `GOOGLE_SERVICE_ACCOUNT_KEY` (Drive states its subject as `source.user`);
managed create accepts the key with the one-subject refusal, stores it encrypted with the
subject riding along; the wizard's Google sources gained the key field with the
grant's-width copy; the setup doc carries the five-step runbook, revoke-at-cutover
included. Real-endpoint proof rides the owner runbook like everything Google-shaped.

## What this ADR does not decide

Bulk mapping creation from directory discovery (§4); any Microsoft-side equivalent
change (ADR-0006 stands); Google as a target (never).
