# ADR-0018: JMAP is the primary target protocol; IMAP/DAV is the parallel second family

- **Status:** Accepted
- **Date:** 2026-06-21
- **Supersedes:** the earlier "JMAP as a roadmap/planned adapter" framing.

## Context
A growing class of EU sovereign suites — **La Suite numérique** (DINUM) and its SaaS resellers (**mosa.cloud**, the Dutch **MijnBureau**) — are **JMAP-first and deliberately omit IMAP** (the La Suite *Messages* brick states "no POP3 or IMAP, by design"). **JMAP** (RFC 8620/8621, plus JMAP for Calendars/Contacts/Files) is the modern, JSON-over-HTTP open successor to IMAP/CalDAV/CardDAV/WebDAV, with superior native delta-sync. Meanwhile, **OX-based suites (openDesk)** and **Soverin** speak classic **IMAP/CalDAV/CardDAV/WebDAV**.

## Decision
- Build the **JMAP target adapter first**; ship the **IMAP/CalDAV/CardDAV/WebDAV** target family in parallel. **Both are in the MVP.**
- JMAP applies to the **target write-path** and the internal normalized model. The **O365 source remains IMAP+OAuth2/Graph** — Microsoft has no JMAP, so source extraction is unchanged (ADR-0006/0012).
- **Reference target: Stalwart** (speaks both JMAP and IMAP/DAV) for local dev/e2e; **real targets:** mosa.cloud (JMAP) and openDesk (OX over IMAP/DAV).
- **Engine:** a JMAP writer on a JS client (e.g. jmap-jam). For the initial bulk copy, reuse the existing **one-shot JMAP migration utility** (imports from IMAP/CalDAV/CardDAV/WebDAV/Exchange/Takeout into a JMAP server, much like imapsync); **incremental shadow** uses JMAP change-tracking (`/changes`, state strings) against the ledger.
- **Mail leads.** JMAP for Calendars/Contacts/Files is newer (Stalwart since late 2025), so those follow mail.

## Consequences
- Aligns the stack with the direction EU sovereign suites are actually taking; unlocks mosa.cloud/La Suite/MijnBureau as **primary** targets, with OX/Soverin reached via DAV.
- One reference server (Stalwart) exercises both target families in tests.
- The connector layer stays protocol-pluggable behind one interface.
- **Risks:** JMAP for cal/contacts/files is less widely implemented than DAV; JMAP tooling is less battle-tested than imapsync. Mitigations: Stalwart as a complete reference, the one-shot migration utility for bulk, and the idempotency property test as the acceptance gate.

## Alternatives considered
- **IMAP/DAV-first** (JMAP later): rejected — delays the JMAP-first sovereign targets that motivate the project.
- **JMAP-only**: rejected — excludes OX-based openDesk and Soverin, which are IMAP/DAV.

## Update 2026-08-03 — the "one-shot JMAP migration utility" was never used

The engine bullet above credits an external one-shot JMAP import utility for
the initial bulk copy. No such utility was ever adopted: our own
`JmapTargetWriter` (jmap-jam) does bulk AND incremental through the same
idempotent shadow pass, and ADR-0019's update note records that the runtime is
pure JavaScript with no shell-outs at all. The SAD's tables were corrected in
its v1.2 pass; this note brings the ADR itself in line (0026 T4). The
decision — JMAP primary, IMAP/DAV parallel, mail leads — is unchanged.

## Update 2026-08-05 — "mail leads" has a first follower, and it is contacts (extended 2026-08-06: files followed second)

"Mail leads and cal/contacts/files follow" was written when JMAP for
Calendars/Contacts/Files was new on Stalwart. Workplan 0031 tested it against
the running server rather than the specification, and the three domains did not
move together:

- **Contacts followed.** `JmapContactTarget` ships (0031 T2), wired for both
  editions, with the sync loop exercised against a real Stalwart in CI. The
  vCard is converted by the SERVER via `ContactCard/parse`, so a card written
  over JMAP holds what a card written over CardDAV holds — proven by reading it
  back out through the CardDAV door.
- **Calendars did not.** Stalwart v0.16.10 refuses `recurrenceRules` over JMAP
  while its CalDAV path accepts them, so a JMAP calendar target could not carry
  a recurring series at all. Parked by owner decision; CalDAV keeps that
  domain. The trigger is `scripts/jmap-target-spike.ts`, re-run on each bump.
- **Files followed too, on 2026-08-06.** `JmapFileTarget` ships (0031 T3),
  wired for both editions. A JMAP `FileNode` has no path — only a `name` +
  `parentId` chain — so the key is rebuilt by `reconstructFileNodePath`, which
  is pinned as producing the same `fileNaturalKeyHash` as the WebDAV source's
  own path. **Unlike contacts, this domain loses nothing:** a node carries both
  `size` and `blobId`, so §20 gets counts, total bytes AND content checksums.
  The one detail that had to be got right is invisible when got wrong — the
  blobId a node carries is NOT the one the upload returned, because Stalwart
  re-issues it on attachment, so a connector holding the upload's handle writes
  successfully and then reports `checksumUnavailable` forever.

**The decision is unchanged; the sequencing note is now specific rather than
aspirational.** One thing it does change: JMAP is not uniformly at parity with
DAV per domain, so "which protocol carries which domain" is a real question per
deployment rather than a detail — two of the three domains have now answered it
and calendars have not. Contacts over JMAP also get **no §20 checksum
leg** — a stored `ContactCard` exposes no route back to vCard bytes — which
verification reports as `CHECKSUM_UNAVAILABLE_contacts` rather than passing
quietly.
