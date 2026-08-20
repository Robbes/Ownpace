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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
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
    *"/calendars/$NCUSER/personal/"*|*"/addressbooks/users/$NCUSER/contacts/"*|*"/files/$NCUSER/"*)
      printf '%s\\n' "\${args[@]}" | grep -q 'Depth: 1' && { echo "$VERIFY_ANSWER"; exit 0; }
      echo -n 207 ;;
    *) echo -n 404 ;;
  esac
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
      VERIFY_ANSWER: 'openmig-demo-event-1 openmig-demo-contact-1 openmig-demo-file-1',
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

  it('seeds all three domains the demo mapping selects', () => {
    run();
    const all = readFileSync(join(dir, 'all.args'), 'utf8');
    expect(all).toMatch(/openmig-demo-event-\d\.ics/);
    expect(all).toMatch(/openmig-demo-contact-\d\.vcf/);
    expect(all).toMatch(/openmig-demo-file-\d\.txt/);
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
    expect(r.stdout).toContain('events:0 contacts:0 files:0');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('seeding did not stick');
  });

  it('succeeds only when the re-read finds the content', () => {
    expect(run().status).toBe(0);
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
    // the rows arrive. Every SQL statement in the file is a SELECT.
    const sql = text.match(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi) ?? [];
    expect(new Set(sql.map((k) => k.toUpperCase()))).toEqual(new Set(['SELECT']));
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
    expect(demo).not.toContain('ONLY_IF_EMPTY');
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
          'openmig-demo-event-tag001-1 openmig-demo-contact-tag001-1 openmig-demo-file-tag001-1',
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
    expect(r.stdout).toContain('events:0 contacts:0 files:0');
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

  it('counts resources, not matching lines — Nextcloud answers on one', () => {
    // `grep -c` counts LINES and the multistatus is a single line, so it
    // answered 1 however many resources were there. Run #20's evidence reads
    // "event 1: HTTP 204 / event 2: HTTP 204 / present now — events:1".
    const r = run({
      VERIFY_ANSWER:
        'openmig-demo-event-1 openmig-demo-event-2 openmig-demo-contact-1 openmig-demo-file-1',
    });
    expect(r.stdout).toContain('events:2 contacts:1 files:1');
  });
});
