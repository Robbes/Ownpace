// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT CALLED `items`, AND A GATE THAT TOOK IT FOR A FOURTH LEVEL.
 *
 * E2E (managed) #216 went red on main (74b70906) with:
 *
 *   the migration screen's shape: top-level keys='domains,migration', item-level names=1
 *
 * The operator's screen for one migration (`GET /api/support/migrations/:id`,
 * level 3) carries each data type's `last_pass_metrics`. Since #1335 (0150 T1)
 * a pass that completes writes its measurements there, and `PassMetrics` has
 * always had `items`: how many items the pass handled, a number. The gate's
 * shape check looked for a key NAMED `items` anywhere in the answer, and found
 * one.
 *
 * ## Why this is a gate defect and not a product one
 *
 * Level 3 is the last level because a screen that lists items shows subject
 * lines (0110). A count shows none: durations and counts are what §17 allows
 * on that row, and a number cannot hold a subject, an href or a hash. What a
 * fourth level would have to add is a key holding something that is not a
 * number: a list, an object, a string. So the check now looks for the names
 * where they hold anything but a number, and says which names it found.
 *
 * The program is lifted out of `smoke-managed.sh` exactly as it runs, and run
 * on the answer #216 got and on the answers a fourth level would give.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../deploy/compose/smoke-managed.sh', import.meta.url)),
  'utf8',
);

/** A `jq -r '…'` program assigned to `name`, lifted out of the gate. */
function program(name: string): string {
  const m = new RegExp(`${name}="\\$\\(jq -r '([^']+)'`).exec(source);
  expect(m, `${name}'s jq program was not found in smoke-managed.sh`).not.toBeNull();
  return m![1]!;
}

function run(name: string, body: unknown): string {
  return execFileSync('jq', ['-r', program(name)], {
    input: JSON.stringify(body),
    encoding: 'utf8',
  }).trim();
}

/** What level 3 answered in #216: one data type, its last pass measured. */
const migration = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  mapping_id: '22222222-2222-2222-2222-222222222222',
  name: 'Acme Families — mail',
  lifecycle: 'ACTIVE',
  mode: 'sync',
  pattern: 'one-to-one',
  schedule: null,
  pending_decision_count: 0,
};
const measured = {
  domain: 'mail',
  state: 'COMPLETED',
  last_error_category: null,
  failed_side: null,
  last_pass_metrics: {
    items: 3,
    wallMs: 1840,
    sourceFetchMs: 410,
    targetWriteMs: 620,
    ledgerMs: 90,
    hashMs: 4,
    overlap: 0.4,
    listCollectionsMs: 120,
    collectionSetupMs: 200,
    collectionListingMs: 310,
    collectionsOpened: 2,
    firstWriteAfterMs: 700,
  },
};
const answer216 = { migration, domains: [measured] };

describe('the fourth-level check on the migration screen', () => {
  it('lets through a count called items, the answer #216 got', () => {
    // THE HEADLINE. Red on 74b70906's gate: item-level names=1.
    expect(run('l4_named', answer216)).toBe('0');
    expect(run('l4_found', answer216)).toBe('');
  });

  it('lets through the answer before any pass was measured', () => {
    const unmeasured = { migration, domains: [{ ...measured, last_pass_metrics: null }] };
    expect(run('l4_named', unmeasured)).toBe('0');
  });

  it('fails a list of items, at the top or under a data type', () => {
    const atTop = { ...answer216, items: [{ id: 'x' }] };
    expect(run('l4_named', atTop)).toBe('1');
    expect(run('l4_found', atTop)).toBe('items');
    const underDomain = { migration, domains: [{ ...measured, items: [] }] };
    expect(run('l4_named', underDomain)).toBe('1');
  });

  it('fails a subject, an href or a hash, as the strings they are', () => {
    const leaking = {
      migration,
      domains: [{ ...measured, last: { subject: 'Re: the lawyer', href: '/remote.php/x', natural_key_hash: 'ab12cd34' } }],
    };
    expect(run('l4_named', leaking)).toBe('3');
    expect(run('l4_found', leaking)).toBe('href,natural_key_hash,subject');
  });

  it('fails a collection that holds its name, and a key that holds nothing', () => {
    const named = { migration, domains: [{ ...measured, collection: { name: 'Inbox' } }] };
    expect(run('l4_named', named)).toBe('1');
    const empty = { migration, domains: [{ ...measured, source_ref: null }] };
    expect(run('l4_found', empty)).toBe('source_ref');
  });

  it('counts and names with one program, so the two cannot drift apart', () => {
    const counted = program('l4_named').replace(/\|\s*length$/, '');
    const named = program('l4_found').replace(/\|\s*join\(","\)$/, '');
    expect(counted).not.toBe(program('l4_named'));
    expect(named).not.toBe(program('l4_found'));
    expect(named).toBe(counted);
  });

  it('says which names it found when it fails', () => {
    // #216's verdict said "item-level names=1" and not which: finding `items`
    // took reading the API, the view and PassMetrics.
    const start = source.indexOf('l4_top="$(');
    expect(start, 'the shape check was not found in smoke-managed.sh').toBeGreaterThan(0);
    const block = source.slice(start, start + 2500);
    expect(block).toMatch(/item-level names=\$\{l4_named\} \(\$\{l4_found:-none\}\)/);
  });
});
