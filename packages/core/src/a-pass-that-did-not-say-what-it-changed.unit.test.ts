// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT CARRIED THE OWNER'S EDITS ACROSS AND SAID NOTHING ABOUT IT.
 *
 * The owner added an attendee to an event in Google, ran a pass, and watched
 * the change arrive in Nextcloud. The run log said:
 *
 *     calendar: 0 created, 6104 skipped              Items: 7,467
 *
 * The calendar holds 6,106 items. The two the line does not mention are the
 * two it rewrote — the only two that mattered — and the total beside it is
 * short by exactly them. The owner asked: *"isn't it weird it doesn't list
 * the number of items it updated?"*
 *
 * It was dropped in four places, and three of them carried a comment saying
 * not to:
 *
 *   - `run-delta-sync.ts` declared its `result` with only the fields the job
 *     happened to read, so `updated` — on every result assigned to it — was
 *     invisible to the line below;
 *   - its mail branch rebuilt that result by hand, under *"every field left
 *     out of this literal is a fact the summary below cannot state"*, and left
 *     out `updated` and `adopted`;
 *   - `reconcile.ts` built mail's result beside *"every count this result
 *     omitted has eventually turned out to be a fact somebody needed"*, and
 *     omitted `updated`;
 *   - the cutover narrowed its final pass to `{ created, skipped }` before it
 *     logged it — the last pass before handover, where knowing what changed
 *     matters most.
 *
 * And the appliance composed the same two-number line on its own, so the fix
 * is one helper rather than four more hand-written sentences.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { passCounts, itemsHandled, type PassCounts } from './pass-summary.ts';

/** The owner's pass, 2026-09-22 23:36. */
const calendar: PassCounts = { created: 0, updated: 2, adopted: 0, skipped: 6104 };
const contact: PassCounts = { created: 0, updated: 0, adopted: 0, skipped: 1229 };
const file: PassCounts = { created: 0, updated: 0, adopted: 0, skipped: 134 };

describe('the line says what the pass changed', () => {
  it('names the rewrites, which were the whole point of the pass', () => {
    expect(passCounts(calendar)).toBe('0 created, 2 updated, 6104 skipped');
  });

  it('says "0 updated" rather than nothing, so a quiet pass is distinguishable from a blind one', () => {
    // The line used to read identically for a pass that carried every edit
    // and a pass that carried none. On Google calendars the second one ran for
    // days, and nothing on the screen could tell.
    expect(passCounts(contact)).toBe('0 created, 0 updated, 1229 skipped');
  });

  it('names adoptions when there are some, and stays quiet when there are none', () => {
    expect(passCounts({ created: 0, updated: 0, adopted: 4, skipped: 644 })).toBe(
      '0 created, 0 updated, 644 skipped, 4 adopted',
    );
    expect(passCounts(contact)).not.toContain('adopted');
  });
});

describe('the total counts every item the pass handled', () => {
  it('is 7,469 for the owner\'s pass, not the 7,467 the screen showed', () => {
    const total = [calendar, contact, file].reduce((n, c) => n + itemsHandled(c), 0);
    expect(total).toBe(7469);
  });

  it('counts an adoption, which is an item handled as surely as a copy', () => {
    expect(itemsHandled({ created: 0, updated: 0, adopted: 4, skipped: 644 })).toBe(648);
  });
});

describe('no summary line is written by hand any more', () => {
  // A helper nobody calls fixes nothing. Each of these composed its own
  // two-number sentence; each now has to go through the one that cannot drop
  // a count.
  const REPO = join(import.meta.dirname, '..', '..', '..');
  const SITES = [
    'apps/worker/src/jobs/run-delta-sync.ts',
    'apps/worker/src/jobs/run-cutover.ts',
    'apps/selfhost/src/index.ts',
  ];
  const HAND_WRITTEN = /\$\{[^}]*\.created\} created, \$\{[^}]*\.skipped\} skipped/;

  for (const site of SITES) {
    it(`${site} says its counts through passCounts`, () => {
      const source = readFileSync(join(REPO, site), 'utf8');
      expect(source, `${site} composes "N created, M skipped" by hand again`).not.toMatch(HAND_WRITTEN);
      expect(source).toMatch(/passCounts\(/);
    });
  }

  it('totals Items through itemsHandled on both editions', () => {
    for (const site of ['apps/worker/src/jobs/run-delta-sync.ts', 'apps/selfhost/src/index.ts']) {
      const source = readFileSync(join(REPO, site), 'utf8');
      expect(source, `${site} still totals only created + skipped`).not.toMatch(
        /\.created \+ [a-z]+\.skipped/,
      );
      expect(source).toMatch(/itemsHandled\(/);
    }
  });
});
