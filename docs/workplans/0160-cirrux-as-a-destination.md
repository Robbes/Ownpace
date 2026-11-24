# Workplan 0160 — Cirrux as a destination

> **In one line:** Cirrux, a Dutch workspace hosted in Frankfurt, as a place to migrate into: mail, calendars, contacts and tasks over the IMAP and DAV servers it publishes, and files into its Drive through its own OAuth API, a sign-in a person adds to the account.

## Status — 2026-11-24 (update this block at the end of every session)

**2026-11-24: T2b, the owner's live Drive test, on the test environment: every step ran, and
none of §6's readings was proven wrong** (§6b; T4 for the file face). The OTA client arrived from
Cirrux with a client secret beside the ID; the secret is set nowhere, since this service is a
public client with PKCE and reads none, and the sign-in worked without it. Times are UTC.

1. **The client ID** went into the persisted `.env` (`deploy/compose/.env` is a link to it there),
   and the app phase restarted the API and the worker; both carry it. Step 1 as written was
   stale: it named `set-task-env.sh` and `deploy-tasks.sh`, which alpha.18 removed. Run from the
   operator's checkout, which was older than alpha.18, the app phase built Trigger.dev and stopped
   before `up`; from `main` it passed. And the gate adds `OWNPACE_REACHABLE_HOSTS` to its own copy
   of the `.env` only, after it persists the file, so the restart took the demo's Nextcloud away
   from the stack (*"that address is inside this service's own network"*) until the key was
   written to the persisted file by hand; the gate persists it since #2105. Step 1 is corrected.
2. `GET /api/provider-accounts` answered `cirrux.client: "deployment"`, and `GET
   /api/redirect-uris` listed `cirrux.migration` as the OTA callback Cirrux registered.
3. **Test** on the Cirrux account from T2: *Carries:* without Files, and **Connect Cirrux Drive**
   offered.
4. **Connect Cirrux Drive** (08:38): the window said *"Cirrux Drive is connected. Signed in to
   Cirrux as `<login>`, `<workspace>`. Files can now go to this account's Drive."*; the row
   *"Cirrux Drive is connected, and the account has been measured again."* and *Carries: Email ·
   Calendar · Contacts · Files · Tasks*. The next **Test** found *Files none, 219.8 MB*. The
   **Test** box under the row kept the earlier answer, without Files, until pressed again.
5. **Test** twice, a minute apart: both measured the Drive, no error, and the owner stayed signed
   in to Cirrux: two refreshes, each successor stored. *Found: Files none* counts folders at the
   top of the Drive (`qualifyCirruxDrive`), so a file there leaves it at none while the size grows.
6. The screens offer no Nextcloud or other WebDAV **source**, so the source was a Dropbox folder:
   a 10-byte text file, a 14.8 MB file, a 160.5 MB file and, added before the first pass, a 2.2 GB
   one; in Cirrux Drive, a folder of the same name with a file differing from the 14.8 MB one only
   in capitals. Generic DAV sources are passed on as work of their own.
7. **A migration of files only** (first pass 09:46): one folder, the one made; the text file and
   the 160.5 MB file created, the latter through the chunked upload in `CXDRV2`, and it plays in
   full from Cirrux: Cirrux decrypted every part (§6's readings 1 to 3, 20 and 21 hold). The
   capitals file was refused (*"Cirrux Drive already holds … Cirrux treats the two names as one:
   capitals and accents written another way do not count there. Nothing was copied and the file
   in Cirrux was not changed"*), and Cirrux's file was unchanged. The 2.2 GB file was refused before
   a byte was read (*"… is 2.2 GB, and Cirrux Drive takes files up to 2 GB each (2 GiB), however
   they are sent. It was not moved."*). Cirrux's own Drive page says 2 GB per file in its web app
   (§1), so no uploader here can carry a larger file into Cirrux.
8. **A replace**: the text file edited at the source arrived in Cirrux under the same file, through
   the chunked flow under `base_ctag`. **A conflict** could not be made: Cirrux's web app has no
   way to put a new version of a file in place, so the owner deleted the copy, emptied it from the
   trash and uploaded another file of the same name. The writer found its copy gone (*"changed at
   the source, and its copy is no longer in Cirrux Drive, so it was not replaced"*) and left the new
   file alone. Not observed: `409 version_conflict` on a `base_ctag`, which only Cirrux's API or apps
   can provoke.
9. **An approved removal** of the 160.5 MB file, deleted at the source, once *deleting by hand* was
   on: *Deleted on the new system too*, and the file was in Cirrux's trash.
10. **After fifteen minutes**: the pass at 10:16 came 19 minutes after the one before, and it and
    the next succeeded (*file: 0 created, 0 updated, 0 skipped*): the worker refreshed and wrote
    back, and nobody was signed out.
11. **Disconnect Cirrux Drive** (10:27): *"Cirrux Drive is disconnected: Ownpace deleted its sign-in,
    and no file goes to this account until you connect it again. Cirrux offers apps no way to end a
    sign-in, so at Cirrux it stays valid until it goes unused for 30 days. To end it sooner, revoke
    Ownpace in Cirrux Mail under Settings → Security, where the apps you have authorized are
    listed."*; *Carries:* without Files. **Sync now**: the files failed with *"This Cirrux account has
    no Cirrux Drive connected, so nothing was written for 'file', here or to any other destination.
    On the Accounts page, press Connect Cirrux Drive on this account, and 'file' carries on at the
    next pass."*, and nothing was written. Ownpace was listed under Cirrux's Settings → Security;
    the owner revoked it there, connected again, and the pass at 10:29 created a file added at the
    source meanwhile.
12. The migration was deleted. The account was kept, since another migration uses it, so the
    receipt that names the Drive sign-in was not observed.

No failure named `undecryptable_content`, `upload_size_mismatch`, `invalid_grant` or `name_taken`
(the capitals file was refused before an upload, by the writer's own key), and nobody was signed
out. Seen on the screens and left for later, with the owner's agreement: the plain headline of the
capitals refusal and of the missing copy is the generic *"The destination refused to accept this.
Common causes are no space left…"*; the migration's headline after the disconnect says *"press
Reconnect or Replace credentials"* where the row's button is **Connect Cirrux Drive**; a deletion
waiting while deleting by hand is off says *"Set `allowApplyDeletions: true` in its config"*; *Live
progress* counted a removed file and none of the copied ones (*0 of ~3 · 0 of ~175.3 MB*), and once
said *3 failed* beside *2 could not be copied*; and the Nextcloud account's Test names no size where
Dropbox's does.

**2026-11-20, late: the owner's test sent no mail, and Cirrux's copies keep their guests**
(ADR-0043, amended; §1's row on the marker; §4, step 11). Run on the test environment with this
change deployed (E2E (managed) run 44797714678, deployment 20261120.10), the queue held for it.
A new migration of the owner's own Google calendars into Cirrux copied 6,211 events, keeping their
guests, each marked `SCHEDULE-AGENT=CLIENT`, and the owner saw no mail from it. Step 11: (1) the
event whose only guest was the owner's second address arrived with that guest, and no invitation
reached it; (2) its title and time, changed at the source, arrived after **Sync now** with the
guest kept, and no update reached it; (3) could not be run, for the reason below. In its place
the other change that mailed on 2026-11-19 was run: a new event with the same only guest, which
again sent no invitation, then the guest taken off at the source and copied by the next pass, and
no cancellation reached it. The owner's answer: *"4b sends no mail, but did sync. Continue."*, and
the change merged on it. Not observed: a removal applied at Cirrux to a copy that lists guests.

Why (3) could not run: **Google's calendars report no deletions to this service.** As read on
2026-09-12 (`caldav-source.ts`), Google's `sync-collection` REPORT answers a first read with
nothing, so the source lists each calendar whole with `calendar-query` on every pass (this run:
*6,212 skipped*), and that listing names no removals. A calendar has no bin to read either, and an
item missing from a listing is never counted as deleted (`detectPathKeyedMoves` runs for files
alone). So an event deleted in Google never reaches **Deleted on the old system**, and no copy of a
Google event is removed at any target. Google Tasks is not affected: its API reports deletions. A
removal of a copy that lists guests can therefore come only from a source that reports deletions
(Microsoft 365, Nextcloud, Infomaniak, Cirrux), one item at a time, after **Turn on deleting by
hand**. How Google's calendar deletions could be read is being worked out with the owner.

Seen on the same run, and recorded where each belongs: four old messages copied from Gmail showed
the evening they were copied, because no IMAP writer here ever gave an APPEND the message's own
arrival time (workplan 0002; fixed in #1976), and the owner paused the run's mail until that
lands. Two messages that looked like one copied twice were two messages of one thread.

**2026-11-20: Cirrux's copies keep their guests again, for alpha.13, once the owner's test sends
no mail** (ADR-0043, amended; §1's rows of Cirrux's answer, §5's sixth bullet, and §4's steps 10
and 11 follow). Asked *"Decision for alpha.13, no rush: copy guests to Cirrux again?"*, the owner
answered *"Yes, copy to Cirrux again, but we need to test"*; ADR-0043's amendment of 2026-11-20
quotes the question, the three options and the answer. Cirrux had answered the same day (§1): its
server did not honour `SCHEDULE-AGENT=CLIENT`, and does now. `cirrux` is off
`TARGETS_THAT_MAIL_GUESTS`, which is empty and is kept, with its reader and the path for a copy
that lists guests (§5's fifth bullet), for the next kind seen mailing guests; the tests hand the
reader a list of their own and the writers their flag, so both stay proven while the list is
empty. Cirrux is written as Nextcloud is: each guest and the organiser kept and marked
`SCHEDULE-AGENT=CLIENT`, a copy there that lists guests rewritten and removed as at any target not
on the list, and the Test and the audit row saying what its server advertises. A copy written
while the guard was on names its guests in `COMMENT` lines, and gets them back at its next
rewrite, the next time the event changes at the source. Infomaniak is unchanged. An invitation
Cirrux might still send cannot be taken back, so the change merges only once §4's step 11 has sent
no mail on the test environment. Proven: the four guard files the change reaches
(`a-guest-a-server-would-mail`, `a-target-that-mails-guests-gets-none`,
`a-copy-that-lists-guests-is-left-as-it-is`, `target-scheduling`), changed to say so, 80 cases;
and seven mutations, each run against them and the file restored byte for byte: `cirrux` back on
`TARGETS_THAT_MAIL_GUESTS` (9 cases fail, in all four files), the reader ignoring a list it is
handed (4), the verdict or the recorder not handing its list on (2 each), the writer writing
guests to a kind on the list (3, one in `dav-write-round-trips`), and the path for a copy that
lists guests taken out of a rewrite (4) and of a removal (5). Every unit test file that reads a
changed file, 172 found with `git grep`, passed (4,755 cases); ESLint on the three changed
packages and `tsc --noEmit` found nothing; the six docs checks passed. Not proven: whether Cirrux
keeps to the marker now (§4, step 11).

**2026-11-19, night: T7, Disconnect Cirrux Drive** (§6; ADR-0052 amended). A Drive sign-in
ended only when its account was deleted, or when its app password was replaced with another
mailbox's. *Disconnect Cirrux Drive*, beside a connected Drive on the Accounts page, asks first,
then removes the Drive grant and nothing else (`POST /api/migrations/cirrux/disconnect`): under
the row lock a refresh takes, with the app password and every other key kept, the record's file
face set to its measured no and `connection.cirrux_drive_disconnected` written in the same
transaction. The API then drops its access tokens for the account; a pass running in the worker
stops within a minute, when its store says no grant is stored. A pass on the account refuses its
files before anything is built, writing them nowhere, in a sentence naming *Connect Cirrux
Drive*, stated `auth_expired`; a data type's status row now keeps a category its throw site
stated, so the Accounts row names that button. Cirrux's API pages name an authorization and a
token endpoint and no revocation (§1), so Cirrux is not asked: the answer says the sign-in lasts
there until it goes unused for 30 days, or until it is revoked under Settings → Security. A closed
organisation may disconnect, since it ends access and starts nothing. Proven: 54 new unit cases
as run, in nine files (the screen's six run in English and in Dutch), two of the files new
(`disconnect-cirrux-drive.unit.test.ts`, `a-disconnect-leaves-no-token.unit.test.ts`); four
existing pins follow the change (the pass's new sentence in two, `markFailed`'s stated category,
the closed-organisation door count); and two new cases in
`cirrux-grant-store.integration.test.ts`, run on a local Postgres 16 (`./scripts/local-pg.sh`):
the disconnect waits for a refresh holding the lock and removes the successor it stored, and on
a connection row security does not hold it does not reach another organisation's row. 39
mutations, each one change to this code on disk, restored byte for byte, each caught (§6,
*Disconnect Cirrux Drive (T7): the mutations*); one, the tenant filter in the removal's own
`WHERE`, only on real Postgres, since row security hides the other row from the unit tests'
role. Not proven: anything against a live Cirrux client (T2b, §6b step 11).

**2026-11-19, night: an event at Cirrux that lists guests is left as it is.** The owner tested
Cirrux alone, with two events of their own and a guest on each: taking the guest off one, and
deleting the other, each mailed the guest a cancellation (`METHOD:CANCEL`, the mailbox as its
organiser). So the events written before the guests came out would have mailed every guest a
cancellation the first time the writer rewrote one, since a rewrite takes every guest off, or
removed one. For a Cirrux target the calendar and task writers now read the copy first and,
when it lists a guest, send neither: the change at the source is not applied and is asked about
again on the next pass, and a removal answers *kept for its guests* and removes nothing (§5).

**2026-11-19, evening: Cirrux emailed invitations for the events written.** With the third
correction on the test environment, the resumed pass wrote events into the calendar it had made,
and Cirrux emailed an invitation to every guest of every event that listed one, past events
included. One that reached the owner shows how. It came in the test mailbox's name, for a meeting
from 2019 that an outside organiser had invited the source account to. Its attached `invite.ics`
names Cirrux's CalDAV server (`PRODID:-//Cirrux CalDAV//`), says `METHOD:REQUEST`, keeps the
outside organiser as `ORGANIZER`, and carries the attendee without the `SCHEDULE-AGENT=CLIENT`
the writer had put on it. Cirrux's calendar API page says the mailbox is always the organiser and
that guests are emailed invitations, updates and cancellations (§1). The owner paused the
migration. For a Cirrux target the calendar and task writers now write no guest and no organiser:
each becomes a comment that names the person (§5). The events written before the pause keep
their guests at Cirrux, and are left as they are: Cirrux emails every guest a cancellation when
such an event is deleted (*What the owner does*).

**2026-11-19, T5: built, to 2 GiB; merged as #1952 (`4db06696`)** (§6; ADR-0052). Both blockers are decided. A pass may
write a rotating refresh token back, for a provider whose tokens rotate, one refresh at a time per
connection, through the one credential store, by a compare-and-swap on what it read. And
Cirrux's client is one public client per deployment, PKCE `S256` and no secret, registered by
Cirrux by hand; two are requested, for the live callback
`https://app.ownpace.eu/api/migrations/cirrux/callback` and the OTA callback
`https://app.ota.ownpace.eu/api/migrations/cirrux/callback`, with the scopes `user.profile
workspace.read drive.read drive.create drive.update drive.delete`. Built: the consent door
(`/api/migrations/cirrux/authorize` and `/callback`), which stores the grant on the account; the
rotating write-back under the connection row's lock; the file face of the `cirrux` kind, which
exists only once a grant is stored and is a measured no without one, or without the deployment's
client (`CIRRUX_OAUTH_CLIENT_ID`); the Drive writer, to 100 MB in one request and to 2 GiB
through the chunked upload, each part encrypted here in `CXDRV2` and streamed; *Connect Cirrux
Drive* on the Accounts page; *Where does it go?* offering a saved Cirrux account for files once
its Drive is measured; the words in both languages.
Not proven: anything against a live Cirrux client (T2b, §6b). Where Cirrux's pages are
ambiguous, §6 says what the code assumes and how it fails if that is wrong.

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
it was before #1941, and main carries 0068 since. *2026-11-23, the same again:* the scheduled E2E
(managed) of 2026-11-23, run 45183707271, failed because its seed refused a schema newer than its
build (0075, *newer than this build understands*): #2080's branch E2E (managed), run 45175853703,
had migrated the shared OTA database before #2080 merged (on 2026-11-23 at about 15:49 UTC,
`d9c7dccd`). The guard did its job, and the next E2E (managed) on `main`, run 45256793178, was
green.

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
| T2 The first live Test and migration | owner | 🔨 **Started 2026-11-19**: contacts failed with a 501, calendars with a 404, then each event with a 404, each corrected in T3; then Cirrux emailed the guests of the events written, and the migration is paused; tasks and mail have had no turn yet | §4: a Cirrux mailbox, an app password, the Test, then one small migration with each data type, and four things to look at. Step 8 is still to run. Steps 10 and 11, the guests test on the test environment, come first (2026-11-20): §5's sixth correction merges only on their answer. |
| T3 What T2 corrects | builder | 🔨 **Five corrections 2026-11-19**: contacts go into the mailbox's own address book; calendars and task lists are made where the server keeps them; a new one is read back where the server put it; nothing written to Cirrux names a guest or an organiser; an event there that already lists a guest is neither rewritten nor deleted. **A sixth 2026-11-20**: the guests are written again, marked, as at Nextcloud, once §4's step 11 sends no mail | §5. A DAV base URL, if discovery from the root finds nothing; a label behaviour the guide states. |
| T4 The proof written down | builder | 🔨 **Files recorded 2026-11-24** (T2b); the other faces wait on T2 | The feature matrix's ⏳ for `cirrux` becomes ✅ per face that T2 ran, with its counts, as the matrix's *Live proofs* rule asks. |
| T2b The first live Drive test | owner | ✅ **Run 2026-11-24** on the test environment | §6b, and Status of 2026-11-24: connect, two refreshes, a files migration (a simple and a chunked upload, a capitals clash and a file over 2 GiB refused), a replace, an approved removal to the trash, a refresh after nineteen minutes, a disconnect and a reconnect. Not observed: `409 version_conflict`, and the account's deletion receipt. |
| T5 Files into Cirrux Drive | builder, owner | 🔨 **Built 2026-11-19, to 2 GiB** | §6; ADR-0052. The consent door, the rotating write-back one refresh at a time, the face and its Test, the writer (simple upload to 100 MB; the chunked upload to 2 GiB and every replace in Cirrux's `CXDRV2` format, streamed; `base_ctag`; the trash for approved removals), the Accounts page's button. |
| T7 Disconnect Cirrux Drive | builder | 🔨 **Built 2026-11-19** | §6, *Disconnect Cirrux Drive*; ADR-0052 amended. The grant alone removed under the row's lock, the record's file face and the audit line in the same transaction, the access tokens dropped (at once in the API, within a minute in a pass), a pass's files refused under `auth_expired`. Nothing asked of Cirrux, which publishes no revocation. |
| T6 Cirrux Docs | — | 🅿️ **Parked** | §7. A preview editor for early-access accounts; files stay files. |

## 1. What Cirrux publishes (T0)

Read on 2026-11-19. *Read* means the page itself was read; *inferred* says what it rests on;
*observed* is what the test mailbox did; *said* is what Cirrux answered on 2026-11-20,
paraphrased, and not yet observed unless the row says so.

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
| An event made through the API is organised by the mailbox the calendar belongs to, and the organiser cannot be set. Sending `attendees` replaces the guest list, and guests are emailed the update. Deleting an event emails its guests a cancellation; only the organiser can delete | `https://cirrux.co/help/api/calendar` | read |
| On 2026-11-19 the CalDAV server emailed an invitation, in the mailbox's name, to every attendee of an event written over CalDAV, past events included. It did not honour `SCHEDULE-AGENT=CLIENT`, and dropped it from what it sent | the invitation of 2026-11-19 (§5) | **observed**; not published |
| The server did not honour `SCHEDULE-AGENT=CLIENT`: it took a CalDAV PUT that lists attendees for a new event the organiser makes, and sent the invitations | Cirrux's answer of 2026-11-20 | **said**; what was observed on 2026-11-19 (§5) |
| It skipped events in the past, but took a recurring event with no end date for one still going on, which is why invitations went out for old events | Cirrux's answer of 2026-11-20 | **said** |
| The server honours `SCHEDULE-AGENT=CLIENT` now | Cirrux's answer of 2026-11-20 | **said**, and **observed** on 2026-11-20 (§4, step 11): no mail at a first copy, a change, or a guest taken off; a removal not yet observed |
| Deleting a single event sent its attendees a notification; deleting a whole calendar sends none | Cirrux's answer of 2026-11-20 | **said**; the first is what the owner's test of 2026-11-19 saw (§5) |
| An alarm that sends an email (`VALARM` with `ACTION:EMAIL`) is not supported | Cirrux's answer of 2026-11-20 | **said** |
| Cirrux's app should show an event's `COMMENT` when the event is opened | Cirrux's answer of 2026-11-20 | **said**; not yet observed |
| Server-side filters run as mail arrives and can forward; whether they run on IMAP-appended mail | `https://cirrux.co/help/mailboxes` | read; the second half **not published** |
| Drive at `drive.cirrux.co`; 2 GB per file in the web app; names unique per folder, case-insensitive; trash 30 days | `https://cirrux.co/help/drive` | read |
| Drive API: the shape in §6 | `https://cirrux.co/help/api/drive` | read |
| Docs at `docs.cirrux.co`, a preview for accounts given early access; documents live in Drive; the API reads and writes them as Markdown; export as PDF or Markdown | `https://cirrux.co/help/docs`, `https://cirrux.co/help/api/documents` | read |
| API under `https://api.cirrux.co/public_api`, `/v1`, bearer tokens. A workspace API key (`cxk_…`, made by an admin) reaches only `workspace.read`, `email.read`, `email.write`, `email.send`, in the mailboxes chosen for it; Drive, Calendar, Tasks, Contacts and Documents need a user-scoped OAuth token and refuse a key with `403 forbidden`. 18 scopes. OAuth: authorization code with PKCE `S256`, public client, access tokens 15 minutes, refresh tokens 30 days, each refresh retiring the previous one. 600 requests a minute per token; `429` with `Retry-After` | `https://cirrux.co/help/api` | read |
| An OAuth client ID is not self-service: email help@cirrux.co with the app's name, its redirect URLs and its scopes | `https://cirrux.co/help/questions/oauth-client-for-my-app` | read |
| No OAuth revocation an app can call: the pages name the authorization endpoint (`https://api.cirrux.co/oauth/authorize`) and the token endpoint (`https://api.cirrux.co/oauth/token`), and nothing else; the error table says an access token can be "unknown, expired or revoked". Both point to a metadata document, `https://api.cirrux.co/.well-known/oauth-authorization-server`, which was not read | `https://cirrux.co/help/api`, `https://cirrux.co/help/questions/oauth-client-for-my-app` | read (searched) |
| Settings → Security lists a person's active sessions and the apps they have authorized, and any of them can be revoked there; the AI-assistants page calls the list *Authorized apps* | `https://cirrux.co/help/security`, `https://cirrux.co/help/mcp` | read; whether this service's Drive sign-in is listed there is **not yet observed** (T2b) |
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
from Cirrux (§6), one per deployment, requested with the scopes `user.profile workspace.read
drive.read drive.create drive.update drive.delete`. `drive.delete` is used only to move a file
to the trash when a person approved removing it because it was deleted at the source.

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
10. **Before the guests come back: the setup** (2026-11-20; §5's sixth bullet; ADR-0043). This
    step and the next come first, before steps 7 to 9 are taken up again, and only on the test
    environment, once E2E (managed) has run on this change's branch and put it there: the change is
    not on `main` until step 11 has answered. Say *testing* before you start, which holds the
    queue, so nothing else goes to the test environment until you say *done* after step 11. Leave
    the migration paused on 2026-11-19 paused while the branch is there: a pass of it would write
    the guests of every event it has not copied yet, other people among them. Connect your Cirrux
    account there with an app password, as in steps 2 and 4: calendars need no OAuth client; only
    Drive does (§6b). In a source calendar you own, make one event in the future whose only guest is
    your own second address, and no other person. Start one migration of that calendar alone into
    the Cirrux account.
11. **The guests test, as it was run for Cirrux on 2026-11-19** (a guest taken off one event, and
    another event deleted, each mailed the guest a cancellation), now with the guest written to
    Cirrux, marked `SCHEDULE-AGENT=CLIENT`. Watch your second address's inbox at each of three
    steps. (1) The first pass: no invitation may arrive. (2) Change the event's title at the
    source, then press **Sync now**: no update may arrive. (3) Delete the event at the source and
    press **Sync now**; under **Deleted on the old system**, press **Delete it here too**, then
    **Confirm delete**: no cancellation may arrive. **No mail at any step** is the evidence that
    Cirrux keeps to the marker, as it said on 2026-11-20 (§1): the change merges, and the result
    goes into §1, this Status block and ADR-0043's amendment log. (3) needs **Turn on deleting by
    hand** on the Deletions page first, and a source that reports deletions: from Google it cannot
    be run, because Google's calendars report none (the Status entry of 2026-11-20, late). Take
    the guest off the event at the source instead, press **Sync now**, and watch for a
    cancellation; that is how it was run on 2026-11-20. **Mail at any step** means the
    change does not merge, and `cirrux` goes back on `TARGETS_THAT_MAIL_GUESTS`, where `main` still
    has it; you tell Cirrux which step mailed, and the step goes into §1.

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
- **Invitations emailed for the events written (found 2026-11-19, corrected the same day)**. The
  resumed pass wrote events with every `ATTENDEE` and `ORGANIZER` marked `SCHEDULE-AGENT=CLIENT`,
  as for every target (ADR-0043), and Cirrux emailed every attendee an invitation in the
  mailbox's name, past events included. The invitation's own attachment kept the outside
  organiser and lost the marker, and the API page says the mailbox is always the organiser (§1):
  over CalDAV, Cirrux schedules as its app does. So `cirrux` was put in `TARGETS_THAT_MAIL_GUESTS`
  (`packages/shared/src/calendar-scheduling.ts`), until 2026-11-20 (the sixth bullet), and
  ADR-0043 is amended for it the same day: the exception is undone by taking `cirrux` off the
  list once Cirrux can be written without mailing guests, shown by a pass that sends none. For a
  target of such a kind, the calendar and task writers write no `ATTENDEE` and no `ORGANIZER`:
  each is replaced, where it stood, by a `COMMENT` that names the person (*Invited at the source:
  …*, *Organised at the source by: …*).
  An email alarm's `ATTENDEE` is who the alarm goes to, and stays. `calendarContentHash` reads
  none of these lines, so verification compares as before. Both deps builders hand the writer
  the target's kind, and the connection test, the assessment and the audit row said for Cirrux
  what the writer did instead of what the marker would do. Tested in
  `a-guest-a-server-would-mail.unit.test.ts`, `dav-write-round-trips.unit.test.ts`,
  `a-target-that-mails-guests-gets-none.unit.test.ts` and `target-scheduling.unit.test.ts`,
  with seventeen mutations, each caught. The events written before the pause keep their guests
  at Cirrux, and are left as they are: the next bullet.
- **A copy that still lists guests, rewritten or deleted (found 2026-11-19, corrected the same
  day)**. The owner tested Cirrux alone: a guest taken off an event, and an event deleted, each
  mailed the guest a cancellation (`METHOD:CANCEL`, the mailbox as its organiser). A rewrite
  takes every guest off, so each event written before the previous bullet would have mailed all
  its guests a cancellation the first time its source changed, and a removal would have too. For
  a target in `TARGETS_THAT_MAIL_GUESTS`, the calendar and task writers now read the copy first,
  with one GET, and only on a rewrite or a removal. When it lists an `ATTENDEE` outside an alarm
  (`namesGuests`), nothing is sent. A rewrite answers `keptForGuests`: the row is left exactly as
  it was, its source version not advanced, so the next pass asks again and the rewrite goes
  through the day `cirrux` leaves the list. A removal answers `kept_for_guests` on *Deletions*
  and *Moves*, in words a person can act on. A copy that cannot be read, or whose answer holds no
  calendar object, is neither rewritten nor removed, and one that is gone is left gone. A guest added between the read and the `DELETE`
  changes the version, and `If-Match` then removes nothing. The pass's log and the run log say
  how many were left. Tested in `a-copy-that-lists-guests-is-left-as-it-is.unit.test.ts`,
  `a-guest-a-server-would-mail.unit.test.ts`, `update-propagation.unit.test.ts`,
  `apply-deletion.unit.test.ts` and `apply-relocation.unit.test.ts`, with twenty-five mutations,
  each caught.
- **Guests written again, once a test sends no mail (2026-11-20)**. Cirrux answered on 2026-11-20
  (§1): its server had not honoured `SCHEDULE-AGENT=CLIENT`, took a PUT that lists attendees for a
  new event the organiser makes, and skipped past events but not a recurring one with no end date;
  it says it honours the parameter now. The owner, asked whether to copy guests to Cirrux again
  for alpha.13, answered *"Yes, copy to Cirrux again, but we need to test"*, and ADR-0043's
  amendment of 2026-11-20 quotes the question, the three options and the answer. `cirrux` left
  `TARGETS_THAT_MAIL_GUESTS`, which is now empty. The list stays, with its reader and the fifth
  bullet's path, for the next kind seen mailing guests, and the tests hand the reader a list of
  their own and the writers their flag, so both stay proven while the list is empty. Cirrux is
  written as Nextcloud is: each guest and the organiser kept and marked `SCHEDULE-AGENT=CLIENT`,
  nothing read first, a copy that lists guests rewritten and removed as at any target not on the
  list, and the Test and the audit row saying what its server advertises. A copy written while the
  guard was on names its guests in `COMMENT` lines, and gets them back at its next rewrite, the
  next time the event changes at the source. A copy written before the guard, which still lists
  its guests and was kept for them (the fifth bullet), is rewritten and removed as any other.
  Tested in the four guard files the change reaches (`a-guest-a-server-would-mail`,
  `a-target-that-mails-guests-gets-none`, `a-copy-that-lists-guests-is-left-as-it-is`,
  `target-scheduling`). It merges only once §4's step 11 has sent no mail on the test environment.

## 6. T5 — files into Cirrux Drive (built, to 2 GiB)

From `https://cirrux.co/help/api/drive` and `https://cirrux.co/help/api`, read 2026-11-19, under
`https://api.cirrux.co/public_api/v1`: a user-scoped OAuth token (a workspace API key is
refused); folders by `POST /drive/folders` and listed by `GET /drive/files?folder_uuid=`; names
unique among live siblings ignoring case and Unicode form; a simple upload of base64 JSON up to
100 MB; a chunked upload up to 2 GiB, encrypted by the client in Cirrux's `CXDRV2` format; a
replace under `base_ctag`, which answers `409 version_conflict`; `POST …/trash`, restorable for 30
days, and a permanent `DELETE` this product never sends; `content_modified_at`; `GET
/workspace/storage`; 600 requests a minute per token.

### The decision (ADR-0052)

Cirrux Drive ships in alpha.12. Every refresh returns a new refresh token and retires the old
one, and a retired one presented again signs the person out, so a pass WRITES THE SUCCESSOR BACK:
only for a provider whose tokens rotate; one refresh at a time per connection, holding the
connection row's lock from reading the token to storing its successor; through `SecretStore`, by
an UPDATE that compares the ciphertext it read; never logged. A token Cirrux may have spent (an
answer that never arrived, `invalid_grant`) is removed in the same transaction and never sent
again; an answer that says nothing happened (`429`, `5xx`, a connection never opened) keeps it.
One public client per deployment, `CIRRUX_OAUTH_CLIENT_ID`, read by the API and the worker.

### What is built

- **The consent door** (`apps/api/src/routes/migrations/cirrux-oauth-routes.ts`,
  `cirrux-consent.ts`). `POST /api/migrations/cirrux/authorize` names a Cirrux destination of the
  organisation, refuses a deployment with no client (`no_cirrux_client`), a closed organisation
  and a person who has not accepted the texts, and begins a signed, single-use, ten-minute state
  holding the PKCE verifier. `GET /callback` refuses another issuer and an organisation closed
  since, exchanges the code, stores the refresh token on the account under the row's lock with
  the audit line `connection.cirrux_drive_connected`, measures the account again with the
  consent's own access token (so no refresh is spent), and tells the opening window only that the
  Drive is connected. The token never reaches a browser.
- **The grant** (`packages/orchestration/src/cirrux-grant-store.ts`): `CIRRUX_DRIVE_GRANT_KEY`
  in the account's encrypted record, beside the app password; the rotation under `SELECT … FOR
  UPDATE`; a new app password for the same mailbox keeps it, another mailbox's does not.
- **The tokens** (`packages/connectors/src/cirrux-token-provider.ts`): an access token in memory,
  single-flight in a process, each outcome sorted rotated, spent or kept.
- **Disconnect Cirrux Drive** (T7; `POST /api/migrations/cirrux/disconnect`,
  `removeCirruxDriveGrant`). Authenticated and scoped to the organisation as the consent door is;
  only on a `cirrux` destination of it (`not_a_cirrux_account` otherwise). Under the row's lock,
  `CIRRUX_DRIVE_GRANT_KEY` leaves the record and nothing else does, by a compare-and-swap on the
  ciphertext read; the record's file face becomes the measured no `qualifyCirruxDrive` answers
  without a grant, and `connection.cirrux_drive_disconnected` is written with the actor and the
  account, in the same transaction. Then `forgetCirruxAccess` drops the API's access tokens for
  the account; a provider elsewhere asks its store at most once a minute whether a grant is still
  stored (`holdsGrant`) before it hands out a token in memory. Nothing is sent to Cirrux: the
  answer's `revocation` is `unsupported`, with the Security page (§1), or `no_credential` with
  `removed: false` for an account that stored none (a second press, or a sign-in Cirrux had
  already ended, whose stale face is put right). Not refused for a closed organisation: it ends
  access and starts nothing, as withdrawing a grant does. A pass on the account then refuses its
  file data type before anything is built, in a sentence of its own (*nothing was written for
  'file', here or to any other destination*), stated `auth_expired`; and a data type's failure
  now keeps the category its throw site stated (`markFailed`, `domainFailedEvent`), so the
  Accounts row names *Connect Cirrux Drive*. The screen: *Disconnect Cirrux Drive* beside a
  stored sign-in, a question first (*Yes, disconnect* / *Keep it connected*), then what was done
  and how the sign-in ends at Cirrux, in both languages.
- **The face** (`qualifyCirruxDrive`, `GRANTED_TARGET_FACES`): a measured no, `structural`,
  without the deployment's client; a measured no, `notGranted`, without a grant; with one,
  measured through the stored sign-in (who, which workspace, the top of the Drive, the pool).
  The create door takes `file` for a stored Cirrux account and refuses it, naming the button,
  while the account stores no grant.
- **The writer** (`packages/connectors/src/cirrux-drive-target.ts`, `cirrux-drive-api.ts`):
  folders found by name, case-insensitively, single-flight per path; a simple upload to 100 MB,
  streamed and hashed as sent; the same name adopted, another capitalisation refused as a
  collision; a replace only when the source changed, always under a `base_ctag` (the one written,
  or for an adopted copy the one just read), through the chunked flow in `CXDRV2`, aborted on any
  failure; `content_modified_at` kept; an approved removal moved to the trash, only while the
  `ctag` is ours; the pool checked before the first upload of a pass; `429` waited out for its
  `Retry-After`. A file over 100 MB goes through the chunked upload (below); one over 2 GiB is
  refused before a byte is read, as not moved, with the reason.
- **The screens**: *Connect Cirrux Drive* on a Cirrux account's row, only with the deployment's
  client, its window opened in the press; *Where does it go?* offering a saved Cirrux account for
  files once its record measured the Drive, and never a new one; the standing failure naming the
  button; the card's hint, a fourth checklist step, the guides' *Files: Cirrux Drive*, the
  receipt and the retirement sentence naming the Drive sign-in.
- **The deployment**: `CIRRUX_OAUTH_CLIENT_ID` in `managed.yml` for the API and the `worker`
  service (until alpha.18, `set-task-env.sh` passed it to Trigger.dev's tasks), in
  `managed.env.example`; `GET /api/redirect-uris` lists the
  callback as `cirrux.migration`.

Two departures from the plan as split: `CXDRV2` and its known-answer vector landed in the first
step, because Cirrux offers no way to put new bytes in an existing file but the chunked replace;
and the first step already refused a file over 2 GiB as not moved, since "waiting" would have
been untrue for it.

### Where Cirrux's pages leave it open

What the code assumes, and how it fails when the assumption is wrong. Nothing here was invented
as Cirrux's behaviour; each is a reading T2b can confirm.

1. **The chunk index starts at 0** in the AAD (`CXDRV2_FIRST_CHUNK_INDEX`). The page says "the
   chunk index", not its base. Wrong, and every replace ends in `422 undecryptable_content`: the
   writer aborts the staged version and says so; the file in Cirrux stays as it was.
2. **The 16-byte header is in part 1**, in front of chunk 0, and each later part is one chunk.
   The page says the header "goes in front of the first chunk". Wrong, and complete answers `422
   upload_size_mismatch` or `undecryptable_content`; the same abort.
3. **The UUID's 16 raw bytes are in the order its text writes them.** Not stated. Wrong: the
   same `undecryptable_content`.
4. **`data_key` is "base64"**, alphabet unnamed (the download's `data` is URL-safe). Both are
   read; anything that is not 32 bytes is refused before anything is encrypted.
5. **100 MB is 100,000,000 bytes of the file**, not of the base64 body and not 100 MiB. If
   Cirrux counts otherwise, a file near the line meets `413 file_too_large`, and the same file
   goes through the chunked upload; nothing was stored by the refused request.
6. **A folder listing is complete**: no paging is documented. If Cirrux pages a large folder, a
   file beyond the first page is not seen, its upload meets `422 name_taken`, the folder is
   listed again, and the file fails by sentence: never a second copy.
7. **"Ignoring case and Unicode form"** is keyed as trimmed, NFC, lower case. Cirrux's exact
   folding (`ß` and `ss`, a dotted capital I) is not stated; a pair Cirrux joins and this key
   does not meets `name_taken` and is refused, never adopted as somebody else's.
8. **Files and folders are separate namespaces** under one parent, as the Drive page's own
   examples read. Wrong, and a file named like a folder meets `name_taken` and fails by sentence.
9. **The token answer** carries RFC 6749's names (`access_token`, `refresh_token`, `expires_in`,
   `scope`); Cirrux's page lists none. A `scope` that is present and lacks `drive.read`,
   `drive.create` or `drive.update` is refused; an absent one is not guessed at. An answer
   without a new refresh token is read as spent.
10. **The `iss` string** is in Cirrux's metadata document, which was not read; the callback
    compares origins with `https://api.cirrux.co`, and accepts an absent one (RFC 9207).
11. **A successor lives 30 days from its own issue.** Cirrux says refresh tokens last 30 days
    and rotate; whether the chain has a lifetime of its own is not said. A chain that ends earlier
    answers `invalid_grant`, the grant is removed, and the person connects again.
12. **"Signs the user out"** may end the person's own sessions or only the grant; the design
    takes the worst case and never presents a token that may be spent.
13. **Whether a refresh retires access tokens already issued** is not said. A `401` refreshes
    once and retries the request.
14. **The profile carries no email**, so the consent cannot check that the Cirrux person who
    signed in is the mailbox's. The window and the log name the login and the workspace.
15. **The token endpoint's limit**: 60 requests a minute per IP for requests without a bearer
    token. One refresh per writer per fifteen minutes stays far below it; a deployment with many
    Drives refreshing at a tick's start would meet it first, and a `429` keeps the token.
16. **A replace of a trashed file** is not described; this product never replaces a trashed
    copy (it is the person's, `conflicted`).
17. **No revocation endpoint** is documented (§1). Deleting the account, or *Disconnect Cirrux
    Drive*, deletes our copy, and both receipts say the sign-in expires at Cirrux after 30 days
    unused, or ends when the person revokes it under Settings → Security. The metadata document
    the API pages point to may name a `revocation_endpoint`; it was not read (item 10).
18. **`409 upload_in_progress`** from an upload this pass did not start is not aborted: it may be
    the person's own, in Cirrux's app. The file fails for that pass and is asked again; Cirrux
    discards an unfinished upload after 24 hours.
19. **A listing includes files still uploading**; such a file is never adopted as a copy.
20. **The upload routes' `{uuid}`** (`/v1/drive/uploads/{uuid}/part_urls`, `/complete`,
    `/abort`) is read as the init's `file_uuid`, the one the replace routes name; the init also
    answers a `version_uuid` and an `s3_upload_id`. Wrong, and the first part URL request answers
    `404`: the upload is aborted (or expires after 24 hours), and the file fails by sentence.
21. **No published test vector.** Cirrux's page gives the format and no example bytes. The
    format is pinned three ways instead: a round trip through a decryptor written from the page
    alone (`decryptCxdrv2`, in the fake Cirrux), which every upload and replace test passes
    through; a known-answer vector computed independently with WebCrypto
    (`cirrux-drive-format.unit.test.ts`); and T2b, where Cirrux's own complete decrypts the
    first chunk.

### The second step: the chunked upload, 100 MB to 2 GiB (built)

A new file over 100 MB goes `POST /v1/drive/uploads`, with its name, type, size, folder and
`content_modified_at`; its per-file `data_key` and chunk size come back, and the answer's chunk
count and ciphertext size are checked against this service's reading of the format before a byte
is sent. Each part is one chunk (the header in front of the first), encrypted as the plaintext
arrives and PUT to its presigned URL; the source is read at most a chunk or two ahead of the
PUT, never the whole file. Part URLs are asked for ten at a time, again once a batch is fifty
minutes old (they last an hour), and again once for a part whose PUT storage answered `403`.
Any failure aborts the upload, which takes the half-made file with it. A replace over 100 MB
goes through the same parts. A file over 2 GiB is refused before a byte is read, and an init
Cirrux answers `413` is the same refusal.

### Disconnect Cirrux Drive (T7): the mutations

Each made one change to the disconnect's code on disk, ran the tests meant to catch it, and was
put back byte for byte (its file’s SHA-256 compared after every one). S4 and S4b are one
mutation run twice: the unit tests connect as `app_user`, whose row security hides another
organisation’s row whatever the query says, and the integration test connects as the database
owner, which row security skips, as it skips the system role. S11 and S4b ran on a local
Postgres 16 (`./scripts/local-pg.sh`).

| # | What was broken | Caught by |
|---|---|---|
| S1 | the whole record dropped, not the one key | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 6 cases |
| S2 | the grant key kept | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 8 cases |
| S3 | any kind or role accepted | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 2 cases |
| S4 | the tenant left out of the removal’s own WHERE | not caught here: row security hides the other row from the unit tests’ role (see S4b) |
| S4b | the tenant left out of the removal’s own WHERE (real Postgres, row security not in force) | `cirrux-grant-store.integration.test.ts`: 1 case |
| S5 | the face not written with the removal | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 3 cases |
| S6 | a stale face left when nothing was stored | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 2 cases |
| S7 | nothing stored, still recorded as a disconnect | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 3 cases |
| S8 | an audit line that failed swallowed | `cirrux-grant-store.unit.test.ts`: 1 case |
| S9 | holdsGrant says yes whatever is stored | `cirrux-grant-store.unit.test.ts`: 2 cases |
| S10 | the store names no connection | `cirrux-grant-store.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 2 cases |
| S11 | the row lock left out of the removal (real Postgres) | `cirrux-grant-store.integration.test.ts`: 1 case |
| T1 | a disconnect here not looked at | `a-disconnect-leaves-no-token.unit.test.ts`: 1 case |
| T2 | a refresh the disconnect overtook handed out | `a-disconnect-leaves-no-token.unit.test.ts`: 1 case |
| T3 | the store never asked before a token in memory goes out | `a-disconnect-leaves-no-token.unit.test.ts`: 4 cases |
| T4 | the store asked on every call | `a-disconnect-leaves-no-token.unit.test.ts`: 2 cases |
| T5 | one question per item, not one for all waiting | `a-disconnect-leaves-no-token.unit.test.ts`: 1 case |
| T6 | a store that could not answer counted as a yes | `a-disconnect-leaves-no-token.unit.test.ts`: 3 cases |
| T7 | no grant stored, token kept and handed out | `a-disconnect-leaves-no-token.unit.test.ts`: 2 cases |
| T8 | a disconnect counted for every connection | `a-disconnect-leaves-no-token.unit.test.ts`: 1 case |
| R1 | this process’s tokens not dropped | `disconnect-cirrux-drive.unit.test.ts`: 1 case |
| R2 | another kind or an unknown id answered 200 | `disconnect-cirrux-drive.unit.test.ts`: 1 case |
| R3 | no audit line | `disconnect-cirrux-drive.unit.test.ts`: 2 cases |
| R4 | the face not handed to the removal | `disconnect-cirrux-drive.unit.test.ts`: 3 cases |
| R5 | the answer claims revoked | `disconnect-cirrux-drive.unit.test.ts`: 2 cases |
| R6 | a closed organisation refused | `disconnect-cirrux-drive.unit.test.ts`: 1 case |
| R7 | the body’s id not checked | `disconnect-cirrux-drive.unit.test.ts`: 1 case |
| W1 | the disconnect receipt says revoked | `token-revocation.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 4 cases |
| W2 | the Security page left out of how it ends at Cirrux | `token-revocation.unit.test.ts`, `disconnect-cirrux-drive.unit.test.ts`: 3 cases |
| P1 | the pass refusal states no category | `a-domain-whose-pass-never-asked.unit.test.ts`, `a-drive-face-a-sign-in-adds.unit.test.ts`: 2 cases |
| P2 | the pass says the create door’s sentence | `a-domain-whose-pass-never-asked.unit.test.ts`, `a-drive-face-a-sign-in-adds.unit.test.ts`: 3 cases |
| P3 | markFailed drops the stated category | `a-failure-with-its-reference.unit.test.ts`: 1 case |
| P4 | runOneDomain hands markFailed no stated category | `failure-side-recorded.unit.test.ts`: 1 case |
| P5 | the worker hands its event no stated category | `failure-side-recorded.unit.test.ts`: 1 case |
| U1 | no question before the press | `CirruxDrive.unit.test.tsx`: 8 cases |
| U2 | offered with no sign-in stored | `CirruxDrive.unit.test.tsx`: 2 cases |
| U3 | how it ends at Cirrux not said | `CirruxDrive.unit.test.tsx`: 2 cases |
| U4 | nothing stored, said as disconnected | `CirruxDrive.unit.test.tsx`: 2 cases |
| U5 | the accounts not read again | `CirruxDrive.unit.test.tsx`: 4 cases |
| U6 | the dormant guard lets the panel draw without a client | `CirruxDrive.unit.test.tsx`: 4 cases |

## 6b. T2b — the owner's live Drive test

When Cirrux has answered the request with a client ID for the OTA callback:

1. In the OTA stack's checkout (`~/ownpace-managed`), first bring the checkout to `main`: the
   nightly gate deploys from the runner's own checkout, so this one can be far behind, and a
   checkout from before alpha.18 still builds Trigger.dev and stops. Then put the ID in the
   persisted `.env` the gate reads, and in `deploy/compose/.env` too where that is a copy rather
   than a link (*The OTA stack: the nightly gate, or a pull* in `docs/managed-bring-up.md`), and
   restart the API and the worker, which both read it (`managed.yml`); the app phase recreates
   the worker with the API:

   ```bash
   cd ~/ownpace-managed
   git status --short                      # nothing tracked changed
   git fetch origin && git switch --detach origin/main
   read -r -p 'Cirrux client ID: ' t
   ./deploy/compose/env-upsert.sh ~/.persistent/ownpace-managed/.env "CIRRUX_OAUTH_CLIENT_ID=$t"
   [ "$(readlink -f deploy/compose/.env)" = "$(readlink -f ~/.persistent/ownpace-managed/.env)" ] && echo 'a link' || ./deploy/compose/env-upsert.sh deploy/compose/.env "CIRRUX_OAUTH_CLIENT_ID=$t"
   unset t
   ./deploy/compose/bootstrap-managed.sh --only app
   for s in api worker; do docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ownpace-managed-$s | grep -q '^CIRRUX_OAUTH_CLIENT_ID=.' && echo "$s set" || echo "$s EMPTY"; done
   ```

   The ID is no secret, and it is the deployment's: it goes in no connection and no screen. If
   Cirrux also sends a client secret, it is set nowhere: nothing here reads one. Run the lines
   while no E2E (managed) run is in progress, as for any key the gate reads. The app phase must
   print `hosts inside this network admitted by name (OWNPACE_REACHABLE_HOSTS): nextcloud,stalwart`;
   until the gate persists that key (#2105), a persisted `.env` without it takes the demo's
   Nextcloud away from the stack, and
   `./deploy/compose/env-upsert.sh ~/.persistent/ownpace-managed/.env OWNPACE_REACHABLE_HOSTS=nextcloud,stalwart`
   before the app phase puts it back. The API's image has no shell, so the check reads the
   containers' environment with `docker inspect`.
2. Check the two answers the screens read: `GET /api/provider-accounts` has `cirrux.client:
   "deployment"`, and `GET /api/redirect-uris` lists `cirrux.migration` as
   `https://app.ota.ownpace.eu/api/migrations/cirrux/callback`, the string Cirrux registered.
3. On the Accounts page, **Test** the Cirrux account from T2 (or add one). Files: a measured no,
   *not connected*, and the row shows **Connect Cirrux Drive**.
4. Press it, sign in to Cirrux as the mailbox's person, and allow. Write down: the window's
   words, and the row's **Carries:** and **Found:** afterwards.
5. Press **Test** twice, a minute apart. Both measure the Drive; each refreshes the sign-in once
   and stores the successor. Check that you are still signed in to Cirrux in the browser.
6. In a file source you own (a Dropbox folder: the screens offer no Nextcloud or other WebDAV
   source, 2026-11-24), make a folder with: a small text
   file, a file of about 20 MB, and, if you have one, a file over 100 MB. In Cirrux Drive, make
   a folder of the same name with one file whose name differs from one of them only in capitals.
7. Start one migration of files only, from that folder into the Cirrux account, and let one pass
   finish. Check in Cirrux Drive: the folder is the one you made (not a second); the small, the
   20 MB and the file over 100 MB are there, with the source's modification dates, and the large
   one opens (Cirrux decrypted every part); the capitals file is reported, and the one in Cirrux
   is untouched. A file over 2 GiB, if you have one, is reported as not moved.
8. Edit the small file at the source and press **Sync now**: the copy in Cirrux has the new
   content, under the same file. Then edit the 20 MB file in Cirrux, edit it at the source too,
   and press **Sync now**: Cirrux's edit stays, and the migration reports a conflict.
9. Delete the small file at the source and press **Sync now**. Under **Deleted on the old
   system**, press **Delete it here too**, then **Confirm delete**: the file is in Cirrux's
   trash, restorable, and nowhere else.
10. Wait more than fifteen minutes and press **Sync now**: the pass runs (the worker refreshed
    and wrote back), and nobody was signed out.
11. Press **Disconnect Cirrux Drive** on the account, then **Yes, disconnect**. Write down the
    row's words, and that **Carries:** no longer names files. Press **Sync now** on the files
    migration: its files fail with a sentence naming **Connect Cirrux Drive**, nothing new
    appears in Cirrux Drive, and its other data types run. In Cirrux Mail, open Settings →
    Security: write down whether this service is listed among the apps you have authorized, and
    revoke it there. Then press **Connect Cirrux Drive**, sign in again and press **Sync now**:
    the files carry on.
12. Delete the migration, then the account if you wish: the receipt names the Drive sign-in.

Write down any failure that names `undecryptable_content`, `upload_size_mismatch`,
`invalid_grant`, `name_taken` or a sign-out, with its words: each is one of §6's readings proven
wrong, and T3's kind of correction follows from it. Then T4 records the proof.

## 7. T6 — Cirrux Docs (parked)

Cirrux Docs is in preview for accounts given early access (`https://cirrux.co/help/api/documents`).
Its documents live in Drive and are read and written as Markdown through the Documents API.
Migrating a Word or Google document *into* Cirrux Docs would be a conversion, which this product
does not do for any destination; once T5 exists, such a file arrives in Cirrux Drive as the file
it is. Revisit when Cirrux Docs is open to every account and someone asks.

## What the owner does

- **First, §4's steps 10 and 11**, on the test environment, once E2E (managed) has put this
  change's branch there: *testing* before, *done* after. No mail at any of the three steps, and the
  change merges; mail at any step, and it does not, and Cirrux is told which step mailed.
- T2's steps, in §4, on a Cirrux mailbox of their own, and the four observations in step 8.
- Once the contacts correction (§5) is on the test environment: **Sync now** on the Cirrux
  migration, and the contacts line it reports. Done 2026-11-19: 1,244 skipped, already there.
- Once the calendar correction (§5) is on the test environment: **Sync now** again, and the
  calendar, task and mail lines it reports. Done 2026-11-19: the calendar was made, and every
  event was refused with 404, corrected in §5's third bullet.
- Once that correction is on the test environment: resume the paused Cirrux migration. Done
  2026-11-19: Cirrux emailed the guests of the events written, and the migration is paused again
  (§5's fourth bullet).
- Leave the events already in Cirrux, and the calendar the pass made, as they are, at least
  until step 11 has answered: on 2026-11-19 Cirrux emailed a guest a cancellation when an event
  was deleted or lost a guest, which the owner's test showed (§5's fifth bullet). Cirrux said on
  2026-11-20 that deleting a whole calendar notifies nobody, where deleting single events did
  (§1); that is not yet observed.
- When Cirrux answers how its server can be written to without mailing guests (asked
  2026-11-19): pass the answer on, so the exception can be undone (§5's fourth bullet). Done
  2026-11-20: Cirrux answered (§1), and the exception is undone once step 11 sends no mail (§5's
  sixth bullet).
- Once the guests correction and the one after it (§5's fourth and fifth bullets) are on the
  test environment, and once step 11 has answered: resume the migration and watch the source
  account's own inbox for the first minutes. The account is an attendee of most events it was
  invited to, so an invitation that still went out would reach it first. Then the calendar, task
  and mail lines the pass reports.
- For T5: the two clients are requested from Cirrux (the live and the OTA callback, §6). The OTA
  one arrived, and T2b's steps in §6b ran on 2026-11-24. When the live one arrives, step 1 of §6b
  on live, with live's own `.env` and callback.
- Nothing with a workspace API key or a webhook.

## Open questions

1. Should the Cirrux card stay without the experimental tag until T2 runs? Destination cards
   carry no tag today, Soverin's included; T4 records the proof either way.
2. If Cirrux's DAV root turns out to need a path, is it the same for every mailbox, so the
   directory row can carry it?
3. ~~For T5: one OAuth client for every deployment, or one per appliance owner?~~ **Answered
   2026-11-19**: one public client per deployment, registered by Cirrux by hand; the appliance
   has no Cirrux Drive (ADR-0052).
4. ~~For T5: may a pass write a rotated refresh token back?~~ **Answered 2026-11-19**: yes, for a
   provider whose tokens rotate, one refresh at a time per connection (ADR-0052).
