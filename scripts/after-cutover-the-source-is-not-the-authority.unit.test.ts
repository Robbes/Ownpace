// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * After cutover the source is no longer the authority on what exists
 * (workplan 0117 **D4**, owner 2026-09-09).
 *
 * > *"indeed, after cutover the source is no longer the authority on what
 * > exists, so we will not delete in target based on changes in the source."*
 *
 * ## What is actually being protected
 *
 * 0117 §3a: a pass runs after cutover, reads the source's bin, finds an item
 * the person deleted there deliberately, reads that as evidence of a deletion,
 * mirrors it onto the target — and the item now exists nowhere. Every step
 * behaves exactly as designed and the run report says it is mirroring
 * faithfully.
 *
 * §3b then showed the trap needs no drain to spring: under T2 the person
 * deletes in the source's own app on the strength of our verified list, and a
 * live mirror destroys the copy we just certified as safe.
 *
 * ## Why a guard NOW, when nothing is broken
 *
 * Because nothing is broken **by accident**. §3c: the appliance schedules
 * `active` and unschedules everything else, so after cutover the product stops
 * looking — protection by omission, which nobody wrote down and nobody owns.
 * 0117 T1 (the continuous lane) is defined as a mapping that keeps running
 * after cutover, so it removes the accident by construction.
 *
 * This suite turns the accident into an intention, so the day somebody makes a
 * post-cutover phase run passes, the same commit has to answer for the
 * detector. It is a cheap test standing in front of the one defect in this
 * product that destroys a customer's originals.
 *
 * ## The vocabulary comes from the database, not from here
 *
 * `mailbox_mapping.status` has four legal values and migration 0001's CHECK is
 * the authority. Restating them here would be a fifth copy that could go stale
 * exactly when a fifth status is added — which is the moment this guard most
 * needs to be right — so the list is parsed out of the SQL.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAfterCutover, startTransition } from '../packages/shared/src/lifecycle.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** The legal `mailbox_mapping.status` values, from the CHECK that enforces them. */
function statusesFromTheDatabase(): string[] {
  const sql = read('packages/ledger/migrations/0001_baseline.sql');
  const check = /CONSTRAINT mailbox_mapping_status_check CHECK \(\(status = ANY \(ARRAY\[([^\]]+)\]\)\)\)/
    .exec(sql);
  expect(check, 'migration 0001 no longer constrains mailbox_mapping.status — has it moved?')
    .not.toBeNull();
  const values = [...check![1]!.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
  expect(values.length, 'the CHECK parsed to no values').toBeGreaterThanOrEqual(4);
  return values;
}

describe('after cutover the source is not the authority', () => {
  it('every legal status is classified, and the split is the one D4 describes', () => {
    const statuses = statusesFromTheDatabase();
    const after = statuses.filter(isAfterCutover);
    const before = statuses.filter((s) => !isAfterCutover(s));

    // `paused` is BEFORE cutover: it holds a slot and the migration has not
    // ended, so the source is still the authority. Reading it as "after"
    // would silently stop mirroring for a customer who merely pressed pause.
    expect(before.sort()).toEqual(['active', 'paused']);
    expect(after.sort()).toEqual(['cutover', 'done']);
  });

  it('an unknown status is treated as BEFORE cutover — the direction that keeps looking', () => {
    // A fifth status arrives; this predicate has not been taught it yet. The
    // safe default is the one that does NOT silently switch a behaviour off:
    // being wrong toward "still mirroring" is a visible, recoverable state,
    // and being wrong toward "stopped" is a silence nobody notices.
    expect(isAfterCutover('shadow')).toBe(false);
    expect(isAfterCutover('')).toBe(false);
  });

  it('startTransition refuses exactly the post-cutover statuses, through the same predicate', () => {
    for (const status of statusesFromTheDatabase()) {
      const refused = 'conflict' in startTransition(status);
      expect(
        refused,
        `startTransition and isAfterCutover disagree about '${status}'. They described the ` +
          'same boundary in two places until 2026-09-09, and one copy had already drifted ' +
          'into the API by hand.',
      ).toBe(isAfterCutover(status));
    }
  });

  it('no source file spells the post-cutover pair inline any more', () => {
    // The drift this replaced: `status === 'cutover' || status === 'done'`,
    // written out in the shared lifecycle, copied into the managed API with
    // its message string, and expressed in the appliance as its complement
    // (`!== 'active'`). Three places, one rule, no name.
    //
    // Written first as "no file contains this pattern", which failed on the
    // DEFINITION — `isAfterCutover`'s own body is the comparison. A guard that
    // forbids the thing it is protecting is not a strict guard, it is a broken
    // one, and the only way to satisfy it would have been to obfuscate the
    // predicate. So: exactly one occurrence, and it is the definition.
    const inline = /===\s*'cutover'\s*\|\|\s*[A-Za-z.]*status\s*===\s*'done'/g;
    const occurrences = (f: string): number => (read(f).match(inline) ?? []).length;

    expect(
      occurrences('packages/shared/src/lifecycle.ts'),
      'the comparison should appear exactly once in lifecycle.ts — inside isAfterCutover, ' +
        'which is its definition. More than one means the predicate was bypassed beside ' +
        'itself; none means it was rewritten and this guard can no longer find it.',
    ).toBe(1);

    const elsewhere = ['apps/api/src/routes/migrations/index.ts'].filter((f) => occurrences(f) > 0);
    expect(
      elsewhere,
      'these files re-spell the cutover/done pair instead of asking isAfterCutover. The rule ' +
        'now carries D4\'s reasoning in its docblock; a bare comparison carries none of it, ' +
        'and is exactly how the API came to hold a hand-copied duplicate.',
    ).toEqual([]);
  });

  it('the appliance still runs passes only where the source IS the authority', () => {
    // THE ONE THAT MATTERS. Today the tick refuses anything that is not
    // `active`, which happens to exclude both post-cutover states — §3c's
    // protection by omission. When 0117 T1 makes a post-cutover phase keep
    // running, this test is what forces the same commit to answer for the
    // deletion detector rather than discovering it on a customer's library.
    //
    // The CONDITION, whole — not a substring of it. Written first as
    // `toMatch(/currentStatus !== 'active'/)`, this test stayed GREEN under the
    // one mutation it exists for: widening the gate to
    // `currentStatus !== 'active' && currentStatus !== 'done'` still contains
    // that substring, so a guard about the destruction of customer data passed
    // while the appliance ran `done` mappings. Substring assertions cannot
    // catch a widened condition, because widening only ever ADDS text.
    const tick = read('apps/selfhost/src/index.ts');
    const gate = /if \(([^)]*currentStatus[^)]*)\)\s*\{/.exec(tick);
    expect(gate, "the appliance's pass gate on `currentStatus` is gone entirely").not.toBeNull();
    expect(
      gate![1]!.trim(),
      "the appliance's pass gate is no longer exactly `currentStatus !== 'active'`. If a " +
        'phase that continues after cutover now runs passes, 0117 D4 requires the deletion ' +
        'detector to be ABSENT from it — not gated per item and not filtered downstream ' +
        '(§4D: a gate strong enough needs T4 tombstones anyway, and a gate can be wrong ' +
        'once; absence cannot). Change this test in the same commit as that proof, never ' +
        'before it, and never to make a red build green.',
    ).toBe("currentStatus !== 'active'");
  });

  it('the rule cannot outlive the decision that made it', () => {
    // A trip-wire in the other direction: if D4 is ever reopened or reversed,
    // the workplan changes and this guard demands the code change with it.
    // Anchored on the decision's own words rather than on proximity to the
    // letters "D4" — the first attempt assumed the marker sat within 400
    // characters of the heading, which says more about how that section is
    // laid out today than about whether the decision still stands.
    const plan = read('docs/workplans/0117-the-conveyor-belt-not-the-home.md');
    expect(plan, '0117 no longer records D4 as taken').toContain('TAKEN 2026-09-09');
    expect(
      plan,
      "the owner's own sentence is what this predicate implements; if the workplan stops " +
        'carrying it, the code is enforcing a rule with no recorded author.',
    ).toContain('the source is no longer the authority on what exists');
    expect(
      read('packages/shared/src/lifecycle.ts'),
      'isAfterCutover must keep pointing at the decision it implements, or the next reader ' +
        'sees a predicate about two strings and deletes it as ceremony.',
    ).toMatch(/0117 \*\*D4\*\*/);
  });
});
