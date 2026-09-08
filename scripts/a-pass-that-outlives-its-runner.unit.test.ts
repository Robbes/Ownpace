// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS MUST STOP ITSELF BEFORE ITS RUNNER STOPS IT (2026-09-08).
 *
 * The managed pass runs as a Trigger.dev task under `maxDuration`. That
 * ceiling is a KILL: the process ends where it stands, mid-item, and none of
 * the code that closes the run row runs. `managed-sync-tick` skips a mapping
 * that has an open `running` row, so the mapping then stops syncing — silently,
 * and until somebody notices by hand.
 *
 * `PASS_SOFT_DEADLINE_MS` exists so the pass ends itself first, cleanly, with
 * its cursors intact. That only works while it is genuinely SMALLER than the
 * kill, and the two numbers live in different files, in different units, and
 * cannot import each other: `trigger.config.ts` is loaded a second time inside
 * the build's indexer container, where a workspace import has already cost
 * this repository one aborted deploy.
 *
 * Two numbers that must agree, in two files, with no compiler between them, is
 * exactly the shape a guard is for. This one reads both as text.
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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = 'apps/worker/trigger.config.ts';
const DEADLINE = 'packages/shared/src/pass-deadline.ts';

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** `maxDuration: 3600` — the runner's kill, in SECONDS. */
function maxDurationSeconds(): number {
  const found = /^\s*maxDuration:\s*(\d+)\s*,/m.exec(read(CONFIG));
  if (!found) {
    throw new Error(
      `${CONFIG} no longer declares \`maxDuration: <seconds>\` on its own line. ` +
        'This guard reads it as text, so it must stay one — or this guard must change.',
    );
  }
  return Number(found[1]);
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
  it('states the runner ceiling in both files, in agreement', () => {
    // Written in seconds in the config and milliseconds in the constant, so
    // the conversion is the thing that can silently rot.
    expect(constantMs('PASS_HARD_LIMIT_MS')).toBe(maxDurationSeconds() * 1000);
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

  it('reads a real number from the config rather than passing on absence', () => {
    // The vacuity floor. If the regex ever stops matching, every assertion
    // above would throw rather than pass — but a `maxDuration: 0` would pass
    // them all while meaning the ceiling is gone.
    expect(maxDurationSeconds()).toBeGreaterThan(0);
  });
});
