# Workplan 0103 — the mail a migration must not send

## Status — 2026-08-27 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-25** | This document — extended the same day with the owner's follow-up: the two-pass idea assessed (moved mail, not suppressed mail), and the notification channels beyond invitations. The question (issue #493) is answered: the fan-out is real, our write path does nothing about it, and the engine that would send it is already in the Stalwart binary this repo pins. Sources at the bottom; repo facts verified by grep, not memory. |
| T0 The posture, as an ADR | ✅ **Done 2026-08-25** | ADR-0043 — "a migration is silent by default; outward mail is a human-pressed action", accepted on the owner's instruction to build 0103 as written. Faithful copy, suppressed side effects; explicit SERVER rewritten, CLIENT/NONE kept. |
| T1 Neutralise the object at write | ✅ **Done 2026-08-25** | `neutraliseScheduling` in `@openmig/shared`, applied at the writer's one PUT choke point. Folded-line aware; SERVER→CLIENT; CLIENT/NONE untouched; idempotent. The hash subtlety DISSOLVED on measurement: `calendarContentHash` fingerprints UID/SUMMARY/DESCRIPTION/LOCATION only, and that invariant is now pinned by test. 13 unit rules + 2 on-the-wire rules, proved by breaking three ways. |
| T2 The gate: prove silence, don't assume it | ✅ **Done 2026-08-25** | Demo Nextcloud's SMTP now points at Mailpit — ARMED, so silence is falsifiable. Fresh event 1 carries a tag-addressed canary (third-party organiser, as most migrated meetings are). The smoke asserts the target copy's bytes carry SCHEDULE-AGENT=CLIENT (the writer observed on a real server) and catcher silence twice: after sync and after the take-back's DELETE (the CANCEL side). 4 rules in `the-mail-nobody-should-get.unit.test.ts`, proved by breaking. Owner-as-organiser on an armed server stays T3's measurement. |
| T3 Measure the target, per mapping | 🟡 **the measurement and the record are done** (capability 2026-08-25, the per-mapping record 2026-08-26 via 0105 T0; corrected here 2026-08-27); the canary half stays owner-gated | `detectCaldavScheduling` (connectors): one OPTIONS request reads the RFC 6638 `calendar-auto-schedule` compliance class out of the DAV header — API-only, no object written, no mail risked, which is all a real customer target ever offers (owner's constraint). Failure answers `unknown`, reported as unmeasured, never as safe. The gate measures the demo target every run and says whether the neutralising is load-bearing there. **The first half of what this row called REMAINING was built on 2026-08-26 and the board never caught up** — corrected 2026-08-27, because a plan that still asks for work somebody already did is how it gets done twice. 0105 T0 landed `packages/orchestration/src/target-scheduling.ts`, whose own docstring names itself "the 0103 T3 remainder", and it answers the question at all three moments it is asked: at connection test, where `probe-connection.ts` appends the sentence and `Connections.tsx` shows it; **once per mapping**, where `schedulingRecorder` writes the verdict to the audit log before the first calendar write — measured on the SAME endpoint the writer just received, guarded by `latestAuditEventAt` so a retried or resumed pass re-measures nothing, and never a pass-killer (the writer neutralises unconditionally under ADR-0043, so an advisory record that cannot be written is reported and the pass continues); and in the assessment (`permissions.ts`), which quotes the same sentences and excludes carddav, an address-book target having no scheduling to measure. Wired into the real pass as `recordTargetScheduling` in `build-deps-from-mapping.ts`, from the mapping's own credentials — not a demo path. **GENUINELY REMAINING, and owner-gated:** the owner-as-organiser honouring canary, which needs a tenant-owned probe inbox. Deliberately not guessed at: a canary that lands in an address nobody chose is mail this workplan exists to prevent. |
| T4 The operator switches, documented | ✅ **Done 2026-08-25** | `docs/dav-sync.md` § "Scheduling and invitation mail on the target": both switches, the reminder keys, the live-server caveat in bold, and the rule that the tool never flips them. |
| T5 The delete path | ✅ **Done 2026-08-25** | `Schedule-Reply: F` on both DELETE sites: `removeDavResource` (the gated apply path) and the take-back tool's `dav()`. Belt to T1's braces — either alone silences an honouring server; a server honouring neither is T3's to expose. Both proved by breaking. |
| T6 Shares: record the silence flags | ✅ **Done 2026-08-25** | The four flags recorded beside `applyShareGrant` itself — where a future bulk verb would be written — so it is born silent. (Side find while there: the file carried a raw NUL byte as a join separator, making it BINARY to grep and so invisible to every text guard; now the `'\u0000'` escape — same string, same grant_hash, greppable file.) |

## The question

> is the mail spread-out when migrating calendar events and shared files/folders
> a real issue, and if so what strategies prevent / suppress it?
> — the owner, 2026-08-25; issue #493 asked the calendar half on 2026-08-21.

## Is it real? Yes — and here is the mechanism

**RFC 6638 makes the server the mailman by default.** On a scheduling-enabled
CalDAV collection, a `PUT` of a calendar object carrying `ATTENDEE` properties
makes the server deliver iTIP scheduling messages to every attendee; over mail
that is iMIP — a real message in a real inbox. The `SCHEDULE-AGENT` parameter
decides who does that per attendee, and its default is `SERVER`. `CLIENT` and
`NONE` both mean the server sends nothing.

So importing a decade of a mailbox's meetings into a scheduling-enabled target
is, from the server's point of view, *organising* a decade of meetings: every
attendee of every event can be (re-)invited, including people who left the
company years ago and mailing lists with thousands of members. The same RFC
runs in reverse: **deleting** an organiser's copy sends CANCEL — which is our
take-back phase and the gated apply-deletion path, not a hypothetical.

**Our write path does nothing about any of this.** `caldav-target-writer.ts`
PUTs the source's raw iCalendar bytes; `ATTENDEE`/`ORGANIZER` lines ride
through verbatim. A repo-wide grep for `SCHEDULE-AGENT`, `Schedule-Reply`,
`sendUpdates`, `sendNotificationEmail`, `sendInvitation` finds nothing outside
this document.

**And the engine is already on our own stack.** The self-host/e2e target pins
`stalwartlabs/stalwart:v0.16.10`; Stalwart shipped RFC 6638 scheduling with
iMIP in v0.12.1. A mail server needs nobody's SMTP relay to send. The demo
Nextcloud, by contrast, has no mail configuration at all — mute by accident,
not by decision.

**Why nothing has mailed anyone yet:** no fixture in this repository contains a
single `ATTENDEE` line. The gates are green about this the way the apply half
was green in run #6 — the half that matters has never executed. That is the
shape this repo keeps rediscovering, and it is why T2 is a gate rather than a
code-review habit.

## What each target does, verified

| Target | Behaviour | Off-switch | Verified how |
|---|---|---|---|
| **Stalwart** (our e2e/self-host target, v0.16.10) | RFC 6638 + iMIP since v0.12.1 | Global `enable = false` for scheduling; also per-account permission | Vendor docs + changelog (sources below); version from `deploy/selfhost/setup-stalwart.sh:48` |
| **Nextcloud** (demo target, common real target) | iMIP plugin registered only when app config `dav/sendInvitations` = `yes` — **the default**. Skips events whose last occurrence is past, so pure history is partially self-protecting; future events and open-ended recurrences still fan out | `occ config:app:set dav sendInvitations --value no` (instance-wide) | Read from `nextcloud/server` source: `apps/dav/lib/Server.php` (registration condition), `IMipPlugin.php` (past-event skip) |
| **Soverin / Mailfence / Infomaniak** (ADR-0011 recommended) | Unknown — their docs are unreachable from this environment (egress proxy) | Unknown | **Not verified. Measure, don't trust** — which is what T3 exists for |
| **Microsoft 365** (not a target today) | Graph event-create with attendees always mails; no suppression parameter — feature request open since 2020. The old escape (EWS `SendMeetingInvitations="SendToNone"`) is closing: EWS in Exchange Online is blocked from 2026-10-01 (allowlist until 2027-04-01, then gone) | None via supported APIs | MS Q&A + retirement announcements (sources) |
| **Google** (source today, not a target) | `events.import` exists precisely for migration: no notifications, organiser preserved. `events.insert` needs `sendUpdates=none`, and Google's own docs say migrations should use import | Built into the right verb | Google Calendar API reference (sources) |

The M365 row is worth a sentence: if Microsoft 365 ever becomes a *target*,
calendar import with attendees intact **cannot currently be done silently
through supported APIs at all**. That is a scoping fact for any future "Graph
target" plan, not a task here.

## Shared files and folders — mostly already answered

ADR-0032 / workplan 0052 landed on the right posture before this question was
asked: every share grant is a checklist row, application is **one row at a
time, human-pressed, and labelled as outward-facing** in the UI ("pressing it
sends a real invitation"). There is no bulk path, so there is no storm to
suppress. Nextcloud internal user shares (our one implemented verb) notify
in-app; mail depends on the recipient's own activity settings — nothing to
suppress per call.

What T6 records for the day a bulk verb exists: the silence flags the APIs
already offer. Google Drive `permissions.create?sendNotificationEmail=false`;
Microsoft Graph `driveItem: invite` with `sendInvitation: false` (grants the
permission without sending the mail); Box collaborations `notify=false` and
Dropbox `add_folder_member` `quiet` per their API docs — the last two verified
against vendor documentation at build time, not here.

## The strategies, ranked

1. **Neutralise the object at write (T1) — the portable one.** Inject
   `SCHEDULE-AGENT=CLIENT` into every `ATTENDEE` and `ORGANIZER` property
   before PUT. RFC-blessed, per-object, target-agnostic; attendee data
   (names, PARTSTAT) survives for the person reading their calendar; and on a
   server that honours it, the same parameter silences the CANCEL on our
   deletes. *The one subtlety:* the writer's change detection hashes calendar
   bytes — the transform must be applied on one side of every comparison or
   every event looks permanently changed. T1 is that transform plus the hash
   discipline, proved by breaking.
2. **Switch the target off (T4) — where we run it.** Stalwart and Nextcloud
   both have global switches (table above). Instance-wide means a customer's
   live server goes quiet for its *real* users too — so this is a documented
   migration-window procedure with a restore step, never something the tool
   flips silently. Hard rule 2's spirit: don't mutate somebody's server
   config on the way past.
3. **Prove the silence (T2) — the gate.** Give one fixture event an
   `ATTENDEE:mailto:` address that resolves to Mailpit, then assert nothing
   arrived — after the sync *and* after the take-back. This converts "we
   believe the writer neutralises and the target honours" into a measured
   fact that re-proves itself on every Stalwart upgrade. The catcher and the
   per-run token discipline already exist (#577/#578); this is one fixture
   line and two assertions.
4. **Measure the customer's target (T3).** A canary event with a
   tenant-owned probe address at verify time, recorded per mapping. Servers
   that ignore `SCHEDULE-AGENT` exist; whether a given target honours it is a
   verdict, 0029-style, not an assumption.
5. **Belt for the delete path (T5).** `Schedule-Reply: F` on our DELETEs —
   defined by the same RFC for exactly this, cheap to add where `dav-removals`
   and the take-back tooling issue deletes.

What is deliberately *not* proposed: stripping `ATTENDEE` lines. It silences
every server unconditionally — and destroys data a person still wants to see
in their own copy of the event. ADR-0024's spirit applies: the copy should be
faithful; the *side effects* are what we suppress.

## "Add the events without people, and the people in a second pass?"

Asked by the owner (2026-08-25), because it is the most commonly recommended
trick out there — it circulates in the Microsoft world precisely because Graph
has no suppression parameter. The direct answer: **it does not suppress
anything on a scheduling server; it only moves the mail to the second pass.**

RFC 6638 scheduling is computed from the *change* each write makes: the server
inspects the attendees that appeared, disappeared or changed and mails
accordingly. Pass 1 (no attendees) is silent because there is nobody to tell.
Pass 2 (attendees added) is, to the server, *you have just invited these
people* — and it sends exactly the invitations pass 1 avoided. Microsoft's own
suggested workaround concedes this in its wording: create the event without
attendees "and then share the invite in a separate email" — the second pass
must never be an API pass, or it mails.

So the idea collapses into one of two strategies already weighed here:

- **Pass 2 never happens** → this is the strip-`ATTENDEE` strategy wearing two
  passes, with the same data loss, rejected above.
- **Pass 2 carries `SCHEDULE-AGENT=CLIENT`** → the parameter did all the work,
  and one pass with it (T1) achieves the same silence without the second
  write, the second change-detection entry, or the window between passes.

Not adopted. T1 + the T2 gate dominate it on every axis. The one place the
instinct behind it is right: on a target where nothing can silence the fan-out
(today's Microsoft 365), importing bare and never adding attendees via API is
the only silent option — which is a data-loss decision to put in front of the
owner, not a technique.

## Not only invitations — the other notification channels

Issue #493's word is *notifications*, which is wider than iMIP invitations.
What each channel does with imported events, verified where marked:

- **Invitations / cancellations (iTIP/iMIP)** — the body of this document.
- **Reminders (`VALARM`)** — Nextcloud's `ReminderService` materialises EMAIL
  and DISPLAY alarms, and **skips triggers already in the past** (verified in
  source), so imported *history* cannot re-fire there. Future events imported
  with `VALARM` will remind on schedule — which is usually *wanted*: the
  person migrated their calendar to keep being reminded. The admin switches
  (`dav sendEventReminders`, and the source-verified
  `sendEventRemindersToSharedUsers`) belong in T4's operator table as
  migration-window options, not as defaults.
- **In-app / activity digests** — Nextcloud's activity mails are a third
  channel. Not investigated here; T4's builder should spend ten minutes on it
  rather than inherit a guess.
- **Share notifications** — the shares section above; storm-proof by 0052's
  one-at-a-time design.

## Sources

- [RFC 6638 — Scheduling Extensions to CalDAV](https://www.rfc-editor.org/rfc/rfc6638) (behaviour on PUT; `SCHEDULE-AGENT` values; `Schedule-Reply`); readable summary: [tech-invite rendering](https://www.tech-invite.com/y65/tinv-ietf-rfc-6638-2.html), [Open-Xchange iTIP notes](https://documentation.open-xchange.com/8/middleware/calendar/iTip.html)
- Nextcloud source: [`apps/dav/lib/Server.php`](https://github.com/nextcloud/server/blob/master/apps/dav/lib/Server.php) (`sendInvitations` gate, default `yes`), [`IMipPlugin.php`](https://github.com/nextcloud/server/blob/master/apps/dav/lib/CalDAV/Schedule/IMipPlugin.php) (past-event skip), [`ReminderService.php`](https://github.com/nextcloud/server/blob/master/apps/dav/lib/CalDAV/Reminder/ReminderService.php) (past-trigger skip; `sendEventRemindersToSharedUsers`)
- [Stalwart scheduling docs](https://stalw.art/docs/collaboration/scheduling/), [changelog](https://github.com/stalwartlabs/stalwart/blob/main/CHANGELOG.md) (RFC 6638 + iMIP in v0.12.1; global disable)
- [Google Calendar `events.import`](https://developers.google.com/calendar/v3/reference/events/import), [`events.insert` `sendUpdates`](https://developers.google.com/workspace/calendar/v3/reference/events/insert)
- Microsoft: [no suppression on Graph event create (Q&A)](https://learn.microsoft.com/en-us/answers/questions/1339837/disable-the-invitation-mail-to-the-participants-wh), [EWS retirement](https://techcommunity.microsoft.com/blog/exchange/retirement-of-exchange-web-services-in-exchange-online/3924440), [EWSAllowedAppIDs / final phase](https://techcommunity.microsoft.com/blog/exchange/introducing-ewsallowedappids-preparing-for-the-final-phase-of-ews-retirement/4529471)
- [Graph `driveItem: invite` (`sendInvitation`)](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0), [Drive `permissions.create` (`sendNotificationEmail`)](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)
