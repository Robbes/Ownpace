# ADR-0006: O365 access model

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Each customer registers their own single-tenant Entra app** and consents in their own tenant — the central multi-tenant app is retired (2026-08-09). The credential never leaves customer custody; deleting the registration is their kill switch.
- Application permissions + **Application Access Policy** for org tenants; delegated for individuals.
- Mail: **IMAP+OAuth2 primary**, Graph fallback via a self-verifying probe (`MailSourceWithGraphFallback`) — probe the alternative, never parse Microsoft's error prose.

> **Update 2026-08-02 (workplan 0021 T5, owner decision: keep + build).** The
> "Microsoft Graph fallback when IMAP is disabled per mailbox" promise had no
> code behind it — the mail path was IMAP+OAuth2 only. Kept, and built the
> same day as **workplan 0023**: T1 the `GraphMailSource` connector (keyed on
> the same `internetMessageId` natural key so a transport switch cannot
> duplicate a mailbox), T2 the wiring through both editions' dep builders,
> and T3 the runtime detection this ADR promises —
> `MailSourceWithGraphFallback` probes Graph when IMAP refuses
> authentication and Graph credentials exist, and continues the run over
> Graph, loudly. Detection is self-verifying (probe the alternative) rather
> than parsing Microsoft's error prose, which does not distinguish
> disabled-IMAP from a bad credential. Also
> historical: "imapsync"/"DavMail->vdirsyncer" in the decision text are
> pre-ADR-0019 names — the real path is our own TypeScript connectors

> **Update 2026-08-09 (workplan 0026 T3 row 14, owner decision): the
> "one multi-tenant Entra app" half is RETIRED — the alternative this ADR
> rejected is now the model.** Each customer registers their own single-tenant
> app in their own tenant and consents to it there. What changed the weighing:
> the consequence line below — "Requires Microsoft Publisher Verification" —
> turned out to be the expensive part, an external Partner Center process with
> lead time that gates every foreign tenant's consent, while the cost this ADR
> originally held against per-customer registration ("more setup") had already
> been paid by the code: the appliance takes the customer's own `OAUTH2_*`
> values, and the managed edition stores `clientId`/`clientSecret` per
> connection — there was never a central credential in the running system.
> First-party consent has no verification wall, the credential never leaves
> the customer's custody, and deleting the app registration is a customer-side
> kill switch. Everything else in this ADR stands: application permissions +
> Application Access Policy for org tenants, delegated for individuals, IMAP
> primary with the Graph fallback. `docs/o365-setup.md` is retargeted to the
> per-customer model (the multi-tenant consent-URL flow kept for the record),
> and SAD §25 item 1's verification task is resolved by this decision rather
> than by paperwork.
> (IMAP+OAuth2 mail, Graph cal/contacts/files), and DavMail was never used
> (ADR-0012 avoided it).

## Context
We read from many O365 tenants (org/SMB and individuals), including shared mailboxes, while minimizing privilege and onboarding friction.

## Decision
Publish **one multi-tenant Entra app**. Use **application permissions + Application Access Policy** (token scoped to in-scope mailboxes) for org/SMB tenants; **delegated permissions** for individuals/family. Mail read path: **IMAP + OAuth2 (imapsync) primary**, **Microsoft Graph fallback** when IMAP is disabled per mailbox (runtime detection). Files/rich data via Graph; cal/contacts via DavMail->vdirsyncer or Graph.

## Consequences
- One admin consent enables reading all/shared mailboxes for org tenants.
- Application Access Policy keeps it least-privilege.
- Requires Microsoft Publisher Verification (and possibly app compliance) — see backlog.

## Alternatives considered
- Per-customer app registration: more setup, less central trust.
- Graph-primary for mail: more custom code than imapsync over IMAP.
