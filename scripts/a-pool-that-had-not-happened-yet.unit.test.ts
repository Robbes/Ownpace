// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A POOL THAT HAD NOT HAPPENED YET.
 *
 * E2E (managed) run #79 failed with:
 *
 *   pgbouncer|pgbouncer|1|0|0|0|0|0|0|0|0|0|0|0|0|statement|
 *   ::error::PgBouncer is not in transaction mode. managed.yml sets
 *   pool_mode=transaction.
 *
 * PgBouncer was not the problem. `SHOW POOLS` ALWAYS lists the admin
 * pseudo-database `pgbouncer`, whose pool_mode is `statement` and always will
 * be. The check grepped the whole output for the word "transaction", so what it
 * actually measured was "has any client connected yet" — and what it REPORTED
 * was a sentence about the pooler's configuration.
 *
 * The api had been up for two seconds. No application pool existed. The gate
 * sent the reader to `pgbouncer.ini`, which says `pool_mode = transaction` on
 * line 58 and is mounted read-only — a file that was already correct.
 *
 * A TRUE STATEMENT ABOUT THE WRONG THING is the failure mode hard rule 10 is
 * about, and it is expensive precisely because it is true: nothing in the
 * message looks wrong, so the reader spends their time where the message points.
 *
 * THREE OUTCOMES, THREE MESSAGES. "The app never opened a pooled connection",
 * "the app's pool is in the wrong mode" and "everything is fine" have three
 * different remedies, and the first two were one message before.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(REPO_ROOT, '.github/workflows/e2e-managed.yml');

/** The step's script, comments stripped — a rule must not read its own prose. */
function poolerStep(): string {
  const src = readFileSync(WORKFLOW, 'utf8');
  const from = src.indexOf('The app talks through PgBouncer');
  const to = src.indexOf('A BACKUP NOBODY HAS RESTORED');
  expect(from, 'the PgBouncer step moved or was renamed').toBeGreaterThan(-1);
  expect(to, 'the anchor after it moved').toBeGreaterThan(from);
  return src
    .slice(from, to)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

const s_step = poolerStep;

describe('the pooler check judges the pool it is about', () => {
  it('selects the application database, not whatever SHOW POOLS lists', () => {
    expect(
      poolerStep(),
      'The check greps the whole SHOW POOLS output. That output always contains\n' +
        'the admin pseudo-database `pgbouncer`, whose mode is `statement`, so the\n' +
        'result is a fact about traffic dressed as a fact about configuration.',
    ).toMatch(/awk -F'\|' -v db="\$app_db" '\$1==db'/);
    // And the value judged must COME from that selection. Asserting the awk
    // merely exists let a break that bypassed it pass: the helper still
    // contained the line, nothing used it. A rule that checks a definition
    // rather than its use is satisfied by dead code.
    expect(s_step(), 'row is not taken from the filtered app pool').toMatch(
      /row="\$\(app_pool\)"/,
    );
  });

  it('does not read the mode with ${row##*|}, which the trailing separator empties', () => {
    // Measured, not reasoned about: the rows in run #79 end with a separator,
    // so the naive form yields "" and the refusal reads "is in '' mode" — a
    // gate failing a correct stack while saying nothing.
    expect(poolerStep()).not.toMatch(/\$\{row##\*\|\}/);
    expect(poolerStep()).toMatch(/for \(i = NF; i >= 1; i--\)/);
  });

  it('keeps "no pool" and "wrong mode" as separate refusals', () => {
    const step = poolerStep();
    expect(step, 'nothing distinguishes an absent pool').toMatch(/No pool for/);
    expect(step, 'nothing reports the mode it actually found').toMatch(/is in '\$\{mode\}' mode/);
  });

  it('makes a connection happen rather than waiting and hoping', () => {
    // If no pool exists, ask the API for a database-backed read. Then an absent
    // pool means the app is not using the pooler — which is what this step is
    // for — instead of meaning the test was early.
    expect(poolerStep()).toMatch(/\/ready/);
  });
});

describe('the extraction itself, run rather than asserted', () => {
  /** Exactly the two lines the workflow uses, over a real SHOW POOLS body. */
  function verdict(pools: string, db: string): string {
    const script = `
      row="$(awk -F'|' -v db="${db}" '$1==db' <<<"$POOLS")"
      [ -n "$row" ] || { echo "no-pool"; exit 0; }
      mode="$(awk -F'|' '{for (i = NF; i >= 1; i--) if ($i != "") { print $i; exit }}' <<<"$row")"
      [ "$mode" = "transaction" ] && echo "ok" || echo "wrong-mode:$mode"
    `;
    return execFileSync('bash', ['-c', script], {
      env: { ...process.env, POOLS: pools },
      encoding: 'utf8',
    }).trim();
  }

  const ADMIN = 'pgbouncer|pgbouncer|1|0|0|0|0|0|0|0|0|0|0|0|0|statement|';
  const APP_OK = 'openmigrate|openmigrate|1|0|0|0|1|0|0|1|0|0|0|0|0|transaction|';
  const APP_BAD = 'openmigrate|openmigrate|1|0|0|0|1|0|0|1|0|0|0|0|0|statement|';

  it('passes when the app pool is in transaction mode', () => {
    expect(verdict(`${ADMIN}\n${APP_OK}`, 'openmigrate')).toBe('ok');
  });

  it('is not fooled by the admin pool alone — run #79 exactly', () => {
    expect(verdict(ADMIN, 'openmigrate')).toBe('no-pool');
  });

  it('names the mode it found when the app pool really is wrong', () => {
    expect(verdict(`${ADMIN}\n${APP_BAD}`, 'openmigrate')).toBe('wrong-mode:statement');
  });
});
