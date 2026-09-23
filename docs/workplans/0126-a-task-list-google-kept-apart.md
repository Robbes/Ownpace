# Workplan 0126 — A task list Google kept apart

## Status — 2026-09-23 (update this block at the end of every session)

**2026-09-23, T4 done:** the setup, verification, bring-up and feature-matrix docs name the
Google Tasks API and `tasks.readonly`, and the archive Test says "tasks" for a Google export.
What is left is live: T6's To Do half, T7, and T8 on the owner's account.

**2026-09-23, T3 done:** the connection Test lists the first face a grant carries, so a grant
for Tasks alone passes on its task lists instead of failing over a calendar nobody granted.

**2026-09-23, later still: T2 is built, so a Google account can carry Tasks.** Tasks is the
account's third default face. The consent asks for `tasks.readonly` when it is ticked, the builder
arm hands the source the tenant's rate budget, the Test measures the face (lists and tasks
counted) instead of answering a structural no, and the scope manifest promises it. Two things
still stood between this and a live run. **T3's probe**, since done: the connection Test's
headline check listed the calendar face, so a grant for Tasks alone failed it. **The Google
project:** the owner enables the Google Tasks API and declares `tasks.readonly` on the consent
screen, and the console says which class it is in. It is believed sensitive, as calendar and
carddav are, but only the console can confirm that.

**2026-09-23, later: T1 is built. Nothing can reach it until T2.** `GoogleTasksSource` turns
Google's lists and tasks into VTODO, with D1–D3 and D5 in the mapping, and 29 tests on the documented
shapes pin it. Trap 6 is answered: the UID is Google's id hex-encoded, so the key's lowercasing
cannot merge two tasks. Next is T2, the grant and the builder arm, which makes the face reachable.

**2026-09-23: the owner took D1–D5 as recommended.** *"Google Tasks, decisions D1–D5 in workplan
0126: ok!"* Nothing waits on a decision any more, so T1 can start.

**2026-09-22: planned at the owner's request; nothing built.** *"I see Google also supports tasks.
And we support that in Nextcloud as target. We need to also be able to migrate the tasks. Take
this up in a workplan, bring up to par similar to the other Google kinds, also compare to the
microsoft tasks kind."* This reopens 0113 T6 ("Google Tasks out of v1", decided 2026-09-03).
The `task` domain, its Nextcloud target and a Microsoft To Do source already exist. What is missing
is a Google face, and everything that makes a Google face whole: the grant, the Test, the preflight
and the screens.

The API facts below are from Google's own discovery document for the Tasks API (revision 20260920),
read 2026-09-22. The repo facts come from reading the code the same day. Nothing has been tried
against a live account.

| Task | Status | Evidence |
|---|---|---|
| T0 The owner's decisions | ✅ **Taken 2026-09-23** | All five as recommended (§ The owner's decisions). The owner: *"Google Tasks, decisions D1–D5 in workplan 0126: ok!"* |
| T1 The connector: Google Tasks → VTODO | 🟢 **Built 2026-09-23; unreachable until T2** | `packages/connectors/src/google-tasks-source.ts`, in the shape of `graph-todo-source.ts`. Lists are folders that declare `VTODO`, and tasks are VTODO with `etag` as the version (`updated` if Google ever omits it). A full listing each pass asks for `showCompleted`, `showHidden`, `showAssigned` and `showDeleted`, 100 a page. Completed and cleared tasks arrive `COMPLETED` (D1). An assigned task's origin and link, and each of `links[]`, are readable lines in `DESCRIPTION` after the notes (D2, D3). A deleted task is not an item: its source path goes into `removed`, the same path the live task was recorded under (D5). `due` becomes `DUE;VALUE=DATE`, read off the string. A subtask names its parent's UID in `RELATED-TO;RELTYPE=PARENT`. A 403 `insufficientPermissions` names the missing Tasks tick, a 401 says reconnect, and anything else is Google's own sentence without the envelope (`googleRefusalReason` in `drive-refusal.ts`). `a-google-task-arrives-as-vtodo.unit.test.ts`: 29 tests. |
| T2 The grant: a fifth Google face | 🟢 **Built 2026-09-23** | `task` is in both Google lists (`PROVIDER_ACCOUNT_DOMAINS.google`, last, and `GOOGLE_RESTRICTED_ACCOUNT_DOMAINS`). `GOOGLE_DOMAIN_SCOPES.task` asks `tasks.readonly` (read from `GOOGLE_TASKS_SCOPE`, so asked equals minted) and accepts the read-write `tasks`. `domainsToScopes`, the consent's `ORDER` and `GRANT_DOMAIN` know it, and `unsatisfiedScopes` now reads broader scopes off the table (`grantSatisfiesAskedScope`) instead of a hand-kept Drive pair. `ACCOUNT_FACE_BUILDERS.google.task` is `google-tasks`, and `buildGoogleTasksSourceFrom` (`google-tasks-source-factory.ts`) builds it: domain-wide delegation first, else the refresh token, with a named refusal at build time and the tenant's rate budget. The OpenAPI enum, the scope manifest (version bumped), the Google refusal sentence and the wizard card are updated. `a-fifth-google-face.unit.test.ts` pins the chain; 18 existing guards that pinned "no Google task face" now pin the new one. Not built: an appliance `google-tasks` source type, which no other plan asked for either (To Do has one, 0114 T9). |
| T3 The Test and the preflight | 🟢 **Done 2026-09-23** (the measure with T2, the probe after it) | `qualifyGoogleGrant` measures the face (lists and tasks counted, deleted ones not), and `GOOGLE_NO_TASKS` is gone. The preflight follows the same builder seam (`run-discovery` → `buildTaskSourceFromConnection`). **The probe:** a Google account's connection Test used to list the CALENDAR face always, so a grant for Tasks alone failed its Test. It now reads the grant (`readGoogleGrant`, shared with the qualification) and lists the first face the grant carries, calendar first (`googleFacesInProbeOrder`), which is Microsoft's shape. A grant it cannot read (domain-wide delegation, a missing field, a refused exchange) keeps the calendar headline and the refusal it always gave. `a-grant-for-tasks-alone.unit.test.ts`. |
| T4 The screens and docs | 🟢 **Done 2026-09-23** (screens with T2, docs after T3) | With T2: the wizard card and its restricted twin (en, nl), the setup step naming the Tasks API, the Connections tick (read from the table), the scope manifest, the OpenAPI text, the `sourceDomainRefusal` sentence, and the tests that pinned "a Google account offers no Tasks tick". After T3: `docs/feature-matrix.md` (the account paragraph, the task-sources paragraph, the ⛔ row now ✅), `docs/google-workspace-setup.md` (the Google Tasks API, the scope, the domain-wide delegation row), `docs/google-oauth-verification.md` (the class, the justification, and the console reading still owed), `docs/managed-bring-up.md` (both tiers' faces, the API, the scope), and the archive Test's word for a Google export's tasks (`an-export-that-called-google-tasks-reminders.unit.test.ts`). |
| T5 Throttling | 🟢 **Done for Tasks (T1 + T2)**: the builder arm passes the tenant's rate budget, and the Test passes none, as Microsoft's does | T1's source waits out a 429 or 503 (Retry-After, else one second, once) and takes the tenant `ThrottleLimiter` when given one. It also reads Google's 403 `rateLimitExceeded`/`userRateLimitExceeded` as the rate limit it is, so an owner is never told to reconnect over a limit that clears by itself. Whether Tasks answers a limit that way is unverified; Calendar and Drive document it. Left for T2: the builder passes the limiter. Originally: Google sources have no `ThrottleLimiter` and no 429 backoff; a 429 surfaces as an error. The Tasks API pages 100 tasks at a time, so the face should get the tenant limiter and a Retry-After backoff, as Graph's sources have. The other Google faces share the gap, which is named here and not fixed here. |
| T6 The target makes a TASK list | 🟡 **Google's half built in T1; To Do's open** | Google's lists now declare `VTODO`. `CalDAVTargetWriter` sends `supported-calendar-component-set` on MKCALENDAR only when the source folder declares components, and the To Do source declares none. So a migrated list is created with the server's default set. Both task sources should declare `VTODO`, and what Nextcloud does with no set should be checked. |
| T7 Say what does not carry, for BOTH sources | 📋 Open | § The comparison. Google cannot give recurrence or a time of day. To Do drops attachments, linked resources, reminders not in UTC, unknown recurrence types and checklist structure, and none of it is reported today. On par means both say so, in the same shape. |
| T8 Live proof | ⏳ Needs T1–T4 | On the owner's account: the preflight counts tasks, including completed ones (the `showHidden` trap), subtasks arrive nested in Nextcloud Tasks, a second pass creates nothing, an edit in Google reaches Nextcloud, and Mailpit stays silent. |

## The source: Google Tasks API v1 (discovery document, revision 20260920)

- **Scopes:** `https://www.googleapis.com/auth/tasks.readonly` (all this needs) and `…/auth/tasks`.
- **Lists:** `GET tasks/v1/users/@me/lists`, up to 1000 a page. A list has `id`, `etag`, `updated`,
  `title`.
- **Tasks:** `GET tasks/v1/lists/{tasklist}/tasks`, **20 a page by default and 100 at most**,
  `pageToken`, `updatedMin`, `showCompleted`, `showHidden`, `showDeleted`, `showAssigned`, and
  due/completed ranges.
- **A task:** `id`, `etag`, `title` (≤1024), `notes` (≤8192), `status` (`needsAction` or `completed`),
  `due`, `completed`, `updated`, `parent` (a subtask's parent), `position` (order among siblings),
  `hidden`, `deleted`, `links[]` (`type` e.g. `email`, `generic`, `chat_message`, `keep_note`; `link`;
  `description`), `webViewLink`, `assignmentInfo`.

The traps, each a silent loss if missed:

1. **Completed tasks are hidden by default.** `showCompleted` defaults to true, but *"showHidden
   must also be True to show tasks completed in first party clients, such as the web UI and
   Google's mobile apps."* A listing without `showHidden=true` drops every task the person ticked
   off in Google's own apps.
2. **Assigned tasks are left out by default.** `showAssigned` defaults to false. Tasks assigned to
   the person from Docs or Chat spaces are theirs too (D2).
3. **`due` is a date, not a time.** *"Only date information is recorded … It isn't possible to read
   or write the time that a task is scheduled for using the API."* It maps to `DUE;VALUE=DATE`,
   taken from the UTC date as given and never shifted by a timezone.
4. **No recurrence.** The API has no recurrence field, so a repeating task arrives as one task. It
   is reported (T7), not guessed at.
5. **The version must be set.** The sync rewrites an item only when its `sourceVersion` changes,
   and treats an absent one as "skip". The task's `etag` is the version, or edits never flow. The
   same gap in the Drive and OneDrive file listings is 0042 T8 (d).
6. **Ids are case-sensitive, and the ledger lowercases.** The task natural key hashes
   `'todo:' + uid.toLowerCase()` (`packages/shared/src/hash.ts`). Two Google ids differing only in
   case would collide. Check whether Google's id alphabet makes that possible before T1 ships.
   **Answered in T1 (2026-09-23): by construction, not by the alphabet.** The discovery document
   says only "Task identifier", so nothing rules a case-only difference out. The UID is therefore
   Google's id hex-encoded (`google-task-<hex>`), which the lowercasing cannot merge. It is also safe
   as the object's name on the target, which writes `{uid}.ics` unencoded. The id itself rides
   along in `X-GOOGLE-TASKS-ID`.

## The comparison

| | Google Tasks (API) | Microsoft To Do (`graph-todo-source.ts`) | Where it goes in VTODO |
|---|---|---|---|
| Lists | task lists | To Do lists (incl. the flagged-email list, copied like any other) | one collection each |
| Title / notes | `title`, `notes` (plain) | `title`, `body` (HTML, flattened) | `SUMMARY`, `DESCRIPTION` |
| Done | `status`, `completed` | 5 statuses mapped onto 3, kept in `X-MICROSOFT-TODO-STATUS` | `STATUS`, `COMPLETED`, `PERCENT-COMPLETE` |
| Due | date only | date only (the time is dropped) | `DUE;VALUE=DATE` |
| Start | — | start date, recurrence start | `DTSTART;VALUE=DATE` |
| Priority | — (the app's star is not in the API) | `importance` → 1/5/9 | `PRIORITY` |
| Repeats | **not in the API** | 6 Graph patterns → `RRULE`; others dropped silently | `RRULE` |
| Reminder | — | only when in UTC; others dropped silently | `VALARM` |
| Subtasks | `parent` (real subtasks) | checklist items, flattened into the description | `RELATED-TO;RELTYPE=PARENT` for Google |
| Order | `position` | — | kept verbatim in `X-GOOGLE-TASKS-POSITION` (T1); a sort-order property, if Nextcloud Tasks honours one (to check) |
| Links | `links[]`, `webViewLink` | linked resources: not fetched | `DESCRIPTION` lines (D3, built in T1). `webViewLink` is not carried: it points at the task in Google, which is what the migration leaves |
| Attachments | — | not fetched, dropped silently | — |
| Categories | — | `categories` | `CATEGORIES` |
| Version | `etag` | `lastModifiedDateTime` | the ledger's `source_version` |
| Deletions | `deleted` with `showDeleted` | none: a full listing each pass | removal evidence, if D5 says so |
| Proven live | never | never (0114 T10) | — |

To Do already has the fuller mapping. What neither has is a report of what was left behind, which
is where "on par" matters most (T7).

## What "on par with the other Google kinds" means (the repo, 2026-09-22)

- **Scopes:** one row in `GOOGLE_DOMAIN_SCOPES` (`account-qualification.ts`), read in both
  directions by consent and by the Test. Consent asks with `include_granted_scopes`, so adding a face
  later does not strip the earlier ones.
- **Faces:** `PROVIDER_ACCOUNT_DOMAINS.google` is `['calendar','contact']` today. The consent route's
  `GRANT_DOMAIN` covers four faces, and `GOOGLE_RESTRICTED_ACCOUNT_DOMAINS` also has no task.
- **Builder:** a `SourceFaceBuilder` name and a row in `ACCOUNT_FACE_BUILDERS.google`, plus an arm in
  `buildTaskSourceFromConnection` (its default refuses, naming the missing builder). The factory
  follows `buildGoogleCalendarDavSourceFrom`: domain-wide delegation first, otherwise
  `GoogleTokenProvider` with the face's scope, refusing at build time by name.
- **The Test:** `qualifyGoogleGrant` reads the grant's scopes and measures each face. `task` is
  hard-coded to `GOOGLE_NO_TASKS` today. The headline probe always lists the calendar face; Microsoft's
  lists the first face the grant carries.
- **Guards that will turn red, correctly:** `a-face-a-provider-account-cannot-build`,
  `a-face-no-account-can-actually-build`, `provider-accounts.unit.test.ts`, and the Connections
  test "a Google account offers no Tasks tick".
- **Also wrong today:** the archive qualification tells an owner that tasks in an export are
  *"migrated from the account itself instead, live"*. For Google that is untrue until this ships.
  Takeout's `Tasks.json` is a second route (0116) and is not this plan. **True since T2, and the
  sentence says "tasks" rather than Apple's "reminders" for a Google export since T4.**

## The owner's decisions (taken 2026-09-23, all five as recommended)

- **D1 Completed tasks, including the ones Google hides.** *Decided:* carry them, as
  `COMPLETED`. They are the person's history, and Nextcloud Tasks hides completed tasks by default,
  so the list looks the same as before.
- **D2 Tasks assigned from Docs or Chat.** *Decided:* carry them, with the link to where they
  came from in the description. They are on the person's list in Google.
- **D3 Links (email, chat, Keep).** *Decided:* one readable line each in `DESCRIPTION`, which
  every client shows. `ATTACH` is tidier, but few task apps display it.
- **D4 What cannot be carried.** *Decided:* report it per migration, as a count per reason,
  in the shape the preflight already uses for refused Google files. Do it for To Do in the same
  change.
- **D5 Deletions.** *Decided:* read `showDeleted` and pass deleted ids as reported removals,
  as the OneDrive delta does. They go to the owner's Deletions queue, never applied automatically.

## Not in this plan

- Writing back to Google, or two-way sync.
- Takeout's `Tasks.json` (the archive route, 0116).
- VJOURNAL, and re-arming alarms (0113's own exclusions).
