# Workplan 0156 — What the owner found testing, 2026-10-03

> **In one line:** Six defects from the owner's testing on 2026-10-03: a permission list that read other migrations' sources, a verification one missing folder ended, invitations mailed to nobody, files over 1 GiB refused by Nextcloud, a first copy run once a day, and two deletion switches that read as one.

## Status — 2026-10-04 (update this block at the end of every session)

**2026-10-03: opened from the owner's report of six screenshots**, on the managed edition, with
three migrations in one organisation: *MS-2-NC* (a Microsoft account into Nextcloud), *Goog2NC*
(a Google account into Nextcloud) and a Dropbox account into Nextcloud. Each task below is one
pull request. The owner decided two questions the same day: an invitation is mailed (T3,
*"Send an email"*), and a first copy runs back to back whatever the schedule (T5, in the owner's words: a
daily schedule *"might be reasonable … after all sync was done, … but not for the initial
bulk"*, which is 0125 T8's option (a)).

**2026-10-04: all six done**, one pull request each: T1 #1423, T2 #1428, T3 #1430, T4 #1431,
T5 #1432, T6 #1429, every one green in CI before it merged. What each left undone is in its
section. Two things for the owner's own test data: the *MS-2-NC* sharing list keeps the Google
rows earlier rescans saved (§1, *Not done*), and the four parked Dropbox files go up once the
demo Nextcloud is recreated with the new body limit and each is retried (§4, *Not done*).

**2026-10-04, later: T3's invitation links the Alpha conditions and the tester guide** during the
alpha, in the organisation's language (0131 T1 (b)), on
`claude/ownpace-public-readiness-y7orc6-the-alpha-by-its-name`, not merged. §3's follow-up says
what changed. Guards first: `an-invitation-that-is-mailed` (Dutch and English) and
`an-invitation-that-says-who-asked` failed on cd318823; green after.

| Task | Status | Notes |
|---|---|---|
| T1 A migration's permission list reads its own source | ✅ **Done 2026-10-03** | §1. `migrationInventoryScans` resolves the migration's own source, migration → mailbox → connection, and the report measures its own target. The appliance reads the mapping asked about. The Finish page's blind-spot line follows the source. |
| T2 A missing target folder is a finding, and the other data types are still verified | ✅ **Done 2026-10-04** | §2. A 404 on the listing's own folder is `TargetFolderMissingError`, a FAIL naming the folder with advice to restore it; any other listing failure is NOT_VERIFIABLE for its own data type; every other data type is still verified. |
| T3 An invitation is mailed to the person invited | ✅ **Done 2026-10-04** (owner, 2026-10-03: send it) | §3. `member_invited`, mailed after the row commits, with `notified` on the answer and Send again on the row; privacy §4.6 says so. A declined invitation no longer makes the member list unreadable. |
| T4 Files over 1 GiB reach Nextcloud | ✅ **Done 2026-10-04** | §4. A file over 64 MiB goes to a Nextcloud target in pieces (chunked upload); a 413 is said as the request limit and parked for a person; the demo Nextcloud's body limit is lifted. |
| T5 A first copy runs back to back | ✅ **Done 2026-10-04** (owner, 2026-10-03: 0125 T8's (a)) | §5. While some data type has never completed a pass, the managed tick runs the migration at the 15-minute floor whatever its schedule; then the schedule applies. |
| T6 The Deletions page's two switches say what each does | ✅ **Done 2026-10-04** | §6. *Deleting by hand* and *Automatic removal of moved files' old copies*, each with its own Turn off; turning the first off turns both off. |

## 1. T1 — the permission list of one migration listed another's

**What the owner saw.** The Finish page of *MS-2-NC* offered *Haal de rechtenlijst op*, and the
list it fetched carried the Google account's Drive shares: *"how could that be, is the
finish-listing scoped too wide, like on all migrations?"* It was.

**Why.** The page asks for its own migration (`GET /api/permissions/report?mappingId=…`), and the
sharing checklist is stored per migration (`share_grant`, keyed by `mapping_id`, ADR-0032). But
the scans that fill both were resolved by `tenantInventoryScans(tenantId, mailbox)` in
`apps/api/src/routes/permissions.ts`, from the ORGANISATION's connections: every Microsoft
source, the first Google Drive source and the first DAV source, with Drive asked first. So a
Microsoft migration in an organisation that also connected a Google account read that account's
Drive, and a Google migration beside a Microsoft source was given Exchange PowerShell for its
Gmail. The rescan (`POST /api/migrations/:id/sharing/rescan`) saved those rows under the
migration's own id. The target's section had the same shape (`tenantTargetConduct`, the
organisation's first DAV target). The pass had this defect once and was fixed in
`loadDomainConnections` (`packages/orchestration/src/build-deps-from-mapping.ts`); the report
never got the fix. The appliance had it too: `inventoryScansFor` in `apps/selfhost/src/index.ts`
read every mapping file's source.

**What was built.**

- `migrationInventoryScans(tenantId, mappingId, mailbox)`: the migration's source mailbox's
  connection, the migration's `source_config_override` merged over its config, its credentials
  through `sourceCredentialsFor` (the migrator's own grant included), and the scans chosen by that
  one kind. A withdrawn grant reads nothing: each section says the pass's own sentence
  (`grantWithdrawnRefusal`). A migration whose mailbox names no connection keeps the
  organisation-wide answer, logged, as the pass falls back for the same rows. The report
  (`?mappingId=`) and the rescan use it; an address asked for directly (`?mailbox=`) names no
  migration and keeps `tenantInventoryScans`.
- `migrationTargetConduct`: the migration's own target, with its override; a target that is not
  DAV-shaped gets no section even when another migration's Nextcloud is connected.
- The appliance's `inventoryScansFor(mailbox, scope)`: the mapping asked about for a report by
  `mappingId` and for every rescan, every mapping only for `?mailbox=`; its target likewise.
- `PermissionsHandover` takes the migration's `sourceKind` (the failures queue's) and shows
  Microsoft's blind-spot line for a Microsoft source, a new Google line (Gmail delegation, Google
  Calendar sharing; Drive IS read) for a Google source, and none for any other source.

**Proof.** `apps/api/src/routes/a-report-that-reads-its-own-migration.unit.test.ts`: one
organisation with both accounts connected; the organisation-wide lookup is shown handing the
Microsoft mailbox the Google Drive (the control), and the migration's scans read only their own
source, keep their own wording, read nothing on a withdrawn grant, fall back for a legacy row,
and ask every question inside the organisation. `PermissionsHandover.unit.test.tsx` holds the
line to the source, in both vocabularies (`o365`, `google-drive`).
`an-organisation-closed-at-every-door.unit.test.ts` counts `migrationInventoryScans` and
`sourceCredentialsFor` as uses of the stored access; `permissions.ts` asks the close before them.

**Not done.** Rows a rescan already saved from another migration's source stay in that list:
`upsertShareGrants` never deletes, and ADR-0032 keeps decisions. An owner who rescanned a
migration in a mixed organisation before this fix can delete the wrong rows' decisions by hand,
or delete and recreate the migration.

## 2. T2 — a deleted target folder ended the whole verification

**What the owner saw.** On *Verificatie — MS-2-NC*, after the owner deleted the migration's target
folder `/Microsoft-Rhb` on Nextcloud: *"De verificatie is niet voltooid. PROPFIND on / failed
with status 404: Sabre\DAV\Exception\NotFound — File with name /Microsoft-Rhb could not be
located"*, and no data type verified at all.

**Why.** `runVerification` (`packages/core/src/verification.ts`) verifies the data types one
after another with no catch between them, so the first listing that throws ends the run and the
worker lands it `failed` (`apps/worker/src/jobs/run-verification.ts`). The listing's own error
is untyped and names `/` because the path it holds is relative to the target folder
(`propfindChildren` in `packages/engines/src/webdav-target-writer.ts`).

**What was built.**

- `TargetFolderMissingError` (`packages/shared/src/target-folder-missing.ts`), recognised by a tag
  (`isTargetFolderMissing`) so a second copy of the module still knows it. The WebDAV writer's
  listing throws it for a 404 on the folder it starts from, naming the folder as the server
  knows it (`/Microsoft-Rhb`, from `targetFolderPrefix`); a 404 below the folder stays a plain
  error, and both still carry the server's words.
- `runVerification` catches per data type, around the measurement only (the ledger's own reads
  still end the run). The folder missing is a FAIL with every recorded item missing and an issue
  `TARGET_FOLDER_MISSING_<type>` naming the folder; any other listing failure is NOT_VERIFIABLE
  with the error quoted (`TARGET_UNREAD_<type>`). Both hold the cutover. A closed organisation
  still ends the run (0139 T7).
- The advice for the folder is to restore it and verify again, not "Re-sync": the writer's
  ledger fast-path skips every item the record says was copied, so a pass would copy none of
  them back. A data type the target did not answer for is told to put that right, not to supply
  a reindexer.

**Proof.** `packages/core/src/a-target-folder-that-was-deleted.unit.test.ts`: with the files
listing throwing the folder's 404, mail still PASSes, files FAIL with 3 of 3 missing and the
folder named, the advice restores and does not re-sync; a 401 makes files NOT_VERIFIABLE with the
status quoted while mail passes; a closed organisation still rejects the run.
`dav-reindexers.unit.test.ts`: a prefixed folder's 404 is `TargetFolderMissingError` naming
`/Microsoft-Rhb`; a 404 below it is not. Unit tiers of `packages`, `apps/worker`, `apps/selfhost`
and `apps/api`: `Test Files 681 passed (681)`, `Tests 8197 passed (8197)`.

**Not done.** The confirmation pass (`confirmation-reader.ts`) still marks every row of a data
type whose listing failed `unchecked`, the folder missing included; it says nothing wrong, and
could say more.

## 3. T3 — an invitation mailed nobody

**What the owner saw.** *"inviting someone doesn't email that person. How should this work, and
why doesn't it work?"* By design until now: `POST /api/tenants/:id/members` writes the
`tenant_member` row and sends nothing; the form says *"No email yet; tell them yourself"*;
workplan 0093 and `docs/managed-bring-up.md` say the same, and the privacy policy's draft 1.2
relies on it (its briefing: *"The service mails nobody a customer invites"*). The owner decided
on 2026-10-03 that an invitation is mailed.

**What was built.**

- `member_invited` (`packages/shared/src/notifications.ts`), in the organisation's summary
  language: who invited them (when the inviter's token carries an address) to which
  organisation, where to sign in and the exact address to sign in with, never a token; that it
  is safe to forward and that nothing happens unless they sign in and join; the alpha paragraph
  during the alpha; and, last, what we keep about them and the privacy policy's address, as the
  share mail closes (privacy §4.6, GDPR Art. 14(3)(b)). No "open the app" line: they have no
  account yet.
- `apps/api/src/routes/tenants/invitation-mail.ts`: after the row commits, the API mails and
  answers `notified` — `sent`; `off` with no SMTP or no `WEB_URL`; `failed`, including a
  `LEGAL_SITE_URL` the mail cannot use; `limited` past 20 invitation mails a day per
  organisation, since the relay also carries the sign-in codes (0133). The invitation stands
  whatever it says. `POST /members/:id/resend` mails an open invitation made on the Team page
  again, at most once in ten minutes (`429` with `Retry-After`); a member who joined or declined,
  and a granted access request, answer `409`. Both limits are kept in the API process, like the
  report channel's.
- The Team page says what became of the mail, in four sentences, and offers *Send again* on an
  open invitation it made. `declined` joined the web's `MemberStatusSchema`: one declined
  invitation had made the whole member list unreadable.
- Privacy §4.6 (draft 1.2, en and nl) says the invited person gets one mail, and again only on
  Send again, with a copy kept as §9 says; its briefing records the change. The bring-up doc's
  mail table lists it, and its "never mailed" paragraph no longer names invitations. The OpenAPI
  spec documents `notified` and the resend route. `appUrl` moved to `access-notify.ts` so the
  grant mail and the invitation read one address.

**Proof.** `an-invitation-that-is-mailed.unit.test.ts` (the real route on PGlite as
`app_user`, the real channel, only the SMTP transport replaced): one Dutch mail to the invited
address naming the organisation, the inviter, where and with which address to sign in and the
privacy policy, with no token; `off` with the row saved when the channel is off or `WEB_URL`
unset; a duplicate refused and mailed nobody; Send again `429` within ten minutes and mailed
after; `409` for a declined invitation and for a granted request; twenty mails, then `limited`.
`an-invitation-that-says-who-asked.unit.test.ts` holds the wording in both languages.
`Tenants.unit.test.tsx` holds the four outcome lines and Send again;
`a-declined-invitation-the-list-could-not-read.unit.test.ts` every status the column holds.

**Not done.** An invitation still matches the signed-in address exactly, case included
(migration 0006): the mail names the exact address, but an address typed with capitals and
registered in lower case still matches nothing.

**Follow-up, 2026-10-04 (0131 T1 (b)), on
`claude/ownpace-public-readiness-y7orc6-the-alpha-by-its-name`, not merged.** During the alpha
the invitation now ends its alpha paragraph with the Alpha conditions' address and the tester
guide's, in the organisation's language, as the grant mail does; the privacy line stays last.
`memberInvitedEvent` takes the mail's locale and makes both addresses inside the guard that
turns a `LEGAL_SITE_URL` it cannot use into `failed`. `an-invitation-that-is-mailed` gained the
case on the real route for a Dutch and for an English organisation, and
`an-invitation-that-says-who-asked` the wording in both languages; all failed on cd318823. A
third route case holds the guard: with `LEGAL_SITE_URL=www.ownpace.eu` the invitation is saved,
answers `failed`, sends nothing and spends no allowance. It passed on cd318823 too, and fails
with the guard removed (a 500 after the invitation committed).

## 4. T4 — files over 1 GiB never reached Nextcloud

**What the owner saw.** The four largest Dropbox files (1.31 GB twice, 2.14 GB, 4.51 GB) parked
after five tries, each with *"PUT failed … with status 413: Sabre\DAV\Exception\BadRequest —
Verwachte bestandsgrootte van 1401302831 bytes maar gelezen … 0 bytes"* under *"We could not
classify this one"*. A 1 GB VOB went through.

**Why.** Every file over 8 MiB goes up in ONE streamed PUT (`uploadStreamed`). The demo Nextcloud
in `deploy/compose/managed.yml` is `nextcloud:34-apache`, whose Apache refuses a request body
over 1 GiB (`APACHE_BODY_LIMIT`'s default, 1073741824 bytes): Apache keeps the body from PHP,
Sabre reads 0 bytes, and 413 is answered. Any Nextcloud behind a body limit refuses the same
way, and nothing in this repository speaks Nextcloud's chunked upload. A 413 is in no failure
category, so it was *unknown*, and each pass spent one of the five tries.

**What was built.** `WebDAVTargetWriter` sends a file larger than 64 MiB to a Nextcloud files
URL with Nextcloud's chunked upload: MKCOL `…/dav/uploads/<user>/ownpace-<uuid>`, numbered PUTs
(`Destination`, `OC-Total-Length`, each its own `Content-Length`), then MOVE `.file`. The pieces
are cut from one streamed read through one hasher (`ChunkSlicer`, `nextcloud-chunked-upload.ts`)
and never held whole. The answers are the single PUT's: a create carries `Overwrite: F`, so a
taken path is a 412 that is adopted (or refused for a directory); a rewrite carries the strong
version as RFC 4918's tagged `If` (measured: `If-Match` on that MOVE is checked against `.file`).
The MOVE's ETag and the whole-file hash are recorded. A failure deletes the upload folder,
best-effort, and surfaces the original error; a transient answer on a piece sends every piece
again from a fresh read. Whether the target chunks is decided once per writer and logged once: a
URL that is not Nextcloud's shape, or an upload area answering MKCOL with 403/404/405/409/501,
keeps the single PUT. Both editions get it through `buildFileTargetFor`. The broken
`Content-Range` path and its `chunkedUploads`/`chunkSize` config are gone. A 413 states
`target_refused`, with a sentence naming the file's size and the request limit
(`LimitRequestBody`/`APACHE_BODY_LIMIT`, nginx, a CDN), and is parked for a person rather than
retried; `classifyFailure` reads `status 413` and its reason phrases the same way, and the
remedy names an upload size limit (en, nl). The demo Nextcloud sets `APACHE_BODY_LIMIT: "0"`, the
seed's 413 hint names the right limit, and `docs/dav-sync.md` *Files — large files* replaces the
stale "defaults to 10 MB". The integration Nextcloud runs with a 16 MiB limit
(`NEXTCLOUD_BODY_LIMIT_BYTES`).

**Proof.** Reproduced on `nextcloud:34-apache` with a 16 MiB limit: a 20 MiB single PUT answered
`413 … Expected filesize of 20971520 bytes but read … 0 bytes`, and a `Content-Range` PUT `400
Content-Range on PUT requests are forbidden.` Every protocol answer used was measured there (MOVE
201 with ETag; `Overwrite: F` 412 writing nothing; tagged `If` stale/current 412/204;
`OC-Total-Length` mismatch 400; an unknown user's MKCOL 409).
`a-file-larger-than-the-servers-request-limit.integration.test.ts` passed 4/4 against it, with
`uploads/` empty afterwards. `a-file-too-large-for-one-request.unit.test.ts` (26, including a
real-fetch check that a 72 MiB file in 16 MiB pieces never holds half a piece) and
`a-large-file-goes-up-in-pieces-in-both-editions.unit.test.ts` (3). Typecheck and the full lint
exit 0; unit for packages, web i18n, selfhost, worker, scripts and deploy: `Test Files 789
passed (789)`, `Tests 11172 passed | 1 skipped`.

**Not done.** Resuming a partial upload across passes: each attempt starts at the first piece in
a new upload folder, and Nextcloud removes an abandoned one after 24 h. Stopping mid-file at the
pass deadline: it is still checked between items. Not measured: Nextcloud's v2 path (Redis plus
S3), and MOVE assembly time for a multi-GB file against undici's 300 s headers timeout.
`deploy/compose/dev.yml`'s Nextcloud keeps the 1 GiB default. For the owner's four parked files:
recreate the demo Nextcloud (`docker compose -f deploy/compose/managed.yml up -d nextcloud`) or
deploy this, then press Retry on each.

## 5. T5 — a first copy ran 50 minutes a day

**What the owner said.** *"the default frequency now seems to be 1 sync every 1 day; that might
be reasonable for the free tier and after all sync was done, … but not for the initial bulk."*
The wizard stores `0 2 * * *` when no schedule is picked, and a pass stops itself at 50 minutes,
so a large first copy got one 50-minute pass a day. Workplan 0125 T8 found this on 2026-09-28
and offered (a) passes back to back until the first copy is done, (b) an hourly default, (c) the
schedule editable; the owner chose (c) then, and now (a).

**What was built.** While a migration's first copy is unfinished, the managed tick runs it at
the 15-minute floor, counted from the last pass's start, whatever its stored schedule; once every
data type has completed a pass, the schedule applies as before. "Unfinished" is
`FIRST_COPY_UNFINISHED` in `apps/worker/src/jobs/managed-sync-tick.ts`: some data type the pass
copies has no `migration_status.completed_at`, where a data type counts when it is selected, not
stopped by its owner, and its own path row's phase (or the migration's) is in
`PASS_RUNNING_STATES`. `markCompleted` is that column's only writer and nothing clears it, so a
deadline-stopped copy reads unfinished and a migration whose only open work is parked failed
items reads finished. A provider's daily ceiling waits until its `windowResetsAt`; a collection
the source would not list follows the schedule. `isSyncDue` takes the fact as `DueFacts {
firstCopyUnfinished }` and stays pure; the `running` skip, the failure back-off and the box caps
hold, in that order, and the tick's summary counts `firstCopies`. The panel and wizard copy say
the new rule (en, nl); the operator runbook and the self-host quickstart describe it. The
appliance is unchanged by design: its passes have no deadline, so a first copy finishes in one
firing, and it has no back-off ladder to keep a floor from spinning on a data type that keeps
failing. No migration and no index.

**Proof.** `a-first-copy-runs-back-to-back.unit.test.ts` (a daily-schedule day goes from 1 pass
to 29, never two at once). `a-migration-that-keeps-asking.unit.test.ts` on PGlite:
deadline-stopped and added data types read unfinished; completed, parked-failures-only, paused,
stopped, `ready`, cutover, ceiling-before-reset and unreadable-collection cases do not.
`a-tick-that-knows-the-box-size.unit.test.ts` (the order of skip, due, back-off and caps).
`a-cadence-with-nowhere-to-change-it.unit.test.tsx`. Typecheck and eslint exit 0; unit and
unit-browser over orchestration, shared, ledger, worker, selfhost, web and scripts: 657 of 662
files, the 5 failures load timeouts (4 pass alone; the fifth, `a-run-row-that-outlived-its-pass`,
fails identically on base `cd9a75e1` under the same load).

**Not done.** The appliance's ceiling-stopped first copy still waits for its next cron firing
rather than the window's reset. A never-completed data type failing for a self-healing cause
keeps the floor, as a migration with no schedule does today. `a-run-row-that-outlived-its-pass`'s
10-second `beforeAll` is flaky under load on main.

## 6. T6 — the Deletions page's two switches read as one

**What the owner saw.** *Deletions — Goog2NC*: *"Applying deletions is ON for this migration"*
above *"Auto-applying relocations is OFF … Enable auto-apply for relocations"*: *"auto deletions
is ON, but the button below suggests I need to enable it first."*

**Why.** Two different switches with the same verb. `allowApplyDeletions` lets the owner's own
delete buttons work, one item at a time, and removes nothing by itself (`config.ts`, arch §11.1,
ADR-0024). `autoApplyRelocations` removes the old copies of moved files unattended, after strict
checks, and never a deletion (ADR-0031). The wording made the first sound automatic. And turning
the first off left the second stored ON, out of sight, so turning the first on again re-armed
unattended removal without a word.

**What was built.**

- The first switch is *Deleting by hand* (*Handmatig verwijderen*), and ON says what it allows:
  "Nothing is removed until you press a delete button on an item." The second is *Automatic
  removal of moved files' old copies* (*Automatisch verwijderen van oude kopieën van verplaatste
  bestanden*), with its own *Turn off automatic removal*; its hint says it runs without you and
  never touches deletions, and its fold says refused moves stay on the Moves screen (it said
  "this queue", which is the Deletions queue).
- Turning the first off turns the second off too, in one request. A second switch stored ON
  under a first that is off (the appliance's file can say so, and a row from before this) is
  said, *"… is set ON, and does nothing while deleting by hand is off"*, with its own Turn off.
- The enable button for automatic removal keeps two presses and red, and loses the bin, which
  is owed only to what destroys (`primitives.tsx`); the first switch's enable button keeps its.
- `tenants.invite.adminCan` names the two switches in the same words, and the Moves hub no
  longer says moves are "never acted on".

**Proof.** `ApplyDeletionsPanel.unit.test.tsx`, *the two switches read as two*: what ON
allows; the second switch's words and its bin-less two-step button (the first's bin checked as
the control); two different Turn offs; turning the first off sends both flags off; a second
switch stored ON under a first that is off is shown and can be turned off.
`a-role-that-promises-less-than-it-allows` (web and API) hold the admin sentence to the new
words. Web and tenant routes: `Test Files 143 passed (143)`, `Tests 2717 passed (2717)`.
