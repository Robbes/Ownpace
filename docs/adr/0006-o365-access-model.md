# ADR-0006: O365 access model

- **Status:** Accepted
- **Date:** 2026-06-20

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
