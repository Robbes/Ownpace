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

/**
 * ONE PRESS OVER ONE FOLDER, ON THE REAL STACK (2026-09-19).
 *
 * The gate pressed `apply-all` and nothing else, so the folder press shipped
 * with its rule unit-tested and its behaviour against a real Nextcloud
 * unproven. Two things had to be true before it could be pressed at all, and
 * the second is the one that had been quietly false:
 *
 *  1. the seed has to share a FOLDER and something inside it — one file never
 *     folds, and a press over a group of one proves less than it looks;
 *  2. the SCAN has to say where things sit. `scanNextcloudShares` threw away
 *     `path` and `item_type`, so on the one source this gate runs against
 *     nothing folded and a folder press would have answered 404 forever.
 *
 * What is pinned here is the shape of the proof, not its wording: the seed,
 * the ORDER (folder press before apply-all, which settles everything), the
 * refusal checked before the press, and the take-back.
 */
describe('the folder press, pressed', () => {
  it('the seed shares a folder AND a file inside it, to one address at one level', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(seed, 'the shared folder is gone — a folder press has no folder').toMatch(
      /MKCOL "\$\{FILES\}\$\{share_dir\}"/,
    );
    expect(
      seed,
      'the folder holds nothing — a group of one is not the shape the fold exists for',
    ).toMatch(/openmig-demo-folder-file-\$\{TAG\}\.txt/);
    expect(
      seed,
      'permissions are no longer pinned. A folder that comes back writer beside a child\n' +
        'that comes back reader is a DEVIATION: the child leaves the group, the press\n' +
        'covers one row, and the gate still passes while testing something weaker.',
    ).toMatch(/"permissions=1"/);
  });

  it('the take-back removes the folder, so the source does not grow one per run', () => {
    const seed = strip('seed-demo-dav-content.sh');
    expect(seed).toMatch(/dir_spec="\$\{FILES\}openmig-shared-\$\{TAG\}"/);
    expect(seed).toMatch(/\$\{dir_spec:\+"\$dir_spec"\}/);
  });

  it('the smoke requires the SCAN to have said where things sit', () => {
    // Without placement nothing folds, and the press 404s. A gate that jumped
    // straight to the press would report that 404 as "the press is broken".
    const smoke = strip('smoke-managed.sh');
    expect(smoke).toMatch(/SELECT count\(\*\) FROM share_grant[^"]*parent_key='\$\{folder_parent\}'/);
  });

  it('presses the folder BEFORE apply-all, which would otherwise settle its rows', () => {
    const smoke = strip('smoke-managed.sh');
    const folder = smoke.indexOf('sharing/apply-folder');
    const all = smoke.indexOf('sharing/apply-all');
    expect(folder, 'the folder press is gone from the gate').toBeGreaterThan(-1);
    expect(
      folder,
      'apply-all now runs first. It settles every open clean row, so the folder press\n' +
        'that follows it has nothing to press and passes by applying zero.',
    ).toBeLessThan(all);
  });

  it('proves the GATE before the press: refused, named, and nothing sent', () => {
    const smoke = strip('smoke-managed.sh');
    // An empty `confirmed`, refused by name — ADR-0032 §6 at folder scale.
    expect(smoke).toMatch(/\\"confirmed\\":\{\}/);
    expect(smoke).toMatch(/unconfirmed_grantees/);
    // And the refusal must NAME who it waits on: "some address is unconfirmed"
    // is not something anybody can act on.
    expect(smoke).toMatch(/grep -q "\$folder_addr" <<<"\$ungated_body"/);
    // THE CLAUSE WORTH THE ROUND TRIP. A gate that refuses after the
    // invitations have left is not a gate, and only the catcher can say.
    expect(
      smoke,
      'the leak check is gone — nothing proves the refused press sent no mail.',
    ).toMatch(/leaked=[\s\S]{0,200}folder_note/);
  });

  it('then presses with the confirmation and requires the folder AND its file', () => {
    const smoke = strip('smoke-managed.sh');
    expect(smoke).toMatch(/\\"\$\{folder_addr\}\\":\\"\$\{folder_addr\}\\"/);
    expect(
      smoke,
      'the press no longer requires TWO rows. One would pass with the child\n' +
        'deviating out of the group — the failure this seeds against.',
    ).toMatch(/fpress_applied:-0\}" -lt 2/);
    // And the target's own mail, told apart from apply-all's by its note.
    expect(smoke).toMatch(/Folder moved for run \$\{BALANCE_TAG\}/);
  });
});
