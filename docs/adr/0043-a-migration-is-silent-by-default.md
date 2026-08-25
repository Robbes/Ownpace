# ADR-0043: A migration is silent by default — outward mail is a human-pressed action

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** Owner, 2026-08-25 — "do T1 and T2, and the rest", instructing
  workplan 0103's proposed posture to be built as written. The research that
  proposed it: `docs/workplans/0103-the-mail-a-migration-must-not-send.md`
  (merged the same day, #588); the question it answers is issue #493's.

## Operative rules

- **No write this product makes to a target may cause the target to send mail
  or notifications to third parties, unless a person pressed a control that
  says so.** The precedent is ADR-0032 / workplan 0052, which made every
  share grant a one-at-a-time, human-confirmed action labelled as
  outward-facing in the UI. This ADR generalises that posture to calendars —
  where RFC 6638 makes a scheduling-enabled target the mailman *by default* —
  and to any domain added later.
- **The copy stays faithful; the side effects are what we suppress.**
  `ATTENDEE` and `ORGANIZER` are data a person still wants in their own copy
  of an event. They are never stripped. What changes is transport metadata:
  `SCHEDULE-AGENT=CLIENT` on every `ATTENDEE` and `ORGANIZER` the calendar
  writer PUTs (0103 T1), which RFC 6638 defines as "the server stores and
  sends nothing". An explicit `SCHEDULE-AGENT=SERVER` from the source is
  rewritten too — it was true where the event lived; carried over, it re-fires
  years-old invitations. Explicit `CLIENT`/`NONE` are kept byte-for-byte.
- **The same rule covers deletion.** Take-back and the gated apply-deletion
  path delete organiser copies, which fans out CANCEL under the same RFC.
  Neutralised objects do not CANCEL on honouring servers; `Schedule-Reply: F`
  on our DELETEs (0103 T5) is the belt for attendee-side replies.
- **Silence is proved, not assumed.** The managed gate seeds an
  attendee-carrying event and asserts the catcher stays empty across sync and
  take-back (0103 T2), and asserts the neutralised bytes on the target.
  Whether a given customer target *honours* the parameter is a measured fact
  per mapping (0103 T3), never an assumption — servers that ignore it exist.
- **Target-side switches are an operator's migration-window decision, never a
  silent default.** Nextcloud's `sendInvitations` and Stalwart's scheduling
  toggle are instance-wide: flipping them on a customer's live server
  silences their real users too. The tool documents them (0103 T4) and does
  not touch them.

## Context

Importing a decade of meetings into a scheduling-enabled CalDAV target is,
from the server's point of view, *organising* a decade of meetings. The full
mechanism, per-target behaviour (Stalwart ships the engine in the version
this repo pins; Nextcloud's defaults; Google's import verb; Microsoft 365's
lack of any suppression), and the strategies weighed — including the
widely-circulated "import bare, add attendees in a second pass", which merely
moves the mail to the second pass — are in workplan 0103 with sources.

## Consequences

- The calendar writer transforms bytes it previously passed verbatim. This is
  safe against change detection because `calendarContentHash` fingerprints
  `UID/SUMMARY/DESCRIPTION/LOCATION` only — an invariant pinned by test
  (`calendar-scheduling.unit.test.ts`), so widening the fingerprint set has a
  named consequence instead of a silent verify regression.
- A target that ignores `SCHEDULE-AGENT` can still mail. That residual risk
  is what T3's measurement and T4's documented switches exist for; the gate
  (T2) turns any regression on our own stack into a red run.
