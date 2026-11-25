# Workplan 0170 — The last 90 days first

> **In one line:** Every first copy of mail, files and calendars brings the last 90 days first, then the rest; a migration can also be set to only the last 90 days (plus all contacts and tasks), to try destinations with fresh data, and broadened to everything later without starting over.

## Status — 2026-11-24 (update this block at the end of every session)

**2026-11-25, the owner's two answers on the Dutch.** One word for *the last 90 days*, *afgelopen*, the chip too (*Afgelopen 90 dagen*; the owner: *"Q1: a"*), and *bestemmingen*, not *doelplatformen*, in the hint under *Alleen de afgelopen 90 dagen* (*"Q2: a"*). The screens, the server's sentence that holds a 90-day migration's switch, the glossary row and the Dutch guides (`start.md`, `google.md`) say so; §7's tables below keep the words as planned.

**2026-11-24, T1 built** (on `claude/ownpace-public-readiness-y7orc6-0170-t1`; the interface pushed
first, as `1b23bc4`, for T2 to T5). What was built differently from §3 and §5, and why:

- **The managed worker runs passes in `run-delta-sync.ts`, not `runAllDomains`** (§3.2 says both
  editions use `runAllDomains`; only the appliance does). So the rule is one module,
  `packages/orchestration/src/recent-window-pass.ts` (`planWindow`, `runWithWindow`), which both
  dispatchers call, and `apps/worker` gained the calls (`run-delta-sync.ts`, `run-discovery.ts`,
  and for D8 `run-cutover.ts` and the CLI).
- **Phase A then phase B per data type, in the same firing**, not every lane's phase A before any
  phase B. The managed worker gives each data type its own share of the pass's time, and phase B
  inside that share keeps the share honest; the appliance does the same, so the editions copy in
  one order (hard rule 5). Mail and the DAV types still run in parallel lanes.
- **Phase A is owed when the data type's window record is not `in` and its first copy has never
  completed** (`migration_status.completed_at`), not "the first time a data type is copied" alone:
  so every migration made before this, and a 90-day migration broadened after its window was in,
  gets no phase A. A RETRY that clears the record therefore costs no extra window pass.
- **`RecentOnlySetting.anchor` is optional** in the type: the appliance's mapping file carries
  `{ "days": 90 }`, and the anchor is written at first record. `planWindow` refuses to run a
  window without one.
- **`fileInWindow` holds every directory**, as well as an item with no date (D6).
- **D8 reaches every door of the switch-over**: the update route (`code: recent_only`), the cutover
  door, the cutover job, the operator CLI's `approve`, `execute` and `complete`, and the
  appliance's lane door, all through `recentOnlyIsSwitchedOver` (`lifecycle.ts`).
- **The appliance's `/status` carries the same `window`** as managed's read, for T5.

**2026-11-24, later still: D8 answered.** The owner, verbatim: *"D8: no, not before"*. A migration
of only the last 90 days is not switched over before it is broadened to everything: switching over
follows *Copy everything* and its phase B (§6, §10). T1's refusal is the rule, not a placeholder
until an answer. Every decision of §10 is answered.

**2026-11-24, later: the owner's answers to §10, recorded.** D1, D4, D6 and D7 as advised. D2
reframed: a migration of the last 90 days is not a trial of Ownpace but a person trying a
destination with their fresh data; it can be broadened to everything, and never narrowed from
everything to 90 days. D3: the names follow from that, so *trial* is gone from the screens and
from the contract (§5, §7). D5: the appliance gets the same as managed, both phases and the
90-day choice, in alpha.19. One question that follows from D2 is open: D8, whether a 90-day
migration may be switched over before it is broadened. Until it is answered, T1 refuses it, a
rule that is one line to lift.

**2026-11-24: planned, for alpha.19. Nothing built.** This plan fixes the shared interfaces so
that six build tasks (T1 to T6) can run as separate pull requests, in parallel where §9 allows.
The owner waived every waiting period and asked for it in the alpha now in progress. No database
change is expected (§3.4).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T1 Core engine and contract | builder | 🔨 **Built, PR open**: unit, typecheck and lint green; E2E (self-hosted, Postgres and PGlite) and E2E (managed) to be dispatched by the owner | §3, §5, §6. The interface first (`1b23bc4`): `ListOptions`, `recent-window.ts`, `recentOnly`. Then the window in `runDomainSync`, `recent-window-pass.ts` for both dispatchers, discovery, the revision rule, the API (`recentOnly`, `window`, `openapi.yaml`), the appliance's anchor and `/status`, and D8 at every door. No database change. |
| T2 Mail sources | builder | 🔨 **Built 2026-11-24** | §4.1. IMAP and Gmail: `UID SEARCH SINCE` the UTC day before `since` (an internal date's own date, to UTC-12), then a fetch of those UIDs; a server that refuses the SEARCH has the folder listed whole and the window kept by each message's internal date, the same answer as a server that honours `SINCE`. A window listing's cursor names its window (`since:{ms}:{uidValidity}:{uidNext}`) and is a full scan to a listing without one or with a wider one, so it can never stand in for a content cursor. Graph mail: **no `$filter`**, §11 question 1. `MailSourceWithGraphFallback` and `GmailFolderView` forward `options`. Unit only; the Stalwart proof is T6's. |
| T3 File sources | builder | 🔨 **Built 2026-11-24** | §4.2. Google Drive asks with `q` and `modifiedTime >= …` when `since` is given; OneDrive, Dropbox, Box, WebDAV and the archive filter after listing with `fileInWindow` (`file-window.ts`), and an archive item with no date is in the window (D6). A windowed listing stays out of the memo `listKeys` reads, and no cursor that claims items before `since` is stored as a content cursor. E2E (self-hosted) on Postgres and PGlite: green before the merge (runs 45487961798, 45488960904). |
| T4 Calendar sources | builder | 🔨 **Built 2026-11-24**, draft PR | §4.3. Built 2026-11-24, on T1's interface: CalDAV `time-range` from a day before `since`, plus `prop-filter` RRULE and RDATE queries so a server that does not expand recurrence still lists every series; a refusal lists the calendar whole; no cursor from a window listing; VTODO never windowed. Graph calendar filters delta entries before `$value` and marks its cursor with the window. `eventInWindow` decides D1 (a) through `ical-occurrences.ts` (time zones, dates, DURATION, UNTIL, COUNT, RDATE, overrides) and holds what it cannot bound. The DTSTART parse reads the VEVENT's own start, in UTC. Unit tests fail without the change. |
| T5 Web UX and guides | builder | 🟡 Built, in review | §7, §5.4. On branch `claude/ownpace-public-readiness-y7orc6-0170-t5`, with T1's merged in: *How much?* on *What moves?*, said again on the check screen; on the migration page, from `window` on the detail (managed) or `/status` (the appliance), the *Last 90 days* chip, never *Ready to switch*, Finish *After Copy everything* (D8), and the milestone line (`windowParts`); *Copy everything* with its confirmation on managed (the appliance's is its mapping file); `docs/guides/*/start.md`, served as `start`; the Finish page offers no switch-over while the migration is of only the last 90 days, and links to *Copy everything* instead (D8). Unit tests for each state. Waits for the owner's Dutch and the E2E runs. |
| T6 Proofs | builder | 📋 Planned | §8. Integration on Stalwart and Nextcloud, `local-pg.sh`, the appliance's mapping file, and the managed E2E smoke's 90-day case. |
| T7 The managed E2E run | owner | ⏳ **Owner** | Started by the owner on the self-hosted runner, after T6 merges. |
| T8 The owner's decisions | owner | ✅ Done | §10: D1 to D8 answered 2026-11-24. |

## 1. The owner's words

The question, 2026-11-24, verbatim: *"reason on whether we can move the most fresh data per
object first (like fifo), and moving older material after that. Like some kind of ordering. Would
that make sense?"*

The proposal back was *a recent window first, then the rest*, not a global newest-first sort (§2).
The owner's answer, verbatim: *"yes, plan it as a workplan, 90 days. I waive all waiting/days, try
to get it in the upcomming alpha we are still working on. ... Also add one feature (fit in UX!) for
people that just want to first test seperate targets and want to test with only syncing the 90 day
newers data (and all contacts/tasks)."*

The owner's answers to §10, the same day, verbatim:

> 1: yes
> 2: its not a trail, but the user trails the target system. It's not a ownpace trail, but we just
> enable someone to trail several target systems with their fresh data. One should be able to
> broaden the migration from 'only 90 days' to 'all'. We dont do the other way around (all to
> 90-days.)
> 3: revice from my lines at 2.
> 4: default and one can not change. It's the default ordering/flow: fresh first, older a bit later.
> 5: revice, keep same as managed.
> 6: yes, one uploads all.
> 7: yes.

And to D8 (§10), the same day, verbatim: *"D8: no, not before"*.

## 2. What happens today, and why not a global sort

Within each folder or collection, a pass copies in the order the source lists. IMAP reads `1:*`
by sequence, oldest first (`ImapFlowSource.fetchListing`,
`packages/connectors/src/imapflow-source.ts`, `client.fetchAll('1:*', { uid, flags, envelope,
internalDate, size })`), and `runDomainSync` (`packages/core/src/domain-sync.ts`) takes the items
as listed, reading the ledger 500 keys ahead (`LEDGER_READ_AHEAD`). The ledger records every item
once, by its natural key, so the order changes nothing about correctness, resumption or later
passes (ADR-0020).

A global newest-first sort across every folder would need the whole listing of an account in
memory before the first copy, and a resumption point that is not a folder's cursor. A window does
neither: it is a filter on the listing each folder already makes, and the second phase is today's
first pass.

## 3. The design

### 3.1 Two phases of every first copy, and a migration of the last 90 days

- **Phase A, the window.** The first time a data type is copied, a pass lists only what falls in
  the window, and copies it. This is how every migration's first copy runs, with no choice to
  switch it off (D4).
  - Mail: received on or after `since`. Inbox first, then Sent, then the other folders in the
    order the source lists them.
  - Files: modified on or after `since`.
  - Calendars: every event that ends on or after `since`, which includes every upcoming one. A
    recurring series is copied whole, with all its overrides, when any of its occurrences falls on
    or after `since` (D1).
  - Contacts and tasks: everything, with no window. They are small, and a person needs them whole.
- **Phase B, the rest.** The next pass of that data type is today's first pass: a full listing
  with no cursor. The ledger's read-ahead skips everything phase A copied (`quietSkip`), so phase
  B costs a listing plus the older items. Everything after phase B is unchanged.
- **A migration of the last 90 days** is phase A without phase B: every pass of it is a window
  pass. It is for a person who wants to try one or more destinations with their fresh data before
  they move; it is not a trial of Ownpace, and nothing on screen calls it one (D2, D3). *Copy
  everything* broadens it: the next pass of each windowed data type is phase B. The other way, from
  everything to 90 days, does not exist (§5.3).

`since` is the start of the UTC day 90 days before the anchor. For a migration of everything the
anchor is the moment its first windowed pass of that data type starts, recorded with the window
(§3.3, D7). For a 90-day migration it is the moment the migration is created, stored in its
setting (§5.1), so its window grows with time and never slides: an item copied into it never
leaves its window.

### 3.2 Where the window lives in the engine

**In `runAllDomains`** (`packages/orchestration/src/orchestration.ts`), used by both editions.
Each lane (`planDomainLanes`) runs its data types twice where a window is owed: first a window pass
of every data type in the lane whose phase A is not done, then the ordinary pass of each. So
across a migration, the last 90 days of every data type are in before any lane starts on older
material. For a 90-day migration, every pass is the window pass and there is no second round.

`runOneDomain(domain, { window })` hands the window to the domain wrappers (`mail-sync`,
`dav-sync`, the file wrapper), which set a new dep on `DomainSyncDeps`:

```ts
/** This pass reads a window, not the whole source (workplan 0170). */
readonly window?: {
  readonly since: Date;
  /** Whether the item is in the window, from its listing alone. */
  readonly holds: (item: Item) => boolean;
  /** A 90-day migration's pass (§3.1), rather than phase A of a migration of everything. */
  readonly only: boolean;
};
```

**In `runDomainSync`**, a window changes five things and nothing else:

1. **The listing.** `listSince(folder, cursor, { since })` (§3.5). Every item the source returns
   is checked with `window.holds`; what fails it is set aside exactly as a test marker sets an
   item aside (`unmarked`, workplan 0162 §4): not copied, not recorded, and its key goes into
   `setAsideKeys` so a reported removal or a bin entry never resolves it as deleted. Connectors
   may ignore `since`; the loop's check is the one that decides.
2. **The folder order, mail only.** Folders are taken Inbox, then Sent (by special use, RFC
   6154), then the rest in listing order. Only in a window pass.
3. **The cursor.** A window pass never writes a collection's content cursor. An IMAP cursor is
   `uidValidity:uidNext`; stored after a `SINCE` listing it would tell phase B that every older
   message had been seen, and they would never be copied, with no ledger row to show it. A 90-day
   migration stores its cursors under their own namespace, `windowCursorKey(collectionPath)`
   (§3.3), as the bin scan does (`discardedScanCursorKey`), so *Copy everything* finds no content
   cursor and phase B lists in full.
4. **Absence.** A window listing is not a complete listing of the collection. No ledger row is
   counted absent, and no path-keyed move or deletion is inferred (`detectPathKeyedMoves` is not
   called), as for `markedOnly` and `snapshot`. Reported removals and the owner's bin are positive
   evidence and are still read, against every item the source still lists, in the window or set
   aside. **So a 90-day migration never reads "outside the window" as "deleted"**: an item older
   than the window was never copied, and an item that leaves the window (an event moved to an old
   date) is set aside, not absent.
5. **Completion.** A phase A pass does not call `markCompleted` for its data type, so the stage
   stays *Copying*, verification is not offered, and `firstCopyOf` waits for phase B. A 90-day
   migration's window pass does call it: it is complete when its window is in, and its *in step*
   means in step for the window.

The discovery read (`packages/core/src/discovery.ts`, `source.listSince(folder)`) takes the same
window for a 90-day migration, so *Review and start* counts what it will copy. For a migration of
everything, discovery reads in full, as today. The bin scan (`packages/core/src/reconcile.ts`)
never takes a window.

### 3.3 The record that phase A is done, without a schema change

The `cursor` table (ledger migration 0001) already keys free text per mapping. Two reserved keys,
built with U+0001 as `discardedScanCursorKey` is, so no real collection can produce them:

```ts
// packages/shared/src/recent-window.ts
/** Where a data type's window is recorded: its `since`, and whether phase A is done. */
export function windowRecordKey(domain: DiscoveryDomain): string; // `\u0001window-record\u0001${domain}`
/** A 90-day migration's own cursor for a collection, apart from its content cursor. */
export function windowCursorKey(collectionPath: string): string;  // `\u0001window\u0001${collectionPath}`
/** The record's value, JSON in `SyncCursor.value`. */
export interface WindowRecord {
  readonly since: string;             // ISO 8601, UTC midnight
  readonly state: 'copying' | 'in';   // 'in' once phase A reached the end of every collection
}
```

Written by `runAllDomains` through the `CursorStore` it already holds: `copying` when phase A
starts, `in` when the window pass ends with every collection reached
(`unfinishedCollections.size === 0`, no budget pause). A phase A that stops halfway stays
`copying`, and the next pass does phase A again; the ledger skips what it copied.

`CursorStore.clear` (the operator's RETRY) also clears these. That costs one more window pass, which
copies nothing new, and moves a migration of everything's anchor; it never loses an item, because
phase B follows. A 90-day migration's anchor is in its setting, not here, so a retry leaves its
window where it was.

### 3.4 No database change

The window record is in `cursor`; the 90-day setting is in
`mailbox_mapping.source_config_override` (§5.1), the per-mapping JSON that already holds the export
formats (0125 §5). The appliance writes the same `mailbox_mapping` row from its mapping file. If a
build finds it needs a column after all, it stops and says why in this plan before writing a
migration.

### 3.5 The shared interfaces (fixed here, built by T1)

`packages/shared/src/ports.ts`:

```ts
/** What a listing may be asked to leave out (workplan 0170). */
export interface ListOptions {
  /**
   * Only items on or after this instant are wanted. A source MAY filter by it on the server, and
   * MAY return items before it: the loop checks every item itself. It MUST NOT keep a listing
   * made with `since` where `listKeys` reads it (Google Drive, Dropbox and Box memo their last
   * listing for `listKeys` today), and it MUST NOT return a cursor that claims an item before
   * `since` was seen when that cursor could be stored as a content cursor.
   */
  readonly since?: Date;
}
```

`listSince(folder, cursor?, options?: ListOptions)` on `SourceConnector`, `CalendarSource` and
`FileSource`. Not on `ContactSource`: contacts are never windowed. The `unmarked` field's comment
widens to *items a selection set aside, a test marker's or a window's*; the name stays, so no
caller changes. `MarkedOnly*` (`packages/orchestration/src/marked-only.ts`) forwards `options`.

`packages/shared/src/recent-window.ts`, beside the two keys above:

```ts
export const RECENT_WINDOW_DAYS = 90;
export const WINDOWED_DOMAINS = ['email', 'file', 'calendar'] as const satisfies readonly DiscoveryDomain[];
/** The start of the UTC day `days` before `anchor`. */
export function windowSince(anchor: Date, days?: number): Date;
export function mailInWindow(item: MailItem, since: Date): boolean;      // receivedAt >= since
export function fileInWindow(item: FileItem, since: Date): boolean;      // modifiedAt >= since, or no date (D6)
export function eventInWindow(raw: RawCalendarEvent, since: Date): boolean;
```

T1 ships `eventInWindow` holding everything it cannot decide (no parsable DTSTART, any RRULE), so
a window never loses an event before T4; T4 replaces its body (§4.3). Tasks (`VTODO`) use the
calendar port and are never windowed: their data type is `task`.

## 4. Each source, and how it filters by date

A source that filters on the server saves the listing; one that cannot is filtered by the loop
after listing, which saves the downloads and uploads, the cost that matters. Each row's file and
call, from the code as it stands on `main`:

### 4.1 Mail (T2)

| Source | File and call today | Window |
|---|---|---|
| IMAP, and every IMAP account (Soverin, Apple, Cirrux, Infomaniak, IMAP for Microsoft) | `imapflow-source.ts`, `fetchListing`: `fetchAll('1:*', …)` by sequence; date is `internalDate` → `MailItem.receivedAt` | With `since`: `client.search({ since }, { uid: true })`, then `fetchAll(uids, …, { uid: true })`. `SINCE` is by day and ignores the time, so it may return a few extra; the loop drops them. An empty search answers no items and no cursor claim. |
| Gmail (over IMAP) | `gmail-source-factory.ts`, `GmailFolderView` delegates to `ImapFlowSource` | The same `SEARCH SINCE`, which Gmail honours. No `X-GM-RAW`: one path for every IMAP server. |
| Microsoft Graph mail | `graph-mail-source.ts`, `listSince`: `GET {scope}/mailFolders/{id}/messages/delta?$select=…` | With `since` and no cursor: add `$filter=receivedDateTime ge {iso}` to the first URL. The deltaLink carries it, so a 90-day migration's window cursor stays within the window. To confirm against Microsoft's documentation in T2: messages delta accepts `receivedDateTime ge` only. `MailSourceWithGraphFallback` forwards `options`. **T2 did not add the `$filter`: a filtered delta lists at most 5,000 messages (§11 question 1).** |

### 4.2 Files (T3)

| Source | File and call today | Window |
|---|---|---|
| OneDrive and SharePoint | `graph-drive-source.ts`: `GET {scope}/drive/root/delta`; date `lastModifiedDateTime` → `modifiedAt` | No date filter on driveItem delta. After listing, in `toRawFileItems`/`fromChanges`. |
| Google Drive | `google-drive-source.ts`, `listChildren`: `files.list` with `q='{id}' in parents and trashed=false …` | With `since`: `and modifiedTime >= '{rfc3339}'` in `q`, for files only (never `foldersOnly`). The `lastListing` memo that `listKeys` reads is not written by a listing with `since`. |
| Dropbox | `dropbox-file-source.ts`: `files/list_folder` and `/continue`; date `server_modified` | No date filter. After listing; the `listKeys` memo is not written by a listing with `since`. |
| Box | `box-file-source.ts`: `GET /folders/{id}/items?fields=…modified_at…` | No date filter on folder items. After listing; the same memo rule. `content_modified_at` is not added: `modified_at` is what `modifiedAt` already is. |
| WebDAV (any server, Nextcloud among them) | `webdav-source.ts`: `PROPFIND` `Depth: 1`, `getlastmodified` | No filter in PROPFIND. After listing. `listKeys` makes its own PROPFIND, unaffected. |
| The export archive | `archive-file-source.ts`, a snapshot: `open()` walks and hashes every item; date is the sidecar's `photoTakenTime` → `createdAt` → `modifiedAt` | After listing, which saves the uploads but not the walk. An item with no date (`modifiedAt` the epoch) is **in** the window (D6: *"one uploads all"*). |

### 4.3 Calendars (T4)

| Source | File and call today | Window |
|---|---|---|
| CalDAV: any server, Google (`google-dav-source-factory.ts`) and Apple (`dav-factories.ts`) | `caldav-source.ts`: `REPORT sync-collection`; fallback `calendar-query` with no `time-range` (`shared/src/caldav-query.ts`) | With `since` and no cursor: `calendar-query` with `<C:time-range start="{since}"/>` inside the VEVENT `comp-filter`. The server expands recurrence (RFC 4791 §9.9) and returns a series whose any occurrence is in range, as a whole resource. This path returns no sync token, so a 90-day migration lists its window each pass and has no removal report for calendars (§6). For `VTODO` (tasks) never. |
| Microsoft Graph calendar | `graph-calendar-source.ts`: `GET {scope}/calendars/{id}/events/delta`, then one `$value` per event | No date filter kept: `calendarView/delta` returns occurrences, not series, which changes the item and its key. Filter on the delta entry's `end` and `type` (`seriesMaster` kept) **before** the per-event `$value` fetch, which saves the requests. |

**A defect T4 fixes on the way.** `extractStart` in `caldav-source.ts` matches the first
`DTSTART` in the object, with no anchor to the VEVENT, so in a VCALENDAR whose VTIMEZONE comes
first it reads the time zone's `STANDARD`/`DAYLIGHT` start (often 1970); with no DTSTART it falls
back to now. `eventInWindow` parses DTSTART, DTEND or DURATION, RRULE's `UNTIL` and `COUNT`, and
RDATE from the VEVENT itself, and holds the event when it cannot decide.

## 5. The contract, the API and the appliance (T1)

### 5.1 Where the choice is stored

`source_config_override.recentOnly`, beside the export formats:

```json
{ "recentOnly": { "days": 90, "anchor": "2026-11-24T10:00:00Z" } }
```

Absent for every migration of everything. `MappingConfig` gains `readonly recentOnly?: {
readonly days: number; readonly anchor: string }`, read in `build-deps-from-mapping.ts` from the
merged override on managed, and by `parseMappingConfig` (`packages/shared/src/config.ts`) from the
appliance's mapping file (§5.4). A migration of everything needs no setting at all: phase A is how
every first copy runs.

### 5.2 The create route

`CreateMappingBase` (`apps/api/src/routes/migrations/index.ts`) gains `recentOnly:
z.boolean().optional()`. `true` writes the override with `days: 90` and `anchor` = the request's
time. The superRefine refuses `recentOnly` on a migration with no windowed data type (contacts and
tasks only), in our words, since it would copy the same as a migration of everything.
`openapi.yaml` documents the field on `CreateMappingRequest`, and the read of a migration gains:

```yaml
window:
  type: object
  properties:
    recentOnly: { type: boolean }
    since: { type: string, format: date-time, nullable: true }
    in: { type: array, items: { $ref: '#/components/schemas/DiscoveryDomain' } }  # phase A done
    copying: { type: array, items: { $ref: '#/components/schemas/DiscoveryDomain' } }
```

read from the window records (§3.3), so the page can show the milestone without a new table.

### 5.3 *Copy everything* is a revision, one way only

A new field in `packages/shared/src/config-revision.ts`'s `REVISABLE_FIELDS`: `recentOnly`. Its
rule has two directions (D2):

- **Broadening**, from the last 90 days to everything: allowed at any time, with the consequence
  *"The older items are copied next; what is already there stays."* On managed, through `PUT
  /api/migrations/:mappingId` with `{ recentOnly: false }`, which removes the key from the override
  (merged, never replaced, 0125 §5). The next pass of each windowed data type finds no content
  cursor, lists in full, and is phase B.
- **Narrowing**, from everything to the last 90 days: refused, always, whether or not anything was
  copied, with *start a new migration* (as `source.type` is refused).

### 5.4 The appliance, the same as managed (D5)

The appliance runs `runAllDomains` too, so phase A and B come to it with T1 and need nothing of
its own. The 90-day choice is in its mapping file, read by the shared `parseMappingConfig`:

```json
{ "recentOnly": { "days": 90 } }
```

The appliance writes the anchor itself when it first records the mapping, into the same
`source_config_override`, so a restart never moves the window; a file that names an `anchor` is
used as written. Broadening is removing the key from the file: the boot's revision check (0125 T2,
`mailbox_mapping.revision_state`) reads it through the same rule as managed, records the
broadening, and allows it. Adding the key to a mapping that had none is refused at boot with the
same sentence managed gives. The appliance's screens show the same state and milestone as managed
(§7.2, §7.3) where they show a migration's stage; *Copy everything* on the appliance is the file
edit, which its guide says.

## 6. What deltas, deletions, verification and the cutover lanes do with a window

- **Deltas.** Phase A writes no content cursor; phase B writes them as today. A 90-day migration
  writes window cursors only (§3.2 3). Graph mail's filtered deltaLink, IMAP's `uidNext` after
  `SINCE`, a WebDAV etag cursor of the window's items: each is read again only by a 90-day
  migration, never by phase B.
- **Deletion detection.** Off by absence in every window pass (§3.2 4). Reported removals and the
  bin still count. A 90-day migration over CalDAV has no removal report (its `calendar-query` has
  no sync token): a deletion at the source shows only through the bin, or after *Copy everything*.
  Said in the guide.
- **Verification counts.** The source count is the ledger's (`getSourceCountFromLedger`), so in a
  90-day migration both sides count the window. Verification is not run while any data type's
  phase A is done and its phase B is not (`copying`), since the destination is knowingly half full.
- **The cutover lanes.** Phase A and B happen before a data type's cutover and never after: the
  continuous lane (0117) and a data type's own cutover (0128 T5) start from a data type whose
  first copy is complete, which phase A alone is not. A 90-day migration is not switched over
  before it is broadened (D8, answered): T1 refuses it, and the page offers *Copy everything*
  where the switch-over would be.

## 7. The UX (T5)

Copy below is a proposal after the owner's D2 and D3; the owner reviews all Dutch. Each hint is
one sentence of at most 12 words, the rest behind *Why?* (0118 §2,
`words-that-fit-on-one-line.unit.test.ts`). *Destination* / *bestemming* is the product's word for
a target, as the screens already say it.

### 7.1 *Start a migration*, the *What moves?* step

Under the data types, one choice of two, *Everything* selected:

| Key | English | Dutch |
|---|---|---|
| `start.what.amount.label` | How much? | Hoeveel? |
| `start.what.amount.all` | Everything | Alles |
| `start.what.amount.all.hint` | The last 90 days come first, then everything older. | Eerst de laatste 90 dagen, daarna alles wat ouder is. |
| `start.what.amount.recent` | Only the last 90 days | Alleen de laatste 90 dagen |
| `start.what.amount.recent.hint` | To try a destination with fresh data; contacts and tasks whole. | Om een bestemming met verse gegevens te proberen; contacten en taken helemaal. |
| `start.what.amount.recent.why` | Mail, files and calendars from the last 90 days, and all contacts and tasks. Try as many destinations as you like this way. You can copy everything later, from the migration's page, without starting over. Nothing older is deleted or changed. | Mail, bestanden en agenda's van de laatste 90 dagen, en alle contacten en taken. Zo kunt u zoveel bestemmingen proberen als u wilt. Later kunt u alles kopiëren, vanaf de pagina van de migratie, zonder opnieuw te beginnen. Niets wat ouder is, wordt verwijderd of gewijzigd. |

Shown only when a windowed data type is ticked. The check step names it: *Only the last 90 days*
/ *Alleen de laatste 90 dagen*.

### 7.2 The migration's page (`MappingDetail.tsx`)

- A 90-day migration shows a chip beside the stage, *Last 90 days* / *Laatste 90 dagen*, and in
  the header **Copy everything** / **Alles kopiëren**, with a confirmation: *"Copy everything
  older too? What is there stays."* / *"Ook alles wat ouder is kopiëren? Wat er staat, blijft."*
  There is no action the other way.
- Its stage reads *Kept in step* for the window (`kept_in_step`), and the line under it
  (`stage-line.ts`) says *for the last 90 days* / *voor de laatste 90 dagen*.

### 7.3 The milestone

When every windowed data type's record is `in` and the migration is one of everything,
`stage-line.ts` gains one part, `recentIn`, ahead of the counts:

| Key | English | Dutch |
|---|---|---|
| `people.line.recentIn` | Your last 90 days are in. | De laatste 90 dagen staan erin. |
| `people.line.olderComing` | Older items are still coming. | Oudere items komen nog. |

While phase A runs, the line says *Copying your last 90 days first* / *Eerst uw laatste 90 dagen*.
During phase B the counts read *of about* as today, and the folder that looks half full is
explained by *Older items are still coming.* Mail arrives in the new mailbox newest first; its
dates are kept, so a mail program sorts it right.

### 7.4 The guides

One section per provider guide is too many: the window is the same everywhere. T5 adds
`docs/guides/en/start.md` and `docs/guides/nl/start.md`, *How a migration copies* / *Hoe een
migratie kopieert*, with `{#last-90-days-first}` and `{#last-90-days-only}`, added to
`SERVED_GUIDES`, and links them from the hint's *Why?* and from the chip. What each section says:
the order every migration copies in; what a 90-day migration copies, and that it is meant for
trying destinations; that *Copy everything* does not start over and that there is no way back to
90 days; that a 90-day migration over CalDAV sees deletions only through the bin; and, on the
appliance, the mapping file's `recentOnly` and how to broaden it.

## 8. Proofs (T6, with each task's own unit tests)

- **Unit, in each task.** T1: the window pass writes no content cursor and records `in` only when
  every collection was reached; nothing set aside is counted absent or resolved deleted; Inbox,
  Sent, rest; `markCompleted` not called by phase A and called by a 90-day migration; the revision
  rule both ways (broadening allowed, narrowing refused before and after a copy), on managed and at
  the appliance's boot; the create route and the spec; `parseMappingConfig` reads `recentOnly`.
  T2 to T4: each source's request with and without `since`, and the memo rule (§3.5) for Drive,
  Dropbox and Box. T4: `eventInWindow` over a VTIMEZONE first, a series ending before `since`, one
  with an override in the window, an all-day event, a COUNT.
- **Integration (T6)**, through Testcontainers in CI and on `./scripts/local-pg.sh` where no
  container runtime is:
  - Stalwart: an IMAP source seeded with `APPEND` at internal dates of 400, 100, 30 and 1 days ago
    in Inbox, Sent and a third folder. Phase A copies the two recent ones, Inbox before the third
    folder; phase B the rest; a third pass copies nothing. A 90-day migration copies two, writes no
    content cursor, and after *Copy everything* copies the other two with no duplicate.
  - Nextcloud: CalDAV with an old single event, an old weekly series without end, a series that
    ended a year ago, and an upcoming event: phase A copies the second and fourth whole. WebDAV
    with an old and a new file: the same two-phase result, and in a 90-day migration deleting
    nothing when the old file is moved.
  - The appliance: a mapping file with `recentOnly`, booted twice (the anchor does not move), then
    without it (broadened, phase B runs), then with it again (refused at boot).
  - Idempotency: the existing property tests run once with a window (hard rule 1).
- **E2E (managed).** One case in `deploy/compose/smoke-managed.sh`: a 90-day migration over the
  demo mail source, seeded with one old and one new message, copies one, then *Copy everything*
  through the API copies the other. Run by the owner (T7); never dispatched by a build session.

## 9. The tasks, as pull requests

| Task | Pull request | Depends on | Merges |
|---|---|---|---|
| T1 | `packages/shared` (`ports.ts`, `recent-window.ts`, `config.ts`, `config-revision.ts`), `packages/core` (`domain-sync.ts`, the wrappers, `discovery.ts`), `packages/orchestration` (`orchestration.ts`, `build-deps*.ts`, `marked-only.ts`), `apps/api` (create and update routes, the read, `openapi.yaml`), `apps/selfhost` (the anchor at first record, the boot's revision check) | none (D8 answered: the cutover refusal stays) | 1st |
| T2 | `imapflow-source.ts`, `graph-mail-source.ts`, `mail-source-with-graph-fallback.ts` | T1's interface | after T1, any order with T3, T4 |
| T3 | `graph-drive-source.ts`, `google-drive-source.ts`, `dropbox-file-source.ts`, `box-file-source.ts`, `webdav-source.ts`, `archive-file-source.ts` | T1's interface | after T1 |
| T4 | `caldav-source.ts`, `caldav-query.ts`, `graph-calendar-source.ts`, `recent-window.ts`'s `eventInWindow` | T1's interface | after T1 |
| T5 | `apps/web` (`StartMigration.tsx`, `MappingDetail.tsx`, `Finish.tsx`, `stage-line.ts`, `i18n/strings/*`), `docs/guides/*/start.md`, `guide-handle.ts` | T1's API fields; the owner's Dutch | after T1 |
| T6 | the integration tests, the appliance's boot cases and the smoke case | T1 to T4 | last; then T7 |

T2, T3, T4 and T5 can be built in parallel once T1's branch is pushed, against its interface; each
brings `main` in by merging it after T1 merges (never a rebase). Each source task works without the
others: a source that ignores `since` is correct, only slower (§3.5).

## 10. The owner's decisions

Asked 2026-11-24, answered the same day (§1, verbatim).

- **D1. What 90 days means for a calendar.** ✅ **(a)**: every event that ends on or after
  `since`, including all upcoming ones, and every recurring series with an occurrence on or after
  it, copied whole. Not chosen: (b) only events that start on or after `since`; (c) calendars whole.
- **D2. What a 90-day migration is.** ✅ **Not a trial of Ownpace**: a person trying one or more
  destinations with their fresh data. It can be broadened from *only the last 90 days* to
  *everything*; never the other way (§5.3). What it means for switching over is D8.
- **D3. The names on screen.** ✅ **Revised from D2's words**: no *trial* / *proef* anywhere. The
  choice is *Only the last 90 days* / *Alleen de laatste 90 dagen*, the chip *Last 90 days* /
  *Laatste 90 dagen*, the action *Copy everything* / *Alles kopiëren*, and the milestone *Your last
  90 days are in.* / *De laatste 90 dagen staan erin.* (§7), for the owner's review of the Dutch.
- **D4. Can the order be switched off?** ✅ **No**: fresh first, older a bit later, is the default
  flow of every migration, with no setting.
- **D5. The appliance.** ✅ **The same as managed**, in alpha.19: both phases, and the 90-day
  choice in its mapping file (§5.4).
- **D6. An archive item with no date.** ✅ **In the window**: *"one uploads all"*.
- **D7. The anchor of a migration of everything.** ✅ **When its phase A starts.**
- **D8. May a 90-day migration be switched over before it is broadened?** ✅ **(a), no**: *"D8:
  no, not before"*. Switching over follows *Copy everything* and its phase B. Raised by D2, with
  the options (a) no, and (b) yes, with a sentence that the older items stay at the source. The
  advice was (a): the switch-over is the step where a person stops using the old account, and its
  checks assume a whole copy; someone who settles on a destination broadens first.

## 11. Open questions

1. ✅ **Answered in T2, 2026-11-24: no `$filter` on Graph mail; it filters after listing.**
   Microsoft's page for messages delta (Microsoft Learn, *message: delta*, v1.0, and *Get
   incremental changes to messages in a folder*) supports `receivedDateTime ge` and carries it in
   the nextLink and deltaLink, but also says: *"Applying `$filter` in a delta query returns only
   up to 5,000 messages."* An Inbox can hold more than that in 90 days, and the rest would never
   be listed, with nothing to show it. The page also does not mention shared mailboxes; it lists
   `GET /users/{id}/mailFolders/{id}/messages/delta`, with no difference between delegated and
   application permissions. So the listing stays whole, its deltaLink is true for any later
   listing, and the loop sets aside what is older before anything is downloaded. No real tenant
   read was needed to decide it.
2. Whether a 90-day migration over CalDAV should also read a sync token, so a deletion at the
   source is reported while it runs. Left out of alpha.19 (§6); asked again after a real run.
3. ~~D8 (§10).~~ Answered 2026-11-24: (a), no switch-over before *Copy everything*.
