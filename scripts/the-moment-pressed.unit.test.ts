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

/**
 * THE PRESS THAT RAN OUT OF SHARES (E2E (managed) #277, attempt 2, 2026-10-25).
 *
 * Nextcloud lets one account create 20 shares in 10 minutes, failed attempts
 * included, and every share the gate makes on the target is made as the
 * target account. A press asks for a user share first and by mail only after
 * a 404, so an outsider row costs two. A row a press refused stayed open for
 * good, and apply-all presses the whole mapping, so three rows run #238 left
 * were paid for by every later press. Attempt 2 pressed eight minutes after
 * attempt 1, and its own row most likely came back 429 (inferred from the
 * timings, workplan 0104). The log could not say: it printed the first six
 * lines of the refused JSON, and the status sits at the end of each reason.
 *
 * Pinned here: the refused list is printed whole, a row to a line, and never
 * the body, whose applied rows carry the source's share verbatim; the balance
 * fails when a press said it applied this run's rows and one is still open,
 * then skips every open row the gate made through the product's own decision
 * route, after the press, and asserts none is left; and the rows it picks
 * carry a smoke tag on the item AND the grantee and are open, so no other row
 * can be taken.
 */
describe('the press that ran out of shares (E2E (managed) #277, 2026-10-25)', () => {
  const smoke = strip('smoke-managed.sh');
  const seed = strip('seed-demo-dav-content.sh');
  const branch = (from: string): string => {
    const at = smoke.indexOf(from);
    return at === -1 ? '' : smoke.slice(at, smoke.indexOf('fail_at', at));
  };
  const helper = (() => {
    const at = smoke.indexOf('refused_rows() {');
    return at === -1 ? '' : smoke.slice(at, smoke.indexOf('\n  }\n', at));
  })();

  it('prints every refused row whole, one to a line, with its status', () => {
    expect(
      smoke,
      'the refused list is cut with awk again. Six lines of JSON stopped before the\n' +
        'reason, and the reason is where "(status 429)" is: #277 attempt 2 read like\n' +
        'any other refusal.',
    ).not.toMatch(/\.refused[^\n]*\|\s*(awk|head|cut)\b/);
    expect(helper, 'refused_rows is gone').not.toEqual('');
    expect(helper, 'refused_rows cuts its own output').not.toMatch(/\|\s*(awk|head|cut)\b/);
    expect(
      helper,
      'a refused row must be printed with where it is, its code and its whole reason',
    ).toMatch(/\.refused\[\] \| "[^"\n]*\\\(\.on\)[^"\n]*\\\(\.code\)[^"\n]*\\\(\.reason\)"/);
    expect(helper, 'with no refused array, the reason must still be printed').toMatch(
      /else "[^"\n]*\\\(\.reason \/\/ \.error \/\/ /,
    );
    expect(
      helper,
      'with nothing refused the whole body is printed. Its applied rows carry the source\n' +
        'share verbatim, token and address included, and the job log is public.',
    ).not.toMatch(/\/\/ \.\)|tostring|tojson/);
    expect(helper, 'an empty answer prints nothing at all').toMatch(/\[ -n "\$1" \] \|\|/);
    for (const from of ['expected the folder AND', 'the press applied nothing:']) {
      const b = branch(from);
      expect(b, `the branch "${from}" is gone`).not.toEqual('');
      expect(b, `the branch "${from}" no longer prints the refused rows`).toMatch(
        /refused_rows "\$\{f?press_out%/,
      );
      expect(b, `the branch "${from}" cuts what it prints`).not.toMatch(/\|\s*(awk|head|cut)\b/);
    }
  });

  it("says whether this run's own row was refused, and names the limit on a 429", () => {
    const b = branch('the press applied nothing:');
    expect(b, "the apply-all branch no longer says whether this run's own row was refused").toMatch(
      /own_row="openmig-demo-file-\$\{BALANCE_TAG\}-1\.txt"[\s\S]*any\(\.refused\[\]\?; \.on == \$on\)/,
    );
    expect(
      b,
      'an answer with no refused list (a 500, a proxy page, no body) must not read as\n' +
        '"the press did not try it": nothing in it says so.',
    ).toMatch(/if ! jq -e '\.refused \| type == "array"'[\s\S]*cannot say[\s\S]*elif jq -e --arg on/);
    expect(helper, 'a 429 is no longer told apart').toMatch(/grep -q 'status 429'/);
    expect(helper, "the 429 sentence no longer names Nextcloud's limit").toMatch(
      /20 new shares in 10 minutes[\s\S]{0,200}another run's press/,
    );
  });

  it("skips the gate's open rows through the decision route, after the press, every run", () => {
    const settle = smoke.indexOf('/sharing/${grant_id}/decision');
    expect(
      settle,
      "the balance no longer settles the share rows the gate made. A row a press refused\n" +
        'then stays open for good, and every later press spends two of the 20 on it.',
    ).toBeGreaterThan(-1);
    expect(
      smoke.slice(settle - 300, settle),
      'the settle must SKIP: the decision route then writes the audit trail and makes no share',
    ).toMatch(/\\"action\\":\\"skip\\"/);
    expect(smoke, 'the rows skipped must be the ones the predicate picked').toMatch(
      /gate_rows="\$\(q "SELECT id, on_label FROM share_grant WHERE \$GATE_SHARES ORDER BY on_label"\)"/,
    );
    expect(smoke, 'the loop over the picked rows is gone, or nested under a condition').toMatch(
      /\n {2}while IFS='\|' read -r grant_id grant_on; do\n/,
    );
    expect(smoke.slice(settle, settle + 600), 'a refused skip must fail the run').toMatch(
      /else[\s\S]*fail_at/,
    );
    expect(
      smoke.slice(settle - 300, settle),
      'the skip reason is written to the audit trail for good, so it must hold for every\n' +
        'row it settles: name the run that skipped it, and claim nothing about its file',
    ).toMatch(/skipped by run \$\{BALANCE_TAG\}/);

    const own = smoke.indexOf(
      'if [ "${fpress_applied:-0}" -ge 2 ] && [ "${press_applied:-0}" -ge 1 ]; then',
    );
    expect(
      own,
      "this run's own rows are no longer checked before the skip. When both presses said\n" +
        'they applied, an open one means the press and the ledger disagree, and the skip\n' +
        'would erase the only trace of it.',
    ).toBeGreaterThan(-1);
    expect(
      smoke.slice(own, own + 600),
      "an open row of this run's own, after presses that said they applied it, must fail the run",
    ).toMatch(/\$GATE_SHARES AND on_label LIKE '%\$\{BALANCE_TAG\}%'[\s\S]*fail_at/);
    expect(own, "the check on this run's own rows must come before the skip").toBeLessThan(
      smoke.indexOf('gate_rows="$(q '),
    );

    const press = smoke.indexOf('sharing/apply-all');
    const balance = smoke.indexOf('note "balance — take back what this run added"');
    const guard = smoke.indexOf('if [ "$objects_gone" = "1" ]; then');
    const guardEnd = smoke.indexOf('\n  fi\n', guard);
    const next = smoke.indexOf('note "the progress link"');
    expect(press, 'the press is gone').toBeGreaterThan(-1);
    expect(
      press < balance && balance < guard && guard < guardEnd && guardEnd < settle && settle < next,
      'the settle must come after the press (or it takes a row the press was there to\n' +
        'apply), after the target, source and ledger take-back, outside the objects_gone\n' +
        'guard (a decision, not a delete), and inside the balance, which every seeded run reaches.',
    ).toBe(true);

    expect(smoke, 'what is left open is no longer asserted').toMatch(
      /gate_left="\$\(q "SELECT count\(\*\) FROM share_grant WHERE \$GATE_SHARES"\)"/,
    );
    expect(smoke, 'a row left open must fail the run').toMatch(
      /\[ "\$\{gate_left:-1\}" = "0" \] \|\|[\s\S]{0,300}fail_at/,
    );
  });

  it('picks only open rows that carry a smoke tag on the item AND the grantee', () => {
    const def = /\n {2}GATE_SHARES="([^"\n]*)"/.exec(smoke)?.[1] ?? '';
    expect(def, 'GATE_SHARES, the predicate of the settle, is gone').not.toEqual('');
    expect(def, 'the settle must stay inside the APPLY mapping').toMatch(/^\$SCOPE AND /);
    expect(def, 'a row that is not open must never be taken').toContain("state = 'open'");
    expect(def).toContain("on_label ~ '$GATE_SHARE_ON_RE'");
    expect(def).toContain("grantee ~ '$GATE_SHARE_TO_RE'");
    expect(def, 'an OR, a LIKE or a case-blind match widens the predicate').not.toMatch(
      /\bOR\b|LIKE|~\*/i,
    );

    const onRe = /\n {2}GATE_SHARE_ON_RE="([^"\n]*)"/.exec(smoke)?.[1];
    const toRe = /\n {2}GATE_SHARE_TO_RE="([^"\n]*)"/.exec(smoke)?.[1];
    expect(onRe, 'GATE_SHARE_ON_RE is gone').toBeDefined();
    expect(toRe, 'GATE_SHARE_TO_RE is gone').toBeDefined();
    const on = new RegExp(onRe ?? '$^');
    const to = new RegExp(toRe ?? '$^');

    // The tag the smoke mints, and the names the seed shares under it.
    expect(smoke).toMatch(/BALANCE_TAG="smoke-\$\(date -u \+%Y%m%dT%H%M%SZ\)-\$\$"/);
    expect(seed).toMatch(/"path=\/openmig-demo-file-\$\{SUFFIX\}1\.txt"/);
    expect(seed).toMatch(/share_dir="openmig-shared-\$\{TAG\}"/);
    expect(seed).toMatch(/folder_addr="openmig-folder-\$\{TAG\}@example\.invalid"/);
    const tag = 'smoke-20261005T105039Z-1261917';
    for (const label of [
      `openmig-demo-file-${tag}-1.txt`,
      `openmig-shared-${tag}`,
      `openmig-shared-${tag}/openmig-demo-folder-file-${tag}.txt`,
    ]) {
      expect(on.test(label), `the settle misses the gate's own row ${label}`).toBe(true);
    }
    for (const grantee of [
      `openmig-grantee-${tag}@example.invalid`,
      `openmig-folder-${tag}@example.invalid`,
    ]) {
      expect(to.test(grantee), `the settle misses the gate's own grantee ${grantee}`).toBe(true);
    }

    // And nothing that is not the gate's.
    for (const label of [
      'openmig-demo-file-1.txt',
      'openmig-demo-file-mytag-1.txt',
      'Documents/report.pdf',
      `Documents/openmig-demo-file-${tag}-1.txt`,
    ]) {
      expect(on.test(label), `the settle would take ${label}, which the gate never made`).toBe(false);
    }
    for (const grantee of [
      'anna@example.com',
      'openmig-grantee@example.invalid',
      'openmig-grantee-mytag@example.invalid',
      `openmig-grantee-${tag}@example.invalid.example.com`,
    ]) {
      expect(to.test(grantee), `the settle would take a row shared with ${grantee}`).toBe(false);
    }
  });
});
