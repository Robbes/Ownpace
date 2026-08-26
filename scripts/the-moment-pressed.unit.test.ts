// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE MOMENT, PRESSED (workplan 0104 T2, final stage).
 *
 * The gate no longer only proves the pipe can carry a mail — it presses the
 * REAL announcement: seed a real source share, discover it with the real
 * scan, apply it with the real press, and require the TARGET's own mail to
 * arrive carrying the note only the press writes. These rules keep the four
 * pieces from quietly falling apart, and pin the queue-drain that turns
 * "no mail yet" into "the queue was drained and still nothing" (the owner's
 * question, 2026-08-26).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');
const strip = (path: string): string =>
  readFileSync(join(COMPOSE, path), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

describe('the moment, pressed — the gate presses the real announcement', () => {
  it('the seed shares its tagged file by mail with a tag-addressed outsider', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(
      seed,
      'the seed no longer creates the source share — the rescan then finds\n' +
        'nothing and the press has nothing to press. The share is BY MAIL\n' +
        '(shareType 4) to a tag-addressed outsider, which is what a cutover\n' +
        'audience mostly is.',
    ).toMatch(/shareType=4[\s\S]{0,120}openmig-grantee-\$\{TAG\}@example\.invalid/);
  });

  it('the smoke rescans, presses apply-all with the tagged note, and requires arrival', () => {
    const smoke = strip('smoke-managed.sh');
    expect(smoke, 'the rescan call is gone').toMatch(/sharing\/rescan/);
    expect(
      smoke,
      'the press is gone — the announcement path is back to unit fakes.',
    ).toMatch(/sharing\/apply-all/);
    expect(
      smoke,
      'the press mail is no longer identified by ITS NOTE. The seed itself\n' +
        'mails the same grantee at seed time (the seed’s own act); only the\n' +
        'note tells the announcement apart, so only the note may be asserted.',
    ).toMatch(/Everything moved for run \$\{BALANCE_TAG\}[\s\S]{0,600}-ge 1/);
  });

  it('cutover is fabricated AND retracted around the press — never left flipped', () => {
    const smoke = strip('smoke-managed.sh');
    expect(
      smoke,
      'the press no longer captures the prior mapping status before flipping\n' +
        'it to done — a share applied before cutover is the wrong announcement\n' +
        'from the right channel, and the gate must not normalise it.',
    ).toMatch(/prior_status="\$\(q "SELECT status FROM mailbox_mapping/);
    expect(
      smoke,
      'the flip is not retracted — the demo mapping would stay done and every\n' +
        'later run would report a finished migration that is not.',
    ).toMatch(/UPDATE mailbox_mapping SET status='\$\{prior_status\}'/);
  });

  it('the queue is drained BEFORE the final silence is believed', () => {
    const smoke = strip('smoke-managed.sh');
    const drain = smoke.indexOf('php -f /var/www/html/cron.php');
    const finalSilence = smoke.lastIndexOf('query=openmig-attendee-${BALANCE_TAG}');
    expect(
      drain,
      'the cron drain is gone. Nextcloud has genuinely queued mail channels\n' +
        '(activity digests, calendar reminders) and the demo runs no cron — a\n' +
        'queued mail would sit invisibly behind a PASS until something ran the\n' +
        'jobs. The gate must run them itself, then believe the silence.',
    ).toBeGreaterThanOrEqual(0);
    expect(
      drain >= 0 && finalSilence >= 0 && drain < finalSilence,
      'the drain runs AFTER the last silence check — it must come first, or\n' +
        '"drained and still nothing" is back to "no queue fired yet".',
    ).toBe(true);
  });
});
