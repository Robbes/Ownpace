# Workplan 0053 — domain-wide delegation (ADR-0033)

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the JWT-bearer provider | ✅ **Done 2026-08-17** | `connectors/google-jwt-bearer-provider.ts`: RS256 assertion (`iss` = the service account, `sub` = the ONE impersonated user, per-product scope, one-hour life), exchanged at the same endpoint the refresh flow uses, with the refresh flow's cache/single-flight/five-minute-buffer structure. Refusals at CONSTRUCTION name what is wrong with the paste (not JSON / not a service-account key / missing fields / no subject — "a mapping's blast radius is one subject, however wide the credential"). Google's stock refusals are translated to the place an operator can act (§3): `unauthorized_client` → the Admin-console delegation entry, client id and scope named, revoke-at-cutover restated; `invalid_grant` → the subject as the likely out-of-domain account — Google's own words verbatim beside both (rule 9). 6 unit tests incl. signature verification against the key pair. |
| T2 one mode-selector, four factories | ✅ **Done 2026-08-17** | `orchestration/google-dwd.ts`: `dwdTokenProviderIfConfigured` — a `serviceAccountKey` in the credentials selects the JWT-bearer flow, absent means every factory's refresh-token path runs UNTOUCHED (all 29 pre-existing factory tests pass unmodified). Drive (subject from `creds.subject` — the factory has no user parameter), Gmail and both Google DAV factories (subject = the `user` they already take, so the impersonated identity and the authenticated identity cannot diverge). The credential-naming vocabulary gained `serviceAccountKey` per edition. 4 new factory tests: the assertion impersonates the subject with the read-only scope; refresh-token refusals never fire in DWD mode; no-subject and mangled-paste refusals at build time. |
| T3 both editions opt in | ✅ **Done 2026-08-17** | Appliance: `GOOGLE_SERVICE_ACCOUNT_KEY` (one env var, the whole key file) wired at all four build sites; `GoogleDriveSource.user` added to config + parser so a Drive mapping can state its subject. Managed: create accepts `sourceConfig.serviceAccountKey` — the refresh-token trio stops being required, and a DWD source without a username refuses with the one-subject sentence; the credential record carries key + subject encrypted, so probes and passes build identically (0046's rule). Wizard: the four Google source cards gained the key textarea with the grant's-width copy (EN/NL) — gates accept either flow. 3 create-coherence tests. |
| T4 not done, honestly | ⛔ | (a) Real-endpoint proof — DWD-minted tokens against live Drive/Gmail/Calendar/Contacts rides the owner runbook like everything Google-shaped (Gmail's IMAP XOAUTH2 accepting a DWD token is the claim most worth proving first). (b) Bulk mapping creation from directory discovery — out of ADR-0033's scope by its own words (§4). (c) Key rotation tooling — the runbook says revoke at cutover; anything fancier waits for demand. |

## What this is

ADR-0033, built the day after it was accepted: the second way into Google. A Workspace
admin authorises a dedicated service account once, and the four Google sources can mint
tokens impersonating each mapping's subject — one admin action instead of one consent
ceremony per user per product. Per-user refresh tokens remain the default and the
documented first path; a deployment opts into DWD by providing the key, and the setup
doc's five-step runbook ends where the credential should: revoked, at cutover.

## The one decision

**The subject is the mapping's own user, everywhere.** The credential can impersonate
anybody; nothing built here ever impersonates more than the one account a mapping names.
Gmail and the DAV sources reuse the `user` they always required, so the impersonated and
authenticated identities are the same string; Drive — which never needed a user before —
now states one (`source.user` / `username`) exactly when DWD is chosen, and the create
path refuses a DWD mapping that names nobody.
