# Workplan 0156 — What the owner found testing, 2026-10-03

> **In one line:** Six defects from the owner's testing on 2026-10-03: a permission list that read other migrations' sources, a verification one missing folder ended, invitations mailed to nobody, files over 1 GiB refused by Nextcloud, a first copy run once a day, and two deletion switches that read as one.

## Status — 2026-10-03 (update this block at the end of every session)

**2026-10-03: opened from the owner's report of six screenshots**, on the managed edition, with
three migrations in one organisation: *MS-2-NC* (a Microsoft account into Nextcloud), *Goog2NC*
(a Google account into Nextcloud) and a Dropbox account into Nextcloud. Each task below is one
pull request. The owner decided two questions the same day: an invitation is mailed (T3,
*"Send an email"*), and a first copy runs back to back whatever the schedule (T5, in the owner's words: a
daily schedule *"might be reasonable … after all sync was done, … but not for the initial
bulk"*, which is 0125 T8's option (a)).

| Task | Status | Notes |
|---|---|---|
| T1 A migration's permission list reads its own source | ✅ **Done 2026-10-03** | §1. `migrationInventoryScans` resolves the migration's own source, migration → mailbox → connection, and the report measures its own target. The appliance reads the mapping asked about. The Finish page's blind-spot line follows the source. |
| T2 A missing target folder is a finding, and the other data types are still verified | 📋 **Proposed** | §2. |
| T3 An invitation is mailed to the person invited | 📋 **Proposed** (owner, 2026-10-03: send it) | §3. Also: a declined invitation makes the member list unreadable. |
| T4 Files over 1 GiB reach Nextcloud | 📋 **Proposed** | §4. Chunked upload, a 413 said as what it is, the demo Nextcloud's body limit. |
| T5 A first copy runs back to back | 📋 **Proposed** (owner, 2026-10-03: 0125 T8's (a)) | §5. |
| T6 The Deletions page's two switches say what each does | 📋 **Proposed** | §6. Turning the first off turns the second off too. |

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

**To build.** A 404 on the target folder itself becomes a typed finding that names the folder as
the server knows it; that data type is reported as such (not as an empty listing: hard rule 9),
and every other data type is still verified. Any other listing failure of one data type makes
that data type `NOT_VERIFIABLE` with the error quoted, which keeps a cutover blocked. A closed
organisation still ends the run (0139 T7).

## 3. T3 — an invitation mailed nobody

**What the owner saw.** *"inviting someone doesn't email that person. How should this work, and
why doesn't it work?"* By design until now: `POST /api/tenants/:id/members` writes the
`tenant_member` row and sends nothing; the form says *"No email yet; tell them yourself"*;
workplan 0093 and `docs/managed-bring-up.md` say the same, and the privacy policy's draft 1.2
relies on it (its briefing: *"The service mails nobody a customer invites"*). The owner decided
on 2026-10-03 that an invitation is mailed.

**To build.** On invite, a mail to the invited address: who invited them to which organisation,
where to sign in, and the exact address to sign in with. No token and no link that signs anyone
in. A *Send again* for an open invitation, limited. The form says whether the mail went, was not
sent because this deployment sends none, or failed. Privacy §4.6 (draft 1.2, both languages) and
the bring-up doc say so.

**Found on the way.** A member row whose invitation was declined has status `declined`, which
the web's member schema does not accept, so the whole member list fails to read.

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

**To build.** Nextcloud's chunked upload (v2) for large files on a Nextcloud target: the chunks
in an upload folder, then one MOVE, so nothing is at the path until the whole file is, and a
re-run converges. A 413 said as the server's request-size limit. The demo Nextcloud's body limit
raised, and the seed script's wrong hint corrected.

## 5. T5 — a first copy ran 50 minutes a day

**What the owner said.** *"the default frequency now seems to be 1 sync every 1 day; that might
be reasonable for the free tier and after all sync was done, … but not for the initial bulk."*
The wizard stores `0 2 * * *` when no schedule is picked, and a pass stops itself at 50 minutes,
so a large first copy got one 50-minute pass a day. Workplan 0125 T8 found this on 2026-09-28
and offered (a) passes back to back until the first copy is done, (b) an hourly default, (c) the
schedule editable; the owner chose (c) then, and now (a).

**To build.** While a migration's first copy is unfinished, the tick treats it as due at the
schedule floor (15 minutes after its last pass started) whatever its schedule; once every data
type has completed a pass, its own schedule applies. The caps, the failure backoff and a pause
still hold.

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

**To build.** The first says *by hand*, the second *automatic*, each with its own *Turn off*;
turning the first off turns both off; the enable button loses its bin, which is owed only to what
destroys.
