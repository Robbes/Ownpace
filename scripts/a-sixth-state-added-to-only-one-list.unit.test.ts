// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LANE THAT RUNS IN ONE VOCABULARY AND HAS ENDED IN THE OTHER
 * (workplan 0117 T1; owner decisions D6 and D4).
 *
 * `continuous` is a mapping that keeps copying after cutover and deletes
 * nothing. Adding it looks like adding a string to an enum. It is not: this
 * repository keeps the lifecycle in FOUR places that must agree, and each
 * disagreement is silent and expensive in a different way.
 *
 *   `mailbox_mapping.status`      what the routes and the appliance read to
 *                                 decide whether a mapping runs
 *   `path_lifecycle.state`        what BILLING reads — `holdsASlot`
 *   `MappingStatus`               what the audit log records a change as
 *   `isAfterCutover`              where the deletion detector may not go
 *
 * Miss the second and the lane runs while the billing ledger believes those
 * paths ended at cutover — capacity nobody meters, costing real bytes every
 * pass. That is the question D6 asked, and the owner answered it on
 * 2026-09-10: *"a. yes it holds a slot"*.
 *
 * **Miss the fourth and it is much worse.** `isAfterCutover` is how D4's rule
 * reaches the code: after cutover the source is no longer the authority on
 * what exists, so the deletion detector must be ABSENT from that phase. A
 * `continuous` outside that predicate is a mapping that keeps running WITH the
 * detector present — which restores 0117 §3a's loop exactly: the person tidies
 * their old Drive, the pass reads the bin, mirrors the deletion onto the
 * target, and the item exists nowhere. Every step behaving as designed.
 *
 * So the rule this pins is not "the string is present in five files". It is
 * **the state and its two consequences arrive together, or the tests fail.**
 *
 * WHAT THIS PINS, and why each part earns its place:
 *
 *  - **Both database CHECKs are widened by the same migration.** Widening one
 *    is the half-change that produces the unmetered lane, and a migration is
 *    where somebody would do it, one ALTER at a time.
 *  - **`holdsASlot('continuous')` is true**, because D6 is a pricing decision
 *    and a later reader will otherwise "tidy" it to match the four states that
 *    end.
 *  - **`isAfterCutover('continuous')` is true.** The load-bearing one.
 *  - **ADR-0014 records the sixth state.** `PATH_STATES` is documented as
 *    ADR-0014's list, so the ADR is part of the definition, not commentary.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATH_STATES, holdsASlot, SLOT_HOLDING_STATES } from '@openmig/ledger';
import { isAfterCutover } from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The lane, named once so every assertion below is about the same thing. */
const LANE = 'continuous';

/** The whole ledger migration chain, concatenated — CHECKs live across files. */
function ledgerChain(): string {
  const dir = 'packages/ledger/migrations';
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => read(`${dir}/${f}`))
    .join('\n');
}

/**
 * The LAST definition of a named CHECK in the chain — migrations apply in
 * filename order, so a later `ADD CONSTRAINT` is what the database ends up
 * with. Reading the first would report migration 0001's four states forever.
 */
function currentCheck(constraint: string): string {
  const all = [...ledgerChain().matchAll(
    new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(([^;]*?)\\);`, 'g'),
  )];
  const inline = [...ledgerChain().matchAll(
    new RegExp(`CONSTRAINT ${constraint}\\s*\\n?\\s*CHECK \\(([^\\n]*)\\)`, 'g'),
  )];
  const found = [...inline, ...all];
  expect(found.length, `no CHECK named ${constraint} anywhere in the chain`).toBeGreaterThan(0);
  return found[found.length - 1]![1]!;
}

describe('the lane exists in every vocabulary that decides something about it', () => {
  it('the database lets a mapping hold it', () => {
    expect(currentCheck('mailbox_mapping_status_check')).toContain(`'${LANE}'`);
  });

  it('the database lets a PATH hold it — the half a one-ALTER change would miss', () => {
    expect(currentCheck('path_lifecycle_state_check')).toContain(`'${LANE}'`);
  });

  it('both were widened by ONE migration, so neither can land alone', () => {
    const dir = 'packages/ledger/migrations';
    const widening = readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => read(`${dir}/${f}`).includes(`'${LANE}'`));
    expect(widening, `no migration mentions '${LANE}'`).not.toEqual([]);
    for (const file of widening) {
      const sql = read(`${dir}/${file}`);
      const mapping = sql.includes('mailbox_mapping_status_check');
      const path = sql.includes('path_lifecycle_state_check');
      expect(
        mapping === path,
        `${file} widens only one of the two vocabularies. A mapping that can be ` +
          `'${LANE}' while a path cannot is a lane billing believes has ended.`,
      ).toBe(true);
    }
  });

  it('the audit log can name a transition into it', () => {
    const audit = read('apps/api/src/routes/migrations/mapping-status-audit.ts');
    const union = /export type MappingStatus =([^;]*);/.exec(audit);
    expect(union, 'MappingStatus moved or was renamed').not.toBeNull();
    expect(union![1]).toContain(`'${LANE}'`);
  });
});

describe('and the two rules that make it safe to run', () => {
  it('D6: it holds a slot — a path that never ends never gives its capacity back', () => {
    expect(PATH_STATES).toContain(LANE);
    expect(holdsASlot(LANE as (typeof PATH_STATES)[number])).toBe(true);
    // Derived, never listed twice — the WHERE clause that counts slots reads
    // this, so a disagreement here bills a different number than it charges.
    expect(SLOT_HOLDING_STATES).toContain(LANE);
  });

  it('D4: it is after cutover, so the deletion detector is absent from it', () => {
    expect(isAfterCutover(LANE)).toBe(true);
    // The three that were already true stay true — this is an addition, and a
    // rewrite that swapped one for another would otherwise read as a pass.
    expect(isAfterCutover('cutover')).toBe(true);
    expect(isAfterCutover('done')).toBe(true);
    expect(isAfterCutover('active')).toBe(false);
    expect(isAfterCutover('paused')).toBe(false);
  });

  it('ADR-0014 records the sixth state, because PATH_STATES cites it', () => {
    const adr = read('docs/adr/0014-cost-recovery-billing.md');
    expect(adr).toContain(LANE);
    // Not merely mentioned: the ADR has to say it holds a slot, which is the
    // decision, and name the obligation that comes with charging for it.
    const amendment = /Amended 2026-09-10[^]*?released capacity[^]*?\n\n/.exec(adr);
    expect(amendment, 'the 2026-09-10 amendment is not in ADR-0014').not.toBeNull();
    expect(amendment![0]).toMatch(/holds a\s*\n?slot|\*\*holds a\s*\n?slot\*\*/);
    expect(amendment![0]).toMatch(/bill does\s*\n?not stop at cutover/);
  });
});
