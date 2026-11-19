# ADR-0043: A migration is silent by default — outward mail is a human-pressed action

- **Status:** Accepted; amended 2026-11-19 (a target that emails guests whatever the marker says,
  or that no pass has tested yet, gets none, and a copy there that already lists guests is left as
  it is)
- **Date:** 2026-08-25
- **Deciders:** Owner, 2026-08-25 — "do T1 and T2, and the rest", instructing
  workplan 0103's proposed posture to be built as written. The research that
  proposed it: `docs/workplans/0103-the-mail-a-migration-must-not-send.md`
  (merged the same day, #588); the question it answers is issue #493's.

## Operative rules

- **No write this product makes to a target may cause the target to send mail or notifications
  to third parties, unless a person pressed a control that says so.** This extends ADR-0032's
  posture for shares (workplan 0052) to calendars, where RFC 6638 makes a scheduling target the
  mailman by default, and to any domain added later:
  `docs/workplans/0103-the-mail-a-migration-must-not-send.md`.
- **The copy stays faithful; the side effects are what we suppress.** `ATTENDEE` and `ORGANIZER`
  are kept: the calendar writer sets `SCHEDULE-AGENT=CLIENT` on every one it PUTs (0103 T1). An
  explicit `SCHEDULE-AGENT=SERVER` from the source is rewritten too; explicit `CLIENT`/`NONE` are
  kept byte-for-byte: `packages/shared/src/calendar-scheduling.unit.test.ts`.
- **Except a target that may email guests whatever the parameter says** (2026-11-19):
  a kind in `TARGETS_THAT_MAIL_GUESTS` (Cirrux, 0160; Infomaniak, untested, 0161) gets neither; each
  becomes a `COMMENT` naming the person: `packages/shared/src/a-guest-a-server-would-mail.unit.test.ts`.
  Undone by taking the kind off the list once its target can be written without mailing guests,
  shown by a pass that sends nothing.
- **At such a target, a copy that already lists guests is left as it is** (2026-11-19): neither
  rewritten nor deleted, and reported, since either would mail each guest:
  `packages/engines/src/a-copy-that-lists-guests-is-left-as-it-is.unit.test.ts`.
- **The same rule covers deletion.** Take-back and the gated apply-deletion path delete organiser
  copies; neutralised objects send no CANCEL on honouring servers, and `Schedule-Reply: F` on our
  DELETEs (0103 T5) is the belt for attendee-side replies:
  `packages/engines/src/dav-remove.unit.test.ts`.
- **Silence is proved, not assumed.** The managed gate seeds an attendee-carrying event and
  asserts the catcher stays empty across sync and take-back, and the neutralised bytes on the
  target (0103 T2): `scripts/the-mail-nobody-should-get.unit.test.ts`. Whether a customer target
  *honours* the parameter is measured per mapping (0103 T3,
  `packages/orchestration/src/target-scheduling.ts`), never assumed.
- **Target-side switches are an operator's migration-window decision, never a silent default.**
  Nextcloud's `sendInvitations` and Stalwart's scheduling toggle are instance-wide; the tool
  documents them (0103 T4, `docs/dav-sync.md`) and does not touch them.

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

## Amendment log

- **2026-10-03** — Operative rules cut to the [ADR-0051](./0051-an-adr-reads-as-it-stands.md) budget; nothing was
  decided. Their earlier wording, with the reasons and examples the budget left out, is in the
  record: [history/0043-a-migration-is-silent-by-default.md](./history/0043-a-migration-is-silent-by-default.md).
- **2026-11-19** — **Amended**, by the owner (*"yes, you may"*), on the condition that it can be
  undone once Cirrux says how its server can be written to without mailing guests. A target that
  emails guests whatever `SCHEDULE-AGENT` says gets no `ATTENDEE` and no `ORGANIZER`; each becomes
  a `COMMENT` that names the person. Cirrux had emailed an invitation, in the test mailbox's name
  and past events included, to every guest of the events a pass wrote into it, each marked
  `SCHEDULE-AGENT=CLIENT` (workplan 0160 §5). The first operative rule is why: no write may make a
  target mail third parties.
- **2026-11-19** — **Amended** again, under the first operative rule: at a target in
  `TARGETS_THAT_MAIL_GUESTS`, a copy that already lists a guest is neither rewritten nor deleted.
  Cirrux emails a guest a cancellation when they are taken off an event and when the event is
  deleted: a test of each that evening mailed one. The events written before the guests came out
  still list them there, and a rewrite takes every guest off. The writer reads the copy first,
  sends nothing when it lists a guest, and says so (workplan 0160 §5).
- **2026-11-19** — **Amended**: a kind can be on the list untested. `infomaniak` is on it from the
  day its kind arrives (workplan 0161 T1), because no pass has been run against it: its CalDAV
  server answers as SabreDAV, which in Nextcloud was seen to honour `SCHEDULE-AGENT=CLIENT`
  (workplan 0103), but what Infomaniak's does with it has not been seen, and an invitation sent
  cannot be taken back. Its writers send no guest, and leave a copy there that lists one as it
  is, as at Cirrux. What a person reads about such a target says it is untested, never that it
  mails guests (`TARGETS_UNTESTED_FOR_GUESTS`). It leaves the list on the evidence of a pass that
  sent none (workplan 0161 T2).
