// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What `smoke-managed.sh` is allowed to call a pass.
 *
 * This gate's first green run (e2e-managed #6, 2026-08-18) printed these three
 * lines within four lines of each other:
 *
 *     no eligible item (status 'copied'/'updated' with a target_ref) — SKIPPED.
 *     verify: done   apply: skipped-no-item
 *     SMOKE PASS
 *
 * The script's own header had always said success is verify `done` AND apply
 * terminal as `applied` or `refused`. The code disagreed with the header: the
 * terminal-state assertion sat INSIDE the `else` of the eligible-item check, so
 * the one branch that needed judging was the one branch that escaped it. The
 * apply half had therefore never executed under CI, and nothing said so.
 *
 * The bug was one level of indentation, which is precisely why it needs a test
 * rather than a careful reader — the next person to restructure that block will
 * not remember that the `case` has to outlive the `if`.
 *
 * These tests execute the real script's real decision lines, extracted from the
 * file rather than restated here. A test that restated them would pass forever
 * while the script drifted underneath it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = join(REPO_ROOT, 'deploy/compose/smoke-managed.sh');
const WORKFLOW = join(REPO_ROOT, '.github/workflows/e2e-managed.yml');

const smoke = readFileSync(SMOKE, 'utf8');

/**
 * The preamble every extracted fragment needs.
 *
 * The script's assertions call `fail_at` rather than assigning `fail=1`, so
 * that the verdict can say WHICH of the 147 of them fired. That makes
 * `fail_at` part of the vocabulary these fragments are written in, and a
 * harness that did not define it would report every fragment as passing —
 * `fail_at: command not found` leaves `$fail` at 0, which is the exact
 * false-green this file exists to prevent.
 *
 * Taken from the script rather than restated: `FAIL_PREAMBLE` greps the real
 * function out of the real file, so a change to what `fail_at` does reaches
 * these tests instead of drifting away from them.
 */
const FAIL_PREAMBLE = (() => {
  const start = smoke.indexOf('fail_at() {');
  const end = smoke.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('fail_at() is no longer defined in smoke-managed.sh');
  return `fail=0\nSECTION=test\nFAIL_REASONS=""\n${smoke.slice(start, end + 3)}`;
})();
const workflow = readFileSync(WORKFLOW, 'utf8');
const SEED_MANAGED = join(REPO_ROOT, 'apps/api/src/scripts/seed-managed.ts');
const seedManaged = readFileSync(SEED_MANAGED, 'utf8');

/** Run a fragment of the real script under bash and report the resulting $fail. */
function verdict(fragment: string, setup: string): string {
  const out = execFileSync('bash', ['-c', `${FAIL_PREAMBLE}\n${setup}\n${fragment}\necho "FAIL=$fail"`], {
    encoding: 'utf8',
  });
  // The fragments print diagnostics of their own; the verdict is the last line.
  return out.trim().split('\n').pop()!.replace('FAIL=', '');
}

describe('the apply half is judged, including when it found nothing to do', () => {
  // Extracted, not restated: this is the line the script actually runs.
  const caseLine = smoke.split('\n').find((l) => l.startsWith('case "$APPLY_RESULT" in'));

  it('the terminal-state assertion is at top level, not nested in the else', () => {
    // The whole bug, stated as a position. An indented `case` is inside the
    // `if [ -z "$HASH" ] … else` again, which is how a skip became a pass.
    expect(caseLine).toBeDefined();
    expect(smoke).toMatch(/^case "\$APPLY_RESULT" in/m);
    expect(smoke).not.toMatch(/^\s+case "\$APPLY_RESULT" in/m);
  });

  it.each([
    ['applied', '0'],
    ['refused', '0'],
  ])('%s is a pass', (result, expected) => {
    expect(verdict(caseLine!, `APPLY_RESULT=${result}`)).toBe(expected);
  });

  it.each([
    // The regression this file exists for.
    ['skipped-no-item'],
    ['timeout'],
    ['failed'],
    ['start-http-403'],
    ['start-http-500'],
  ])('%s is a failure', (result) => {
    expect(verdict(caseLine!, `APPLY_RESULT=${result}`)).toBe('1');
  });

  it('says how to give the apply half something to act on', () => {
    // seed-managed.ts creates tenants, connections and mappings but no items —
    // so "run a sync" is the fix, and a failure that does not name it just
    // moves the puzzle. Rule 9.
    // The sentence an operator reads first. It names both eligible statuses
    // since run #18, where asking for one of them turned an eligible item into
    // "there is nothing here".
    expect(smoke).toContain("no eligible item (status 'copied' or 'updated' with a target_ref id)");
    expect(smoke).toMatch(/\/start\b/);
  });
});

describe('the task lane is asserted by name, not left to the inventory (0113 T7)', () => {
  // WHY BY NAME. The diagnosis block already groups the ledger by `domain`,
  // so a task row SHOWS there — and a run with no task rows at all shows
  // nothing there and stays green, because the apply half takes whichever
  // eligible item it finds and one calendar row satisfies it. That is the
  // shape that has fooled this gate twice: green because the half that
  // mattered never executed (run #6's skipped apply, run #20's spent
  // fixture). A domain nobody asserts is a domain nobody is testing.

  it('counts copied rows for the task domain specifically', () => {
    expect(smoke).toMatch(/domain='task'\s+AND\s+status IN \('copied','updated'\)/);
  });

  it('scopes that count to THIS run\'s tag', () => {
    // An earlier run's task row must not answer for this one — the same rule
    // the balance section works under.
    const block = smoke.slice(smoke.indexOf('THE TASK LANE LANDED'));
    expect(block).toContain('BALANCE_TAG');
  });

  it('sets fail when nothing copied — it does not merely remark on it', () => {
    // The whole point. `echo` without `fail=1` is what "SKIPPED" beside
    // "SMOKE PASS" looked like three lines apart in run #6.
    // Bounded to THIS block, not to the next section header: everything
    // between here and the runner logs includes the no-eligible-item branch,
    // which sets `fail` for its own reasons — so the looser slice passed with
    // the task-lane `fail=1` deleted. Found by breaking it, which is the only
    // way that kind of pass shows itself.
    const start = smoke.indexOf('THE TASK LANE LANDED');
    const block = smoke.slice(start, smoke.indexOf('if [ -z "$HASH" ]; then', start));
    expect(block).toContain('::error::');
    expect(block).toMatch(/fail_at/);
  });

  it('names the four things a zero could mean, so the reader is not left guessing', () => {
    // A refusal that names a symptom and not a state is only half a refusal
    // (rule 9). Zero copied tasks has four distinct causes with four
    // different fixes, and the message has to tell them apart.
    const block = smoke.slice(smoke.indexOf('THE TASK LANE LANDED'));
    expect(block).toContain('T3a');
    expect(block).toContain('T3b');
    expect(block).toContain('T4');
    expect(block).toContain('T5');
  });
});

describe('an enqueue that never became a runner is a failure', () => {
  // 0018 T5's lesson is the reason this script exists at all; it used to be
  // reported with an echo, so the script could miss the single thing it was
  // written to catch and still say PASS.
  const block = smoke
    .split('\n--- ')
    .join('\n--- ') // no-op, keeps the split readable below
    .match(/if \[ "\$found_logs" != "1" \]; then[\s\S]*?\nfi/)?.[0];

  it('is asserted, not merely remarked upon', () => {
    expect(block).toBeDefined();
    expect(block).toContain('fail_at');
  });

  it('no runner containers sets fail', () => {
    expect(verdict(block!, 'found_logs=0')).toBe('1');
  });

  it('at least one runner container leaves fail alone', () => {
    expect(verdict(block!, 'found_logs=1')).toBe('0');
  });
});

describe('the evidence reaches the artifact', () => {
  // Run #6 uploaded nothing: the smoke defaulted SMOKE_OUT to /tmp while the
  // collector globbed the workspace, so `redact-evidence.sh` cleaned an empty
  // directory and upload-artifact warned "No files were found". T5's redaction
  // had never actually redacted anything in CI.
  // `${{ github.run_id }}` contains spaces, so this reads to end of line.
  const smokeOut = workflow.match(/SMOKE_OUT:[ \t]*(.+)/)?.[1]?.trim();

  it('the workflow tells the smoke where to write', () => {
    expect(smokeOut).toBeDefined();
  });

  it('and that path is one the collector globs', () => {
    // The collector's own glob, read from the workflow rather than assumed.
    expect(workflow).toContain('smoke-managed-*.log');
    expect(smokeOut).toMatch(/^smoke-managed-.*\.log$/);
  });

  it('the smoke honours SMOKE_OUT', () => {
    expect(smoke).toContain('OUT="${SMOKE_OUT:-');
    // Through the address filter first (a-public-log-that-named-the-machine-it-ran-on),
    // and still into $OUT.
    expect(smoke).toMatch(/exec > >\((sed [^|]*\| )?tee "\$OUT"\)/);
  });

  it('and the file is gitignored, because it carries the task environment', () => {
    // The runner debug logs it captures print DATABASE_URL, SECRET_ENCRYPTION_KEY
    // and the tr_prod_ key. Moving it into the workspace is only safe if it can
    // never be committed.
    expect(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')).toContain('smoke-managed-*.log');
  });
});

describe('unhealthy is reported as unhealthy, and nothing else is', () => {
  // Run #6 listed seven services under "unhealthy services, if any" — trigger-api,
  // trigger-supervisor, trigger-tls, minio, registry, docker-proxy, nextcloud —
  // none of which was unhealthy. They define no healthcheck, so `.Health` is
  // empty and `grep -v ' healthy$'` matched them. The step also could not fail.
  const step = workflow.slice(workflow.indexOf('What state did we leave it in?'));

  it('distinguishes "no healthcheck" from "unhealthy"', () => {
    expect(step).toContain('no healthcheck defined');
    expect(step).toMatch(/\$2=="unhealthy"/);
  });

  it('a real unhealthy service fails the job', () => {
    expect(step).toMatch(/::error::Left unhealthy/);
    expect(step).toMatch(/exit 1/);
  });

  it('the awk selects unhealthy without catching the healthcheck-less', () => {
    const sample = [
      'ownpace-api healthy',
      'trigger-api ', // no healthcheck: .Health is empty
      'trigger-supervisor ',
      'some-broken unhealthy',
    ].join('\n');
    const unhealthy = execFileSync('bash', ['-c', `awk '$2=="unhealthy"{print $1}'`], {
      encoding: 'utf8',
      input: sample,
    }).trim();
    expect(unhealthy).toBe('some-broken');

    const nocheck = execFileSync('bash', ['-c', `awk 'NF==1 && $1!=""'`], {
      encoding: 'utf8',
      input: sample,
    }).trim();
    expect(nocheck.split('\n').map((s) => s.trim())).toEqual(['trigger-api', 'trigger-supervisor']);
  });
});

describe("the smoke's eligibility is the product's, not a paraphrase of it", () => {
  // Run #18 went red with an eligible item sitting in its own printed
  // diagnosis: `file|updated|1|1` — one updated file, with a target_ref id,
  // which `ownershipCheck` in apply-deletion.ts would have accepted. The smoke
  // asked for `status='copied'` alone, so it declared there was nothing to act
  // on and failed the gate for a reason that was not true.
  //
  // `updated` means WE wrote over a copy we had written before; `copied` means
  // we created it. Both are ours to remove. `adopted` is the one that is not,
  // and the product refuses it deliberately — those bytes were the account
  // owner's before we arrived (hard rule 2).
  //
  // This reads the PRODUCT'S function rather than restating its answer, so the
  // two cannot drift in either direction: widen the gate and forget the smoke,
  // or narrow the smoke and forget the gate, and this fails.
  const applyDeletion = readFileSync(
    join(REPO_ROOT, 'packages/core/src/apply-deletion.ts'),
    'utf8',
  );

  /** The statuses `ownershipCheck` lets through, read from its own source. */
  function statusesTheProductAccepts(): string[] {
    const line = /if \(row\.status === 'copied' \|\| row\.status === 'updated'\) return undefined;/.exec(
      applyDeletion,
    );
    if (!line) return [];
    return [...line[0].matchAll(/'(\w+)'/g)].map((m) => m[1]!).sort();
  }

  /** The statuses the smoke's eligibility SQL asks for. */
  function statusesTheSmokeAsksFor(): string[] {
    const found = new Set<string>();
    for (const m of smoke.matchAll(/status IN \(([^)]*)\)/g)) {
      for (const s of m[1]!.matchAll(/'(\w+)'/g)) found.add(s[1]!);
    }
    return [...found].sort();
  }

  it("finds the product's gate, so the comparison below is not two empty lists", () => {
    // If `ownershipCheck` is rewritten into a shape this regex does not match,
    // every assertion here would pass against nothing at all.
    expect(
      statusesTheProductAccepts(),
      'could not read the accepted statuses out of ownershipCheck — the shape ' +
        'of that early return changed, and this guard is now blind',
    ).not.toEqual([]);
  });

  it('asks for exactly what the apply path accepts', () => {
    expect(statusesTheSmokeAsksFor()).toEqual(statusesTheProductAccepts());
  });

  it('asks for both, by name, so a silent narrowing fails here', () => {
    // The specific regression, pinned as a sentence rather than as one entry
    // in a list comparison.
    expect(statusesTheSmokeAsksFor()).toEqual(['copied', 'updated']);
  });

  it('never treats an adopted item as eligible', () => {
    // The one the product refuses on purpose. If it ever appears in the
    // smoke's SQL, the gate would be asking to delete somebody else's bytes.
    expect(smoke).not.toMatch(/status IN \([^)]*'adopted'/);
    expect(applyDeletion).toContain("row.status === 'adopted'");
  });

  it('requires a target_ref id as well as a status', () => {
    // The other half of eligibility, and the one that was vacuous before
    // 2026-08-19: a status alone matched rows whose target handle was empty,
    // which is how the apply half passed while acting on nothing.
    //
    // Eligibility is now defined ONCE in $ELIGIBLE and interpolated, so this
    // asserts the stronger property the factoring bought: the clause exists in
    // that one definition, and every query that selects an item uses it rather
    // than open-coding a filter that could drift from it.
    // And a recorded version (workplan 0149 T3): without one the removal is
    // refused as `version_unknown`, which this gate's verdict would pass.
    expect(smoke).toMatch(
      /ELIGIBLE="status IN \('copied','updated'\) AND coalesce\(target_ref->>'id',''\) <> '' AND target_version IS NOT NULL"/,
    );
    const selects = [...smoke.matchAll(/SELECT natural_key_hash FROM item[^"]*/g)];
    expect(selects.length).toBeGreaterThan(0);
    for (const m of selects) {
      expect(m[0], 'an item query that does not use $ELIGIBLE').toContain('$ELIGIBLE');
    }
  });
});

describe('the two services nothing else speaks for (0084)', () => {
  // `minio` and `trigger-tls` were the last of the original seven that no
  // healthcheck probed and no other step proved. The workplan asked for
  // healthchecks; they are assertions instead, and the substitution is the
  // thing worth pinning: a compose probe runs INSIDE the image, so under
  // `up -d --wait` one naming a binary that image lacks does not misreport —
  // it fails the bring-up. Nothing in this repo has ever run a command inside
  // `bitnamilegacy/minio` or `caddy:2-alpine`, so there is no evidence to
  // write such a probe from, and an assertion has none of that exposure.
  const minio = smoke.match(
    /if docker exec "\$API_CONTAINER" "\$API_NODE" -e \\\n[\s\S]*?\nfi/,
  )?.[0];
  const tls = smoke.match(/TLS_PORT="\$\{TRIGGER_TLS_PORT[\s\S]*?\nfi/)?.[0];

  it('both blocks are extractable — there is something to test', () => {
    expect(minio, 'the minio assertion is gone from smoke-managed.sh').toBeDefined();
    expect(tls, 'the trigger-tls assertion is gone from smoke-managed.sh').toBeDefined();
  });

  it('each SETS FAIL rather than merely remarking on it', () => {
    // The 0084 lesson in one line: run #6 went green with half the gate
    // unasserted because the diagnosis was an echo.
    expect(minio).toContain('fail_at');
    expect(tls).toContain('fail_at');
  });

  it('minio unreachable fails the smoke', () => {
    expect(verdict(minio!, 'API_CONTAINER=x API_NODE=/nodejs/bin/node\ndocker() { return 1; }')).toBe('1');
  });

  it('minio answering leaves the smoke alone', () => {
    expect(verdict(minio!, 'API_CONTAINER=x API_NODE=/nodejs/bin/node\ndocker() { return 0; }')).toBe('0');
  });

  it('nothing on the TLS port fails the smoke', () => {
    // curl exiting non-zero — connection refused, handshake dead — leaves the
    // `|| echo 000` value, which is the case this exists for.
    expect(verdict(tls!, 'curl() { return 7; }')).toBe('1');
  });

  it('any HTTP status from the TLS front leaves the smoke alone', () => {
    // ANY status. Caddy answering 502 still means TLS terminated, which is the
    // claim — a probe that demanded 200 would go red whenever the thing behind
    // the proxy was restarting.
    expect(verdict(tls!, 'curl() { echo 502; }')).toBe('0');
  });

  it('reaches minio through a container, because it publishes no port', () => {
    // managed.yml gives minio no `ports:` — it is reachable only on the stack
    // network, and `http://minio:9000` is the address trigger-api is
    // configured with. Asserting it from the host would be asserting a
    // different thing, and would fail for the wrong reason.
    expect(minio).toContain('docker exec');
    expect(minio).toContain('minio:9000');
    expect(
      /ports:\s*\n\s*-\s*"\$\{MINIO/.test(readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8')),
      'minio now publishes a port — the assertion could go direct, and this comment is stale',
    ).toBe(false);
  });

  it('reaches the TLS front BY IP, because an IP sends no SNI', () => {
    // trigger-tls.Caddyfile's rule 2, learned live on 2026-08-01: browsers
    // connecting by IP send no SNI and get no certificate unless default_sni
    // is set. The site address is the operator's own host, so a request to
    // `localhost` sends an SNI matching no site — a false red waiting to
    // happen on any box where TRIGGER_TLS_HOST is not `localhost`.
    expect(tls).toContain('127.0.0.1');
    expect(tls).not.toContain('https://localhost');
    expect(
      readFileSync(join(REPO_ROOT, 'deploy/compose/trigger-tls.Caddyfile'), 'utf8'),
      'default_sni is gone from the Caddyfile — connecting by IP no longer works',
    ).toContain('default_sni');
  });
});

describe('the header and the code agree', () => {
  // The original defect was not a typo, it was a contract the code stopped
  // honouring while the comment kept promising it.
  it('the header claims exactly what the code now enforces', () => {
    expect(smoke).toMatch(/Success = verify `done` AND apply terminal/);
    expect(smoke).toContain('no runner at all');
  });
});

describe('the refusal says WHICH way there is nothing to act on', () => {
  // Three states hid behind one paragraph: no items at all, items but none
  // copied, copied but with no target handle. They have entirely different
  // fixes, and telling them apart meant querying the box by hand — which
  // across runs #7, #8 and #9 is exactly what it cost.
  const block = smoke.match(/ {2}echo "what IS on this mapping:"[\s\S]*?\n {2}fi\n/)?.[0];

  /** Drive the real branch with a `q` that answers as a given ledger would. */
  function diagnose(
    total: string,
    eligible: string,
    breakdown = '',
    spent = '0',
    fixture = '',
    handled = '0',
  ) {
    // `pick_fixture` is defined further up the real script, outside this block.
    // Left undefined, bash printed "command not found", the branch that calls it
    // silently took the empty path, and every test here still passed — a
    // vacuous pass hiding the newest branch entirely. Stubbed rather than
    // extracted because what this suite drives is the DECISION, not the SQL:
    // the SQL has its own guards in packages/ledger.
    const pickers = `pick_fixture() { printf '%s' "${fixture}"; }`;
    // The eligible-count query is told apart by its status list, not by the
    // word "copied": that word appears in both queries' text now, and matching
    // on it silently answered the ELIGIBLE query with the TOTAL — which made
    // this stub report "6 eligible" for a ledger the test said had none. The
    // tombstone count is told apart the same way, and for the same reason.
    // The rows ours WITH a handle (workplan 0149 T3) are told apart by the
    // handle clause, before the status list both of those counts carry.
    const q = `q() { case "$1" in
      *"count(*) FROM item"*"status='tombstoned'"*) echo "${spent}" ;;
      *"count(*) FROM item"*"coalesce(target_ref->>'id','') <> ''"*) echo "${handled}" ;;
      *"count(*) FROM item"*"status IN ('copied','updated')"*) echo "${eligible}" ;;
      *"count(*) FROM item"*) echo "${total}" ;;
      *) printf '%s' "${breakdown}" ;;
    esac; }`;
    return execFileSync(
      'bash',
      ['-c', `set -u\nAPPLY_TENANT=t\nAPPLY_MAPPING=m\nDB_CONTAINER=db\n${q}\n${pickers}\n${block}`],
      { encoding: 'utf8' },
    );
  }

  it('refuses the fixed fixtures instead of spending one, and says so first', () => {
    // The branch added 2026-08-20. Eligible items EXIST here — that is the
    // point: this is the only state where the gate declines work it could do.
    // It must be reported as a refusal, not as one of the three absences, or
    // the reader goes hunting a sync bug (which is how #20 was misread).
    const out = diagnose('66', '6', '', '4', 'h-fixture');
    expect(out).toContain('only the FIXED demo fixtures');
    expect(out).toContain('--fresh');
    expect(out).not.toContain('nothing has ever synced here');
    expect(out).not.toContain('is SPENT, not broken');
  });

  it('is extractable — the branch still exists to test', () => {
    expect(block).toBeDefined();
  });

  it('no items at all names the empty demo, and the script that fills it', () => {
    const out = diagnose('0', '0');
    expect(out).toContain('no items at all');
    expect(out).toContain('seed-demo-dav-content.sh');
    expect(out).not.toContain('product fault');
  });

  it('items but none copied names a product fault, not a fixture', () => {
    const out = diagnose('6', '0', 'calendar|pending|6|0');
    expect(out).toContain("none is 'copied' or 'updated'");
    expect(out).toContain('product fault');
    // Points at the run log, because that is where a stalled copy explains itself.
    expect(out).toContain('run_event');
    expect(out).not.toContain('seed-demo-dav-content.sh');
  });

  // RUN #20 (2026-08-19). A fourth state, which for two runs wore the third
  // one's paragraph: nothing eligible because this script has already SPENT the
  // fixture, one applied deletion per green run, against a bring-up seed that
  // writes six fixed natural keys and a `classifyKnownItem` that refuses
  // forever to re-create a tombstoned one. Calling that "a product fault" sent
  // the reader hunting a copy bug in a sync that had never failed.
  it('all-tombstoned is called a spent fixture, not a product fault', () => {
    const out = diagnose('73', '0', 'file|tombstoned|2|2', '9');
    expect(out).toContain('SPENT');
    expect(out).not.toContain('product fault');
    // The fix that actually works, named: fresh keys, not another re-seed of the
    // fixed ones, which is the thing that cannot help here.
    expect(out).toContain('--fresh');
    expect(out).toContain('never re-copied');
  });

  it('a copy failure with no tombstones behind it is still a product fault', () => {
    // The two branches must not collapse into each other: a mapping that has
    // never had an apply run against it and still copies nothing IS a bug.
    const out = diagnose('6', '0', 'calendar|pending|6|0', '0');
    expect(out).toContain('product fault');
    expect(out).not.toContain('SPENT');
  });

  it('copied without a target id is called a ledger-write bug', () => {
    const out = diagnose('6', '6', 'calendar|copied|6|0');
    expect(out).toContain('none carries a target_ref id');
    expect(out).toContain("bug in the sync's ledger write");
    expect(out).not.toContain('seed-demo-dav-content.sh');
  });

  it('copied with a handle but no recorded version is said to be that, not a sync bug', () => {
    // Workplan 0149 T3: a removal without a version is refused as
    // version_unknown, so such rows are not eligible. Calling them a ledger-
    // write bug would send the reader hunting a sync that did nothing wrong.
    const out = diagnose('6', '6', 'file|copied|6|6|0', '0', '', '6');
    expect(out).toContain('none recorded a version');
    expect(out).toContain('version_unknown');
    expect(out).not.toContain("bug in the sync's ledger write");
  });

  it('always prints the actual breakdown, whichever state it is', () => {
    expect(diagnose('6', '0', 'calendar|pending|6|0')).toContain('calendar|pending|6|0');
    expect(diagnose('0', '0')).toContain('(total 0, eligible 0');
  });
});

describe('the prepare phase (SMOKE_PREPARE_APPLY)', () => {
  const block = smoke.match(
    / {2}note "prepare \(SMOKE_PREPARE_APPLY=1\)[\s\S]*?\n {2}\[ -n "\$HASH" \] \|\| echo "prepare: still nothing[^\n]*\n/,
  )?.[0];
  const guard = smoke
    .split('\n')
    .find((l) => l.startsWith('if [ "${SMOKE_PREPARE_APPLY'));

  it('is OFF unless asked for — by hand this stays an acceptance test', () => {
    // Manufacturing its own fixture by default would be the same class of lie
    // as the skip that used to pass: the script would stop reporting the state
    // of the stack and start reporting the state it arranged.
    expect(guard).toBeDefined();
    expect(guard).toContain('"${SMOKE_PREPARE_APPLY:-0}" = "1"');
  });

  it('runs whenever the gate asks for it, leftover item or not', () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal is the point.
    // It held `[ -z "$HASH" ]` under the reading that "an eligible item that
    // already exists is the real thing; seeding over it would replace a
    // genuine precondition with a manufactured one." True about the item, and
    // wrong about the phase — because finding the apply half an item is the
    // least of what prepare does. It mints BALANCE_TAG, and four assertions
    // are scoped to that tag: the task lane landed, the large file landed, the
    // scheduling canary's bytes, and the balance section that hands back what
    // the run created. Skipping prepare therefore never saved a seed; it
    // silently disabled four checks and left the residue behind.
    //
    // It stayed harmless only while a leftover was rare. The CI stack is never
    // torn down, and since the verify half now enqueues a sync before it
    // measures (see a-verify-that-measured-a-race.unit.test.ts), a copied
    // leftover is the normal state by the time this line is reached — so the
    // old guard would have turned four live assertions off on every run.
    expect(guard).not.toContain('[ -z "$HASH" ]');
    // And it starts from nothing, so the item the apply half spends is one
    // THIS run created under a tag the balance section can take back.
    expect(block).toMatch(/^ {2}HASH=""$/m);
  });

  it('seeds the source and enqueues a sync — neither alone is enough', () => {
    expect(block).toBeDefined();
    expect(block).toContain('seed-demo-dav-content.sh');
    expect(block).toMatch(/\/sync\b/);
    // */15 is the default cadence; a gate cannot wait for the tick.
    expect(smoke).toContain('DEFAULT_SYNC_SCHEDULE');
  });

  it('sends an explicit JSON body, because zod parses it', () => {
    expect(block).toContain('Content-Type: application/json');
    expect(block).toMatch(/-d '\{"type":"delta"\}'/);
  });

  it('re-checks the SAME question rather than assuming it worked', () => {
    // The poll re-runs the eligibility query; it does not set HASH to something
    // it hoped for. A seeding failure still lands in the diagnosis below.
    //
    // It now re-runs it by calling the SAME picker the first selection used —
    // which is what makes "the same question" literally true rather than a
    // claim about two hand-copied SQL strings that could drift apart.
    expect(block).toContain('pick_disposable');
    expect(block).toContain('SEEDING FAILED');
  });

  it('the apply half never spends a fixed demo fixture', () => {
    // The regression this pins was found on a live stack, 2026-08-20. The
    // selection was `ORDER BY natural_key_hash LIMIT 1`, so it took whichever
    // FIXED fixture sorted first; the apply then tombstoned its natural key,
    // and classifyKnownItem never re-creates one. Three runs left four
    // tombstones and drove the verify half from 66/66 files and 3/3 calendar to
    // 65/66 and 1/3 — the gate degrading the fixtures its other half measures,
    // unrepairable by re-seeding because the keys were spent.
    //
    // So the picker excludes fixed fixtures by shape (digits straight before
    // the extension; --fresh keys carry a tag there), and the refusal branch
    // exists so "only fixtures left" reports itself instead of being paid for.
    expect(smoke).toContain('pick_disposable()');
    expect(smoke).toMatch(/FIXTURE_RE=.*openmig-demo-\(event\|contact\|file\|task\)/);
    expect(smoke).toContain('!~');
    expect(smoke).toMatch(/REFUS|refuses to spend|now REFUSES/i);
  });

  it('the workflow turns it on, and nothing else does', () => {
    expect(workflow).toContain('SMOKE_PREPARE_APPLY: 1');
  });
});

describe('the persist dir cannot be an unexpanded variable', () => {
  // e2e-managed #26. The repository variable MANAGED_ENV_PERSIST_DIR was set to
  // "$HOME/.persistent/ownpace-managed". GitHub passes a variable's value
  // VERBATIM, and `${VAR:-default}` substitutes that value without re-expanding
  // it — so PERSIST_DIR became a literal path beginning with a dollar sign,
  // nothing was ever restored, and the next step reported "this runner has
  // never had the managed stack set up": a symptom three steps from the cause,
  // on the one job nobody can reproduce locally.
  //
  // Extracted and RUN rather than grepped, because what matters is which values
  // it refuses, not how the case statement is spelled.
  const block = workflow.match(
    /^ {10}case "\$\{MANAGED_ENV_PERSIST_DIR:-\}" in[\s\S]*?\n {10}esac\n/m,
  )?.[0];

  function refuses(value: string | undefined): boolean {
    const frag = block!
      .split('\n')
      .map((l) => l.slice(10))
      .join('\n');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' } as NodeJS.ProcessEnv;
    if (value !== undefined) env.MANAGED_ENV_PERSIST_DIR = value;
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${frag}`], { env, encoding: 'utf8' });
    return r.status !== 0;
  }

  it('is extractable — the guard still exists to test', () => {
    expect(block, 'the MANAGED_ENV_PERSIST_DIR guard is gone from e2e-managed.yml').toBeDefined();
  });

  it('refuses a value carrying an unexpanded $HOME', () => {
    expect(refuses('$HOME/.persistent/ownpace-managed')).toBe(true);
  });

  it('accepts an absolute path, and accepts being unset', () => {
    // Unset is the ordinary case: the workflow default expands $HOME properly,
    // because there it is a literal in the script rather than a value.
    expect(refuses('/home/runner/.persistent/ownpace-managed')).toBe(false);
    expect(refuses(undefined)).toBe(false);
  });
});

describe('the failure summary cannot leak what the redaction removes', () => {
  // The last lines of the evidence are captured runner logs, and a runner's
  // debug output prints the whole task environment. A job log is readable by
  // everyone who can see the repo.
  const step = workflow.slice(
    workflow.indexOf('What the smoke actually concluded, where a log tail can reach it'),
  );
  const tailStep = step.slice(0, step.indexOf('- name: What state'));

  it('tails the redacted copy, never the workspace original', () => {
    expect(tailStep).toContain('managed-evidence/smoke-managed-');
    // The bare workspace path is what must NOT be tailed.
    expect(tailStep).not.toMatch(/\n\s+f="smoke-managed-/);
  });

  it('runs after the redaction step, which is if: always()', () => {
    const redactAt = workflow.indexOf('Redact the evidence before it becomes an artifact');
    const tailAt = workflow.indexOf(
      'What the smoke actually concluded, where a log tail can reach it',
    );
    expect(redactAt).toBeGreaterThan(-1);
    expect(tailAt).toBeGreaterThan(redactAt);
  });
});

describe('a green states its own verdict', () => {
  // Run #12 passed every step and its verdict was unreadable: the artifact host
  // is not always fetchable, and the log tail could not reach back past the
  // upload and `docker compose ps`. What was left was "all steps passed, so it
  // must be fine" — the exact reasoning that made run #6's green a lie. A gate
  // whose conclusion cannot be read is not a gate, it is a colour.
  const step = workflow.slice(
    workflow.indexOf('What the smoke actually concluded, where a log tail can reach it'),
  );
  const body = step.slice(0, step.indexOf('- name: What state'));

  it('prints the evidence tail on success too, not only on failure', () => {
    expect(body).toContain('if: always()');
    expect(body).not.toContain('if: failure()');
  });
});

describe('a verify that compared nothing is not a pass', () => {
  // The same shape as the apply half's skip-that-passed, and it survived that
  // fix: `state: done` says the run finished, not that it compared anything. On
  // an empty mailbox verify reports sourceCount 0 / targetCount 0 / PASS —
  // true, and worth nothing. It has never fired on the machine only because that
  // box happens to hold three messages somebody put there by hand; nothing in
  // this repo seeds them.
  const block = smoke.match(/^VERIFIED_ITEMS="\$\(json_number[\s\S]*?\nfi$/m)?.[0];

  function verdict(setup: string) {
    const helper = `json_number() { printf '%s' "$1" | grep -o "\\"$2\\":[0-9]*" | head -1 | cut -d: -f2; }`;
    const out = execFileSync(
      'bash',
      ['-c', `${FAIL_PREAMBLE}\n${helper}\n${setup}\n${block}\necho "FAIL=$fail"`],
      { encoding: 'utf8' },
    );
    return out.trim().split('\n').pop()!.replace('FAIL=', '');
  }

  it('is extractable — the guard still exists to test', () => {
    expect(block).toBeDefined();
  });

  it('fails when verify finished having compared zero items', () => {
    expect(verdict(`VERIFY_RESULT=done\nrbody='{"totalItemsSource":0}'`)).toBe('1');
  });

  it('passes when it actually compared something', () => {
    expect(verdict(`VERIFY_RESULT=done\nrbody='{"totalItemsSource":3}'`)).toBe('0');
  });

  it('fails when the count is absent entirely, rather than assuming it was fine', () => {
    // A report shape that changed is not evidence that anything was verified.
    expect(verdict(`VERIFY_RESULT=done\nrbody='{"other":1}'`)).toBe('1');
  });

  it('does not double-report a verify that already failed for its own reason', () => {
    // `fail` is already 1 from the state check; this must not claim the empty
    // mailbox is why.
    expect(verdict(`VERIFY_RESULT=timeout\nrbody='{"totalItemsSource":0}'`)).toBe('0');
  });

  it('says what is actually owed rather than only that it refused', () => {
    expect(block).toMatch(/needs seeding/i);
    expect(block).toMatch(/absence of data as the absence of problems/i);
    // It covers TWO mappings now, so it must name both seeders — the mail-only
    // wording would send a reader of the DAV failure to the wrong script.
    expect(block).toContain('seed-imap-source.mjs');
    expect(block).toContain('seed-demo-dav-content.sh');
  });
});

describe('a domain that was SKIPPED was not verified, whatever the status said', () => {
  // FOUND 2026-08-19. The demo seed splits domains across two tenants, because
  // `connection` has one source + one target row per tenant and cannot point at
  // Stalwart and Nextcloud at once. This half only ever ran against tenant A,
  // so every managed run reported `calendar/contacts/files: SKIPPED` and nobody
  // read it as a gap: NO run had ever verified a calendar, a contact or a file.
  // They were exercised by the sync and checked by nothing.
  const block = smoke.match(/^for d in "\$\{REQUIRED_DOMAINS\[@\]\}"; do[\s\S]*?\ndone$/m)?.[0];

  /** Drive the real loop with a report body and a required-domain list. */
  function verdict(rbody: string, required: string[]) {
    const setup = `rbody='${rbody}'\nVERIFY_LABEL=test\nREQUIRED_DOMAINS=(${required.join(' ')})`;
    const out = execFileSync('bash', ['-c', `${FAIL_PREAMBLE}\n${setup}\n${block}\necho "FAIL=$fail"`], {
      encoding: 'utf8',
    });
    return out.trim().split('\n').pop()!.replace('FAIL=', '');
  }

  // The real shape, from e2e-managed #20's evidence: the skip is announced by an
  // issue id, and the per-domain blocks carry nested `issues` arrays — which is
  // why the assertion matches that id and not a `"status"` field no `[^}]*`
  // grep survives.
  const skipped = (d: string) =>
    `{"${d}":{"issues":[{"id":"SKIPPED_${d}","message":"${d} verification was disabled in the config — this domain was NOT checked.","severity":"WARNING"}],"status":"SKIPPED"}}`;
  const checked = `{"calendar":{"issues":[],"status":"PASS"},"contacts":{"issues":[],"status":"PASS"},"files":{"issues":[],"status":"PASS"}}`;
  /** A real tenant-A report: `mail` checked, the DAV domains present and skipped. */
  const mailCheckedDavSkipped =
    `{"mail":{"issues":[],"status":"PASS"},` +
    `"calendar":{"issues":[{"id":"SKIPPED_calendar","message":"this domain was NOT checked.","severity":"WARNING"}],"status":"SKIPPED"}}`;

  it('is extractable — the guard still exists to test', () => {
    expect(block).toBeDefined();
  });

  it('fails when a required domain was skipped', () => {
    expect(verdict(skipped('calendar'), ['calendar'])).toBe('1');
  });

  it('fails when ANY one of several required domains was skipped', () => {
    // The tenant-B call requires three. Two present and one skipped is still a
    // gate that did not cover what it claims to.
    expect(verdict(skipped('files'), ['calendar', 'contacts', 'files'])).toBe('1');
  });

  it('passes when every required domain was actually checked', () => {
    expect(verdict(checked, ['calendar', 'contacts', 'files'])).toBe('0');
  });

  it('does not care about domains it was not asked for', () => {
    // Tenant A's mapping legitimately skips the three DAV domains — that is the
    // seed's design, not a fault — so requiring only `mail` must pass over them.
    // The fixture carries a real `mail` block because the loop now requires the
    // domain it was asked about to BE THERE; a report with no `mail` at all is
    // the separate failure below, and conflating the two is what let a missing
    // domain read as a checked one.
    expect(verdict(mailCheckedDavSkipped, ['mail'])).toBe('0');
  });

  // ---- absent is not unskipped (the sixth fan-out, #750's shape in the gate)
  //
  // Before #750 the report had four domain keys and no `tasks`. `SKIPPED_tasks`
  // is not in that body — and "not skipped" was this loop's pass. So the gate
  // would have reported a domain the engine had never heard of as checked,
  // which is the same lie one layer out.

  it('fails when a required domain is ABSENT from the report, not merely skipped', () => {
    // The pre-#750 report, exactly: four domains, no tasks.
    const fourKeys =
      `{"mail":{"issues":[],"status":"PASS"},"calendar":{"issues":[],"status":"PASS"},` +
      `"contacts":{"issues":[],"status":"PASS"},"files":{"issues":[],"status":"PASS"}}`;
    expect(verdict(fourKeys, ['calendar', 'contacts', 'files', 'tasks'])).toBe('1');
    // And the four that ARE there still pass on that same body, so the failure
    // is about the missing one rather than about the assertion being noisy.
    expect(verdict(fourKeys, ['calendar', 'contacts', 'files'])).toBe('0');
  });

  it('does not accept the domain name appearing as a VALUE somewhere else', () => {
    // The probe has to be `"<domain>":{` — the shape of a domain block — because
    // the report is full of places the word appears as a value. An issue that
    // names the domain it is about is the obvious one, and a loose `"tasks"`
    // grep reads it as the domain block being present: the report then has no
    // task results at all and the gate calls them checked.
    const nameAsAValue =
      `{"calendar":{"issues":[{"id":"X","domain":"tasks","message":"see the task lane"}],"status":"PASS"}}`;
    expect(verdict(nameAsAValue, ['tasks'])).toBe('1');
  });
});

describe('both demo mappings are verified, not just the mail one', () => {
  it('verifies tenant A for mail AND tenant B for the three DAV domains', () => {
    expect(smoke).toMatch(
      /verify_mapping "\$VERIFY_TENANT" "\$VERIFY_SUB" "\$VERIFY_MAPPING" mail mail/,
    );
    expect(smoke).toMatch(
      /verify_mapping "\$APPLY_TENANT" "\$APPLY_SUB" "\$APPLY_MAPPING" dav calendar contacts files/,
    );
  });

  it('does NOT assert PASS on the DAV mapping, because this script breaks it', () => {
    // The apply half removes one real item per run and the tombstone is
    // permanent, so the target legitimately lacks items the source still lists.
    // `missingOnTarget` is EXPECTED here and grows by one per run; asserting
    // PASS would make the gate red for its own correct behaviour.
    expect(smoke).toMatch(/DELIBERATELY NOT ASSERTED `PASS`/);
    expect(smoke).not.toMatch(/overallStatus.*PASS/);
  });
});

describe("the demo's mail source is seeded, and only when it needs to be", () => {
  // The other half of the vacuous-verify fix. The seeder is not new — it is the
  // one e2e.yml has used nightly since 0010 T5 — so the risk here is not the
  // protocol, it is pointing it at the wrong instance or letting it grow a
  // long-lived mailbox every run.
  const step = workflow.slice(workflow.indexOf("The demo's mail source has mail in it"));
  const body = step.slice(0, step.indexOf('- name: The app talks through'));
  const seeder = readFileSync(join(REPO_ROOT, 'test/e2e/seed-imap-source.mjs'), 'utf8');

  it('runs before the smoke, not after it', () => {
    expect(workflow.indexOf("The demo's mail source has mail in it")).toBeLessThan(
      workflow.indexOf('The acceptance smoke'),
    );
  });

  it('points at the MANAGED Stalwart, not the dev one', () => {
    // setup-managed-demo.sh publishes 1994 deliberately, so the managed
    // instance cannot collide with the dev/e2e stack's 1993. Seeding 1993 would
    // put mail in the wrong mailbox and leave this gate still verifying nothing.
    // The PORT VALUE, not the prose: the comment above it names 1993 precisely
    // to say why this is not that.
    const portLine = body.split('\n').find((l) => l.includes('SEED_IMAP_PORT'));
    expect(portLine).toBeDefined();
    expect(portLine).toContain('1994');
    expect(portLine).not.toContain('1993');
  });

  it('uses the demo tenant A source account', () => {
    expect(body).toContain('source@dev.local');
  });

  it('does not grow the mailbox on every run', () => {
    // `append` is an append. Unguarded, a stack that is never torn down gets a
    // few more messages nightly and a source whose count drifts is a poor thing
    // to verify against.
    expect(body).toContain("SEED_ONLY_IF_EMPTY: 'true'");
  });

  it('and the seeder honours that by returning before appending', () => {
    expect(seeder).toContain('SEED_ONLY_IF_EMPTY');
    const guard = seeder.slice(seeder.indexOf('if (onlyIfEmpty)'));
    const upToAppend = guard.slice(0, guard.indexOf('client.append'));
    expect(upToAppend).toMatch(/mailboxOpen\('INBOX'\)/);
    expect(upToAppend).toMatch(/return;/);
  });

  it('leaves the self-host e2e untouched — the option defaults to off', () => {
    expect(seeder).toMatch(/SEED_ONLY_IF_EMPTY \|\| 'false'/);
  });
});

describe('the last two services nothing spoke for (0084 T7.1)', () => {
  // The healthcheck audit was redone against the gate's OWN printed list rather
  // than memory: four services define no healthcheck, not the seven the
  // workplan claimed, and the two it named as most important — trigger-api and
  // trigger-supervisor — already had them. Of the real four, minio and
  // trigger-tls were already asserted here; these two were covered by nothing.
  const registry = smoke.match(/^REGISTRY_PORT_CHECK=[\s\S]*?\nfi$/m)?.[0];
  // Both sides of the proxy since 2026-11-02 (workplan 0136 T4): the
  // supervisor's DOCKER_HOST answers in the supervisor, and the name does not
  // resolve in the API container. From the container's name to the `esac` of
  // the second, the first `esac` after it.
  const proxy = smoke.match(/^SUPERVISOR_CONTAINER="\$\{COMPOSE_PROJECT\}-trigger-supervisor"\n[\s\S]*?\nesac$/m)?.[0];
  // The registry from the API container since 2026-11-14 (workplan 0136 T4):
  // its name does not resolve there. From the assignment to its `esac`.
  const registryFromApi = smoke.match(/^reg_from_api="\$\(docker exec[\s\S]*?\nesac$/m)?.[0];

  /** Run an extracted block with `curl`/`docker` stubbed onto PATH: everything it printed, the verdict last. */
  function run(block: string, stubs: Record<string, string>, setup = ''): string {
    const dir = mkdtempSync(join(tmpdir(), 'smokesvc-'));
    mkdirSync(join(dir, 'bin'));
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(dir, 'bin', name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(dir, 'bin', name), 0o755);
    }
    try {
      return execFileSync('bash', ['-c', `${FAIL_PREAMBLE}\n${setup}\n${block}\necho "FAIL=$fail"`], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** The verdict of an extracted block, the last line `run` prints. */
  function verdict(block: string, stubs: Record<string, string>, setup = '') {
    return run(block, stubs, setup).trim().split('\n').pop()!.replace('FAIL=', '');
  }

  /**
   * How `fetch` answers inside one container: a Response, or a rejection
   * carrying Node's error code the way undici's does (`cause.code`). The
   * message names `<address>` where a real one would carry the address, so a
   * probe that printed messages would print it.
   */
  const ANSWERS = {
    docker: "async () => new Response('OK', { status: 200, headers: { 'api-version': '1.52' } })",
    dockerWithoutHeader: "async () => new Response('OK', { status: 200 })",
    haproxy403: "async () => new Response('Forbidden', { status: 403 })",
    haproxy503: "async () => new Response('Service Unavailable', { status: 503 })",
    registry: "async () => new Response('{}', { status: 200 })",
    ...Object.fromEntries(
      (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'] as const).map((code) => [
        code,
        `async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('${code} <address>:2375'), { code: '${code}' }) }); }`,
      ]),
    ),
  } as Record<string, string>;

  /**
   * A `docker` whose `exec` runs the probe's own node script, with `fetch`
   * answering in the supervisor as `sup` does and in the API container as
   * `api` does. It refuses any other container, program or form, so a probe
   * that moved to another container or binary fails here rather than passing.
   */
  function dockerRunningTheProbe(sup: string, api: string): Record<string, string> {
    // Percent-encoded whole, quotes included, so it sits in the stub's single quotes as one word.
    const preload = (fetch: string) =>
      `data:text/javascript,${encodeURIComponent(`globalThis.fetch = ${fetch};`).replace(/'/g, '%27')}`;
    return {
      docker: [
        '[ "$1" = exec ] || exit 97',
        'case "$2" in',
        `  stub-trigger-supervisor) [ "$3" = node ] || exit 96; pre='${preload(sup)}' ;;`,
        `  stub-api) [ "$3" = /nodejs/bin/node ] || exit 96; pre='${preload(api)}' ;;`,
        '  *) exit 95 ;;',
        'esac',
        '[ "$4" = -e ] && [ "$#" = 5 ] || exit 94',
        'exec node --import "$pre" -e "$5"',
      ].join('\n'),
    };
  }
  const PROXY_SETUP = 'COMPOSE_PROJECT=stub API_CONTAINER=stub-api API_NODE=/nodejs/bin/node';

  it('both blocks are extractable — they still exist to test', () => {
    expect(registry).toBeDefined();
    expect(proxy).toBeDefined();
    expect(registryFromApi).toBeDefined();
  });

  it.each([['ENOTFOUND'], ['EAI_AGAIN']])("no registry name in the API container (%s) is a pass", (code) => {
    const out = run(registryFromApi!, dockerRunningTheProbe(ANSWERS.docker!, ANSWERS[code]!), PROXY_SETUP);
    expect(out.trim().split('\n').pop()).toBe('FAIL=0');
    expect(out).toContain(`trigger-registry: no such name from the API container (${code})`);
  });

  it.each([
    ['the registry answering it', 'registry', "got 'answered HTTP 200' (exit 0)"],
    ['a refused connection', 'ECONNREFUSED', "got 'ECONNREFUSED' (exit 1)"],
    ['a timeout', 'UND_ERR_CONNECT_TIMEOUT', "got 'UND_ERR_CONNECT_TIMEOUT' (exit 1)"],
  ])("the API container reaching the registry's name, by %s, is a failure, and says so", (_how, answer, got) => {
    // Anything but an unknown name means a network the API container is on,
    // ownpace-network, with every other service and every task run, knows it.
    const out = run(registryFromApi!, dockerRunningTheProbe(ANSWERS.docker!, ANSWERS[answer]!), PROXY_SETUP);
    expect(out.trim().split('\n').pop()).toBe('FAIL=1');
    expect(out).toContain('FAIL: the API container asked trigger-registry:5000 and got');
    expect(out).toContain(got);
    expect(out, 'a message carries the address, and this log is public').not.toContain('<address>');
  });

  it("asks the registry's name in the API container, by the path the preflights found", () => {
    // A container the stub does not know exits 95, so another container fails here.
    expect(verdict(registryFromApi!, dockerRunningTheProbe(ANSWERS.docker!, ANSWERS.ENOTFOUND!), 'COMPOSE_PROJECT=stub API_CONTAINER=other API_NODE=/nodejs/bin/node')).toBe('1');
    expect(registryFromApi).toContain('docker exec "$API_CONTAINER" "$API_NODE" -e');
    expect(registryFromApi).toContain("fetch('http://trigger-registry:5000/v2/')");
  });

  it('the registry failing to answer at all is a failure', () => {
    // `000` is curl for "no response". A dead registry means every task deploy
    // fails, and it surfaces as a task that never starts — nothing in that
    // message names the registry.
    //
    // THIS TEST FOUND A REAL ONE. The first draft ended the command with
    // `|| echo 000`, and on a refused connection curl BOTH prints `000` and
    // exits non-zero — so the fallback appended a second, `reg_code` became
    // `000000`, and `!= "000"` was true. The assertion could not fail. A check
    // that cannot fail is worse than no check: it reports as coverage.
    expect(verdict(registry!, { curl: 'echo -n 000; exit 7' })).toBe('1');
  });

  it('a curl that cannot run at all is also a failure, not a pass', () => {
    // Empty output must not read as a status code either.
    expect(verdict(registry!, { curl: 'exit 127' })).toBe('1');
  });

  it('has no fallback that would mask the no-response case', () => {
    // Code lines only — the comment above it quotes the bug it is warning about.
    const code = registry!
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/\|\|\s*echo\s*000/);
  });

  it.each([['200'], ['401']])('the registry answering HTTP %s is a pass', (code) => {
    // ANY status counts on purpose. `/v2/` answers 200 or 401 depending on the
    // build, and the claim that matters is "something is serving HTTP here",
    // not a particular code an upstream image is free to change.
    expect(verdict(registry!, { curl: `echo -n ${code}` })).toBe('0');
  });

  it.each([['ENOTFOUND'], ['EAI_AGAIN']])(
    'Docker answering the supervisor, and no name in the API container (%s), is a pass',
    (code) => {
      const out = run(proxy!, dockerRunningTheProbe(ANSWERS.docker!, ANSWERS[code]!), PROXY_SETUP);
      expect(out.trim().split('\n').pop()).toBe('FAIL=0');
      expect(out).toContain('trigger-docker-proxy HTTP 200 Api-Version 1.52');
      expect(out).toContain(`trigger-docker-proxy: no such name from the API container (${code})`);
    },
  );

  it.each([
    ['refused', 'ECONNREFUSED'],
    ['timed out', 'UND_ERR_CONNECT_TIMEOUT'],
    ['found no name', 'ENOTFOUND'],
    ['answered as HAProxy, 503', 'haproxy503'],
    ['answered as HAProxy, 403', 'haproxy403'],
    ['answered 200 without the Api-Version Docker sets', 'dockerWithoutHeader'],
  ])('the supervisor\'s DOCKER_HOST %s is a failure, and says so', (_how, answer) => {
    // This is workplan 0018's entire failure mode: the supervisor creates every
    // runner container through this proxy, so when it is down an enqueue never
    // becomes a runner — invisible in a green CI. And only Docker's answer
    // counts: HAProxy answers 403 and 503 itself, without Api-Version.
    const out = run(proxy!, dockerRunningTheProbe(ANSWERS[answer]!, ANSWERS.ENOTFOUND!), PROXY_SETUP);
    expect(out.trim().split('\n').pop()).toBe('FAIL=1');
    expect(out).toContain('FAIL: Docker did not answer the supervisor\'s DOCKER_HOST (tcp://trigger-docker-proxy:2375) from trigger-supervisor.');
    expect(out, 'a message carries the address, and this log is public').not.toContain('<address>');
  });

  it.each([
    ['Docker answering it', 'docker', "got 'answered HTTP 200' (exit 0)"],
    ['HAProxy answering it', 'haproxy403', "got 'answered HTTP 403' (exit 0)"],
    ['a refused connection', 'ECONNREFUSED', "got 'ECONNREFUSED' (exit 1)"],
    ['a timeout', 'UND_ERR_CONNECT_TIMEOUT', "got 'UND_ERR_CONNECT_TIMEOUT' (exit 1)"],
  ])('the API container reaching the proxy\'s name, by %s, is a failure, and says so', (_how, answer, got) => {
    // Anything but an unknown name means a network the API container is on,
    // ownpace-network, with every other service and every task run, knows it.
    const out = run(proxy!, dockerRunningTheProbe(ANSWERS.docker!, ANSWERS[answer]!), PROXY_SETUP);
    expect(out.trim().split('\n').pop()).toBe('FAIL=1');
    expect(out).toContain(`FAIL: the API container asked trigger-docker-proxy:2375 and got`);
    expect(out).toContain(got);
    expect(out).not.toContain('<address>');
  });

  it('asks the supervisor by its project\'s name, and the API container by the path the preflights found', () => {
    // A fixed container name would ask the OTA stack's supervisor from any
    // stack (two-stacks-on-one-box); a container the stub does not know exits 95.
    expect(verdict(proxy!, dockerRunningTheProbe(ANSWERS.docker!, ANSWERS.ENOTFOUND!), 'COMPOSE_PROJECT=other API_CONTAINER=stub-api API_NODE=/nodejs/bin/node')).toBe('1');
    expect(proxy).toContain('docker exec "$SUPERVISOR_CONTAINER" node -e');
    expect(proxy).toContain('docker exec "$API_CONTAINER" "$API_NODE" -e');
  });

  it('asserts rather than probes, and says why', () => {
    // The temptation is to "just add a healthcheck". A compose probe runs
    // INSIDE the image and under `up -d --wait` one naming a missing binary
    // does not misreport — it fails the bring-up and takes the gate with it.
    // Nothing here has ever executed a command inside either image.
    expect(smoke).toMatch(/has ever executed a command inside/);
    expect(smoke).toContain('`registry:3` or the Docker socket proxy**');
    expect(smoke).toMatch(/closes the COVERAGE gap, not the healthcheck one/);
  });

  it('does not add a compose healthcheck to either image', () => {
    // If this ever fails, somebody had the evidence — a Docker daemon and those
    // images pulled — and should say so in the diff. Guessing is what costs a
    // bring-up.
    const managed = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
    const block = (name: string) => {
      const i = managed.indexOf(`  ${name}:`);
      const rest = managed.slice(i + 1);
      const j = rest.search(/\n {2}[a-z0-9_-]+:\n/);
      return j === -1 ? rest : rest.slice(0, j);
    };
    expect(block('trigger-registry')).not.toContain('healthcheck:');
    expect(block('trigger-docker-proxy')).not.toContain('healthcheck:');
  });
});

describe('nothing temporary is still living in the gate', () => {
  /**
   * A `probe:` job went into this workflow on 2026-08-23 to ask the running
   * Zitadel two questions, carrying the comment "Deleted before this branch is
   * proposed" and a `probe_only` dispatch input to switch the real gate off.
   * It was not deleted. It sat on `main` for a day — a second job in the gate,
   * an extra input on every dispatch dialog, and an `if:` on the real job
   * whose only purpose was to dodge a probe nobody would run again.
   *
   * Harmless this time, and that is the point: the promise was in a comment,
   * and a comment cannot delete anything. Everything scaffolding-shaped now
   * has to justify itself to a test that outlives the branch.
   */
  it('declares exactly the jobs the gate is, and no scaffolding beside them', () => {
    // From the `jobs:` block only — a bare two-space key also matches
    // `schedule:` under `on:`, which this test caught itself doing.
    const jobsBlock = workflow.slice(workflow.search(/^jobs:$/m));
    const jobs = [...jobsBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['e2e-managed']);
  });

  it('takes no dispatch input that exists to switch the gate off', () => {
    // An input that gates the gate is how a run can look green having done
    // nothing. ONE input is the gate's own since workplan 0167 T7: `job_runner`,
    // which runner works the stack's jobs in that run, `trigger` or `pg-boss`,
    // or empty for the stack's own (its .env, else managed.yml's default):
    // a string, so that empty can be given, and refused by its step otherwise.
    // It chooses what the gate drives, never whether it runs: every step but
    // the Trigger.dev plane's own drill runs in both, and the smoke judges both
    // (the pg-boss sections below). Nothing else.
    const on = (parse(workflow) as { on: { workflow_dispatch?: { inputs?: Record<string, { type?: string; options?: string[]; default?: string }> } | null } }).on;
    const inputs = on.workflow_dispatch?.inputs ?? {};
    expect(Object.keys(inputs), 'a dispatch input beside job_runner').toEqual(['job_runner']);
    expect(inputs.job_runner).toMatchObject({ type: 'string', default: '' });
    // And nothing in the job reads an input but the steps that set the mode.
    const reads = [...workflow.matchAll(/\$\{\{\s*inputs\.([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(['job_runner']));
    // The one `if:` on it writes it into the checkout's .env; none skips a step of the gate.
    const ifs = workflow.split('\n').filter((l) => /^\s*if:.*\binputs\./.test(l)).map((l) => l.trim());
    expect(ifs).toEqual(["if: inputs.job_runner != ''"]);
  });

  it('no job is conditional on anything but the event that fired it', () => {
    // `if:` on a top-level job in THIS workflow has meant exactly one thing so
    // far: skipping the gate. If a real need appears, this test is the place
    // to record why.
    expect(workflow).not.toMatch(/^ {4}if:/m);
  });

  it('says TEMPORARY nowhere, because the last thing that did outlived its branch', () => {
    expect(workflow).not.toMatch(/TEMPORARY/i);
  });
});

describe('the DAV verify asks about every domain the demo tenant actually selects', () => {
  /**
   * The break that did not break.
   *
   * Deleting `tasks` from the tenant-B `verify_mapping` call left every test in
   * this repository green — the same shape as #747's Break E and #750's Break
   * F. Nothing paired the list of domains the gate VERIFIES against the list
   * the seed SELECTS, so the managed gate could go on migrating a domain it
   * never asked a question about.
   *
   * The two sides cannot import each other: one is bash, one is TypeScript, and
   * `no-workspace-imports.unit.test.ts` keeps `deploy/` free of `@openmig/*`
   * besides. So they are paired here, as text, with the vocabulary shift
   * written down rather than assumed — the seed speaks `DiscoveryDomain`
   * (`contact`, `file`, `task`), the report speaks `VerificationDomain`
   * (`contacts`, `files`, `tasks`). Four vocabularies, still four; this is the
   * seam where two of them meet.
   */
  const DISCOVERY_TO_REPORT: Readonly<Record<string, string>> = {
    email: 'mail',
    calendar: 'calendar',
    contact: 'contacts',
    file: 'files',
    task: 'tasks',
  };

  /** Tenant B's selected domains, read out of the seed rather than restated. */
  const seededDomains = (() => {
    const match = seedManaged.match(/domains: \[('calendar'[^\]]*)\]/);
    expect(match, "tenant B's domains list is no longer recognisable in seed-managed.ts").not.toBeNull();
    return match![1]!.split(',').map((d) => d.trim().replace(/'/g, ''));
  })();

  /** The required-domain arguments of the tenant-B verify_mapping call. */
  const requiredByTheGate = (() => {
    const line = smoke
      .split('\n')
      .find((l) => l.startsWith('verify_mapping "$APPLY_TENANT"'));
    expect(line, 'the tenant-B verify_mapping call is no longer recognisable').toBeDefined();
    // …"$APPLY_MAPPING" <label> <domains…>
    return line!.trim().split(/\s+/).slice(5);
  })();

  it('every domain tenant B selects is a domain the DAV verify requires', () => {
    const expected = seededDomains.map((d) => {
      expect(DISCOVERY_TO_REPORT[d], `no report spelling known for the seeded domain '${d}'`).toBeDefined();
      return DISCOVERY_TO_REPORT[d]!;
    });
    // Sorted, because the order is the reading order of the call and carries no
    // meaning — what matters is that neither side holds a domain the other does
    // not.
    expect([...requiredByTheGate].sort()).toEqual([...expected].sort());
  });

  it('tasks is one of them, which is the case that was missing', () => {
    expect(seededDomains).toContain('task');
    expect(requiredByTheGate).toContain('tasks');
  });
});

describe("the status page's identity-provider lamp is read, not just the page", () => {
  /**
   * `${STATUS}/health` proves gatus is serving. It proved nothing about the
   * lamps, and the reference deployment showed a red `Identity provider` for a
   * provider that was signing people in (2026-09-06): the probe's address named
   * the provider's external domain, which a fronted stack no longer aliases on
   * the app network, so the probe went out to the ingress. The gate now reads
   * the row off gatus's own API — the same list the operator's screen reads —
   * and a lamp that lies fails the run.
   */
  const start = smoke.indexOf('note "the status page"');
  const end = smoke.indexOf('note "verdict"');
  const section = start >= 0 && end > start ? smoke.slice(start, end) : '';

  it('has a status-page section that ends where the verdict begins', () => {
    expect(section, 'the status page section is gone or moved past the verdict').not.toBe('');
  });

  it("reads the Identity provider row off gatus's own API", () => {
    expect(section).toContain('/api/v1/endpoints/statuses');
    expect(section).toMatch(/select\(\.group == "Ownpace" and \.name == "Identity provider"\)/);
  });

  it('requires the newest result to be a pass, and fails the gate otherwise', () => {
    expect(section).toMatch(/\.results\[-1\]\.success/);
    expect(section).toMatch(/^\s*up\)\s*$/m);
    const verdictBranch = section.slice(section.indexOf('case "$idp_lamp"'));
    expect(verdictBranch, 'a lamp that is not green does not fail the gate').toMatch(/fail_at/);
  });

  it('waits for a first probe rather than failing on an empty history', () => {
    expect(section).toMatch(/"unprobed"/);
    expect(section).toMatch(/\[ "\$idp_lamp" = "unprobed" \] \|\| break/);
  });
});

describe('a target the reindexer could not see is not a verified target (2026-09-07)', () => {
  /**
   * THE THIRD FACE OF THE SAME COIN, and the one that was still missing after
   * the other two were fixed. `state: done` says the run finished;
   * `totalItemsSource` says the source had content; the skip loop says each
   * domain was looked at. Nothing looked at what came back from the TARGET.
   *
   * The failure that gap admits is specific and quiet. A DAV listing query the
   * server ACCEPTS and that matches nothing returns an empty multistatus — not
   * an error, not a refusal, an empty collection. RFC 6352 §10.5 makes that
   * reachable by accident: `test` defaults to `anyof`, so an
   * `addressbook-query` filter carrying no prop-filter is an OR over zero
   * tests. The reindexer then reports a perfectly healthy zero, and this gate
   * called it a pass — because `missingOnTarget` growing is EXPECTED here (the
   * apply half tombstones one item per run), so the number that would have
   * said otherwise was the one nobody read.
   *
   * A floor, not a match, for the same reason `PASS` is not asserted: the
   * tombstones make an equality red for the script's own correct behaviour.
   *
   * And NOT a new rule. `selfhost-verification.e2e.test.ts` has asserted
   * `sourceCount > 0` / `targetCount === sourceCount` / `missingOnTarget === 0`
   * all along — it can hold the equality because that flow has no apply half
   * consuming an item per run. So the managed gate was the edition missing the
   * check rather than the edition being held to a new one, which is hard rule
   * 5 read the way it is meant to be: both editions, and this was the half
   * that had drifted.
   */
  const block = smoke.match(/^for domain in "\$\{REQUIRED_DOMAINS\[@\]\}"; do[\s\S]*?\ndone$/m)?.[0];

  /**
   * Drive the real loop with a report body, a required-domain list, and how
   * many rows the ledger holds tombstoned per domain, in the ledger's spelling.
   *
   * `q` is the script's psql helper, defined at the top of the script and not
   * in this block. Left undefined, bash printed `q: command not found` into
   * every unit run, the tombstone count came back empty, and every empty
   * target took the "listing found nothing" branch: the spent-fixture branch
   * beside it never ran here, and a mistake in it passed (the trap the
   * `pick_fixture` stub above was written for). So `q` is stood in for, and it
   * answers only the question the loop should ask: a count of this mapping's
   * tombstoned rows in one domain. Anything else, or a count missing the
   * tenant or the mapping, is said on stderr and fails the case.
   */
  function drive(rbody: string, required: string[], tombstoned: Record<string, number> = {}) {
    const counts = Object.entries(tombstoned)
      .map(([domain, n]) => `*"domain='${domain}'"*) echo ${n} ;;`)
      .join('\n      ');
    const q = `q() {
    case "$1" in *"count(*) FROM item"*"status='tombstoned'"*) ;; *) echo "UNEXPECTED QUERY: $1" >&2; return 1 ;; esac
    case "$1" in *"tenant_id='t-1'"*) ;; *) echo "UNSCOPED QUERY: $1" >&2; return 1 ;; esac
    case "$1" in *"mapping_id='m-1'"*) ;; *) echo "UNSCOPED QUERY: $1" >&2; return 1 ;; esac
    case "$1" in
      ${counts}
      *) echo 0 ;;
    esac
  }`;
    const setup = `rbody='${rbody}'\nVERIFY_LABEL=test\nREQUIRED_DOMAINS=(${required.join(' ')})\ntenant=t-1\nmapping=m-1\n${q}`;
    const r = spawnSync(
      'bash',
      ['-c', `${FAIL_PREAMBLE}\n${setup}\n${block}\nprintf '\\n--- verdict ---\\nFAIL=%s\\n%s' "$fail" "$FAIL_REASONS"`],
      { encoding: 'utf8' },
    );
    expect(r.stderr).not.toMatch(/command not found|UNEXPECTED QUERY|UNSCOPED QUERY/);
    const [out, verdictPart = ''] = r.stdout.split('\n--- verdict ---\n');
    const [failLine = '', ...reasons] = verdictPart.split('\n');
    return { out, fail: failLine.replace('FAIL=', ''), reasons: reasons.join('\n') };
  }

  /** The verdict alone, for the cases that have no tombstones behind them. */
  function verdict(rbody: string, required: string[]) {
    return drive(rbody, required).fail;
  }

  /** The real shape: per-domain blocks under a mapping id, each self-labelling. */
  const report = (domains: Record<string, [number, number]>) =>
    JSON.stringify({
      report: {
        m1: Object.fromEntries(
          Object.entries(domains).map(([d, [sourceCount, targetCount]]) => [
            d,
            { dataType: d, sourceCount, targetCount, issues: [], status: 'PASS' },
          ]),
        ),
      },
    });

  it('is extractable — the guard still exists to test', () => {
    expect(block).toBeDefined();
  });

  it('FAILS when the source has items and the target listing found none', () => {
    // The whole point: a CardDAV query the server accepted and that matched
    // nothing looks exactly like this, and looked like a pass until today.
    expect(verdict(report({ contacts: [6, 0] }), ['contacts'])).toBe('1');
  });

  it('passes when the target listing found items, even fewer than the source', () => {
    // The tombstones: every run permanently consumes one item, so the target
    // legitimately lags. That is why this is a floor and not an equality.
    expect(verdict(report({ contacts: [6, 5] }), ['contacts'])).toBe('0');
  });

  it('passes an empty domain at BOTH ends, rather than inventing a failure', () => {
    // Nothing on the target is the right answer to nothing at the source. A
    // gate that reddened here would be red for a correct migration of nothing.
    expect(verdict(report({ tasks: [0, 0] }), ['tasks'])).toBe('0');
  });

  it('catches the empty one among several required domains', () => {
    const mixed = report({ calendar: [3, 3], contacts: [6, 0], files: [9, 8] });
    expect(verdict(mixed, ['calendar', 'contacts', 'files'])).toBe('1');
    // ...and stays quiet when it is not asked about the empty one.
    expect(verdict(mixed, ['calendar', 'files'])).toBe('0');
  });

  it('fails on a report shape it cannot read, rather than assuming it was fine', () => {
    // The `totalItemsSource` guard's stance, inherited: a report whose shape
    // changed is not evidence that anything was verified. An older engine that
    // omits `dataType` lands here, and says so.
    expect(verdict(`{"report":{"m1":{"contacts":{"status":"PASS"}}}}`, ['contacts'])).toBe('1');
  });

  it('names the quiet cause, not just the number', () => {
    // A gate that says "targetCount=0" sends somebody to the sync. The cause
    // is as likely to be the listing query, and the message has to say so or
    // the next person re-derives it from scratch.
    expect(block).toMatch(/matches nothing|found nothing/i);
    expect(block).toMatch(/listing query/i);
  });

  it('calls a domain whose every source item is tombstoned a spent fixture set, not a broken listing', () => {
    // 2026-09-09: the demo stack answered task|tombstoned|2, both fixed task
    // fixtures, and the gate sent its reader to a DAV query that was working.
    // As many tombstones as source items is the edge: every one is spent.
    const r = drive(report({ contacts: [6, 0] }), ['contacts'], { contact: 6 });
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('the fixture set is spent, not the listing broken');
    expect(r.reasons).not.toContain('the target listing found nothing');
    expect(r.out).toContain('seed-demo-dav-content.sh --fresh');
  });

  it('still points at the listing when only some of the source items are tombstoned', () => {
    const r = drive(report({ contacts: [6, 0] }), ['contacts'], { contact: 5 });
    expect(r.fail).toBe('1');
    expect(r.out).toContain('5 of them are tombstoned');
    expect(r.reasons).toContain('the target listing found nothing');
    expect(r.reasons).not.toContain('the fixture set is spent');
  });

  it.each([
    ['mail', 'email'],
    ['tasks', 'task'],
    ['contacts', 'contact'],
    ['files', 'file'],
    ['calendar', 'calendar'],
  ])("asks the ledger about '%s' in the ledger's own spelling, '%s'", (reported, ledger) => {
    // The report and the ledger spell four of the five domains differently. A
    // count asked in the report's spelling matches no row and answers 0, and a
    // spent fixture set then reads as a broken listing on every run.
    const r = drive(report({ [reported]: [3, 0] }), [reported], { [ledger]: 3 });
    expect(r.reasons).toContain('the fixture set is spent');
  });
});

// ---------------------------------------------------------------------------
// THE GATE IN BOTH MODES (ADR-0054; workplan 0167 T7).
//
// On a stack whose jobs run on pg-boss the Trigger.dev plane is stopped, so
// each section that asks it is skipped, out loud, and what stood for "an
// enqueue became a runner" is read from pg-boss instead. The first real stack
// these branches meet is the E2E (managed) run of the switch-on, so each is
// run here against stubs, from the script's own text: a skip in the wrong mode
// is a green on less evidence, and a pg-boss run in which no job completed
// must be red.
// ---------------------------------------------------------------------------

/** A function of the smoke, as it is written there: `name() {` to the `}` that ends it. */
function smokeFunction(name: string): string {
  const start = smoke.indexOf(`\n${name}() {`);
  if (start < 0) throw new Error(`smoke-managed.sh no longer defines ${name}()`);
  return smoke.slice(start + 1, smoke.indexOf('\n}\n', start) + 3);
}

/** Run `body` after the smoke's own definitions of `fns`, under the smoke's `set -uo pipefail`. */
function smokeRun(fns: string[], body: string, env: Record<string, string> = {}) {
  const r = spawnSync(
    'bash',
    ['-c', ['set -uo pipefail', FAIL_PREAMBLE, `. '${join(REPO_ROOT, 'deploy/compose/env-read.sh')}'`, ...fns.map(smokeFunction), body, 'echo "FAIL=$fail"'].join('\n')],
    { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } },
  );
  const out = `${r.stdout}${r.stderr}`;
  return { status: r.status, out, fail: /^FAIL=(\d)$/m.exec(r.stdout)?.[1] ?? '?', reasons: /FAIL_REASONS<<([\s\S]*?)>>/.exec(r.stdout)?.[1] ?? '' };
}
const SHOW_REASONS = 'printf "FAIL_REASONS<<%s>>\\n" "$FAIL_REASONS"';

describe('which runner works the jobs is read once, as the bring-up reads it, and the workflow reads it the same way', () => {
  const dirs: string[] = [];
  /** A deploy/compose directory holding a .env (or none) and a managed.yml with this default (or none). */
  function box(dotenv: string | null, ymlDefault: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'job-runner-'));
    dirs.push(dir);
    const compose = join(dir, 'deploy/compose');
    mkdirSync(compose, { recursive: true });
    writeFileSync(join(compose, 'env-read.sh'), readFileSync(join(REPO_ROOT, 'deploy/compose/env-read.sh')));
    if (dotenv !== null) writeFileSync(join(compose, '.env'), dotenv);
    writeFileSync(
      join(compose, 'managed.yml'),
      `services:\n  api:\n    environment:\n      APP_ENV: x\n${ymlDefault === null ? '' : `      OWNPACE_JOB_RUNNER: \${OWNPACE_JOB_RUNNER:-${ymlDefault}}\n`}`,
    );
    return { dir, compose };
  }
  const smokeReads = (compose: string) =>
    smokeRun(['smoke_env_value', 'smoke_job_runner'], 'smoke_job_runner && echo "rc=0" || echo "rc=$?"', { SCRIPT_DIR: compose });
  const step = (parse(workflow) as { jobs: Record<string, { steps: Array<{ id?: string; run?: string }> }> }).jobs['e2e-managed']!.steps.find((s) => (s.run ?? '').includes('>"$RUNNER_TEMP/job-runner"'));
  function workflowReads(dir: string, input = '') {
    const temp = join(dir, 'runner-temp');
    mkdirSync(temp, { recursive: true });
    const output = join(temp, 'job-runner');
    writeFileSync(output, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step?.run ?? 'exit 99'], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', JOB_RUNNER_INPUT: input, RUNNER_TEMP: temp },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, mode: readFileSync(output, 'utf8').trim() };
  }

  it.each([
    ['no .env and no default in managed.yml', null, null, 'trigger'],
    ['a .env without the key, and no default', 'NODE_ENV=development\n', null, 'trigger'],
    ['the key empty', 'OWNPACE_JOB_RUNNER=\n', null, 'trigger'],
    ['trigger', 'OWNPACE_JOB_RUNNER=trigger\n', null, 'trigger'],
    ['pg-boss', 'OWNPACE_JOB_RUNNER=pg-boss\n', null, 'pg-boss'],
    ['pg-boss in double quotes, as Compose reads it', 'OWNPACE_JOB_RUNNER="pg-boss"\n', null, 'pg-boss'],
    ['pg-boss in single quotes, with a comment', "OWNPACE_JOB_RUNNER='pg-boss'   # the switch\n", null, 'pg-boss'],
    ["no key, and managed.yml's default pg-boss", 'NODE_ENV=development\n', 'pg-boss', 'pg-boss'],
    ["the .env's trigger over managed.yml's pg-boss", 'OWNPACE_JOB_RUNNER=trigger\n', 'pg-boss', 'trigger'],
    ["the last assignment, as Compose takes it", 'OWNPACE_JOB_RUNNER=trigger\nOWNPACE_JOB_RUNNER=pg-boss\n', 'trigger', 'pg-boss'],
  ])('%s: %s', (_what, dotenv, ymlDefault, want) => {
    const { dir, compose } = box(dotenv, ymlDefault);
    const s = smokeReads(compose);
    expect(s.out).toContain('rc=0');
    expect(s.out.split('\n')[0]).toBe(want);
    const w = workflowReads(dir);
    expect(w.status, w.out).toBe(0);
    expect(w.mode).toBe(want);
  });

  it.each([['pgboss'], ['Trigger'], ['pg_boss']])("'%s' is refused in one sentence, by both", (value) => {
    const { dir, compose } = box(`OWNPACE_JOB_RUNNER=${value}\n`, null);
    const s = smokeReads(compose);
    expect(s.out).toContain('rc=1');
    expect(s.out).toContain(`OWNPACE_JOB_RUNNER is '${value}', and a stack's jobs run on 'trigger' or 'pg-boss' (unset or empty is 'trigger').`);
    const w = workflowReads(dir);
    expect(w.status).not.toBe(0);
    expect(w.mode).toBe('');
    expect(w.out).toContain(`OWNPACE_JOB_RUNNER is '${value}'`);
  });

  it("the dispatch's input wins over the .env, for the run's steps", () => {
    const { dir } = box('OWNPACE_JOB_RUNNER=trigger\n', null);
    expect(workflowReads(dir, 'pg-boss').mode).toBe('pg-boss');
    expect(workflowReads(dir, 'trigger').mode).toBe('trigger');
  });

  it("the smoke stops at an answer it cannot read, before any section, and the API's own mode is held to it", () => {
    const at = smoke.indexOf('JOB_RUNNER="$(smoke_job_runner)"');
    expect(at).toBeGreaterThan(0);
    expect(smoke.slice(at, smoke.indexOf('\n', at))).toContain('exit 1');
    expect(at).toBeLessThan(smoke.indexOf('note "preflights"'));
    expect(smoke).toMatch(/^api_runner="\$\(api_env OWNPACE_JOB_RUNNER\)"/m);
    expect(smoke.indexOf('api_runner="$(api_env OWNPACE_JOB_RUNNER)"')).toBeLessThan(smoke.indexOf('if trigger_only "minio and trigger-tls"; then'));
  });

  it('the input is written into the checkout only after the persisted copy is saved, and never copied back', () => {
    const steps = (parse(workflow) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string; if?: string }> }> }).jobs['e2e-managed']!.steps;
    const persist = steps.findIndex((s) => (s.run ?? '').includes('cp deploy/compose/.env "${PERSIST_DIR}/.env"'));
    const write = steps.findIndex((s) => (s.run ?? '').includes('OWNPACE_JOB_RUNNER=${JOB_RUNNER}'));
    const bringUp = steps.findIndex((s) => (s.run ?? '').includes('bootstrap-managed.sh'));
    expect(persist).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(persist);
    expect(write).toBeLessThan(bringUp);
    expect(steps[write]!.if).toBe("inputs.job_runner != ''");
    const after = steps.slice(write + 1).filter((s) => /PERSIST_DIR|\.persistent/.test(s.run ?? ''));
    expect(after.map((s) => s.name), 'a step after the write reaches the persisted directory').toEqual([]);
  });

  it("the Trigger.dev plane's drill runs only on trigger, and its keys are asked only there", () => {
    const steps = (parse(workflow) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string; if?: string }> }> }).jobs['e2e-managed']!.steps;
    const mode = steps.findIndex((s) => (s.run ?? '').includes('>"$RUNNER_TEMP/job-runner"'));
    const reads = (s: { run?: string }) => (s.run ?? '').includes('JOB_RUNNER="$(cat "$RUNNER_TEMP/job-runner")"');
    const drill = steps.findIndex((s) => (s.run ?? '').includes('trigger-version.sh drill'));
    const refuse = steps.findIndex((s) => (s.run ?? '').includes('TRIGGER_PROJECT_REF TRIGGER_SECRET_KEY'));
    for (const at of [drill, refuse]) {
      expect(at).toBeGreaterThan(mode);
      expect(reads(steps[at]!), steps[at]!.name).toBe(true);
    }
    // Run, on a stand-in for the drill: on pg-boss it does not run, on trigger it does.
    for (const [m, ran] of [['pg-boss', false], ['trigger', true]] as const) {
      const dir = mkdtempSync(join(tmpdir(), 'drill-'));
      dirs.push(dir);
      mkdirSync(join(dir, 'deploy/compose'), { recursive: true });
      writeFileSync(join(dir, 'job-runner'), `${m}\n`);
      writeFileSync(join(dir, 'deploy/compose/trigger-version.sh'), '#!/usr/bin/env bash\necho "drill ran: $*"\n');
      chmodSync(join(dir, 'deploy/compose/trigger-version.sh'), 0o755);
      const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', steps[drill]!.run!], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', RUNNER_TEMP: dir } });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.includes('drill ran: drill'), `${m}: ${r.stdout}`).toBe(ran);
    }
    expect(steps[refuse]!.run).toMatch(/if \[ "\$JOB_RUNNER" = trigger \]; then\n\s+for key in TRIGGER_PROJECT_REF TRIGGER_SECRET_KEY; do/);
    // No step is skipped by the mode: each decides inside its own run, and says so.
    expect(steps.filter((s) => /steps\.|outputs\./.test(s.if ?? '')).map((s) => s.name)).toEqual([]);
  });

  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
});

describe('a section that cannot speak for a pg-boss stack is skipped, out loud, and only there', () => {
  /** Each Trigger.dev section, by the name its skip line gives and a line only it carries. */
  const SECTIONS: Array<[string, string]> = [
    ['minio and trigger-tls', "fetch('http://minio:9000/minio/health/live')"],
    ['the runner-log capture', "for c in $(docker ps --filter \"network=${COMPOSE_PROJECT}_ownpace-network\""],
    ['trigger-registry and trigger-docker-proxy', 'REGISTRY_PORT_CHECK="${SMOKE_REGISTRY_PORT:-${registry_port:-5000}}"'],
    ['clickhouse, and who can reach it', 'TRIGGER_API_CONTAINER="${COMPOSE_PROJECT}-trigger-api"'],
    ['runner logs captured before AutoRemove', 'if [ "$found_logs" != "1" ]; then'],
    ["the tasks' image", '--entrypoint node "$ours" --version'],
  ];

  it.each(SECTIONS)('"%s" lies inside its own trigger_only, unindented', (name, marker) => {
    const open = smoke.indexOf(`\nif trigger_only "${name}"; then\n`);
    const close = smoke.indexOf(`\nfi # trigger_only "${name}"\n`);
    expect(open, `no trigger_only around "${name}"`).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    const at = smoke.indexOf(marker);
    expect(at, marker).toBeGreaterThan(open);
    expect(at, `${marker} is outside its trigger_only`).toBeLessThan(close);
    // Once each: a second copy of the marker outside would run in both modes.
    expect(smoke.indexOf(marker, at + 1)).toBe(-1);
  });

  it('on trigger it says nothing and runs the section; on pg-boss it prints one line naming the section and the mode, and skips it', () => {
    const t = smokeRun(['trigger_only'], 'JOB_RUNNER=trigger; trigger_only "the tasks\' image" && echo ran || echo skipped');
    expect(t.out.trim().split('\n')).toEqual(['ran', 'FAIL=0']);
    const p = smokeRun(['trigger_only'], 'JOB_RUNNER=pg-boss; trigger_only "the tasks\' image" && echo ran || echo skipped');
    const lines = p.out.trim().split('\n').filter(Boolean);
    expect(lines).toEqual([
      "--- the tasks' image: skipped, this stack runs its jobs on pg-boss and its Trigger.dev plane is stopped ---",
      'skipped',
      'FAIL=0',
    ]);
  });

  it("the pg-boss checks run only on pg-boss: in trigger mode the smoke's verdict rests on what it always did", () => {
    for (const call of ['pgboss_jobs', 'no_runner_started', 'jobs_role_fit', 'worker_fit']) {
      const calls = smoke.split('\n').filter((l) => l.trim() === call);
      expect(calls, `${call} is called once`).toHaveLength(1);
    }
    const jobs = smoke.indexOf('\npgboss_jobs\n');
    expect(smoke.lastIndexOf('if [ "$JOB_RUNNER" = pg-boss ]; then', jobs)).toBeGreaterThan(smoke.lastIndexOf('\nfi\n', jobs));
    // The worker's image stands in the else of the tasks' image.
    const worker = smoke.indexOf('\nworker_fit\n');
    expect(smoke.lastIndexOf('\nelse\n', worker)).toBeGreaterThan(smoke.indexOf('if trigger_only "the tasks\' image"; then'));
    expect(worker).toBeLessThan(smoke.indexOf('fi # trigger_only "the tasks\' image"'));
    // And last before the verdict, once everything this run causes is caused.
    expect(jobs).toBeGreaterThan(smoke.indexOf('note "the books: one sandbox invoice a night (0111, decision 12)"'));
    expect(jobs).toBeLessThan(smoke.indexOf('note "verdict"'));
  });

  it("the header says both modes' rule", () => {
    expect(smoke).toContain('no runner at all');
    expect(smoke).toContain('no job ran is the failure no runner at all is');
  });
});

describe('on pg-boss, every job this run saw completed, and at least one it asked for: "no job ran" is red', () => {
  const UUID = '0f9c3b52-6b1e-4c1a-9a51-2f7e8d6c4b3a';
  const CATALOG = [
    'export const JOB_CATALOG = [',
    "  { ...HOURLY_OR_DAILY, name: 'managed-sync-tick', cron: '* * * * *', pollingIntervalSeconds: 10 },",
    "  { ...HOURLY_OR_DAILY, name: 'managed-digest', cron: '0 8 * * *' },",
    '  {',
    '    ...ASKED_FOR,',
    "    name: 'run-delta-sync',",
    "    policy: 'singleton',",
    '  },',
    "  { ...ASKED_FOR, name: 'run-verification', policy: 'standard' },",
    "  { ...ASKED_FOR, name: 'run-cutover', policy: 'standard' },",
    '] as const satisfies readonly JobCatalogEntry[];',
    '',
  ].join('\n');

  /**
   * pgboss_jobs against `rows` (name|state|count|retried|is-a-schedule) and `waiting` (the count of
   * jobs asked for still in flight), with the jobs `jobs` (id → "name state") behind the runIds.
   */
  function jobs(rows: string[], opts: { waiting?: string; refs?: string; jobs?: Record<string, string>; broken?: boolean; catalog?: string | null } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'pgboss-jobs-'));
    try {
      const catalog = join(dir, 'catalog.ts');
      if (opts.catalog !== null) writeFileSync(catalog, opts.catalog ?? CATALOG);
      writeFileSync(join(dir, 'rows'), rows.map((r) => `${r}\n`).join(''));
      writeFileSync(join(dir, 'jobs'), Object.entries(opts.jobs ?? {}).map(([id, v]) => `${id} ${v}\n`).join(''));
      const stub = `
catalog_path='${catalog}'
eval "$(declare -f catalog_queues | sed "s|\\\${REPO_ROOT}/packages/scheduler/src/pg-boss/catalog.ts|$catalog_path|")"
q() {
  [ -n "\${BROKEN:-}" ] && { echo 'ERROR:  relation "pgboss.job" does not exist' ; return 1; }
  case "$1" in
    *"WHERE j.id = '"*) id="\${1#*WHERE j.id = \\'}"; id="\${id%%\\'*}"; awk -v id="$id" '$1 == id { $1 = ""; sub(/^ /, ""); print }' '${join(dir, 'jobs')}' ;;
    *"GROUP BY"*) cat '${join(dir, 'rows')}' ;;
    *"count(*) FROM pgboss.job j"*) echo "\${WAITING:-0}" ;;
    *) echo "unexpected query: $1" >&2; return 9 ;;
  esac
}
sleep() { :; }
`;
      return smokeRun(['catalog_queues', 'pgboss_jobs'], `${stub}\npgboss_jobs\n${SHOW_REASONS}`, {
        REPO_ROOT: dir,
        SMOKE_STARTED_AT: '2026-11-22T17:00:00Z',
        JOB_SETTLE_POLLS: '2',
        POLL_SLEEP: '2',
        FOLLOWED_REFS: opts.refs ?? '',
        WAITING: opts.waiting ?? '0',
        ...(opts.broken ? { BROKEN: '1' } : {}),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the jobs this run asked for completed, a tick completed, the runIds followed completed: a pass', () => {
    // `__pgboss__send-it` is pg-boss's own: its timekeeper puts one job there per schedule
    // occurrence, a row the review reproduced on the pinned pg-boss as `completed|2|0|false`.
    const r = jobs(['__pgboss__send-it|completed|2|0|false', 'managed-sync-tick|completed|9|0|true', 'run-delta-sync|completed|2|1|false', 'run-verification|completed|1|0|false'], {
      refs: UUID,
      jobs: { [UUID]: 'run-delta-sync completed' },
    });
    expect(r.fail, r.out).toBe('0');
    expect(r.out).toContain('run-delta-sync: 2 completed, 1 after a retry');
    expect(r.out).toContain('every runId this run followed is a pg-boss job that completed: run-delta-sync');
  });

  it('no job at all is a failure: no job ran', () => {
    const r = jobs([]);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('no job ran');
  });

  it("only the schedule's ticks completed is a failure: none of this run's own jobs ran", () => {
    const r = jobs(['managed-sync-tick|completed|9|0|true']);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('no job ran');
  });

  it.each([['failed'], ['cancelled']])('a job that ended %s is a failure, its queue named', (state) => {
    const r = jobs(['run-delta-sync|completed|1|0|false', `run-cutover|${state}|1|0|false`]);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain(`1 job(s) on run-cutover ended ${state}`);
  });

  it.each([['failed'], ['retry']])("a job on pg-boss's own queue that is %s fails the run, as a schedule's would", (state) => {
    const r = jobs(['run-delta-sync|completed|1|0|false', `__pgboss__send-it|${state}|1|1|false`]);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('on __pgboss__send-it');
    expect(r.reasons).not.toContain('a queue the catalog does not name');
  });

  it("pg-boss's own queue alone is no job this run asked for: no job ran", () => {
    const r = jobs(['__pgboss__send-it|completed|3|0|false', 'managed-sync-tick|completed|3|0|true']);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('no job ran');
  });

  it("a schedule's retry that completed inside the wait is said, not failed, every time alike", () => {
    const r = jobs(['run-delta-sync|completed|1|0|false', 'managed-digest|completed|1|1|true']);
    expect(r.fail, r.out).toBe('0');
    expect(r.out).toContain('managed-digest: 1 completed, 1 after a retry');
  });

  it('the wait waits for a retry on any queue, a schedule\'s included, and for the jobs asked for', () => {
    const body = smokeFunction('pgboss_jobs');
    expect(body).toContain("(j.state = 'retry' OR (j.state IN ('created', 'active') AND NOT EXISTS (SELECT 1 FROM pgboss.schedule s WHERE s.name = j.name) AND left(j.name, 10) <> '__pgboss__'))");
  });

  it("a job waiting to retry is a failed attempt, a schedule's included", () => {
    const r = jobs(['run-delta-sync|completed|1|0|false', 'managed-digest|retry|1|1|true']);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('1 job(s) on managed-digest are waiting to retry');
  });

  it('a job this run asked for still running after the wait is a failure, and the wait was waited', () => {
    const r = jobs(['run-delta-sync|completed|1|0|false', 'run-verification|active|1|0|false'], { waiting: '1' });
    expect(r.fail).toBe('1');
    expect(r.out).toContain('waited 4s for the jobs this run asked for to settle');
    expect(r.reasons).toContain('1 job(s) on run-verification are still active after 4s');
  });

  it("a job that began after the wait found nothing in flight is a failure, and not said to have outlasted the wait", () => {
    const r = jobs(['run-delta-sync|completed|1|0|false', 'run-verification|active|1|0|false'], { waiting: '0' });
    expect(r.fail).toBe('1');
    expect(r.out).not.toContain('waited');
    expect(r.reasons).toContain('1 job(s) on run-verification are active, begun after the wait had found nothing in flight');
    expect(r.reasons).not.toContain('after 4s');
  });

  it("a schedule's next tick, created or running, is said and not failed", () => {
    const r = jobs(['run-delta-sync|completed|1|0|false', 'managed-sync-tick|active|1|0|true', 'managed-sync-tick|created|1|0|true']);
    expect(r.fail, r.out).toBe('0');
    expect(r.out).toContain("(managed-sync-tick is a schedule: its active job is the next tick, not this run's)");
  });

  it('a queue the catalog does not name is a failure', () => {
    const r = jobs(['run-delta-sync|completed|1|0|false', 'run-something-else|completed|1|0|false']);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain("on 'run-something-else', a queue the catalog does not name");
  });

  it.each([
    ['a Trigger.dev run id', 'run_cm9x2abcdef', {}, 'which is no pg-boss job id (a UUID)'],
    ['a UUID no job has', UUID, {}, 'is no job in pgboss.job'],
    ['a job that failed', UUID, { [UUID]: 'run-delta-sync failed' }, "is 'run-delta-sync failed', not completed"],
  ])('a runId the smoke followed that is %s is a failure', (_what, ref, known, says) => {
    const r = jobs(['run-delta-sync|completed|1|0|false'], { refs: ref, jobs: known });
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain(says);
  });

  it('pgboss.job that cannot be read is a failure, never an empty pass', () => {
    const r = jobs([], { broken: true });
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('pgboss.job could not be read');
    expect(r.out).toContain('relation "pgboss.job" does not exist');
  });

  it('a catalog that cannot be read is a failure', () => {
    const r = jobs(['run-delta-sync|completed|1|0|false'], { catalog: null });
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain("the catalog's queues could not be read");
  });

  it("reads the real catalog's seventeen queues once it is there, and refuses while it is not", () => {
    const real = join(REPO_ROOT, 'packages/scheduler/src/pg-boss/catalog.ts');
    const r = smokeRun(['catalog_queues'], `catalog_queues '${real}' && echo "rc=0" || echo "rc=$?"`);
    if (existsSync(real)) {
      const names = r.out.split('\n').filter((l) => /^[a-z]/.test(l) && !l.startsWith('rc='));
      expect(names).toHaveLength(17);
      expect(names).toContain('managed-sync-tick');
      expect(names).toContain('run-delta-sync');
    } else {
      expect(r.out).toContain('rc=1');
    }
  });

  it('reads pgboss.job by the start of the run and by the schedule table, through the connection that reads the ledger', () => {
    const body = smokeFunction('pgboss_jobs');
    expect(body).toContain("j.created_on >= timestamptz '${SMOKE_STARTED_AT}'");
    expect(body).toContain('pgboss.schedule');
    expect(body).not.toMatch(/docker exec/);
    // Every runId an API 202 handed over is followed: the sync's and the cutover's.
    expect(smoke).toContain('FOLLOWED_REFS="${FOLLOWED_REFS}${FOLLOWED_REFS:+ }${ref}"');
    expect(smoke).toContain('[ -z "$cut_ref" ] || FOLLOWED_REFS="${FOLLOWED_REFS}${FOLLOWED_REFS:+ }${cut_ref}"');
  });
});

describe('on pg-boss, no Trigger.dev runner started on this stack', () => {
  /** no_runner_started over the events file `lines`, its watcher alive or not. */
  function events(lines: string[], watcher: 'alive' | 'dead' | 'none' = 'alive') {
    const dir = mkdtempSync(join(tmpdir(), 'smoke-events-'));
    try {
      const file = join(dir, 'events');
      if (watcher !== 'none') writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
      writeFileSync(`${file}.err`, watcher === 'dead' ? 'Cannot connect to the Docker daemon\n' : '');
      const pid = watcher === 'alive' ? 'sleep 30 & WATCHER_PID=$!' : watcher === 'dead' ? '(exit 0) & WATCHER_PID=$!; wait "$WATCHER_PID"' : 'WATCHER_PID=""';
      const r = smokeRun(['no_runner_started'], `${pid}\nno_runner_started\n${SHOW_REASONS}\nkill "$WATCHER_PID" 2>/dev/null || true`, {
        SMOKE_STARTED_AT: '2026-11-22T17:00:00Z',
        COMPOSE_PROJECT: 'ownpace-managed',
        EVENTS_FILE: watcher === 'none' ? '' : file,
      });
      return r;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const NET = 'ownpace-managed_ownpace-network';

  it("a runner on this stack's network is a failure, by name", () => {
    const r = events(['container start aaa ownpace-managed-api ', `network connect n1 ${NET} aaa`, 'container start bbb runner-cm9x ', `network connect n1 ${NET} bbb`]);
    expect(r.fail).toBe('1');
    expect(r.out).toContain('runner containers started on this stack since 2026-11-22T17:00:00Z: runner-cm9x');
  });

  it("another stack's runner, on its own network, is not this stack's", () => {
    const r = events(['container start bbb runner-cm9x ', 'network connect n2 ownpace-live_ownpace-network bbb', 'container start ccc ownpace-managed-worker ', `network connect n1 ${NET} ccc`]);
    expect(r.fail, r.out).toBe('0');
    expect(r.out).toContain("no runner-* container started on this stack's network since 2026-11-22T17:00:00Z (2 container start(s) watched)");
  });

  it.each([['dead'], ['none']] as const)('a stream that is %s is a failure: what it did not watch, it cannot speak for', (watcher) => {
    const r = events([], watcher);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain("Docker's events were not watched for the whole run");
  });

  it('the stream starts with the run, on pg-boss only, runs until the trap, and is never a replay with --until', () => {
    const at = smoke.indexOf('\nif [ "$JOB_RUNNER" = pg-boss ]; then\n  EVENTS_FILE="$(mktemp');
    expect(at).toBeGreaterThan(0);
    const block = smoke.slice(at, smoke.indexOf('\nfi\n', at));
    expect(block).toContain('docker events --since "$SMOKE_STARTED_AT" --filter type=container --filter type=network');
    expect(block).toContain('--filter event=start --filter event=connect');
    expect(block).toContain('WATCHER_PID=$!');
    const code = smoke.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code, 'a replay of the daemon\'s last 256 events').not.toMatch(/docker events[^\n]*--until/);
    expect(at).toBeLessThan(smoke.indexOf('note "preflights"'));
    // Ended by every EXIT trap from there on, the runner-log watcher's kill.
    const traps = smoke.slice(at).split('\n').filter((l) => /^\s*trap\s+.*\bEXIT\b/.test(l));
    expect(traps.length).toBeGreaterThanOrEqual(3);
    for (const trap of traps) expect(trap).toContain('kill "$WATCHER_PID" 2>/dev/null || true');
    // And nothing resets WATCHER_PID after it is started.
    expect(smoke.slice(at + block.length).match(/^WATCHER_PID=""/m)).toBeNull();
  });
});

describe('on pg-boss, the Trigger.dev supervisor is not running, at the start and at the end', () => {
  const ask = (said: string, rc: number) =>
    smokeRun(['supervisor_stopped'], `docker() { printf '%s\\n' "$SAID"; return "$RC"; }\nsupervisor_stopped "at the start"\n${SHOW_REASONS}`, {
      COMPOSE_PROJECT: 'ownpace-managed',
      SAID: said,
      RC: String(rc),
    });

  it.each([
    ['stopped', 'false', 0],
    ['not there', 'Error: No such container: ownpace-managed-trigger-supervisor', 1],
    ['not there, in an older Docker\'s words', 'Error: No such object: ownpace-managed-trigger-supervisor', 1],
  ])('%s is a pass', (_what, said, rc) => {
    expect(ask(said, rc).fail).toBe('0');
  });

  it.each([
    ['running', 'true', 0, 'trigger-supervisor is running at the start'],
    ['a Docker that cannot be asked', 'Cannot connect to the Docker daemon', 1, 'trigger-supervisor could not be asked at the start'],
  ])('%s is a failure', (_what, said, rc, reason) => {
    const r = ask(said, rc);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain(reason);
  });

  it('is asked once at the start, after the mode is known, and once at the end', () => {
    expect(smoke).toContain('[ "$JOB_RUNNER" = pg-boss ] && supervisor_stopped "at the start"');
    expect(smoke.indexOf('supervisor_stopped "at the start"')).toBeLessThan(smoke.indexOf('if trigger_only "minio and trigger-tls"; then'));
    expect(smoke.indexOf('\nsupervisor_stopped "at the end"\n')).toBeGreaterThan(smoke.indexOf('\npgboss_jobs\n'));
    expect(smoke.indexOf('supervisor_stopped() {')).toBeLessThan(smoke.indexOf('supervisor_stopped "at the start"'));
  });
});

describe("on pg-boss, the jobs' role is fit and owns pgboss", () => {
  const FIT = 'false|false|false|false|false|true|false|0|0|true|false|false|0';
  const role = (answer: string) =>
    smokeRun(['jobs_role_fit'], `q() { printf '%s\\n' "$ANSWER"; }\njobs_role_fit\n${SHOW_REASONS}`, { ANSWER: answer });

  it('the role the bring-up makes is a pass', () => {
    const r = role(FIT);
    expect(r.fail, r.out).toBe('0');
    expect(r.out).toContain('owns pgboss and every relation in it');
  });

  it.each([
    ['a superuser', `true${FIT.slice(5)}`],
    ['BYPASSRLS', 'false|false|false|false|true|true|false|0|0|true|false|false|0'],
    ['INHERIT', 'false|false|false|false|false|true|true|0|0|true|false|false|0'],
    ['a member of a role', 'false|false|false|false|false|true|false|1|0|true|false|false|0'],
    ['pgboss owned by another role', 'false|false|false|false|false|true|false|0|0|false|false|false|0'],
    ['no schema pgboss', 'false|false|false|false|false|true|false|0|0|no schema|false|false|0'],
    ['may create in public', 'false|false|false|false|false|true|false|0|0|true|false|true|0'],
    ["pg-boss's tables installed by the owner", 'false|false|false|false|false|true|false|0|0|true|false|false|12'],
    ['no such role', ''],
  ])('%s is a failure', (_what, answer) => {
    const r = role(answer);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain('ownpace_jobs is not the role the bring-up makes');
  });
});

describe("on pg-boss, the worker is the API's image, as uid 65532, with no shell, healthy, and holds no owner's URL", () => {
  const ABSENT = 'OCI runtime exec failed: exec failed: unable to start container process: exec: "SHELL": executable file not found in $PATH: unknown';
  const ENV = [
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'OWNPACE_JOB_RUNNER=pg-boss',
    'JOBS_DATABASE_URL=postgresql://ownpace_jobs:a-password@pgbouncer:6432/openmigrate',
    'APP_DATABASE_URL=postgresql://app_user:another@pgbouncer:6432/openmigrate',
    'SYSTEM_DATABASE_URL=postgresql://ownpace_system:third@pgbouncer:6432/openmigrate',
  ].join('\n');
  function worker(over: Record<string, string> = {}) {
    const stub = `docker() {
  case "$1 $*" in
    "container "*) [ -n "\${INSPECT_FAILS:-}" ] && { echo 'Error: No such container' >&2; return 1; }; printf '%s\\n' "$WORKER_ENV" ;;
    "exec "*"/nodejs/bin/node --version") printf '%s\\n' "$NODE_SAYS" ;;
    "exec "*"getuid"*) printf '%s' "$UID_SAYS" ;;
    "exec "*"3002/health"*) printf '%s\\n' "$HEALTH_SAYS"; return "$HEALTH_RC" ;;
    "exec "*" -c true") printf '%s\\n' "\${SHELL_SAYS//SHELL/$3}"; return "$SHELL_RC" ;;
    *) echo "unexpected docker call: $*" >&2; return 9 ;;
  esac
}
smoke_env_value() { [ "$1" = POSTGRES_USER ] && printf '%s' "\${OWNER:-}"; return 0; }`;
    return smokeRun(['worker_fit'], `${stub}\nworker_fit\n${SHOW_REASONS}`, {
      WORKER_CONTAINER: 'ownpace-managed-worker',
      API_NODE_VERSION: 'v26.1.0',
      WANT_NODE: 'v26.1.0',
      NODE_SAYS: 'v26.1.0',
      UID_SAYS: '65532',
      HEALTH_SAYS: 'HTTP 200',
      HEALTH_RC: '0',
      SHELL_SAYS: ABSENT,
      SHELL_RC: '127',
      WORKER_ENV: ENV,
      ...over,
    });
  }

  it('a worker built on the API\'s FROM lines, started as compose is to start it, is a pass', () => {
    const r = worker();
    expect(r.fail, r.out).toBe('0');
    expect(r.out).toContain('the worker: Node v26.1.0, the API\'s');
    expect(r.out).toContain('the worker: runs as uid 65532');
    expect(r.out).toContain('the worker: no shell (sh, /bin/sh, bash, /bin/bash, /busybox/sh)');
    expect(r.out).toContain('its health answers HTTP 200');
    expect(r.out).toContain("JOBS_DATABASE_URL is ownpace_jobs's, through pgbouncer:6432");
    // Roles and names only: a password never reaches the stream.
    expect(r.out).not.toContain('a-password');
    expect(r.out).not.toContain('another');
  });

  it.each([
    ['another Node', { NODE_SAYS: 'v24.0.0' }, "the worker's Node is not the API's"],
    ['a Node that cannot be asked', { NODE_SAYS: 'exec: "/nodejs/bin/node": no such file' }, "the worker's Node could not be asked"],
    ['root', { UID_SAYS: '0' }, 'the worker does not run as uid 65532'],
    ['a shell', { SHELL_SAYS: '', SHELL_RC: '0' }, "the worker's image has a shell"],
    ['a health of 503', { HEALTH_SAYS: 'HTTP 503', HEALTH_RC: '1' }, "the worker's health is not 200"],
    ['JOBS_DATABASE_URL the owner\'s', { WORKER_ENV: ENV.replace('ownpace_jobs:a-password', 'openmigrate:a-password') }, "the worker holds the owner's URL"],
    ['JOBS_DATABASE_URL straight to postgres', { WORKER_ENV: ENV.replace('pgbouncer:6432/openmigrate\nAPP', 'postgres:5432/openmigrate\nAPP') }, "the worker's JOBS_DATABASE_URL is not ownpace_jobs's through the pooler"],
    ['no JOBS_DATABASE_URL', { WORKER_ENV: ENV.split('\n').filter((l) => !l.startsWith('JOBS_')).join('\n') }, "the worker's JOBS_DATABASE_URL is not ownpace_jobs's through the pooler"],
    ["the owner's URL under another name", { WORKER_ENV: `${ENV}\nDATABASE_URL=postgresql://openmigrate:owner-pw@pgbouncer:6432/openmigrate` }, "the worker holds the owner's URL"],
    ['an environment that cannot be read', { INSPECT_FAILS: '1' }, "the worker's environment could not be read"],
  ])('%s is a failure, by name', (_what, over, reason) => {
    const r = worker(over as Record<string, string>);
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain(reason);
    expect(r.out).not.toContain('owner-pw');
  });

  it('a double-quoted POSTGRES_USER is read as Compose reads it, so the check does not pass on nothing', () => {
    const r = worker({ OWNER: '"openmigrate"', WORKER_ENV: `${ENV}\nDATABASE_URL=postgresql://openmigrate:x@pgbouncer:6432/openmigrate` });
    expect(r.fail).toBe('1');
    expect(r.reasons).toContain("the worker holds the owner's URL");
    expect(r.out).toContain('(openmigrate)');
  });

  it('a POSTGRES_USER of its own is the owner asked about', () => {
    const r = worker({ OWNER: 'ledger_owner', WORKER_ENV: `${ENV}\nDATABASE_URL=postgresql://ledger_owner:x@pgbouncer:6432/openmigrate` });
    expect(r.reasons).toContain("the worker holds the owner's URL");
    expect(r.out).toContain('DATABASE_URL');
  });
});

describe("on pg-boss, the worker's log from the start is kept beside the evidence, for the redaction", () => {
  it('is read with --since the start, into a file the collector globs, and not into the stream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'worker-log-'));
    try {
      const out = 'smoke-managed-42.log';
      const def = smoke.slice(smoke.indexOf('\nWORKER_LOG="'), smoke.indexOf('\n', smoke.indexOf('\nWORKER_LOG="') + 1));
      const r = spawnSync(
        'bash',
        [
          '-c',
          [
            'set -uo pipefail',
            `OUT='${out}'`,
            def,
            smokeFunction('keep_worker_log'),
            `docker() { printf '%s\\n' "$*" >calls; echo "[run-delta-sync ${'0'.repeat(8)}-0000-4000-8000-000000000000] secret-bearing line"; }`,
            'JOB_RUNNER=pg-boss SMOKE_STARTED_AT=2026-11-22T17:00:00Z WORKER_CONTAINER=ownpace-managed-worker',
            'keep_worker_log; echo "rc=$?"; keep_worker_log; echo "rc=$?"; echo "log=$WORKER_LOG"',
          ].join('\n'),
        ],
        { cwd: dir, encoding: 'utf8' },
      );
      expect(r.stdout).toContain('log=smoke-managed-42-worker.log');
      // The collector's glob, read from the workflow: the worker's log is in it.
      expect(workflow).toContain('for f in smoke-managed-*.log');
      expect('smoke-managed-42-worker.log').toMatch(/^smoke-managed-.*\.log$/);
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim()).toBe('logs --since 2026-11-22T17:00:00Z ownpace-managed-worker');
      expect(readFileSync(join(dir, 'smoke-managed-42-worker.log'), 'utf8')).toContain('secret-bearing line');
      expect(r.stdout, 'the log reached the stream').not.toContain('secret-bearing line');
      expect(r.stdout.match(/rc=0/g)).toHaveLength(2);
      expect(r.stdout.match(/the worker's log since/g), 'read twice').toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a log that cannot be read says so, and the jobs section fails on it', () => {
    const r = smokeRun(['keep_worker_log'], 'docker() { echo "Error: No such container: x" >&2; return 1; }\nJOB_RUNNER=pg-boss SMOKE_STARTED_AT=x WORKER_CONTAINER=x WORKER_LOG=/dev/null\nkeep_worker_log; echo "rc=$?"');
    expect(r.out).toContain('rc=1');
    expect(r.out).toContain("the worker's log could not be read");
    expect(smoke).toContain(`keep_worker_log || fail_at "the worker's log could not be read, so the evidence holds no account of the jobs"`);
  });

  it('does nothing on trigger, where the runner logs are the evidence', () => {
    const r = smokeRun(['keep_worker_log'], 'docker() { echo called; }\nJOB_RUNNER=trigger\nkeep_worker_log; echo "rc=$?"');
    expect(r.out.trim().split('\n')).toEqual(['rc=0', 'FAIL=0']);
  });

  it('every EXIT trap keeps it, so a run that stops early still does', () => {
    const traps = smoke.split('\n').filter((l) => /^\s*trap\s+.*\bEXIT\b/.test(l));
    expect(traps.length).toBeGreaterThanOrEqual(3);
    expect(traps.slice(1).every((t) => t.includes('keep_worker_log; end_stream'))).toBe(true);
  });
});

describe('on pg-boss, the tick that beat ran there', () => {
  it('asks for the beat only a pg-boss tick writes, and fails when it is stale', () => {
    const block = /^if \[ "\$JOB_RUNNER" = pg-boss \]; then\n {2}runner_beat=[\s\S]*?\nfi$/m.exec(smoke)?.[0];
    expect(block).toBeDefined();
    expect(block).toContain("task = 'managed-sync-tick-pg-boss'");
    const run = (answer: string) => verdict(block!, `JOB_RUNNER=pg-boss\nq() { echo '${answer}'; }`);
    expect(run('fresh')).toBe('0');
    expect(run('stale since 2026-11-22 16:00:00+00')).toBe('1');
    expect(run('')).toBe('1');
    expect(verdict(block!, "JOB_RUNNER=trigger\nq() { echo 'stale'; }")).toBe('0');
  });
});

describe("a pass that never ran points at the section that explains it, in each mode", () => {
  it('on pg-boss at the jobs and the worker\'s log, on Trigger.dev at the runner logs, as it always did', () => {
    expect(smoke).toContain('echo "sync ($label): the enqueue was accepted and never became a runner — see the runner-log section below."');
    expect(smoke).toMatch(/if \[ "\$JOB_RUNNER" = pg-boss \]; then\n\s+echo "sync \(\$label\): the enqueue was accepted and never ran — see the jobs on pg-boss/);
  });
});

describe("the stack's memory, sampled from the start in both runners, is read out and never judged", () => {
  /** What `docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}'` prints: the used part, then the limit. */
  const STATS = [
    'ownpace-managed-api\t212.4MiB / 7.627GiB',
    'ownpace-managed-worker\t96.25MiB / 512MiB',
    'ownpace-managed-db\t1.104GiB / 7.627GiB',
    'runner-cm9x\t180MiB / 7.627GiB',
    'ownpace-live-api\t300MiB / 7.627GiB',
  ].join('\n');
  const LIMITS = ['7.627GiB', '512MiB'];

  function readout(samples: string, runners = '', err = '') {
    const dir = mkdtempSync(join(tmpdir(), 'smoke-mem-'));
    try {
      const file = join(dir, 'mem');
      writeFileSync(file, samples);
      if (err) writeFileSync(`${file}.err`, err);
      return smokeRun(['memory_readout'], `memory_readout '${file}' "$RUNNERS"`, { RUNNERS: runners });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  /** The sampler's own cut, on the fixture, as it runs: this stack's names and the runners only. */
  function strip(stats: string, at: string) {
    const r = smokeRun(['mem_strip_limit'], `grep -E "^(\${COMPOSE_PROJECT}-|runner-)" <<<"$STATS" | mem_strip_limit '${at}'`, { STATS: stats, COMPOSE_PROJECT: 'ownpace-managed' });
    return r.out.replace(/FAIL=\d\n?$/, '');
  }

  it('keeps the used part of each line, never the limit after " / ", and no other stack', () => {
    const kept = strip(STATS, '2026-11-22T19:00:00Z');
    for (const limit of LIMITS) expect(kept, limit).not.toContain(limit);
    expect(kept).not.toContain('/');
    expect(kept).not.toContain('ownpace-live-api');
    expect(kept.trim().split('\n')).toEqual([
      '2026-11-22T19:00:00Z\townpace-managed-api\t212.4MiB',
      '2026-11-22T19:00:00Z\townpace-managed-worker\t96.25MiB',
      '2026-11-22T19:00:00Z\townpace-managed-db\t1.104GiB',
      '2026-11-22T19:00:00Z\trunner-cm9x\t180MiB',
    ]);
  });

  it("prints each container's highest and when, this stack's runs as one line, and the sum, with no limit in it", () => {
    const samples =
      strip(STATS, '2026-11-22T19:00:00Z') +
      strip(STATS.replace('212.4MiB', '250MiB').replace('runner-cm9x\t180MiB', 'runner-cm9x\t120MiB\nrunner-zz11\t20MiB'), '2026-11-22T19:00:15Z');
    const r = readout(samples, 'runner-cm9x\nrunner-zz11');
    expect(r.fail).toBe('0');
    const lines = r.out.split('\n').filter((l) => l.startsWith('memory:'));
    expect(lines).toEqual([
      `memory: ${'ownpace-managed-api'.padEnd(40)} highest ${'250.0 MiB'.padStart(12)} at 2026-11-22T19:00:15Z`,
      `memory: ${'ownpace-managed-db'.padEnd(40)} highest ${'1130.5 MiB'.padStart(12)} at 2026-11-22T19:00:00Z`,
      `memory: ${'ownpace-managed-worker'.padEnd(40)} highest ${'96.2 MiB'.padStart(12)} at 2026-11-22T19:00:00Z`,
      `memory: ${'Trigger.dev runs'.padEnd(40)} highest ${'200.0 MiB'.padStart(12)}, the sum of 2 run(s)' highest`,
      'memory: the sum of the highest values: 1676.7 MiB',
    ]);
    for (const limit of LIMITS) expect(r.out, limit).not.toContain(limit);
  });

  it("leaves out a runner this stack did not start, and a pg-boss stack names no runs", () => {
    const r = readout(strip(STATS, '2026-11-22T19:00:00Z'));
    expect(r.out).not.toContain('Trigger.dev runs');
    expect(r.out).not.toContain('runner-cm9x');
    expect(r.out).toContain('memory: the sum of the highest values: 1439.1 MiB');
  });

  it('a sampler that failed says so in one line, and the verdict is not touched', () => {
    const cases: Array<[string, string]> = [['', ''], ['', 'Cannot connect to the Docker daemon'], ['x\ty\t1MiB\n', 'permission denied']];
    for (const [samples, err] of cases) {
      const r = readout(samples, '', err);
      expect(r.fail).toBe('0');
      const said = r.out.split('\n').filter((l) => l.startsWith('memory:'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('the sampler read nothing');
    }
  });

  it('runs from the start in both modes, ends in every trap, and is read before the verdict without a fail_at', () => {
    const sampler = smoke.indexOf("if stats=\"$(docker stats --no-stream --format '{{.Name}}{{\"\\t\"}}{{.MemUsage}}' 2>&1)\"; then");
    expect(sampler).toBeGreaterThan(0);
    expect(sampler).toBeLessThan(smoke.indexOf('note "preflights"'));
    // Not inside a mode: the line before the sampler's subshell is no `if [ "$JOB_RUNNER"`.
    const start = smoke.lastIndexOf('\n(\n', sampler);
    expect(smoke.slice(smoke.lastIndexOf('\nMEM_PID=""', start), start)).not.toContain('JOB_RUNNER');
    expect(smoke.slice(start, sampler)).toContain('while kill -0 $$ 2>/dev/null; do');
    expect(smoke.slice(sampler, smoke.indexOf('\nMEM_PID=$!', sampler))).toContain('| mem_strip_limit "$now" >>"$MEM_FILE"');
    const traps = smoke.slice(sampler).split('\n').filter((l) => /^\s*trap\s+.*\bEXIT\b/.test(l));
    expect(traps).toHaveLength(3);
    for (const trap of traps) expect(trap).toContain('kill "$MEM_PID" 2>/dev/null || true');
    const read = smoke.indexOf('\nmemory_readout "$MEM_FILE"');
    expect(read).toBeGreaterThan(smoke.indexOf('\npgboss_jobs\n'));
    expect(read).toBeLessThan(smoke.indexOf('note "verdict"'));
    expect(smokeFunction('memory_readout')).not.toContain('fail_at');
  });
});
