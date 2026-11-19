# Workplan 0160 — Cirrux as a destination

> **In one line:** Cirrux, a Dutch workspace hosted in Frankfurt, as a place to migrate into: mail, calendars, contacts and tasks over the IMAP and DAV servers it publishes, and its Drive, which only its own OAuth API reaches, as a later connector.

## Status — 2026-11-19 (update this block at the end of every session)

**2026-11-19, later again: T3's third correction.** With the second correction on the test
environment, the calendar pass found the calendar home and made the source's calendar: Cirrux
answered the MKCALENDAR with 201 and showed the calendar, with the name asked for, beside the
mailbox's Calendar and Reminders. Then it refused every event written to the address asked for
with 404, 25 in a row, and the pass stopped. Cirrux keeps a new calendar under an id of its own.
The writer now asks for a new calendar at a UUID of its own in a home the server named, and
reads the 201 back: the address, the `Location`, then the home's listing (§5). The calendar the
pass made is found again by its name, so no second one is made.

**2026-11-19, later still: T3's second correction.** With the contacts correction on the test
environment, the contacts arrived and show in Cirrux. The owner's next **Sync now** skipped all
1,244, the ledger already holding each one, and its calendar pass failed before it wrote an event:
`MKCALENDAR failed for /calendars/<mailbox>/<slug>/ with status 404`. Cirrux keeps its calendars
elsewhere than Nextcloud's `calendars/<user>/`. The CalDAV writer now asks the server where the
account's calendars are, as the CardDAV writer does, through one helper both share
(`dav-home-set.ts`), and makes the calendar there (§5). A failed type ends the pass, so
nothing after it ran: not after contacts on the first passes, not after calendars on this one.
Tasks and mail have had no turn yet. A pass that goes on to the next type after a failure is
0143 T5's to change.

**2026-11-19, later: T2's first pass, and T3's first correction.** On the test environment, a
Cirrux account's first contacts pass failed before it wrote a card:
`MKCOL failed for /addressbooks/users/<mailbox>/address-book/ with status 501`. The
CardDAV writer had assumed Nextcloud's layout and made a new address book for each one at the
source, and Cirrux makes none (§5). The writer now asks the server where the account's address
books are, and writes into the one the mailbox has. The rest of T2 (§4, step 8) is still to run.
Main's scheduled E2E (managed) at 12:01 UTC, queued behind T1's branch run, refused the test
database at 0068 (*newer than this build understands*), as that guard is meant to: it ran main as
it was before #1941, and main carries 0068 since.

**2026-11-19: T0 read and T1 built.** Cirrux's help site was
read page by page (42 help and API pages and 6 common
questions, from `cirrux.co` itself; §1 lists every fact with its page). T1 adds `cirrux` as a
destination account in Soverin's shape: one row, one app password, four faces (email, calendar,
contact, task), the servers Cirrux publishes pre-filled from a provider-directory row that names
its two pages and the day they were read, a reasoned *no* for the file face, a setup checklist, a
guide in English and Dutch, the card on *Where does it go?* and the Accounts page, the site's
*Where to* card, and ledger migration 0068, which widens `connection.kind` by one value. Three
seams that asked `kind === 'soverin'` now ask one table, `MAIL_SERVER_ACCOUNT_KINDS`, so Soverin's
behaviour is unchanged byte for byte and Cirrux gets the same.

What is proven, and how: `tsc --noEmit` for the repository, the site and the web app; ESLint on
every changed file; the whole `unit` project (1107 files, 17090 tests, 33 skipped) and the whole
`unit-browser` project (184 files, 3532 tests), with the migration chain replayed on PGlite; the
site's `build.mjs --check` (28 pages, nothing unfilled); and fourteen mutations, each breaking
one line of T1 and each caught by the test meant to catch it (§3). What is not proven: anything against a live Cirrux mailbox. **No DAV path, principal URL or
`/.well-known` discovery is published**, and nothing has asked `api.cirrux.co` yet, so whether
discovery from the host's root finds the calendars is the first thing T2 measures. No API key and no webhook were used, and none is needed (§2 (d)).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 What Cirrux publishes | builder | ✅ **Read 2026-11-19** | §1. From the pages themselves; three search-index snippets were stale and are corrected there. |
| T1 The `cirrux` destination | builder | 🔨 **Built 2026-11-19** | §3. Every host and port from `https://cirrux.co/help/setup` and `https://cirrux.co/help/calendar`; the DAV base URL left empty because no path is published. |
| T2 The first live Test and migration | owner | 🔨 **Started 2026-11-19**: contacts failed with a 501, calendars with a 404, then each event with a 404, each corrected in T3; tasks and mail have had no turn yet | §4: a Cirrux mailbox, an app password, the Test, then one small migration with each data type, and four things to look at. Step 8 is still to run. |
| T3 What T2 corrects | builder | 🔨 **Three corrections 2026-11-19**: contacts go into the mailbox's own address book; calendars and task lists are made where the server keeps them; a new one is read back where the server put it | §5. A DAV base URL, if discovery from the root finds nothing; a label behaviour the guide states; the invitation check. |
| T4 The proof written down | builder | ⏳ **Waits on T2** | The feature matrix's ⏳ for `cirrux` becomes ✅ per face that T2 ran, with its counts, as the matrix's *Live proofs* rule asks. |
| T5 Files into Cirrux Drive | builder, owner | ⛔ **Blocked**: an OAuth client only Cirrux issues, and a decision about rotating refresh tokens | §6. The API is documented in full; the connector is not written against it until both blockers are gone. |
| T6 Cirrux Docs | — | 🅿️ **Parked** | §7. A preview editor for early-access accounts; files stay files. |

## 1. What Cirrux publishes (T0)

Read on 2026-11-19. *Read* means the page itself was read; *inferred* says what it rests on.

| Fact | Page | How |
|---|---|---|
| IMAP `imap.cirrux.co`, 993 (SSL) or 143 (STARTTLS); SMTP `smtp.cirrux.co`, 465 (SSL) or 587 (STARTTLS); username the email address; password an App Password | `https://cirrux.co/help/setup` | read |
| Calendar, Contacts and Reminders each: Server `api.cirrux.co`, username the email address, password an App Password. No port and no path for any of the three | `https://cirrux.co/help/setup` | read |
| "point your client at api.cirrux.co with your email address as the username and the app password as the password" | `https://cirrux.co/help/calendar` | read |
| The account's own password is refused for IMAP, SMTP and CalDAV; app passwords are made per mailbox on its Passwords tab (New app password), shown once; no Passwords tab means the workspace turned external apps off | `https://cirrux.co/help/setup` | read |
| An app password works for its one mailbox until deleted; IMAP IDLE is supported | `https://cirrux.co/help/questions/script-or-agent-reads-and-sends-mail` | read |
| TLS for IMAP, SMTP, CalDAV and CardDAV | `https://cirrux.co/help/encryption` | read |
| No WebDAV, no DAV path, no principal URL, no `/.well-known` on any of the 42 pages | all of `https://cirrux.co/help/*` | read (searched) |
| A DAV client given only `api.cirrux.co` finds the collections by RFC 6764 discovery or a PROPFIND on the root | from the two rows above | **inferred**: Apple's apps are documented to work with the bare server name; not yet observed |
| Port 443 for the DAV server | from the bare server name | **inferred**: a DAV server named without a port is HTTPS on its own port |
| Every mailbox has a default calendar, an address book called Contacts and a task list called Reminders; Apple Reminders adds lists over CalDAV; a calendar may hold events and tasks at once | `https://cirrux.co/help/calendar`, `https://cirrux.co/help/api/contacts`, `https://cirrux.co/help/api/tasks` | read |
| Recurring tasks work in Apple Reminders | `https://cirrux.co/updates/email-filters-cirrux-sync` | search snippet only |
| Folders are labels; a slash nests; IMAP shows labels as nested folders; a folder created over IMAP becomes a label | `https://cirrux.co/help/questions/subfolders-in-my-mailbox` | read |
| Changes through Cirrux Calendar or its API email guests invitations, updates and cancellations | `https://cirrux.co/help/api/calendar` | read |
| Whether the CalDAV server sends invitations for an event written over CalDAV, and whether it honours `SCHEDULE-AGENT=CLIENT` | — | **not published** |
| Server-side filters run as mail arrives and can forward; whether they run on IMAP-appended mail | `https://cirrux.co/help/mailboxes` | read; the second half **not published** |
| Drive at `drive.cirrux.co`; 2 GB per file in the web app; names unique per folder, case-insensitive; trash 30 days | `https://cirrux.co/help/drive` | read |
| Drive API: the shape in §6 | `https://cirrux.co/help/api/drive` | read |
| Docs at `docs.cirrux.co`, a preview for accounts given early access; documents live in Drive; the API reads and writes them as Markdown; export as PDF or Markdown | `https://cirrux.co/help/docs`, `https://cirrux.co/help/api/documents` | read |
| API under `https://api.cirrux.co/public_api`, `/v1`, bearer tokens. A workspace API key (`cxk_…`, made by an admin) reaches only `workspace.read`, `email.read`, `email.write`, `email.send`, in the mailboxes chosen for it; Drive, Calendar, Tasks, Contacts and Documents need a user-scoped OAuth token and refuse a key with `403 forbidden`. 18 scopes. OAuth: authorization code with PKCE `S256`, public client, access tokens 15 minutes, refresh tokens 30 days, each refresh retiring the previous one. 600 requests a minute per token; `429` with `Retry-After` | `https://cirrux.co/help/api` | read |
| An OAuth client ID is not self-service: email help@cirrux.co with the app's name, its redirect URLs and its scopes | `https://cirrux.co/help/questions/oauth-client-for-my-app` | read |
| Webhooks: one event, `email.received`, per mailbox, not fired for mail copied in by an import or saved over IMAP; HMAC-SHA256 signature; five attempts | `https://cirrux.co/help/api/webhooks` | read |
| The webhook page says `GET /v1/emails/{uuid}` refuses a workspace API key; the API introduction says a key may read mail | `https://cirrux.co/help/api/webhooks`, `https://cirrux.co/help/api` | read; the two pages disagree |
| One seat price, €2,99 a month or €29 a year with 20 GB; Plus 100 GB, Large 500 GB, Max 2 TB; one storage pool per workspace for mail, Drive, documents and Gmail backups; over the tier for seven days, the workspace moves up; uploads past the pool are refused; no free mailbox; a 14-day refund | `https://cirrux.co/help/billing` | read |
| No published limit on message or attachment size, or on IMAP or DAV request rates | all pages | read (searched) |
| Microsoft Sync is live: read-only, one way, hourly; mail, calendars and contacts; not OneDrive, the online archive, event attachments, group calendars or contact lists. Google Sync the same for Google, without Drive. An IMAP import for other providers, run by hand; `.ics` and `.vcf` uploads | `https://cirrux.co/help/microsoft-sync`, `https://cirrux.co/help/google-sync`, `https://cirrux.co/help/imap-import`, `https://cirrux.co/help/switch-from-microsoft` | read. The search index still held an older Microsoft Sync page saying "no direct connection yet"; the page as served says it connects |
| Werk Slim B.V., Hilversum, Netherlands; Exoscale DE-FRA1 in Frankfurt, and a backup mail exchanger in Exoscale AT-VIE2, Vienna | `https://cirrux.co/terms`, `https://cirrux.co/help/reliability` | read |
| MX `smtp.cirrux.co` (10) and `mx-fallback.cirruxmail.com` (20) | `https://cirrux.co/help/domains` | read |

## 2. The decisions

**(a) Today, without T1, a person can already migrate into Cirrux** through the protocol cards,
as three accounts: **IMAP** with Host `imap.cirrux.co`, Port `993`; **CalDAV** with Host
`api.cirrux.co`, Port `443` and the DAV base URL empty (calendars and task lists); **CardDAV**
with the same host and port (contacts). Each takes the mailbox's email address as Username and
the app password as Password, and *Where does it go?* sends each data type to its own account.
Nothing in that route is less tested than T1: it is the same writers on the same servers. It is
three forms retyping one credential, with no published settings in the boxes and no reason given
for files.

**(b) What the `cirrux` destination adds** is one account for all four data types; the servers
in the boxes with the line saying whose settings they are and when they were read; a Password box
that says it wants an app password; a Test that measures each part and answers Files with the
reason Cirrux Drive cannot be reached; a setup checklist; a guide in English and Dutch; the
card, the tile, and the site's *Where to* card and *Goes to* lists; and, when an account is
deleted, the exact Cirrux screen where the app password is retired.

**(c) Files, docs and tasks.** Tasks go over standard CalDAV and are in T1: every mailbox has a
Reminders list that Apple Reminders reads over CalDAV. Files are not reachable over any standard
protocol: Cirrux Drive has no WebDAV, only its HTTP API, so a files face is a connector of its own
(T5). Docs are Cirrux's own collaborative editor, in preview; a migrated Word or OpenDocument file
stays a file in Drive once T5 exists, and nothing here converts documents into Cirrux Docs (T6).

**(d) The owner's API key and webhooks are not needed**, for T1 or for anything planned. A
workspace API key reaches mail and the workspace only, and this product writes mail over IMAP
with an app password; it cannot reach Drive, calendars, contacts, tasks or documents. The one
webhook event reports mail arriving in a mailbox, does not fire for imported mail, and a one-way
migration into Cirrux has nothing to do with it. What T5 needs instead is an **OAuth client ID**
from Cirrux (§6), requested with the scopes `user.profile`, `drive.read`, `drive.create` and
`drive.update`, and `drive.delete` only if owner-approved removals should reach Cirrux Drive.

**Cirrux's own sync.** Cirrux Sync copies mail, calendars and contacts from Google or from one
person's Microsoft account into Cirrux, one way, every hour; it leaves Google Drive and OneDrive
files behind and names no tasks. It and this product write into the same mailbox, calendars and
address book, and neither knows what the other wrote, so the guide tells a person to use one of
the two for each kind of data.

## 3. T1 — the `cirrux` destination (built)

- **The kind.** `cirrux` in `PROVIDER_ACCOUNT_KINDS` and `PROVIDER_ACCOUNT_DOMAINS` (email,
  calendar, contact, task), `TARGET_TYPE_DOMAINS`, the create and connection doors, the ledger
  enum and migration `0068_the_cirrux_account.sql` (widening only), the front door's lane and
  mark, the web card and tile, the probe (a named account's headline face is its calendar, by
  the account table rather than a list), the qualification and the source-face table (the
  account table serves both roles, so it is in Soverin's state as a source: buildable, offered
  by no door).
- **One table for the mail face.** `MAIL_SERVER_ACCOUNT_KINDS` (soverin, cirrux) and
  `storesItsMailServer` in `packages/shared/src/provider-accounts.ts`, read by the field
  descriptor, the create door's refusal and stored config, the mail seam in
  `build-deps-from-mapping.ts` and the qualification. Soverin's sentences are unchanged; the
  two refusals now name the kind they refuse.
- **The published settings.** A `PROVIDER_DIRECTORY` row: `api.cirrux.co`, `443`,
  `imap.cirrux.co`, `993`, from `https://cirrux.co/help/setup` and `https://cirrux.co/help/calendar`,
  seen 2026-11-19. No `url`: no path is published.
- **The reasoned no.** The qualification answers Cirrux's file face with why: no WebDAV, an API
  that signs a person in through an app Cirrux registers.
- **Words.** The card's hint, the Password box's hint, three setup steps, the credential
  retirement naming Settings → Mailboxes → the mailbox → Passwords, all in English and Dutch;
  `docs/guides/en/cirrux.md` and `docs/guides/nl/cirrux.md`; the site's card and short name.
- **Records.** `CHANGELOG.md`, `docs/feature-matrix.md` (⏳ per face), `docs/target-providers.md`.

**Tests added or widened:** the directory row pinned to its values and its `cirrux.co` sources;
the door's fields, required fields, secret and hint; the mail seam building `imap-dav` on the IMAP
host and refusing without one in the guide's sentence; the create door demanding and storing the
mail server, and a protocol target never storing one; the qualification's four faces and its
reasoned no; the probe's headline face for both account kinds; the credential retirement; the
checklist's words against the guide in both languages; the destinations per data type; a
plausible stored row for the face-building guard.

**Mutations, each run against the one test meant to catch it, and each caught:**

| # | The line broken | Caught by |
|---|---|---|
| M1 | the directory row's host, `api.cirrux.co` → `caldav.cirrux.co` | `provider-directory.unit.test.ts`, the Cirrux row |
| M2 | the Password box's hint removed | `credential-fields.unit.test.ts`, the Cirrux door |
| M3 | the mail seam back to `kind !== 'soverin'` | `build-deps-from-mapping.unit.test.ts`, 2 cases |
| M4 | the create door's refusal back to `=== 'soverin'` | `create-coherence.unit.test.ts` |
| M5 | the stored mail face back to `=== 'soverin'` | `create-coherence.unit.test.ts` |
| M6 | the reasoned no for Cirrux Drive removed | `account-qualification.unit.test.ts` |
| M7 | the probe's headline back to `=== 'soverin'` | `probe-connection.unit.test.ts` |
| M8 | the credential retirement entry unhooked | `standing-grants.unit.test.ts`, 3 cases |
| M9 | the checklist's *New app password* changed | `a-checklist-that-says-what-comes-first.unit.test.tsx` |
| M10 | the Dutch guide's **Gebruikersnaam** changed | `end-user-docs.unit.test.tsx` |
| M11 | the site's Cirrux card removed | `where-to-is-the-apps-own-list.unit.test.ts`, 2 cases |
| M12 | `file` added to Cirrux's data types | `start-plan.unit.test.ts`, 2 cases |
| M13 | Cirrux's email builder set to `gmail` | `a-face-no-account-can-actually-build.unit.test.ts` |
| M14 | `cirrux` removed from the ledger enum | `a-kind-with-nowhere-to-live.unit.test.ts` |

## 4. T2 — the owner's live test

1. Create a Cirrux workspace with one mailbox (a mailbox is paid from day one; the first
   payment is refunded on request within 14 days).
2. In Cirrux Mail: Settings → Mailboxes → the mailbox → Passwords → New app password. Copy it.
3. In Cirrux, put a few things in the mailbox's own data: one event with an attendee whose
   address is one you read, one contact, one task in Reminders.
4. In Ownpace, Accounts → Add an account → Destinations → **Cirrux**. Leave the servers as
   filled in, type the mailbox's address and the app password, press **Add and test**.
5. Write down what the Test says: each face after **Carries:** and **Found:**, the counts, and
   the line about invitations (*calendar auto-scheduling* or not).
6. If calendars, contacts or tasks are *unknown* or found nothing, find the mailbox's DAV
   address in one of two ways, put it in **DAV base URL**, and test again. Write down the address
   (T3).
   - On a Mac: the mailbox's **Passwords** tab has a **macOS configuration** button
     (`https://cirrux.co/help/mac-profile`). Its profile is signed, and sets up the Mac's own
     calendars and contacts, so it names their server and, if Cirrux sets one, their path. Read
     only those lines, not the password's:
     `security cms -D -i ~/Downloads/cirrux-*.mobileconfig | grep -A1 -E '(CalDAV|CardDAV)(HostName|Port|PrincipalURL)'`.
     The profile carries an app password of its own: delete it on the same tab afterwards, and
     delete the downloaded file.
   - Or ask help@cirrux.co for the CalDAV and CardDAV address of the mailbox.
7. Start one small migration from a source you own into that account, with email, calendar
   (including one event with an attendee you control), contacts and tasks ticked, and let one pass
   finish.
8. Check four things: (a) the folders arrive as labels with the same names, and a message that is
   in two source folders arrives once or twice (write which); (b) no invitation reached the
   attendee you control; (c) the tasks arrive in a list beside Reminders and are tasks, not events;
   (d) a second pass copies nothing.
9. Delete the migration, then the account, and delete the app password on the Passwords tab.

## 5. T3 — what T2 may correct

- **Contacts refused with 501 (found 2026-11-19, corrected the same day)**. The CardDAV writer
  put every address book at Nextcloud's `addressbooks/users/<user>/` and made a new one for each
  address book at the source. Cirrux answered that MKCOL with 501, and its Contacts API has no
  call that makes an address book either (`https://cirrux.co/help/api/contacts`). Now, when the
  assumed place is refused with 403, 404, 405, 409 or 501, the writer asks the server where the
  account's address books are: `current-user-principal` at `/.well-known/carddav`, then at the
  configured base, then the principal's `addressbook-home-set`. In that home the folder goes into
  the book with its name, else a new book, else the account's one book. Several books, none
  with its name, is a failure that names them. Verification lists the same home, and a 501 is
  final in `dav-retry.ts`. Tested in `an-address-book-the-server-would-not-make.unit.test.ts`,
  with twelve mutations, each caught. Where Cirrux keeps its books is not recorded here: the
  writer asks every time.
- **Calendars refused with 404 (found 2026-11-19, corrected the same day)**. The CalDAV writer
  put every calendar at Nextcloud's `calendars/<user>/`, and Cirrux answered the MKCALENDAR there
  with 404. The calendars are now found as the address books are, by the same helper
  (`dav-home-set.ts`): `current-user-principal` at `/.well-known/caldav`, then at the configured
  base, then the principal's `calendar-home-set`. In that home the folder goes into a calendar
  with its name that holds the writer's kind (VEVENT, or VTODO for a task list), else a new
  calendar there, else the account's one calendar that holds that kind. A calendar that declares
  no kinds holds every kind (RFC 4791 §5.2.3). Several, none with its name, is a failure that
  names them. Apps add task lists to a Cirrux mailbox over CalDAV
  (`https://cirrux.co/help/api/tasks`); whether Cirrux makes an event calendar over CalDAV is not
  published, and the owner's next pass shows it. Verification lists the same home. Tested in
  `a-calendar-not-where-it-was-assumed.unit.test.ts`, with seventeen mutations, each caught,
  across both writers' tests.
- **A new calendar answered 201 and kept elsewhere (found 2026-11-19, corrected the same day)**.
  Cirrux answered an MKCALENDAR at `<home>/<slug>/` with 201 and made the calendar, named as
  asked, but under an id of its own: every event written to the address asked for was refused
  with 404. Cirrux names its calendars by UUID (`https://cirrux.co/help/api/calendar`), as do the
  calendars Apple's apps make. So a new calendar in a home the server named is now asked for at
  a UUID of the writer's own (`newCalendarSegment`: version 5's shape, from the account, the data
  type and the slug, the same on every pass). Its 201 is read back: a calendar at the address
  asked for, then at the answer's `Location` on this host (an address that answers but holds no
  calendar is not taken for one), then the calendar the home lists now and did not before (the
  one with the folder's name, or the only one). None of these fails the pass and names what
  was asked. A later pass finds the calendar by its name, or by the address made. An event
  refused with 404 now says when its calendar is not there. Tested in the same file, with
  fifteen more mutations, each caught. Whether Cirrux keeps the UUID asked for is not yet seen;
  the read-back holds either way.
- **Discovery finds nothing from the root**: a DAV base URL Cirrux gives goes into the guide and,
  if it is the same for every mailbox, into the directory row as `url`, with the reply as its
  source. If it differs per mailbox, the guide says where to ask and the row stays as it is.
- **A message in two folders**: the guide's *What moves* says which of the two Cirrux does.
- **An invitation arrives**: the guide's marker sentence becomes a warning, and the plan says what
  the writer does about it before anyone migrates a calendar with meetings into Cirrux.
- **The Test reports no auto-scheduling and none was sent**: nothing changes.

## 6. T5 — files into Cirrux Drive (the API's documented shape)

From `https://cirrux.co/help/api/drive`, read 2026-11-19, under `https://api.cirrux.co/public_api/v1/drive`:

- **Auth**: a user-scoped OAuth access token; a workspace API key is refused. Scopes
  `drive.read`, `drive.create`, `drive.update`, `drive.delete`.
- **Folders**: `POST /v1/drive/folders` (`name`, `parent_uuid`); `GET /v1/drive/files?folder_uuid=`
  lists children. Names are unique among live siblings ignoring case and Unicode form, at most 255
  characters, a slash allowed (`422 name_taken`).
- **Upload**: `POST /v1/drive/files` with base64 JSON, up to 100 MB; above that, up to 2 GiB,
  `POST /v1/drive/uploads` → `part_urls` → PUT each chunk to a presigned URL → `complete`, with
  AES-256-GCM encryption done by the client in Cirrux's `CXDRV2` wire format (16-byte header,
  5 MiB chunks, a fixed AAD layout), and a 24-hour expiry.
- **Update**: `POST /v1/drive/files/{uuid}/replace` with `base_ctag`, which refuses a stale
  replace with `409 version_conflict` — the shape of this product's version check (§11.1 of the
  architecture document).
- **Removal**: `POST …/trash` (restorable for 30 days, a `binned` kind) or `DELETE` (permanent).
- **Change feed**: `GET /v1/drive/changes?since=` with a durable `sync_token`, `410` to reseed.
- **Dates**: `content_modified_at` keeps the source's modification time.
- **Storage**: `422 storage_limit_exceeded`, and `GET /v1/workspace/storage` to read the pool first.

**Blocked on two things**, both outside this repository's code:

1. **An OAuth client ID.** Cirrux issues one by email to help@cirrux.co, given the name people
   see, the redirect URLs and the scopes. This product's consent doors live at
   `/api/migrations/<provider>/authorize` and `/callback`, so the request names one callback per
   deployment that will use it. Whether an appliance can use a client registered for the managed
   service's address is open question 3.
2. **Rotating refresh tokens.** Each refresh returns a new refresh token and retires the old one,
   and using a retired one signs the person out (`https://cirrux.co/help/api`). This product's
   stored credentials are written once and never written back by a pass, which is why Box uses
   its client-credentials grant instead (`packages/connectors/src/box-token-provider.ts`).
   Cirrux documents no such grant for Drive. A Cirrux Drive writer therefore needs the pass to
   write the new refresh token back, encrypted, after every refresh, and that is a change to a
   rule every connector keeps today: a decision for an ADR, before any code.

## 7. T6 — Cirrux Docs (parked)

Cirrux Docs is in preview for accounts given early access (`https://cirrux.co/help/api/documents`).
Its documents live in Drive and are read and written as Markdown through the Documents API.
Migrating a Word or Google document *into* Cirrux Docs would be a conversion, which this product
does not do for any destination; once T5 exists, such a file arrives in Cirrux Drive as the file
it is. Revisit when Cirrux Docs is open to every account and someone asks.

## What the owner does

- T2's steps, in §4, on a Cirrux mailbox of their own, and the four observations in step 8.
- Once the contacts correction (§5) is on the test environment: **Sync now** on the Cirrux
  migration, and the contacts line it reports. Done 2026-11-19: 1,244 skipped, already there.
- Once the calendar correction (§5) is on the test environment: **Sync now** again, and the
  calendar, task and mail lines it reports. Done 2026-11-19: the calendar was made, and every
  event was refused with 404, corrected in §5's third bullet.
- Once that correction is on the test environment: resume the paused Cirrux migration, and the
  calendar, task and mail lines it reports.
- For T5, when it is wanted: request an OAuth client from help@cirrux.co (§6, blocker 1), and
  decide whether a pass may write a refreshed credential back (§6, blocker 2).
- Nothing with a workspace API key or a webhook.

## Open questions

1. Should the Cirrux card stay without the experimental tag until T2 runs? Destination cards
   carry no tag today, Soverin's included; T4 records the proof either way.
2. If Cirrux's DAV root turns out to need a path, is it the same for every mailbox, so the
   directory row can carry it?
3. For T5: one OAuth client for every deployment, or one per appliance owner, given that Cirrux
   registers each client and its redirect URLs by hand?
4. For T5: may a pass write a rotated refresh token back to the stored credential, which no
   connector does today?
