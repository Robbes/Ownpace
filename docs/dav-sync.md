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

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `PROPFIND` returns 403 / an HTML page | DAV services not enabled, or the base URL points at the web UI rather than `/remote.php/dav` |
| Home-set discovery finds nothing | `current-user-principal` → home-set chain broken; check the account's principal URL |
| Items sync but land in the wrong collection | Collection path not namespaced under the target account — see `dav-collection-path.ts` |
| Second pass re-creates everything | Natural key unstable (e.g. UID case, or an unnormalized path) |

## References

- `docs/design/domain-sync.md` — the per-domain sync design
- `docs/architecture/solution-architecture.md` §10 (idempotency), §11.1 (deletions as decisions)
- ADR-0005 (idempotency via ledger, non-destructive), ADR-0018 (JMAP primary, IMAP/DAV second)
- `docs/workplans/0007-multi-domain-sync-completion.md` — the slice that shipped these domains
