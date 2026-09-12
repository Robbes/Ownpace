# DAV sync guide — CalDAV (calendar), CardDAV (contacts), WebDAV (files)

The three DAV domains share one design, one idempotency model and one runner shape, so they share
one guide. Domain-specific behaviour is called out per section.

> Replaces `caldav-sync.md`, `carddav-sync.md` and `webdav-sync.md`, which were ~85 % identical
> boilerplate and all documented a `GenericSyncEngine` API that was **removed in PR #38**
> (workplan 0007). Their code samples no longer compiled against the tree.

## Architecture

Each domain pairs a **native TypeScript source connector** with a **target writer**, driven by a
per-domain runner over the shared `runDomainSync` loop, with the ledger enforcing idempotency:

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Source          │────▶│  runCalendarSync │────▶│  Target writer   │
│  (native TS)     │     │  runContactSync  │     │                  │
│                  │     │  runFileSync     │     │                  │
└──────────────────┘     └────────┬─────────┘     └──────────────────┘
                                  │
                                  ▼
                          ┌──────────────────┐
                          │  Ledger          │
                          │  (idempotency)   │
                          └──────────────────┘
```

No shell-outs: no vdirsyncer, no rclone. Pure TypeScript against the wire protocols.

| Domain | Source connector | Runner | RFCs |
|---|---|---|---|
| Calendar | `CalDAVSource` (`packages/connectors/src/caldav-source.ts`) | `runCalendarSync` | RFC 4791, RFC 6578, RFC 5545 |
| Contacts | `CarddavSource` (`packages/connectors/src/carddav-source.ts`) | `runContactSync` | RFC 6352, RFC 6578, RFC 6350 |
| Files | `WebdavFileSource` (`packages/connectors/src/webdav-source.ts`) | `runFileSync` | RFC 4918 |

Runners live in `packages/core/src/dav-sync.ts`; the shared loop is
`packages/core/src/domain-sync.ts` (see `docs/design/domain-sync.md` for the design rationale).

## Usage

All three runners take the same dependency shape and return the same result:

```typescript
import { runCalendarSync, runContactSync, runFileSync } from '@openmig/core';

const result = await runCalendarSync({
  tenantId,          // TenantId
  mappingId,         // MappingId
  source,            // CalendarSource  | ContactSource      | FileSource
  target,            // CalendarTargetWriter | ContactTargetWriter | FileTargetWriter
  ledger,            // Ledger
  cursors,           // CursorStore (optional — omit to force a full scan)
  concurrency,       // number (optional)
});

// DomainSyncResult
// { scanned, created, skipped, failed, drift }
```

`drift` counts source items absent on a later pass — potential deletions. They are **surfaced, never
auto-applied** to the target (arch doc §11.1, hard rule 2).

In practice you rarely construct these by hand: the worker builds them from the mapping row via
`buildDomainDepsFromMapping(pool, tenantId, mappingId, domain)`, and the self-host appliance builds
them from `mapping.json` via `runAllDomains`.

### When file bytes are read

`FileSource.listSince` is **metadata only**; `FileSource.fetch(item)` returns one file's bytes and
is called by the sync loop, once per item, inside its bounded concurrency.

The WebDAV source used to GET each changed file inline in its PROPFIND loop. That made every
download serial regardless of `concurrency` — only the uploads were parallel — and held a whole
folder's bytes in memory before anything was written. It also meant **discovery downloaded the
entire file corpus just to count it**, since `discoverSource` reuses `listSince` precisely because
it is supposed to be body-free.

A source that genuinely has the bytes already may still return them from `listSince`; the loop uses
them and does not re-fetch. What it will not do is substitute an empty file for missing content.

### Which domains run at the same time

`runAllDomains` groups the enabled domains into **lanes** (`planDomainLanes`) and runs the lanes in
parallel, sequentially within each lane. Two domains share a lane whenever they touch any of the
same hosts — source or target.

That rule exists because the domains are not independent. Calendar, contacts and files typically
land on one server, and a Nextcloud running its default SQLite is a single-writer database that
answers `database is locked` under concurrent writes (which is what `requestWithRetry` in the DAV
target writers is for). Mail usually lives elsewhere, so it overlaps the DAV work for free.

Domains whose endpoints cannot be resolved to a host share the first lane, so an unrecognised
config shape stays fully sequential rather than being guessed to be isolated.

## Idempotency

Same anchor in every domain: a stable **natural key** per item, hashed and stored with a
`UNIQUE (tenant_id, mapping_id, natural_key_hash)` constraint. A re-run finds the row and skips;
a changed `content_hash` drives an update. Re-running converges — no duplicates.

| Domain | Natural key | Notes |
|---|---|---|
| Calendar | iCalendar `UID` (+ `RECURRENCE-ID` for exceptions) | Case-insensitive per RFC 5545 §3.3.11 |
| Contacts | vCard `UID` | Case-insensitive |
| Files | Normalized path | See "Path normalization" below |

Helpers live in `packages/shared/src/hash.ts`.

## Incremental sync

- **CalDAV / CardDAV** use RFC 6578 `sync-collection` REPORT with a **sync-token**, falling back to
  **CTag** comparison when the server doesn't advertise sync-token support.
- **WebDAV** compares `getetag` / `getlastmodified` from PROPFIND.

Tokens are persisted per collection in `sync_checkpoint` via the `CursorStore`. Omit `cursors` to
force a full rescan.

**Rule**: a cursor is a CLAIM that everything up to it has been handled, so a FIRST read of a
collection — none held yet — that returns no items and no reported removals MUST NOT have its token
persisted. On a first read an empty answer is ambiguous (an empty collection, or a read that failed
to see what is in it) and the loop cannot tell them apart; storing the token turns the second case
into a permanent one, because every later pass asks "what changed since this token" and is
correctly told "nothing". A reported removal counts as having seen something (RFC 6578) and may
keep its place. Once a cursor EXISTS an empty answer is the ordinary incremental case and must go
on advancing, or every pass after the first re-lists the whole account. Found live 2026-09-11: five
Google calendars listed, five `sync-token` rows written, zero calendar items in the ledger, and
`calendar: 0 created, 0 skipped` reported on a fifteen-minute schedule for days.

**Rule**: a pass reports `collectionsListed` beside `scanned`, and a domain that listed collections
while scanning nothing MUST say so rather than reporting the same zeros an empty source produces.
"Copied nothing" and "had nothing to copy from" are different facts and the second is not a defect.
Three defects have now hidden in that ambiguity — the task domain that built file deps, E2E #168's
`tasks 0/4`, and the calendar wedge above.

## Domain-specific behaviour

### Calendar — recurring events

Handled per RFC 5545:

- **Master event** — the recurring definition carrying the `RRULE`.
- **Exceptions** — individual overridden instances, identified by `RECURRENCE-ID`.

Master and exceptions sync as **separate ledger items**, each with its own natural key
(master `UID`, plus `RECURRENCE-ID` for an exception). Generated display instances are not synced —
they're derived by the client from the master.

### Calendar — timezones

Source timezones are preserved: `VTIMEZONE` components travel with the event, floating times (no
timezone) stay floating, and recurring events keep their original timezone reference.

### Contacts — photos

vCard photos are either base64-embedded or a URI reference. Embedded photos are preserved as-is.
Be aware that some servers impose a per-vCard size limit, which large embedded photos can exceed —
such a failure surfaces as a failed item rather than being silently dropped.

### Files — path normalization

Paths are normalized before hashing so the same file is recognised across passes and platforms:
leading/trailing slashes removed, backslashes converted to forward slashes, repeated slashes
collapsed.

```
Documents\Reports\2024   →  Documents/Reports/2024
/Documents/Reports/2024/ →  Documents/Reports/2024
```

Collection paths are resolved per target account — see
`packages/engines/src/dav-collection-path.ts`.

### Files — collections exist before the PUT that needs them

**Rule**: MKCOL is not recursive (RFC 4918 §9.3.1 — a missing ancestor answers 409, it does not
create one), so every collection along a path MUST be created in order, ancestors first, and every
MKCOL status MUST be read. `201` is the create and `405` is "already there"; anything else is a
refusal and must be thrown with the server's own words. A PUT into a collection that was never
made returns Sabre's `404 File with name /<parent> could not be located` — naming the PARENT — so
an unread MKCOL surfaces as every file under it failing to exist. Found live 2026-09-11: 87 files
under one nested folder, until the consecutive-failure tripwire stopped the pass.

**Rule**: Paths inside `WebDAVTargetWriter` are DECODED strings (`hrefRelativeTo` decodes what the
server lists), so a request URL MUST be built by percent-encoding each segment exactly once —
never by appending the path raw and letting the URL parser mend it. Node escapes a space, which is
why folders with spaces mostly worked, but it reads `#` as a fragment and `?` as a query and
leaves `%` alone: `Q&A #2 (50%).pdf` was PUT to an address the server could not resolve.

### Files — large files

`WebDAVTargetWriter` (`packages/engines/src/webdav-target-writer.ts`) switches to a chunked upload
above `chunkSize`, which **defaults to 10 MB** and is configurable via `WebDAVSyncConfig`.

## Target support

| Target | Calendar | Contacts | Files | Evidence |
|---|---|---|---|---|
| Nextcloud | ✅ | ✅ | ✅ | Reference target — all three integration suites and the e2e gate run against it |
| Stalwart | ❓ | ❓ | — | **Not verified.** Stalwart is the reference target for *mail* (JMAP/IMAP). Its DAV services returned 403/HTML in the only assessment we have (`dav-integration-status.md`, 2026-07-12); the DAV suites were subsequently pointed at Nextcloud instead, so no current evidence either way |
| Generic RFC-compliant DAV | ❓ | ❓ | ❓ | Should work by protocol conformance; untested |

Only claim what has been run: Nextcloud is the one target with real, repeated evidence across all
three domains.

## Scheduling and invitation mail on the target

A CalDAV target that implements RFC 6638 auto-scheduling will **send mail on
writes**: PUT an event carrying `ATTENDEE`s and the server invites them;
DELETE an organiser copy and it cancels. A migration triggers both, at scale
(workplan 0103; ADR-0043). The product protects itself in the object — every
`ATTENDEE`/`ORGANIZER` it writes carries `SCHEDULE-AGENT=CLIENT`, every DELETE
carries `Schedule-Reply: F` — and **measures** the target rather than trusting
it: `detectCaldavScheduling` reads the `calendar-auto-schedule` compliance
class with one OPTIONS request, API-only.

Where you also **run** the target, a global switch exists:

| Target | Off-switch | Verified from |
|---|---|---|
| Nextcloud | `occ config:app:set dav sendInvitations --value no` (invitations); `dav sendEventReminders` / `sendEventRemindersToSharedUsers` (reminder mail) | the `dav` app's own source: the iMIP plugin registers only when `sendInvitations` = `yes` (the default) |
| Stalwart (≥ 0.12.1) | scheduling `enable = false`, or the per-account permission | vendor scheduling docs + changelog |

**Both switches are instance-wide.** On a customer's LIVE server they silence
the customer's real users too — every genuine invitation, not just the
migration's. So this is a **migration-window decision an operator makes and
reverses deliberately**, never something this tool flips (hard rule 2's
spirit: no mutating somebody's server config on the way past), and never a
default. The object-level neutralising above is what protects a migration
into a server whose switches you cannot touch.

Reminders are usually *wanted* after a migration — people moved their
calendar to keep being reminded — so the reminder switches are for the
window only. Note also that Nextcloud skips reminders whose trigger is in
the past and skips invitation mail for events that already ended, so
imported *history* is quiet there by its own design; future events are not.

## Reliability

`CalDAVTargetWriter`, `CarddavTargetWriter` and `WebDAVTargetWriter` retry a write up to 3 times
with a linear backoff (250 ms × attempt) when the server returns **5xx**.

This exists for a specific, observed reason rather than as general resilience: Nextcloud defaults
to **SQLite**, a single-writer database that genuinely returns
`SQLSTATE[HY000]: General error: 5 database is locked` when calendar and contact syncs write the
same account concurrently (confirmed live during 0011 T7). The lock is transient, so a short
backoff is the proportionate fix — cheaper than requiring every demo deployment to run Postgres.

Anything that is not a 5xx, and anything still failing after the retries, is **surfaced verbatim**
and counted in `failed` — never swallowed into an empty result (hard rule 9).

## Testing

Integration suites (Testcontainers Nextcloud, `pnpm test:integration`):

- `packages/connectors/src/caldav-source.integration.test.ts`
- `packages/connectors/src/carddav-source.integration.test.ts`
- `packages/connectors/src/webdav-source.integration.test.ts`
- Cross-domain idempotency: re-run a pass, assert `created === 0` the second time.

End-to-end, all four domains including a restart-resume idempotency gate:
`test/e2e/selfhost-restart-resume.e2e.test.ts` (see `docs/testing.md`).

## Reading a collection: the optimisation and the guarantee

RFC 6578 `sync-collection` answers *"what changed since this token"*. It is an
OPTIMISATION and a server may decline it, answer it emptily, or not implement
it at all. RFC 4791 §7.8 `calendar-query` and RFC 6352 §8.6 `addressbook-query`
answer *"everything that matches"*, and every server must support them.

> **Rule.** A source must never depend on `sync-collection` for correctness. If
> it does not answer, ask the query that has to be answered. `CardDAVSource`
> has fallen back since a Nextcloud address book rejected the report outright;
> `CalDAVSource` promised the same in its file header — "CTag fallback when
> sync-token not supported" — and had no code behind it until 2026-09-12.

> **Rule.** Two ways in, and the second is easy to miss: a **non-207**, and a
> **207 that carries nothing on a read with no cursor**. With a cursor,
> "nothing" is correct and common — it means nothing changed. Without one it is
> a claim that an entire account is empty, and a claim is not evidence.

> **Rule.** The fallback reports no cursor and no removals, and says so by
> returning `undefined` and `[]`. A `…-query` answers what matches, so there is
> no token to resume from and a deleted item is simply absent — calling that a
> removal report would turn "I cannot see it" into "the server told me it is
> gone".

> **Rule.** One component per `calendar-query`. RFC 4791 §9.7.1 makes sibling
> `comp-filter`s a conjunction, so naming VEVENT and VTODO together describes a
> VCALENDAR containing both — no object anybody has. And `<C:filter>` itself is
> not optional (§9.5): the CardDAV sibling shipped without one and Google
> answered `400 … Request contains an invalid argument`.

Live 2026-09-12, mapping `0cc9a844`: five Google calendars, all five created on
the target by that same pass, `listFolders` naming them correctly — and
`calendar: 0 created, 0 skipped` with nothing thrown and no failure row. On the
same pass, over the same Google account and the same token, contacts read 1,227
cards, because CardDAV had the fallback and CalDAV did not. **That asymmetry
was the bug.** Contacts had the other half of it: its first pass read 0 cards
and its second read 1,227, and it only recovered because the cursor invariant
refused to store a token over an empty first read.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `PROPFIND` returns 403 / an HTML page | DAV services not enabled, or the base URL points at the web UI rather than `/remote.php/dav` |
| Home-set discovery finds nothing | `current-user-principal` → home-set chain broken; check the account's principal URL |
| Items sync but land in the wrong collection | Collection path not namespaced under the target account — see `dav-collection-path.ts` |
| Second pass re-creates everything | Natural key unstable (e.g. UID case, or an unnormalized path) |
| A domain reports 0 items from collections that exist | The `sync-collection` REPORT answered 207 with nothing. Since 2026-09-12 both DAV sources check that with a `calendar-query` / `addressbook-query` and log which path answered — look for `[caldav]` / `[carddav]` lines in the run's events |
| `PUT` returns 404 naming a FOLDER, not the file | The parent collection was never created — an MKCOL whose status went unread, or a non-recursive one on a nested path |
| A folder of Google Docs stops a whole pass | A policy refusal counted as a broken world; a decision-class failure must be parked, not counted toward the tripwire (`isDecisionError`) |
| A domain reports `completed` with 0 created and 0 skipped, for ever | A cursor was stored past a first read that saw nothing — check `SELECT folder_path, cursor_value FROM cursor WHERE mapping_id = …`; deleting those rows makes the next pass re-read from the beginning |

## References

- `docs/design/domain-sync.md` — the per-domain sync design
- `docs/architecture/solution-architecture.md` §10 (idempotency), §11.1 (deletions as decisions)
- ADR-0005 (idempotency via ledger, non-destructive), ADR-0018 (JMAP primary, IMAP/DAV second)
- `docs/workplans/0007-multi-domain-sync-completion.md` — the slice that shipped these domains
