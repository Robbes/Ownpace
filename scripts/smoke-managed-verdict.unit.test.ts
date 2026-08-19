// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What `smoke-managed.sh` is allowed to call a pass.
 *
 * This gate's first green run (e2e-managed #6, 2026-08-18) printed these three
 * lines within four lines of each other:
 *
 *     no eligible item (status='copied' with a target_ref) — apply half SKIPPED.
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
import { readFileSync } from 'node:fs';
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
    expect(smoke).toContain("status='copied' with a target_ref");
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
      'open-migrate-api healthy',
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
  function diagnose(total: string, copied: string, breakdown = '') {
    const q = `q() { case "$1" in
      *"count(*) FROM item"*"status='copied'"*) echo "${copied}" ;;
      *"count(*) FROM item"*) echo "${total}" ;;
      *) printf '%s' "${breakdown}" ;;
    esac; }`;
    return execFileSync(
      'bash',
      ['-c', `set -u\nAPPLY_TENANT=t\nAPPLY_MAPPING=m\nDB_CONTAINER=db\n${q}\n${block}`],
      { encoding: 'utf8' },
    );
  }

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
    expect(out).toContain("NONE is 'copied'");
    expect(out).toContain('product fault');
    // Points at the run log, because that is where a stalled copy explains itself.
    expect(out).toContain('run_event');
    expect(out).not.toContain('seed-demo-dav-content.sh');
  });

  it('copied without a target id is called a ledger-write bug', () => {
    const out = diagnose('6', '6', 'calendar|copied|6|0');
    expect(out).toContain('none carries a target_ref id');
    expect(out).toContain("bug in the sync's ledger write");
    expect(out).not.toContain('seed-demo-dav-content.sh');
  });

  it('always prints the actual breakdown, whichever state it is', () => {
    expect(diagnose('6', '0', 'calendar|pending|6|0')).toContain('calendar|pending|6|0');
    expect(diagnose('0', '0')).toContain('(total 0, copied 0)');
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
    expect(block).toContain("coalesce(target_ref->>'id','') <> ''");
    expect(block).toContain('SEEDING FAILED');
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
