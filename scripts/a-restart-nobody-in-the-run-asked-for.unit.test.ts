// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RESTART NOBODY IN THE RUN ASKED FOR, AND A VERDICT THAT BLAMED WHICHEVER
 * CHECK WAS RUNNING (E2E (managed) #195, 2026-09-23).
 *
 * The managed gate runs on the long-lived stack on the Spark, and GitHub
 * starts the nightly hours late, in the owner's working morning. On #195 the
 * API container was recreated mid-run by something outside the run, most
 * likely a deploy on the same box. The section that happened to be running
 * answered 000, and the verdict blamed the progress link, which was never
 * broken.
 *
 * The smoke now notes when the API container started, before its first
 * section, and asks again at the verdict. These run the smoke's own functions,
 * extracted from the script, against a fake `docker`, so what is proved is the
 * code that runs on the Spark, not a copy of it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SMOKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose', 'smoke-managed.sh');
const script = readFileSync(SMOKE, 'utf8');

/** A function the smoke defines, exactly as written there. */
function defined(name: string): string {
  const oneLine = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(script);
  if (oneLine) return oneLine[0];
  const block = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm').exec(script);
  if (!block) throw new Error(`smoke-managed.sh no longer defines ${name}()`);
  return block[0];
}

/**
 * Run the smoke's start-and-verdict pair with `docker inspect` answering
 * `first`, then `second`. A counter file, because each answer is read in a
 * subshell that cannot hand a variable back.
 */
function runWith(first: string, second: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-restart-'));
  try {
    const program = [
      'set -u',
      'fail=0',
      'SECTION="verdict"',
      'FAIL_REASONS=""',
      'API_CONTAINER="ownpace-api"',
      `COUNT="${join(dir, 'count')}"`,
      'echo 0 > "$COUNT"',
      `docker() { n=$(cat "$COUNT"); echo $((n + 1)) > "$COUNT"; if [ "$n" = 0 ]; then echo '${first}'; else echo '${second}'; fi; }`,
      defined('fail_at'),
      defined('api_started_at'),
      defined('api_restart_check'),
      'API_STARTED_AT="$(api_started_at)"',
      'api_restart_check "$API_STARTED_AT"',
      'echo "fail=$fail"',
      'printf "%s" "$FAIL_REASONS"',
    ].join('\n');
    const file = join(dir, 'run.sh');
    writeFileSync(file, program);
    return execFileSync('bash', [file], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a restart under the run is the run’s failure, said as one', () => {
  it('fails the run and names both start times when the API restarted', () => {
    const out = runWith('2026-09-23T08:51:18Z', '2026-09-23T08:56:36Z');
    expect(out).toContain('fail=1');
    expect(out).toContain(
      'the API container restarted under the run (started 2026-09-23T08:51:18Z, then 2026-09-23T08:56:36Z)',
    );
    expect(out, 'and it says what did it, rather than blaming a check').toMatch(
      /something outside the run did \(a deploy\n?.*on this box, most often\) or it crashed/,
    );
  });

  it('says nothing when the same API served the whole run', () => {
    const out = runWith('2026-09-23T08:51:18Z', '2026-09-23T08:51:18Z');
    expect(out.trim()).toBe('fail=0');
  });
});

describe('where the smoke asks', () => {
  /** The script without comment lines, so a sentence about a call is not a call. */
  const code = script
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it('notes the start before its first section, so the whole run is covered', () => {
    const noted = code.indexOf('API_STARTED_AT="$(api_started_at)"');
    const firstSection = code.search(/^note "/m);
    expect(noted, 'the start is never noted').toBeGreaterThan(-1);
    expect(noted, 'the start is noted after a section has already run').toBeLessThan(firstSection);
  });

  it('asks again at the verdict, before the verdict is printed', () => {
    const verdict = code.indexOf('note "verdict"');
    const asked = code.indexOf('api_restart_check "$API_STARTED_AT"');
    const printed = code.indexOf('echo "verify: $VERIFY_RESULT');
    expect(asked, 'the verdict never asks').toBeGreaterThan(verdict);
    expect(asked, 'the verdict is printed before it asks').toBeLessThan(printed);
  });
});
