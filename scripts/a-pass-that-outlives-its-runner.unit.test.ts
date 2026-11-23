// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS MUST STOP ITSELF BEFORE ITS RUNNER STOPS IT (2026-09-08).
 *
 * The managed pass runs under a time limit that is a KILL: the process ends
 * where it stands, mid-item, and none of the code that closes the run row
 * runs. `managed-sync-tick` skips a mapping that has an open `running` row,
 * so the mapping then stops syncing — silently, and until somebody notices by
 * hand.
 *
 * `PASS_SOFT_DEADLINE_MS` exists so the pass ends itself first, cleanly, with
 * its cursors intact. That only works while it is genuinely SMALLER than the
 * kill, and the two numbers live in different places, in different units.
 *
 * ## Whose kill
 *
 * Until alpha.18 the kill was Trigger.dev's `maxDuration` in
 * `apps/worker/trigger.config.ts`, and the pg-boss runner's queues were held
 * to it too (workplan 0167 T6). alpha.18 removed Trigger.dev (0167 T9), so the
 * kill is the pass's queue's time limit in the job catalog alone
 * (`packages/scheduler/src/pg-boss/catalog.ts`, `maxDurationSeconds`,
 * pg-boss's `expireInSeconds`), in seconds. The catalog is data with no
 * import, so it is imported here; `pass-deadline.ts` is read as text.
 *
 * ## What it does NOT check
 *
 * That the margin is big enough for the slowest single item on the slowest
 * target. Nobody has measured that yet — it is stated as an open question in
 * `pass-deadline.ts` rather than pretended here. This guard holds the ordering
 * and a floor under the margin; the size of the margin stays a judgement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOG } from '../packages/scheduler/src/pg-boss/catalog.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEADLINE = 'packages/shared/src/pass-deadline.ts';

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** The pass's queue's time limit in the job catalog: the runner's kill, in SECONDS. */
function passLimitSeconds(): number {
  const pass = JOB_CATALOG.find((queue) => queue.name === 'run-delta-sync');
  if (!pass) throw new Error('the job catalog has no queue for run-delta-sync');
  return pass.maxDurationSeconds;
}

/** A `export const NAME = <expression>;` evaluated as arithmetic on literals. */
function constantMs(name: string): number {
  const found = new RegExp(`export const ${name} = ([^;]+);`).exec(read(DEADLINE));
  if (!found) {
    throw new Error(`${DEADLINE} no longer exports ${name} as a const with a literal value.`);
  }
  const expression = found[1]!.replace(/_/g, '').trim();
  if (!/^[\d\s*+]+$/.test(expression)) {
    throw new Error(
      `${name} is ${expression}, which this guard cannot evaluate — it reads the file as text ` +
        'and only understands products and sums of literals. Keep it literal, or change this guard.',
    );
  }
  // Only digits, whitespace, `*` and `+` reach here, checked directly above.
  return Number(new Function(`return ${expression}`)());
}

describe('the pass deadline and the runner ceiling', () => {
  it("states the runner ceiling in the constant and on the pass's queue, in agreement", () => {
    // Written in seconds in the catalog and milliseconds in the constant, so
    // the conversion is the thing that can silently rot.
    expect(constantMs('PASS_HARD_LIMIT_MS')).toBe(passLimitSeconds() * 1000);
  });

  it('stops the pass before the runner kills it', () => {
    // The ordering, which is the whole point: at or above the ceiling, the
    // pass never stops itself and the defect is back exactly as it was.
    expect(constantMs('PASS_SOFT_DEADLINE_MS')).toBeLessThan(constantMs('PASS_HARD_LIMIT_MS'));
  });

  it('leaves at least five minutes to finish the item in flight and close the books', () => {
    // A floor, not the right answer. When the deadline lands the item already
    // in flight still finishes; then the cursor decision, the ledger writes,
    // the domain status row and the run row all have to land, and the runner
    // has to tear down. A margin of seconds would technically satisfy the
    // ordering above and still be killed mid-close.
    const margin = constantMs('PASS_HARD_LIMIT_MS') - constantMs('PASS_SOFT_DEADLINE_MS');
    expect(margin).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it("gives every queue the pass's hour, the cutover by name excepted", () => {
    expect(JOB_CATALOG.length).toBeGreaterThan(0);
    expect(JOB_CATALOG.filter((queue) => queue.maxDurationSeconds !== passLimitSeconds()).map((queue) => queue.name)).toEqual([
      // A cutover waits for a pass running ahead of it and for its own, then runs the gate.
      // pg-boss's limit is the wall clock, so it has an hour for each (0167 T6).
      'run-cutover',
    ]);
    const cutover = JOB_CATALOG.find((queue) => queue.name === 'run-cutover')!;
    expect(cutover.maxDurationSeconds).toBe(3 * passLimitSeconds());
  });

  it('reads a real number from the catalog rather than passing on absence', () => {
    // The vacuity floor: a limit of 0 would pass the ordering while meaning
    // the ceiling is gone.
    expect(passLimitSeconds()).toBeGreaterThan(0);
  });
});
