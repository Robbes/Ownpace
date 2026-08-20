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

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = join(REPO_ROOT, 'deploy/compose/smoke-managed.sh');
const WORKFLOW = join(REPO_ROOT, '.github/workflows/e2e-managed.yml');

const smoke = readFileSync(SMOKE, 'utf8');
const workflow = readFileSync(WORKFLOW, 'utf8');

/** Run a fragment of the real script under bash and report the resulting $fail. */
function verdict(fragment: string, setup: string): string {
  const out = execFileSync('bash', ['-c', `fail=0\n${setup}\n${fragment}\necho "FAIL=$fail"`], {
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
    expect(block).toContain('fail=1');
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
    expect(smoke).toMatch(/exec > >\(tee "\$OUT"\)/);
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
    expect(smoke).toMatch(/ELIGIBLE="status IN \('copied','updated'\) AND coalesce\(target_ref->>'id',''\) <> ''"/);
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
    /if docker exec "\$API_CONTAINER" node -e \\\n[\s\S]*?\nfi/,
  )?.[0];
  const tls = smoke.match(/TLS_PORT="\$\{TRIGGER_TLS_PORT[\s\S]*?\nfi/)?.[0];

  it('both blocks are extractable — there is something to test', () => {
    expect(minio, 'the minio assertion is gone from smoke-managed.sh').toBeDefined();
    expect(tls, 'the trigger-tls assertion is gone from smoke-managed.sh').toBeDefined();
  });

  it('each SETS FAIL rather than merely remarking on it', () => {
    // The 0084 lesson in one line: run #6 went green with half the gate
    // unasserted because the diagnosis was an echo.
    expect(minio).toContain('fail=1');
    expect(tls).toContain('fail=1');
  });

  it('minio unreachable fails the smoke', () => {
    expect(verdict(minio!, 'API_CONTAINER=x\ndocker() { return 1; }')).toBe('1');
  });

  it('minio answering leaves the smoke alone', () => {
    expect(verdict(minio!, 'API_CONTAINER=x\ndocker() { return 0; }')).toBe('0');
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
  function diagnose(total: string, eligible: string, breakdown = '', spent = '0', fixture = '') {
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
    const q = `q() { case "$1" in
      *"count(*) FROM item"*"status='tombstoned'"*) echo "${spent}" ;;
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
    .find((l) => l.startsWith('if [ -z "$HASH" ] && [ "${SMOKE_PREPARE_APPLY'));

  it('is OFF unless asked for — by hand this stays an acceptance test', () => {
    // Manufacturing its own fixture by default would be the same class of lie
    // as the skip that used to pass: the script would stop reporting the state
    // of the stack and start reporting the state it arranged.
    expect(guard).toBeDefined();
    expect(guard).toContain('"${SMOKE_PREPARE_APPLY:-0}" = "1"');
  });

  it('only runs when there is nothing to act on', () => {
    // An eligible item that already exists is the real thing; seeding over it
    // would replace a genuine precondition with a manufactured one.
    expect(guard).toContain('[ -z "$HASH" ]');
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
    expect(smoke).toMatch(/FIXTURE_RE=.*openmig-demo-\(event\|contact\|file\)/);
    expect(smoke).toContain('!~');
    expect(smoke).toMatch(/REFUS|refuses to spend|now REFUSES/i);
  });

  it('the workflow turns it on, and nothing else does', () => {
    expect(workflow).toContain('SMOKE_PREPARE_APPLY: 1');
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
  // true, and worth nothing. It has never fired on the Spark only because that
  // box happens to hold three messages somebody put there by hand; nothing in
  // this repo seeds them.
  const block = smoke.match(/^VERIFIED_ITEMS="\$\(json_number[\s\S]*?\nfi$/m)?.[0];

  function verdict(setup: string) {
    const helper = `json_number() { printf '%s' "$1" | grep -o "\\"$2\\":[0-9]*" | head -1 | cut -d: -f2; }`;
    const out = execFileSync(
      'bash',
      ['-c', `fail=0\n${helper}\n${setup}\n${block}\necho "FAIL=$fail"`],
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
    const out = execFileSync('bash', ['-c', `fail=0\n${setup}\n${block}\necho "FAIL=$fail"`], {
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
    expect(verdict(skipped('calendar'), ['mail'])).toBe('0');
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
  const proxy = smoke.match(
    /^if docker exec "\$API_CONTAINER" node -e \\\n\s*"fetch\('http:\/\/trigger-docker-proxy[\s\S]*?\nfi$/m,
  )?.[0];

  /** Run an extracted block with `curl`/`docker` stubbed onto PATH. */
  function verdict(block: string, stubs: Record<string, string>, setup = '') {
    const dir = mkdtempSync(join(tmpdir(), 'smokesvc-'));
    mkdirSync(join(dir, 'bin'));
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(dir, 'bin', name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(dir, 'bin', name), 0o755);
    }
    try {
      const out = execFileSync('bash', ['-c', `fail=0\n${setup}\n${block}\necho "FAIL=$fail"`], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
      });
      return out.trim().split('\n').pop()!.replace('FAIL=', '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('both blocks are extractable — they still exist to test', () => {
    expect(registry).toBeDefined();
    expect(proxy).toBeDefined();
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

  it('the docker proxy answering nothing is a failure', () => {
    // This is workplan 0018's entire failure mode: the supervisor creates every
    // runner container through this proxy, so when it is down an enqueue never
    // becomes a runner — invisible in a green CI.
    expect(verdict(proxy!, { docker: 'exit 1' }, 'API_CONTAINER=stub')).toBe('1');
  });

  it('the docker proxy answering is a pass', () => {
    expect(verdict(proxy!, { docker: 'exit 0' }, 'API_CONTAINER=stub')).toBe('0');
  });

  it('asserts rather than probes, and says why', () => {
    // The temptation is to "just add a healthcheck". A compose probe runs
    // INSIDE the image and under `up -d --wait` one naming a missing binary
    // does not misreport — it fails the bring-up and takes the gate with it.
    // Nothing here has ever executed a command inside either image.
    expect(smoke).toMatch(/has ever executed a command inside/);
    expect(smoke).toContain('`registry:2` or `tecnativa/docker-socket-proxy`');
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
