# Workplan 0104 — the announcement a cutover owes

> **In one line:** Announcing shares at cutover: `createNextcloudShare` with share-by-mail fallback, one-press `sharing/apply-all` of held share grants so the target platform mails, a Mailpit arrival gate, and a fallback digest via `sharing/announce`.

## Status — 2026-10-25 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-25, corrected 2026-08-26** | This document. First conclusion said the one-moment announcement must be Ownpace's own mail; the owner corrected it, and the correction holds: **the platform's own notification is the announcement**, released at the chosen moment — because share *creation* is deferrable even though the notification is not, and this product already defers creation to cutover (`not_cut_over` in `share-queue.ts`). Ownpace's own mail is the **fallback lane**, not the headline. |
| T0 Wire the first target share API | ✅ **Done 2026-08-26** | `createNextcloudShare` (nextcloud-ocs.ts): a user share when the target knows the grantee, SHARE-BY-MAIL when it does not — the fallback keyed on OCS statuscode 404, the one locale-independent fact in the refusal (pinned by a deliberately Dutch fixture). The owner's `note` rides both attempts inside the platform's own notification. Both editions switched to it; a correction on 0052's user-share-only slice. Notifications deliberately ON. |
| T1 One go, one press | ✅ **Done 2026-08-26** | `applyAllOpenShareGrants` (share-queue.ts) + `POST /:mappingId/sharing/apply-all` on BOTH editions. Every row still walks applyShareGrant's gates (`NOT_CUT_OVER_REASON` now single-sourced, per-row and press proved equal); links and manual verdicts stay on the checklist; one refusal never stops the next; a second press retries exactly the refused (pinned: the settled row's grantee gets no second mail); the press lands once in the audit log, counted and attributed. |
| T2 The gate proves the mail ARRIVES | ✅ **Done 2026-08-26 (both stages)** | First stage: the smoke's mailproof control (pipe proved before silence believed). Final stage: the seed creates a REAL source share (by mail, tag-addressed), `scanNextcloudShares` (new — a Nextcloud source's outbound shares were a blind spot) discovers it through the real rescan, the smoke PRESSES apply-all with a tagged note inside a fabricate-and-retract cutover window, and the TARGET's own mail must arrive carrying that note. Found and fixed on the way: the capability gate refused kind `nextcloud`/`baseUrl` connections — the demo's own kind — so the first live press would have answered `no_share_api`. Plus the queue drain: `cron.php` runs before the final silence checks, turning "no queue fired yet" into "drained and still nothing" (the owner's question, 2026-08-26). Since 2026-10-04 the drain names the jobs that can mail, as a bare `cron.php` stops at 14 minutes with the queue unemptied, and the rest runs detached after the check (0150). |
| T3 The fallback digest | ✅ **Done 2026-08-26** | `share-announcement.ts` (shared) + `POST /:mappingId/sharing/announce` on BOTH editions, through 0030's channel (`tellMessage` / the appliance's own notifier). Audience: `done_manual` rows only — applied rows the platform announced, skipped rows carry no access, links have no address and are COUNTED, never dropped. One digest per grantee, their items only (§17). Note required (the "where" comes from the person who carried the shares); Template 6 EN/NL in the templates doc, subjects pinned to the code; a prior press makes the next an explicit `confirmResend`, gated on the audit log (`latestAuditEventAt` widened: actor optional, mappingId filter). |
| T5 The press meets the target's limit on new shares | 🔨 **Built 2026-10-25 (#1704), merges after the alpha.2 tag** | The product half owed by the 2026-10-25 entry below. A 429 from the target is `ShareLimit` (shared) and its own sentence, in English and Dutch, with when to apply again; `applyAllOpenShareGrants` and `applyShareGrantsInFolder` stop at the first one and answer the rows from there as `waitingForLimit`, open and untried, apart from `refused`; both editions and the Sharing page. The order of the two calls is unchanged, on purpose: see the entry *the product half, built*. Needs CI and E2E (managed) on its pull request, after the tag. |
| T4 Flags restated | ⬜ proposed | The four cloud silence flags recorded beside `applyShareGrant` (0103 T6) are for any **pre-moment** technical write a future needs — at the chosen moment the apply notifies on purpose. Same flags, opposite press, one policy: mail happens exactly once, when a person chose. |

**2026-10-25: the gate's press met Nextcloud's limit on new shares.** E2E (managed) #277, attempt
2, on the branch of #1680, failed at *the moment, pressed*: apply-all applied none of the run's
rows. The same code passed on attempt 3, and E2E (managed) #278 was green.

- **The mechanism.** Nextcloud 31 to 34 let one account create 20 shares in 10 minutes
  (`ShareAPIController::createShare`, `#[UserRateLimit(limit: 20, period: 600)]`), failed attempts
  included, and answer the next one 429. Every share the gate makes on the target is made as the
  target account: the mail-pipe control, the folder press and apply-all. `createNextcloudShare` asks
  for a user share first and by mail only after a 404, so an outsider row, or a row whose file is
  gone, costs two calls. A row a press refused stayed open for good, because neither the rescan nor
  the balance closed it, and apply-all presses every open row of the mapping, not the run's own: run
  #238 of 2026-10-05 had left three. Attempt 1 pressed about eight minutes before attempt 2 and
  spent 13 calls. Attempt 2's control and folder press took the count to 18, #238's file row to 20,
  and its own row came back 429 as `target_refused`. Attempt 2's row stayed open too, so four were
  left. The smoke's log could not say so: it printed the first six lines of the refused JSON, which
  stopped before the reasons and their status. The demo Nextcloud's own access log, read by the
  owner the same evening, does: ten share calls between 06:31:31 and 06:31:37 UTC, answered 200
  (the control), 404 200 404 200 (the folder press), then 404 404 429 429 429 (apply-all).
- **What the gate does now.** The refused list is printed a row to a line, each with its whole
  reason, which ends with the status; with nothing refused it prints the reason or the count, never
  the body, whose applied rows carry the source's share verbatim. The apply-all branch says whether
  the run's own row was refused, when the answer lists refused rows at all, and a 429 is named as
  this limit. The balance first fails if both presses said they applied and one of the run's own
  rows is still open. It then skips every still-open share row that a run of the gate seeded, under
  any run's tag, through `POST …/sharing/:grantId/decision` with `{"action":"skip"}`, which writes
  the audit trail and makes no share, and fails if one is left. Taking another run's rows is safe
  because the workflow's concurrency group never lets two runs share the stack. The four go on the
  next run. A run with nothing left over spends seven calls (the control, two for each folder row,
  two for its own file row), so two presses inside ten minutes stay under the limit. Guarded in
  `scripts/the-moment-pressed.unit.test.ts`.
- **Owed, after the launch (product).** A real Nextcloud 31 to 34 target has the same limit. A
  one-go press over more than ten outsider rows meets it, fewer when the account made other shares
  in the same ten minutes; rows are shares, not people, so one person with five shared items is
  five. Every row after that comes back 429 under the generic refusal sentence
  (`SHARE_REFUSAL.other`), with nothing to say that waiting is the remedy. The press should
  recognise a 429, stop, and say when to press again. No product code changed here.

**2026-10-25: the product half, built (T5, #1704).** For alpha.3: main is frozen from tonight's
fold until the alpha.2 tag, so its pull request waits for the tag.

- **A 429 is the limit, not a refusal.** `createNextcloudShare` carries the reply's status,
  OCS's code and now the seconds a `Retry-After` asked for (`retryAfterSecondsOf`: whole
  seconds or an HTTP date; anything else is no wait at all, never a guessed one). A 429, as
  the status or as OCS's code, on the user attempt or on the share by mail after a 404, is
  `shareLimitOf` (shared), and its sentence (`SHARE_REFUSAL.limited`) says the new system
  limits how many shares one account may create in a short time, that nothing was refused,
  and when to apply again: what the server asked, or ten minutes, Nextcloud's period unless
  its administrator chose another. Both editions say it in our words, the appliance too:
  Nextcloud's 429 is an empty OCS reply, so there are no words of the target's to keep, and
  the reply goes to the appliance's log. `applyShareGrant` answers it as `target_limited`
  with `limited`, never `target_refused`.
- **The presses stop at the first one.** Both presses now run their rows through one loop,
  `pressRows`, so they cannot differ about a refusal or a limit. A refusal still never stops
  the next row. A limit does: that row and every row after it are returned as
  `waitingForLimit` (id, item, grantee), open and untried, and the edition's sentence for
  the row that met it as `limit`. The press's audit event counts them
  (`waitingForLimit`, classified `keep` for the audit export). A press after the window
  tries exactly those rows and the refused ones, never an applied one. The Sharing page
  says the rows a folder press stopped before under the folder, as *N shares in this folder
  wait for the new system's limit on new shares*, with the sentence under it in the
  reader's language, apart from *did not work*. `apply-all` has no caller on the page. The
  gate's `refused_rows` prints the waiting rows and the sentence, and says when the run's
  own row is among them (`scripts/the-moment-pressed.unit.test.ts`).
- **The call order is unchanged, on purpose.** The owed note asked whether a grantee that
  is plainly an e-mail address could skip the user attempt and save one of the 20 calls.
  It cannot be proved safe, and the opposite can be: Nextcloud's admin manual says a login
  may contain `@` and `.`, `OC\User\Manager::validateUserId` refuses only characters
  outside `a-zA-Z0-9 _.@-'`, and the user share looks `shareWith` up as a user id
  (`userExists`). The OCS share API's own page says only that `shareWith` is a "user /
  group id / email address". So an account named by its address is possible on a stock
  server, and behind LDAP or `user_oidc` wherever the address is chosen as the login; skipping
  the user attempt would give such a person a link by mail instead of a share in their
  account. A test pins the order.
- **What was read upstream.** `apps/files_sharing/lib/Controller/ShareAPIController.php` on
  `stable31`, `stable32`, `stable33`, `stable34` and `stable35`: `#[UserRateLimit(limit:
  20, period: 600)]` on `createShare` on all five. On `master` it is 60: nextcloud/server
  #65333, *Increase rate limiting limit for creating shares*, merged 2026-10-15 on the
  Nextcloud 36 milestone, no backport shown. `RateLimitingMiddleware` (`stable31`,
  `stable34`, `master`): the attempt is registered before the controller runs, so a failed
  share counts; `Limiter::register` throws before it registers, so a 429 does not; the
  answer is `DataResponse([], 429)`, no `Retry-After`. The OCS share API page and the admin
  manual's user page, read from nextcloud/documentation's sources (docs.nextcloud.com did
  not resolve from here).
- **Proved, in unit tests with a server or a client that answers as the limiter does.**
  `share-refusals.unit.test.ts` (the kind, the sentence and its four waits, `Retry-After`
  parsing); `nextcloud-ocs.unit.test.ts` (a 429 on either attempt, one call not two after a
  429 on the first, the header in either case, the order for an address-shaped grantee);
  `share-queue.unit.test.ts` (both presses stop, the rows in order, a refusal before the
  limit stays one, the press after the window); the managed routes over a real ledger
  (`a-press-that-meets-the-share-limit.unit.test.ts`: twelve outsiders against 20 calls,
  ten applied, the 21st call a 429, nothing asked after it); the appliance on PGlite
  (`a-press-that-meets-the-share-limit-on-the-appliance.unit.test.ts`); the Sharing page
  (`a-wall-of-four-hundred-and-eighty-two-rows.unit.test.tsx`). Turning the stop off fails
  seven of them across core, managed and the appliance.
- **Not proved yet.** E2E (managed) on the pull request after the tag. The gate's own press
  spends seven calls, so it should not meet the limit; when it does, the run now says
  which rows waited rather than calling them refused. Nextcloud 36 moves the limit to 60 in
  ten minutes; nothing here depends on the number.

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
