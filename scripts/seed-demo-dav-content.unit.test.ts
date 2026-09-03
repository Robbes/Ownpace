// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The demo's DAV content, and the two ways seeding it goes quietly wrong.
 *
 * `setup-nextcloud-users.sh` provisions accounts and no content — grep it for
 * PUT and nothing comes back. So the demo DAV source has always been empty,
 * every sync of demo tenant B has correctly copied nothing, and `item` has
 * never held a `copied` row for that mapping. That is what e2e-managed run #7
 * found the moment a skipped apply half was allowed to fail instead of pass.
 *
 * Docker and Nextcloud are stubbed here, and the stub is not the thing under
 * test: what is tested is the argv this script builds and the paths it tries,
 * both of which were wrong in the first draft in ways that produce a plausible
 * HTTP error rather than a crash.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDER = join(REPO_ROOT, 'deploy/compose/seed-demo-dav-content.sh');

/**
 * A Nextcloud that answers 207 only for the collection spellings it really
 * uses. Nextcloud's layout is NOT symmetric — calendars live under
 * `calendars/<user>/` but address books under `addressbooks/users/<user>/` —
 * so a script that assumes one spelling for both gets a 404 that reads exactly
 * like "the account has no calendar".
 */
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$ARGDIR/all.args"
printf '%s\\n' "$@" > "$ARGDIR/last.args"
args=("$@"); i=1; [ "\${args[1]}" = "-i" ] && i=2
case "\${args[$((i+1))]}" in true|sh) exit 0 ;; esac
url="\${args[\${#args[@]}-1]}"
for ((j=0;j<\${#args[@]};j++)); do [ "\${args[$j]}" = "-X" ] && m="\${args[$((j+1))]}"; done
if [ "$m" = "PROPFIND" ]; then
  case "$url" in
    # TASK_LIST_ANSWER decides whether the VTODO-only collection already
    # exists: 207 is the steady state (bring-up made it once), 404 sends the
    # seeder down the MKCALENDAR path. Default 207, so every test written
    # before 0113 T7 keeps measuring what it was written to measure.
    *"/calendars/$NCUSER/openmig-tasks/"*)
      printf '%s\\n' "\${args[@]}" | grep -q 'Depth: 1' && { echo "$VERIFY_ANSWER"; exit 0; }
      echo -n "\${TASK_LIST_ANSWER:-207}" ;;
    *"/calendars/$NCUSER/personal/"*|*"/addressbooks/users/$NCUSER/contacts/"*|*"/files/$NCUSER/"*)
      printf '%s\\n' "\${args[@]}" | grep -q 'Depth: 1' && { echo "$VERIFY_ANSWER"; exit 0; }
      echo -n 207 ;;
    *) echo -n 404 ;;
  esac
  exit 0
fi
if [ "$m" = "MKCALENDAR" ]; then
  printf '%s\\n' "$url" >> "$ARGDIR/mkcalendar.txt"
  cat >> "$ARGDIR/mkcalendar-body.txt" 2>/dev/null
  echo -n "\${MKCALENDAR_ANSWER:-201}"
  exit 0
fi
if [ "$m" = "DELETE" ]; then
  printf '%s\\n' "$url" >> "$ARGDIR/deleted.txt"
  echo -n "\${DELETE_ANSWER:-204}"
  exit 0
fi
if [ "$m" = "POST" ]; then
  printf '%s\\n' "\${args[@]}" >> "$ARGDIR/ocs-posts.txt"
  echo -n '{"ocs":{"meta":{"status":"ok","statuscode":200}}}'
  exit 0
fi
cat >> "$ARGDIR/bodies.txt" 2>/dev/null; echo -n 201
`;

let dir: string;
function run(env: Record<string, string> = {}, argv: string[] = []) {
  return spawnSync('bash', [SEEDER, ...argv], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      ARGDIR: dir,
      NCUSER: 'tenant-b-source',
      // The task name joins the default answer because the seeder counts
      // tasks now and refuses when it finds none (0113 T7) — the same
      // "report what is true" rule the other three already lived under.
      VERIFY_ANSWER:
        'openmig-demo-event-1 openmig-demo-task-1 openmig-demo-contact-1 openmig-demo-file-1',
      ...env,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'davseed-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'docker'), STUB);
  chmodSync(join(dir, 'bin', 'docker'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The demo resource names in a captured argv dump. */
const names = (captured: string) => captured.match(/openmig-demo-[a-z]+-[^\s"]+/g) ?? [];

describe('the requests it builds', () => {
  it('sends Content-Type as ONE argument, not three', () => {
    // A header whose value contains `;` is the argv mistake this kind of
    // script invites, and curl does not complain about it — Nextcloud simply
    // stores the wrong content type, and the sync then copies an item that
    // reads as the wrong kind. Pinned because it fails silently, not loudly.
    const r = run();
    expect(r.status).toBe(0);
    const args = readFileSync(join(dir, 'all.args'), 'utf8').split('\n');
    const headers = args.filter((a) => a.startsWith('Content-Type:'));
    expect(headers).toContain('Content-Type: text/calendar; charset=utf-8');
    expect(headers).toContain('Content-Type: text/vcard; charset=utf-8');
    // The split form would leave a bare `Content-Type:` with the value elsewhere.
    expect(args).not.toContain('Content-Type:');
  });

  it('seeds all four domains the demo mapping selects', () => {
    run();
    const all = readFileSync(join(dir, 'all.args'), 'utf8');
    expect(all).toMatch(/openmig-demo-event-\d\.ics/);
    expect(all).toMatch(/openmig-demo-contact-\d\.vcf/);
    expect(all).toMatch(/openmig-demo-file-\d\.txt/);
    // Tasks joined the mapping in 0113 T7. A gate that seeds three domains
    // for a mapping that selects four proves nothing about the fourth.
    expect(all).toMatch(/openmig-demo-task-\d\.ics/);
  });
});

describe('the task list is a collection that declares VTODO and nothing else (0113 T7)', () => {
  // THE WHOLE POINT OF T7. Nextcloud's default `personal` calendar declares
  // `VEVENT,VTODO`, so a VTODO dropped in there is carried by BOTH faces and
  // would pass whether or not the source can tell a task list from a calendar
  // — which is the one thing this gate exists to check. The collection that
  // declares VTODO ALONE is what this product read as a calendar for years.

  it('the tasks go in their own collection, never beside the events', () => {
    run();
    const all = readFileSync(join(dir, 'all.args'), 'utf8');
    expect(all).toContain('/calendars/tenant-b-source/openmig-tasks/openmig-demo-task-1.ics');
    // And the events stay where they were: two collections, not one renamed.
    expect(all).toContain('/calendars/tenant-b-source/personal/openmig-demo-event-1.ics');
    expect(all).not.toContain('/calendars/tenant-b-source/personal/openmig-demo-task-');
  });

  it('creates it with a supported-calendar-component-set of VTODO alone', () => {
    // A collection created WITHOUT the property declares nothing, which RFC
    // 4791 §5.2.3 reads as "may contain any component type" — and a gate
    // seeded into that collection is back to the mixed case it was written to
    // get away from.
    const r = run({ TASK_LIST_ANSWER: '404' });
    expect(r.status).toBe(0);
    const body = readFileSync(join(dir, 'mkcalendar-body.txt'), 'utf8');
    expect(body).toContain('supported-calendar-component-set');
    expect(body).toContain('<C:comp name="VTODO"/>');
    // VEVENT here would make it a mixed collection and quietly undo the test.
    expect(body).not.toContain('VEVENT');
  });

  it('does not MKCALENDAR when the collection is already there', () => {
    // Bring-up runs this every time and must converge (hard rule 1).
    const r = run({ TASK_LIST_ANSWER: '207' });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'mkcalendar.txt'))).toBe(false);
  });

  it('treats 405 as a collection that exists, not as a failure', () => {
    // What a server answers for MKCALENDAR against an existing collection. A
    // race with another bring-up lands here, and refusing would make a
    // concurrent run fail for having lost by a millisecond.
    const r = run({ TASK_LIST_ANSWER: '404', MKCALENDAR_ANSWER: '405' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('openmig-tasks');
  });

  it('refuses when the collection cannot be made at all', () => {
    // 403 from a server that reserves MKCALENDAR, with the collection really
    // absent. Seeding on top of that would PUT tasks into nothing and the
    // verification would be left to notice.
    const r = run({ TASK_LIST_ANSWER: '404', MKCALENDAR_ANSWER: '403' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('could not create the VTODO-only task list');
  });

  it('the VTODO carries a UID that travels with the tagged name', () => {
    // The natural key is the UID (`taskNaturalKeyHash`, 0113). A tagged
    // filename over an untagged UID would hash to the spent fixture's key and
    // change nothing — the same trap the event fixture documents.
    run({ SEED_DAV_TAG: 'tag001' }, ['--fresh']);
    const bodies = readFileSync(join(dir, 'bodies.txt'), 'utf8');
    expect(bodies).toContain('UID:openmig-demo-task-tag001-1');
    expect(bodies).toContain('BEGIN:VTODO');
  });
});

describe("Nextcloud's asymmetric collection layout", () => {
  it('finds both spellings rather than assuming one', () => {
    const r = run();
    expect(r.stdout).toContain('calendars/tenant-b-source/personal/');
    // `addressbooks/users/<user>/` — the spelling that differs from calendars.
    expect(r.stdout).toContain('addressbooks/users/tenant-b-source/contacts/');
  });

  it('refuses when the account has no collections at all', () => {
    const r = run({ NCUSER: 'somebody-else' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/does the account exist|no personal calendar/);
  });
});

describe('it reports what is true, not what it attempted', () => {
  it('PUTs returning 201 are not enough — it re-reads and refuses if empty', () => {
    const r = run({ VERIFY_ANSWER: '' });
    // Every PUT still answered 201 in this run.
    expect(r.stdout).toContain('HTTP 201');
    expect(r.stdout).toContain('events:0 tasks:0 contacts:0 files:0');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('seeding did not stick');
  });

  it('succeeds only when the re-read finds the content', () => {
    expect(run().status).toBe(0);
  });
});

describe('--remove takes one --fresh set back (0100)', () => {
  // The gate seeds six resources a night into a long-lived demo account and,
  // until 0100, never took any of them away. These are the cases that decide
  // whether the removal can be trusted to run unattended, and they are here
  // rather than in a scratch harness because an unattended DELETE is exactly
  // the thing that must not go unwatched.
  const deleted = () => {
    try {
      return readFileSync(join(dir, 'deleted.txt'), 'utf8').trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  it('deletes exactly the eight paths --fresh writes, and nothing else', () => {
    const r = run({ VERIFY_ANSWER: '' }, ['--remove', 'tag-1']);
    expect(r.status).toBe(0);
    const paths = deleted().map((u) => u.replace(/^.*remote\.php\/dav\//, ''));
    expect(paths.sort()).toEqual(
      [
        'addressbooks/users/tenant-b-source/contacts/openmig-demo-contact-tag-1-1.vcf',
        'addressbooks/users/tenant-b-source/contacts/openmig-demo-contact-tag-1-2.vcf',
        'calendars/tenant-b-source/personal/openmig-demo-event-tag-1-1.ics',
        'calendars/tenant-b-source/personal/openmig-demo-event-tag-1-2.ics',
        // The task pair (0113 T7), in the VTODO-only collection rather than
        // beside the events. A `--fresh` set that seeded four domains and
        // took back three would grow the demo source by a task a night.
        'calendars/tenant-b-source/openmig-tasks/openmig-demo-task-tag-1-1.ics',
        'calendars/tenant-b-source/openmig-tasks/openmig-demo-task-tag-1-2.ics',
        'files/tenant-b-source/openmig-demo-file-tag-1-1.txt',
        'files/tenant-b-source/openmig-demo-file-tag-1-2.txt',
      ].sort(),
    );
  });

  it('leaves the task list alone when the account has not got one', () => {
    // `--remove` must never MKCALENDAR: creating a collection in order to
    // empty it is a write on the take-back path. With the collection absent
    // the other three domains are still taken back, and nothing is created.
    const r = run({ VERIFY_ANSWER: '', TASK_LIST_ANSWER: '404' }, ['--remove', 'tag-9']);
    expect(r.status).toBe(0);
    expect(deleted()).toHaveLength(6);
    expect(deleted().join('\n')).not.toContain('openmig-demo-task-');
    expect(existsSync(join(dir, 'mkcalendar.txt'))).toBe(false);
  });

  it('converges when the set is already gone (404 is the outcome we wanted)', () => {
    // Idempotency, hard rule 1: a re-run, or a seed that half-failed, has to
    // finish rather than refuse. 404 means the resource is not there, which is
    // precisely what was asked for.
    const r = run({ VERIFY_ANSWER: '', DELETE_ANSWER: '404' }, ['--remove', 'tag-2']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('source is clean of tag tag-2');
  });

  it('refuses on any other status, naming the resource and the code', () => {
    const r = run({ VERIFY_ANSWER: '', DELETE_ANSWER: '403' }, ['--remove', 'tag-3']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('returned 403');
    expect(r.stderr).toContain('refusing to report a removal that did not happen');
  });

  it('refuses when something tagged survives, even though every DELETE said 204', () => {
    // The distinction the whole script is built on: six status codes are what
    // it attempted, and a re-read is what happened.
    const r = run({ VERIFY_ANSWER: 'openmig-demo-event-tag-4-1' }, ['--remove', 'tag-4']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/still present after removal/);
  });

  it('refuses without a tag, before issuing a single request', () => {
    // A delete that defaults its own target is not a delete anybody should
    // write (hard rule 2). A leftover SEED_DAV_TAG in the environment would
    // otherwise take away a set somebody is still using.
    const r = run({ SEED_DAV_TAG: 'someone-elses-set' }, ['--remove']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--remove needs the tag to remove');
    expect(deleted(), 'it must not touch anything before refusing').toEqual([]);
  });

  it('cleans the TARGET account when pointed at it', () => {
    // The sync copies the seeded set into tenant B's target, under the same
    // names — the natural key IS the name. One script, both ends.
    const r = run(
      {
        VERIFY_ANSWER: '',
        NCUSER: 'tenant-b-target',
        DAV_USER: 'tenant-b-target',
        DAV_PASSWORD: 'tenant_b_target_pw',
      },
      ['--remove', 'tag-5'],
    );
    expect(r.status).toBe(0);
    expect(deleted().every((u) => u.includes('tenant-b-target'))).toBe(true);
    expect(deleted()).toHaveLength(8);
  });
});

describe('it never hands the smoke its precondition', () => {
  it('writes to the DAV source, never to the ledger', () => {
    // Inserting `status='copied'` rows directly would satisfy the apply half
    // and prove nothing — worse, it would be a claim that a copy happened, in
    // the table whose whole job is recording copies that did.
    const text = readFileSync(SEEDER, 'utf8');
    expect(text).not.toMatch(/INSERT\s+INTO/i);
    expect(text).not.toMatch(/UPDATE\s+\w+\s+SET/i);
    expect(text).not.toMatch(/DELETE\s+FROM/i);
    // It does mention the ledger — but only to tell the operator how to WATCH
    // the rows arrive.
    //
    // This used to assert that the only SQL KEYWORD in the file was SELECT.
    // `--remove` broke that without breaking anything real: `dav DELETE <href>`
    // is an HTTP method, and a bare-keyword scan cannot tell it from a table
    // write. Statement SHAPES can, and they are what the rule was always about
    // — so the three writes are refused by shape (above), and what remains is
    // the positive half: it still talks to the database, read-only.
    const writes = text.match(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/gi) ?? [];
    expect(writes, 'the seeder must never write to a table').toEqual([]);
    expect(text, 'and it must still be the read-only observer it documents').toMatch(/\bSELECT\b/);
  });
});

describe('it runs at bring-up, not only when something is already missing (0084)', () => {
  const demo = readFileSync(join(REPO_ROOT, 'deploy/compose/setup-managed-demo.sh'), 'utf8');
  const smoke = readFileSync(join(REPO_ROOT, 'deploy/compose/smoke-managed.sh'), 'utf8');

  it('the demo bring-up seeds the source, beside the accounts it fills', () => {
    // It used to run ONLY from the smoke's prepare phase, which fires when the
    // apply half has nothing to act on. A precondition that appears only once
    // something is already missing is one nobody can reason about: on a stack
    // that happened to have content it never ran at all, and on a fresh one it
    // ran in the middle of a gate that was already in trouble.
    expect(demo).toContain('seed-demo-dav-content.sh');
  });

  it('seeds the account setup-managed-demo.sh just provisioned', () => {
    // The seeder's own default is tenant-b-source, but a bring-up that passed a
    // different user would seed a mailbox nothing syncs — silently, because
    // every PUT would still return 201.
    const call = demo.match(/DAV_USER=(\S+)/)?.[1];
    expect(call).toBe('tenant-b-source');
    expect(demo).toContain('NEXTCLOUD_SOURCE_USER=tenant-b-source');
  });

  it('bring-up seeds BOTH demo sources — mail as well as DAV', () => {
    // The asymmetry this pins cost a live bring-up. setup-managed-demo.sh ran
    // the DAV seeder and never the mail one, so a freshly bootstrapped stack
    // had calendar/contact/file content and an EMPTY mailbox — and every
    // smoke-managed.sh failed its mail half with "reached 'done' but compared
    // NOTHING: totalItemsSource=0", correctly refusing to read an empty source
    // as a clean verification. The script's own comment already contrasted the
    // two seeders' idempotency strategies, so the gap was not for want of
    // knowing the mail seeder existed; nothing simply called it.
    expect(demo).toContain('seed-demo-dav-content.sh');
    expect(demo).toContain('seed-imap-source.mjs');
  });

  it('needs no only-if-empty guard, because it overwrites rather than appends', () => {
    // The MAIL seeder appends, so an unguarded re-run on this long-lived stack
    // grows the mailbox every night — hence SEED_ONLY_IF_EMPTY there. This one
    // PUTs to fixed paths and accepts 201 or 204, created or overwritten, so
    // re-running converges instead of growing. If that ever stops being true,
    // this bring-up call needs a guard and this test should fail first.
    //
    // Asserted by RUNNING it twice rather than by grepping the source for the
    // literal path: `--fresh` made that name an expression, and a regex over
    // the file would now pin the spelling of a variable instead of the
    // behaviour that matters.
    run();
    run();
    const paths = names(readFileSync(join(dir, 'all.args'), 'utf8')).sort();
    expect(paths.length).toBeGreaterThan(0);
    // Every name written exactly twice — overwritten, not added to.
    expect(new Set(paths).size).toBe(paths.length / 2);
    expect(readFileSync(SEEDER, 'utf8')).toContain('201|204');
    // Scoped to the DAV INVOCATION, not the whole file. This used to assert the
    // string was absent from setup-managed-demo.sh entirely, which was true only
    // while that script had one seeder in it; wiring the mail seeder (which
    // needs the guard, as this test's own comment says) tripped it. The
    // property being guarded was always "the DAV call has no guard", so that is
    // what it now checks.
    const davSection = demo
      .split(/echo "\[setup-managed-demo\]/)
      .find((section) => section.includes('seed-demo-dav-content.sh'));
    expect(davSection, 'DAV seeder call not found in setup-managed-demo.sh').toBeDefined();
    // Cut AT the invocation: the section runs on to the next `echo`, which now
    // carries the mail seeder's own comment — and that comment names the flag.
    // Prose about the guard is not the guard.
    const davCall = davSection!.slice(0, davSection!.indexOf('seed-demo-dav-content.sh'));
    expect(davCall).not.toContain('ONLY_IF_EMPTY');
  });

  it('bring-up seeds the FIXED fixture — it is the demo, not a smoke fixture', () => {
    // `--fresh` must not leak into bring-up: that call exists to give every
    // stack the same handful of demo resources, and tagging them would leave
    // the demo account growing a new set on every bootstrap.
    expect(demo).not.toContain('--fresh');
  });

  it('the smoke keeps it as a fallback, and says it is one', () => {
    // Removing it there would strand any stack brought up before this change,
    // and a prepare phase that assumed its precondition would be the same
    // mistake in a different place.
    expect(smoke).toContain('seed-demo-dav-content.sh');
    expect(smoke).toMatch(/FALLBACK|fallback/);
  });

  it('the smoke asks for FRESH keys — the fixed ones are the spent ones', () => {
    // The whole of run #20. The prepare phase fires only when nothing is
    // eligible, and by then the fixed keys are tombstoned; re-seeding them is a
    // no-op that leaves the gate red forever. A plain call here would put it
    // straight back.
    expect(smoke).toMatch(/seed-demo-dav-content\.sh" --fresh/);
  });
});

/**
 * WHY `--fresh` EXISTS (e2e-managed #20, 2026-08-19).
 *
 * `smoke-managed.sh`'s apply half applies a REAL deletion, `applyDeletion`
 * writes `status='tombstoned'`, and `classifyKnownItem` refuses forever to
 * re-create a tombstoned natural key — it cannot tell a change of mind from an
 * erasure request. The names here are FIXED and the natural key is the
 * UID/path, so every green run of the managed gate permanently spent one of six
 * items and re-seeding could not give it back. Run #19 spent the last one; run
 * #20 failed with "no eligible item" against 73 rows that were all `tombstoned`
 * or `adopted`, on a commit whose PR and self-hosted e2e were both green.
 *
 * A gate that consumes its own precondition and cannot replace it fails from
 * then on, forever, for a reason that looks like a product regression.
 */
describe('--fresh seeds keys no tombstone can already own', () => {
  it('a plain run writes the fixed demo names', () => {
    run();
    const all = names(readFileSync(join(dir, 'all.args'), 'utf8'));
    expect(all).toContain('openmig-demo-event-1.ics');
    expect(all).toContain('openmig-demo-contact-2.vcf');
    expect(all).toContain('openmig-demo-file-1.txt');
  });

  it('--fresh writes tagged names instead, never the fixed ones', () => {
    const r = run(
      {
        SEED_DAV_TAG: 'tag001',
        VERIFY_ANSWER:
          'openmig-demo-event-tag001-1 openmig-demo-task-tag001-1 ' +
          'openmig-demo-contact-tag001-1 openmig-demo-file-tag001-1',
      },
      ['--fresh'],
    );
    expect(r.status).toBe(0);
    const all = readFileSync(join(dir, 'all.args'), 'utf8');
    expect(all).toContain('openmig-demo-event-tag001-1.ics');
    expect(all).toContain('openmig-demo-contact-tag001-2.vcf');
    expect(all).toContain('openmig-demo-file-tag001-1.txt');
    // The fixed keys are the spent ones. Writing them again is the no-op that
    // cost run #20, so a fresh seed must not touch them at all.
    expect(names(all)).not.toContain('openmig-demo-event-1.ics');
  });

  it('the UID travels with the name — the UID is what the ledger hashes', () => {
    // calendar/contact natural keys are the VEVENT/vCard UID (see
    // caldav-target-writer.ts / carddav-target-writer.ts). A tagged FILENAME
    // over an untagged UID would produce the same natural key as the spent
    // fixture and change nothing at all. The UID travels in the PUT BODY, so
    // this reads what the stub was fed on stdin.
    run({ SEED_DAV_TAG: 'tag001' }, ['--fresh']);
    const bodies = readFileSync(join(dir, 'bodies.txt'), 'utf8');
    expect(bodies).toContain('UID:openmig-demo-event-tag001-1');
    expect(bodies).toContain('UID:openmig-demo-contact-tag001-1');
    expect(bodies).not.toContain('UID:openmig-demo-event-1\n');
  });

  it('two --fresh runs never collide, even with no tag given', () => {
    // The default tag is a UTC timestamp plus the pid. Two runs in the same
    // second must still differ, or a same-second retry re-seeds spent keys.
    const grab = () => {
      rmSync(join(dir, 'all.args'), { force: true });
      run({}, ['--fresh']);
      return new Set(names(readFileSync(join(dir, 'all.args'), 'utf8')));
    };
    const a = grab();
    const b = grab();
    expect([...a].some((n) => b.has(n))).toBe(false);
  });

  it('an unknown argument is refused rather than silently seeding the fixed set', () => {
    // `--fresk` quietly falling through to the fixed fixture would put the gate
    // straight back into run #20, with every log line claiming it had seeded.
    const r = run({}, ['--fresk']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('unknown argument');
  });

  it('verification counts the TAGGED resources, not the fixed leftovers', () => {
    // The fixed set is still sitting in the source from bring-up. Counting it
    // would let a --fresh run that wrote nothing report itself present, which
    // is the exact class of lie this script's verify step exists to prevent.
    const r = run(
      { SEED_DAV_TAG: 'tag001', VERIFY_ANSWER: 'openmig-demo-event-1 openmig-demo-contact-1' },
      ['--fresh'],
    );
    expect(r.stdout).toContain('events:0 tasks:0 contacts:0 files:0');
    expect(r.status).not.toBe(0);
  });

  it('the "watch it land" hint is paste-safe — credentials resolve INSIDE the container', () => {
    // Found by an operator pasting it: the hint used to read
    //   docker exec ownpace-db psql -U "$POSTGRES_USER" ...
    // and the surrounding heredoc is quoted (deliberately — unquoting it would
    // expand POSTGRES_USER/POSTGRES_DB to nothing and RUN the backticked
    // words), so those names print literally and then get expanded by the
    // OPERATOR'S shell, where they are not set. psql fell back to the host
    // username: `FATAL: role "root" does not exist`.
    //
    // A command a script prints for a human to paste is part of its interface.
    // This pins that the expansion happens in the container, which HAS the
    // variables, by asserting the `sh -c` wrapper rather than the bare form.
    const script = readFileSync(SEEDER, 'utf8');
    expect(script).toContain(`docker exec -i ownpace-db sh -c 'psql -U "$POSTGRES_USER"`);
    expect(script).not.toMatch(/docker exec ownpace-db psql -U "\$POSTGRES_USER"/);
  });

  it('the hint groups by `domain`, never the legacy `item_type`', () => {
    // `item` carries both columns. `domain` ('email','calendar','contact',
    // 'file') is what ledger.ts writes; `item_type` is legacy, unmodelled by
    // the ORM, NOT NULL with DEFAULT 'mail' and written by nothing. Grouping a
    // DAV mapping by item_type returns `mail` for every row — a confident
    // WRONG answer, which cost a live debugging session chasing a cross-domain
    // leak that did not exist. An error would have been kinder.
    const script = readFileSync(SEEDER, 'utf8');
    expect(script).toMatch(/SELECT domain, status, count\(\*\) FROM item/);
    expect(script).not.toMatch(/SELECT item_type, status/);
  });

  it('counts resources, not matching lines — Nextcloud answers on one', () => {
    // `grep -c` counts LINES and the multistatus is a single line, so it
    // answered 1 however many resources were there. Run #20's evidence reads
    // "event 1: HTTP 204 / event 2: HTTP 204 / present now — events:1".
    const r = run({
      VERIFY_ANSWER:
        'openmig-demo-event-1 openmig-demo-event-2 openmig-demo-task-1 ' +
        'openmig-demo-contact-1 openmig-demo-file-1',
    });
    expect(r.stdout).toContain('events:2 tasks:1 contacts:1 files:1');
  });
});
