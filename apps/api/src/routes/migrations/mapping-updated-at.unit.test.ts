// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every write to `mailbox_mapping` stamps `updated_at` (workplan 0109 T1).
 *
 * WHY THIS IS A SOURCE-LEVEL GUARD AND NOT A BEHAVIOUR TEST. The bug it
 * exists for is an OMISSION, and an omission has no behaviour to assert
 * against: a route that forgets `updatedAt` returns exactly what a route that
 * remembers it returns. Nothing fails, nothing logs, no test that was not
 * written specifically for this notices. The only place the mistake is visible
 * is the shape of the call, so that is what is checked.
 *
 * WHAT IT COST TO NOT HAVE THIS. Until 2026-08-27 the column was stamped by
 * two of five writers, which is worse than none: it looked maintained. The
 * PATCH route — how a mapping reaches `paused`, `cutover` AND `done`, three of
 * the four lifecycle transitions — never stamped it, nor did the finish route,
 * so "when did this migration end" was unanswerable from any table. 0109 T1
 * found the finish route; reading the rest found the other two.
 *
 * There is no database trigger to fall back on. Every ledger migration was
 * checked: nothing sets `updated_at` on write, so a writer that omits it
 * leaves the column reading whenever somebody last touched the row for an
 * unrelated reason.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = import.meta.dirname;
const REPO_ROOT = join(ROUTES_DIR, '../../../../..');

/** Every file that could write the table — the routes plus the grant ending. */
const CANDIDATES = readdirSync(ROUTES_DIR).filter(
  (f) => f.endsWith('.ts') && !f.includes('.test.'),
);

/**
 * The `.set({...})` that follows an `.update(schema.mailboxMapping)`.
 *
 * Deliberately crude: it takes the text from the update call to the end of the
 * balanced `.set(` argument. A parser would be more correct and would also be
 * a second thing to maintain; this reads the same shape a reviewer reads.
 */
function setClausesFor(source: string): string[] {
  const clauses: string[] = [];
  const marker = '.update(schema.mailboxMapping)';
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) break;
    from = at + marker.length;
    const setAt = source.indexOf('.set(', from);
    if (setAt === -1) continue;
    // Walk to the matching close paren so a nested object cannot end it early.
    let depth = 0;
    let i = setAt + '.set'.length;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    clauses.push(source.slice(setAt, i + 1));
  }
  return clauses;
}

describe('every write to mailbox_mapping stamps updated_at', () => {
  const files = CANDIDATES.map((f) => ({
    name: f,
    source: readFileSync(join(ROUTES_DIR, f), 'utf-8'),
  })).filter((f) => f.source.includes('.update(schema.mailboxMapping)'));

  it('finds the writers at all — an empty sweep would pass vacuously', () => {
    // The failure mode of every source-reading guard: the file moves, the
    // sweep matches nothing, and green means "not checked" rather than "fine".
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce((n, f) => n + setClausesFor(f.source).length, 0);
    expect(total, 'writers of mailbox_mapping found in this directory').toBeGreaterThanOrEqual(3);
  });

  it.each(files.map((f) => f.name))('%s stamps updatedAt on every update', (name) => {
    const source = files.find((f) => f.name === name)!.source;
    for (const clause of setClausesFor(source)) {
      expect(
        clause,
        `a write to mailbox_mapping in ${name} does not set updatedAt. The column has no ` +
          'database trigger, so an omitted stamp leaves it reading whenever the row was last ' +
          'touched for some other reason — which is how "when did this migration end" became ' +
          'unanswerable (0109 T1). Add `updatedAt: new Date()`.',
      ).toContain('updatedAt');
    }
  });

  it('the grant ending stamps it too — it is a write like any other', () => {
    // Lives in the same directory and already did the right thing; pinned so
    // that staying right is not a coincidence.
    const source = readFileSync(join(ROUTES_DIR, 'grant-ending.ts'), 'utf-8');
    for (const clause of setClausesFor(source)) {
      expect(clause).toContain('updatedAt');
    }
  });

  it('no ledger migration installs a trigger that would make this moot', () => {
    // If somebody later adds a BEFORE UPDATE trigger, this guard is redundant
    // and should be deleted rather than kept as folklore. Until then, the
    // absence is the reason the guard exists, so the absence is asserted.
    const dir = join(REPO_ROOT, 'packages/ledger/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf-8'))
      .join('\n');
    expect(
      /CREATE\s+TRIGGER/i.test(sql),
      'a trigger now exists in the ledger chain — check whether it stamps updated_at on ' +
        'mailbox_mapping, and if it does, delete this guard rather than leaving it as folklore',
    ).toBe(false);
  });
});
