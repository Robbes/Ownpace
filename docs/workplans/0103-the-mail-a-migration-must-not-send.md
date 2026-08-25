# Workplan 0103 — the mail a migration must not send

## Status — 2026-08-25 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| Research | ✅ **Done 2026-08-25** | This document. The question (issue #493) is answered: the fan-out is real, our write path does nothing about it, and the engine that would send it is already in the Stalwart binary this repo pins. Sources at the bottom; repo facts verified by grep, not memory. |
| T0 The posture, as an ADR | ⬜ proposed | "A migration is silent by default; outward mail is a human-pressed action." 0052 already decided this for shares — this generalises it to calendars and writes it down where a reviewer can hold code to it. |
| T1 Neutralise the object at write | ⬜ proposed | `caldav-target-writer` injects `SCHEDULE-AGENT=CLIENT` on every `ATTENDEE` and `ORGANIZER` before PUT. One engineering subtlety below. |
| T2 The gate: prove silence, don't assume it | ⬜ proposed | A fixture event with an `ATTENDEE` at a Mailpit-routed address; assert **zero** mail after sync AND after take-back. Today no fixture carries an attendee at all, so every green run is silent about this by blindness, not by safety. |
| T3 Measure the target, per mapping | ⬜ proposed | A canary event at verify time — some servers ignore `SCHEDULE-AGENT`. Honouring is a fact to record per target, not a spec to trust. |
| T4 The operator switches, documented | ⬜ proposed | Nextcloud and Stalwart both have a global off-switch; both are instance-wide, so on a customer's LIVE server they silence real users too. A migration-window decision, never a silent default. |
| T5 The delete path | ⬜ proposed | `Schedule-Reply: F` on our DELETEs. Take-back and gated apply-deletion currently fan out CANCELs by the same mechanism that import fans out invitations. |
| T6 Shares: record the silence flags | ⬜ proposed | 0052 made share application one-at-a-time and human-pressed — no storm by construction. If a bulk verb ever exists, the per-API flags below are where it starts. |

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

## Sources

- [RFC 6638 — Scheduling Extensions to CalDAV](https://www.rfc-editor.org/rfc/rfc6638) (behaviour on PUT; `SCHEDULE-AGENT` values; `Schedule-Reply`); readable summary: [tech-invite rendering](https://www.tech-invite.com/y65/tinv-ietf-rfc-6638-2.html), [Open-Xchange iTIP notes](https://documentation.open-xchange.com/8/middleware/calendar/iTip.html)
- Nextcloud source: [`apps/dav/lib/Server.php`](https://github.com/nextcloud/server/blob/master/apps/dav/lib/Server.php) (`sendInvitations` gate, default `yes`), [`IMipPlugin.php`](https://github.com/nextcloud/server/blob/master/apps/dav/lib/CalDAV/Schedule/IMipPlugin.php) (past-event skip)
- [Stalwart scheduling docs](https://stalw.art/docs/collaboration/scheduling/), [changelog](https://github.com/stalwartlabs/stalwart/blob/main/CHANGELOG.md) (RFC 6638 + iMIP in v0.12.1; global disable)
- [Google Calendar `events.import`](https://developers.google.com/calendar/v3/reference/events/import), [`events.insert` `sendUpdates`](https://developers.google.com/workspace/calendar/v3/reference/events/insert)
- Microsoft: [no suppression on Graph event create (Q&A)](https://learn.microsoft.com/en-us/answers/questions/1339837/disable-the-invitation-mail-to-the-participants-wh), [EWS retirement](https://techcommunity.microsoft.com/blog/exchange/retirement-of-exchange-web-services-in-exchange-online/3924440), [EWSAllowedAppIDs / final phase](https://techcommunity.microsoft.com/blog/exchange/introducing-ewsallowedappids-preparing-for-the-final-phase-of-ews-retirement/4529471)
- [Graph `driveItem: invite` (`sendInvitation`)](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0), [Drive `permissions.create` (`sendNotificationEmail`)](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)
