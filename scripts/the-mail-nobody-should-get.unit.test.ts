// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MAIL NOBODY SHOULD GET (workplan 0103 T2, ADR-0043).
 *
 * The managed gate now proves a migration's silence instead of assuming it,
 * and this file keeps the three pieces of that proof from drifting apart —
 * because each is useless without the others:
 *
 *   - the demo target's SMTP points at the catcher (ARMED: silence is
 *     falsifiable, not true by inability),
 *   - the fresh fixture carries a tag-addressed ATTENDEE canary (there is
 *     something a regression WOULD mail),
 *   - the smoke asserts the target copy's bytes are neutralised and the
 *     catcher stayed empty, after sync AND after take-back (the CANCEL side).
 *
 * Before this, no fixture in the repository contained a single ATTENDEE line:
 * every green run was silent about invitation fan-out by blindness. The 0103
 * research is the account; run #6's apply-half is the precedent shape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const COMPOSE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');
const strip = (path: string): string =>
  readFileSync(join(COMPOSE, path), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

describe('the mail nobody should get — the gate stays armed and asserting', () => {
  it('points the demo target’s SMTP at the catcher, so silence can fail', () => {
    const compose = parse(readFileSync(join(COMPOSE, 'managed.yml'), 'utf8')) as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    const env = compose.services.nextcloud?.environment ?? {};
    expect(
      env.SMTP_HOST,
      'the demo Nextcloud has no SMTP_HOST, so it CANNOT send mail and the\n' +
        'scheduling-silence assertions are true by inability — the exact\n' +
        'silence-by-blindness 0103 exists to end. Point it at the catcher.',
    ).toBe('mailpit');
    expect(env.SMTP_PORT, 'mailpit listens for SMTP on 1025').toBe('1025');
  });

  it('seeds a canary attendee on fresh event 1, tag-addressed', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(
      seed,
      'seed-demo-dav-content.sh no longer seeds an ATTENDEE canary. Without\n' +
        'one there is nothing a regression toward mailing WOULD mail, and the\n' +
        'gate is silent by blindness again.',
    ).toMatch(/ATTENDEE[^\n]*openmig-attendee-\$\{TAG\}@example\.invalid/);
    expect(
      seed,
      'the canary lost its third-party ORGANIZER. Most of a migrated mailbox\n' +
        'is other people’s meetings, and the organiser property is what makes\n' +
        'a DELETE fan out CANCEL — the take-back half needs it present.',
    ).toMatch(/ORGANIZER[^\n]*openmig-organizer-\$\{TAG\}@example\.invalid/);
    expect(
      seed,
      'the canary is no longer confined to tagged (fresh) seeds. The fixed\n' +
        'demo fixture belongs to the demo UI; an untagged canary would also\n' +
        'search Mailpit for a constant address, which a previous run could\n' +
        'answer for.',
    ).toMatch(/\[ -n "\$TAG" \][\s\S]{0,200}openmig-organizer/);
  });

  it('asserts the neutralised bytes on the target’s own copy', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the smoke no longer reads the canary copy back off the target. The\n' +
        'byte half is what proves the writer neutralised in a real run —\n' +
        'without it, only unit fakes ever see the transform.',
    ).toMatch(/openmig-demo-event-\$\{BALANCE_TAG\}-1\.ics/);
    expect(
      smoke,
      'the smoke reads the copy but no longer requires SCHEDULE-AGENT=CLIENT\n' +
        'in it — an RFC 6638 target without that parameter MAILS the attendees.',
    ).toMatch(/grep -q "SCHEDULE-AGENT=CLIENT"/);
  });

  it('asserts catcher silence twice — after sync and after take-back', () => {
    const smoke = strip('smoke-managed.sh');
    const searches = smoke.match(/query=openmig-attendee-\$\{BALANCE_TAG\}/g) ?? [];
    expect(
      searches.length,
      `the smoke searches the catcher for the canary ${searches.length} time(s);\n` +
        'it takes two — once after sync (invitation fan-out) and once after the\n' +
        'take-back (CANCEL fan-out). Deleting an organiser copy is a scheduling\n' +
        'write under RFC 6638, so removal needs its own assertion.',
    ).toBe(2);
  });

  it('take-back DELETEs carry Schedule-Reply: F (0103 T5)', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(
      seed,
      'seed-demo-dav-content.sh DELETEs without Schedule-Reply: F. The\n' +
        'take-back removes organiser copies that can carry attendees — the\n' +
        'canary above does — and on a scheduling server a bare DELETE fans\n' +
        'out CANCEL to all of them.',
    ).toMatch(/"\$method" = "DELETE"[^\n]*Schedule-Reply: F/);
  });

  it('measures the target instead of trusting it (0103 T3)', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the smoke no longer asks the target whether it auto-schedules. One\n' +
        'OPTIONS request, API-only, no side effects — without it, whether the\n' +
        'neutralising is load-bearing on this target is a guess again.',
    ).toMatch(/OPTIONS[\s\S]{0,400}calendar-auto-schedule/);
    expect(
      smoke,
      'the measurement lost its unmeasured state. A target that answers no\n' +
        'DAV header is UNKNOWN — reporting it as anything else is the run-#6\n' +
        'shape: a check that could not run counted as one that passed.',
    ).toMatch(/UNKNOWN[^\n]*unmeasured/);
  });

  it('keeps the operator switches documented with the live-server caveat (T4)', () => {
    const doc = readFileSync(join(COMPOSE, '..', '..', 'docs', 'dav-sync.md'), 'utf8');
    expect(doc, 'dav-sync.md no longer names the Nextcloud invitation switch').toContain(
      'sendInvitations',
    );
    expect(
      doc,
      'the live-server caveat is gone: both switches are instance-wide, and\n' +
        'without the warning an operator silences a customer’s real users to\n' +
        'quiet a migration.',
    ).toMatch(/instance-wide[\s\S]{0,300}LIVE server/);
  });
});
