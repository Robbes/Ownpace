# Workplan 0104 — the announcement a cutover owes

## Status — 2026-08-26 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-25, corrected 2026-08-26** | This document. First conclusion said the one-moment announcement must be Ownpace's own mail; the owner corrected it, and the correction holds: **the platform's own notification is the announcement**, released at the chosen moment — because share *creation* is deferrable even though the notification is not, and this product already defers creation to cutover (`not_cut_over` in `share-queue.ts`). Ownpace's own mail is the **fallback lane**, not the headline. |
| T0 Wire the first target share API | ✅ **Done 2026-08-26** | `createNextcloudShare` (nextcloud-ocs.ts): a user share when the target knows the grantee, SHARE-BY-MAIL when it does not — the fallback keyed on OCS statuscode 404, the one locale-independent fact in the refusal (pinned by a deliberately Dutch fixture). The owner's `note` rides both attempts inside the platform's own notification. Both editions switched to it; a correction on 0052's user-share-only slice. Notifications deliberately ON. |
| T1 One go, one press | ✅ **Done 2026-08-26** | `applyAllOpenShareGrants` (share-queue.ts) + `POST /:mappingId/sharing/apply-all` on BOTH editions. Every row still walks applyShareGrant's gates (`NOT_CUT_OVER_REASON` now single-sourced, per-row and press proved equal); links and manual verdicts stay on the checklist; one refusal never stops the next; a second press retries exactly the refused (pinned: the settled row's grantee gets no second mail); the press lands once in the audit log, counted and attributed. |
| T2 The gate proves the mail ARRIVES | ✅ **Done 2026-08-26 (both stages)** | First stage: the smoke's mailproof control (pipe proved before silence believed). Final stage: the seed creates a REAL source share (by mail, tag-addressed), `scanNextcloudShares` (new — a Nextcloud source's outbound shares were a blind spot) discovers it through the real rescan, the smoke PRESSES apply-all with a tagged note inside a fabricate-and-retract cutover window, and the TARGET's own mail must arrive carrying that note. Found and fixed on the way: the capability gate refused kind `nextcloud`/`baseUrl` connections — the demo's own kind — so the first live press would have answered `no_share_api`. Plus the queue drain: `cron.php` runs before the final silence checks, turning "no queue fired yet" into "drained and still nothing" (the owner's question, 2026-08-26). |
| T3 The fallback digest | ✅ **Done 2026-08-26** | `share-announcement.ts` (shared) + `POST /:mappingId/sharing/announce` on BOTH editions, through 0030's channel (`tellMessage` / the appliance's own notifier). Audience: `done_manual` rows only — applied rows the platform announced, skipped rows carry no access, links have no address and are COUNTED, never dropped. One digest per grantee, their items only (§17). Note required (the "where" comes from the person who carried the shares); Template 6 EN/NL in the templates doc, subjects pinned to the code; a prior press makes the next an explicit `confirmResend`, gated on the audit log (`latestAuditEventAt` widened: actor optional, mappingId filter). |
| T4 Flags restated | ⬜ proposed | The four cloud silence flags recorded beside `applyShareGrant` (0103 T6) are for any **pre-moment** technical write a future needs — at the chosen moment the apply notifies on purpose. Same flags, opposite press, one policy: mail happens exactly once, when a person chose. |

## The owner's framing, which the research now serves

> my assumption is that at some cutover one needs to inform all people shared
> with, that they have shared files at a new (different) platform. so, I think
> notifying them is normal. but, at one chosen moment in time, not constantly
> during migration of a separate folder/file over and over again.
> — the owner, 2026-08-25

> the message is most powerful/working when [it] came from the target
> platform itself.
> — the owner, 2026-08-26, correcting this document's first conclusion

Both hold together, and the reconciliation is one sentence: **no platform can
defer or resend its notification, but every platform lets you defer the
*creation* — and the notification rides creation.** This product already
holds share creation until cutover (`not_cut_over` is a refusal, not advice),
so applying the held grants at the chosen moment with notifications ON
produces exactly one wave of platform-native mail — the real sender, the real
deep link, the recipient's own language — at the time the owner picked.

- **Per-item silence during migration** — nothing to suppress: no shares are
  created while a migration runs, by construction. The copying of files and
  folders itself notifies nobody.
- **The one chosen moment** — the batch apply is the moment. Where the API
  carries a message, the owner's context ("this replaces the share on the old
  platform") rides inside the platform's own mail: Drive `emailMessage`,
  Graph `invite.message`, Dropbox `custom_message`, Nextcloud's share note.
  Box's collaboration create carries no message — its rows also get the
  fallback digest.

## What the platform mail still cannot say — the fallback lane

The first conclusion was wrong as a headline and right as a remainder. Rows
no platform will announce:

- **`viaLink` rows** — re-creating a link re-opens access to an unknown set
  of people; refused (ADR-0032), so nobody is notified platform-side.
- **`manual` verdicts** — a person carried the right over by hand; whether
  anything was mailed is unknown.
- **Targets without a share API** — plain WebDAV, CalDAV and JMAP have no
  portable share verb (`no_share_api` refusal).
- **Message-less APIs** (Box) — the share mail arrives but cannot carry the
  migration context.

For exactly these, and only these, the announcement is Ownpace's own mail:
per-grantee digests from `share_grant`, Template 6, the tenant admin presses
once, recorded. Counts visible to the operator, addresses never (§17).

## What the product already holds

- **Who**: `share_grant.grantee` — every row carries the address the source
  platform knew. **What**: `subject`/`on` per row. **When**: Template 3's
  moment ("Cutover Complete") — before it, the old platform still answers and
  rollback is possible; an announcement cannot be unsent. **How** (fallback
  lane): 0030's mail infrastructure, gated by Mailpit in OTA.
- **The hold**: `applyShareGrant` refuses before cutover (`not_cut_over`),
  refuses links, refuses manual verdicts — the deferral the whole model rests
  on is already enforced, tested, and merged.

## What this deliberately does not do

- **No platform-side re-notify hacks** (delete + re-grant to force a mail
  drops and re-issues permissions — a real outage for the grantee).
- **No silent bulk creation before the moment.** Early creation with
  notifications suppressed would make the platform mail impossible forever
  (no resend exists) and burn the announcement. The hold is the feature.
- **No operator-initiated send, either lane.** §17 roles.
- **No announcement before cutover completes.** Rollback argument above.

## Sources

- [Drive `permissions.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create) — `sendNotificationEmail` (default true) + `emailMessage` exist only at create; no resend surface
- [Graph `driveItem: invite`](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0) — `sendInvitation` + `message` at invite time only
- [Dropbox `share_folder`/`add_folder_member`](https://www.dropbox.com/developers/documentation/http/documentation#sharing-add_folder_member) — `custom_message`; Box `POST /collaborations` — `notify` but no message field (fallback lane)
- Nextcloud OCS Share API (`POST /ocs/v2.php/apps/files_sharing/api/v1/shares`) — shareType 0 (user) / 4 (share-by-mail), `note`; share-by-mail always mails the link through the instance's SMTP
- Repo: `share-queue.ts` (`not_cut_over`, `link_share`, `manual_only`, `no_share_api` refusals; the recorded silence flags), `share_grant` schema (grantee column), ADR-0032, ADR-0043, workplans 0052/0103, `docs/cutover-communication-templates.md`, `docs/cutover-runbook.md`
