// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LANE THAT RUNS IN ONE VOCABULARY AND HAS ENDED IN THE OTHER
 * (workplan 0117 T1; owner decisions D6 and D4).
 *
 * `continuous` is a mapping that keeps copying after cutover and deletes
 * nothing. Adding it looks like adding a string to an enum. It is not: this
 * repository keeps the lifecycle in SIX places that must agree, and each
 * disagreement is silent and expensive in a different way.
 *
 *   `mailbox_mapping.status`      what the routes and the appliance read to
 *                                 decide whether a mapping runs
 *   `path_lifecycle.state`        what BILLING reads — `holdsASlot`
 *   `MappingStatus`               what the audit log records a change as
 *   `isAfterCutover`              where the deletion detector may not go
 *   `MAPPING_LIFECYCLES`          what BOTH status readers narrow through —
 *                                 and they THROW on a value outside it
 *   `STATE_TABLE.lifecycle`       the word and the colour on every screen
 *
 * The fifth was missed by the survey that produced the first four, and found
 * by reading rather than by the compiler: nothing assigns the literal, so
 * `tsc` had nothing to complain about. What it costs is the loudest failure
 * of the set — `mappingStatus` and the managed API's `scope` both refuse a
 * status they cannot narrow, so a row the database happily holds makes every
 * page and every pass of that migration raise. Widening the union then made
 * the compiler name the sixth, and four exhaustive `Record<MappingLifecycle,
 * …>` maps besides. That is the shape of this defect: one list moves, and the
 * places that must move with it are only partly findable by machine.
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
import { isAfterCutover, MAPPING_LIFECYCLES } from '@openmig/shared';

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

describe('and the two surfaces that REFUSE a status they cannot narrow', () => {
  it('the operating contract admits it, so neither status reader throws on the row', () => {
    expect(MAPPING_LIFECYCLES).toContain(LANE);
    // The four that were already there stay — an addition, not a swap.
    for (const had of ['paused', 'active', 'cutover', 'done']) {
      expect(MAPPING_LIFECYCLES).toContain(had);
    }
  });

  it('both readers still narrow through that list rather than an inline literal', () => {
    // This is what makes the assertion above load-bearing. Either reader could
    // be "simplified" to its own array of four words and keep compiling; the
    // list would then be right and the refusal would still fire.
    for (const file of [
      'apps/selfhost/src/index.ts',
      'apps/api/src/routes/migrations/operating-routes.ts',
    ]) {
      const src = read(file);
      expect(
        src,
        `${file} no longer narrows mailbox_mapping.status through MAPPING_LIFECYCLES`,
      ).toMatch(/MAPPING_LIFECYCLES\.includes\(/);
    }
  });

  it('the badge table has a word and a colour for it', () => {
    // Read as text: this guard lives in scripts/ and the web app is not one of
    // its dependencies. The shape is stable enough to match — every row of
    // STATE_TABLE is `name: { key: '…', tone: '…' }`.
    const chip = read('apps/web/src/components/StateChip.tsx');
    const lifecycle = /lifecycle: \{([^]*?)\n {2}\},/.exec(chip);
    expect(lifecycle, 'STATE_TABLE.lifecycle moved or was renamed').not.toBeNull();
    expect(lifecycle![1]).toMatch(
      new RegExp(`\\b${LANE}: \\{ key: '[^']+', tone: '[^']+' \\}`),
    );
  });
});

describe('but the DOOR into the lane is deliberately still shut', () => {
  /**
   * THE DOOR IS OPEN, AND THIS IS THE TEST THAT REPLACED THE ONE HOLDING IT
   * SHUT (2026-09-10).
   *
   * Its predecessor pinned `continuous` OUT of the PATCH enum and said, in as
   * many words: *when the door is built, widen the enum, and replace this test
   * with one that asserts the customer is told. Do not simply delete it.* This
   * is that test.
   *
   * The condition was never technical. ADR-0014's amendment gives entering the
   * lane a price — a continuous path holds its capacity slot (D6), so the tier
   * does NOT fall the way finishing makes it fall — and somebody who believes
   * the price ends when the migration ends and finds a tier still charging has
   * a fair complaint. So the telling has to exist in both places a person could
   * meet the fact, and neither may quietly go missing:
   *
   *   - **the pricing page**, in the same breath as "finishing lowers your
   *     bill", because a correction three paragraphs later is not a correction;
   *   - **the screen that offers the switch**, because that is where the act
   *     happens and most people never read a pricing page twice.
   *
   * A widened enum with either of those gone is the door opening without the
   * sentence, which is exactly what the old test existed to prevent.
   */
  it('admits continuous, now that the price is said where the switch is', () => {
    const routes = read('apps/api/src/routes/migrations/index.ts');
    const enumLine = /status: z\.enum\(\[([^\]]*)\]\)/.exec(routes);
    expect(enumLine, 'the mapping status z.enum moved or was renamed').not.toBeNull();
    const admitted = [...enumLine![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(admitted).toContain(LANE);
    expect(admitted.sort()).toEqual(['active', 'continuous', 'cutover', 'done', 'paused']);
  });

  it('says on the screen that offers it that the tier does not fall', () => {
    // The words themselves, not merely a key: a `lane.why` that had been
    // emptied or reworded past the point of saying it would satisfy a
    // key-exists check and tell nobody anything.
    const strings = read('apps/web/src/i18n/strings.ts');
    const why = /'lane\.why':\s*([\s\S]*?),\n\s*'lane\.start'/.exec(strings);
    expect(why, 'lane.why is gone — the screen no longer says what entering costs').not.toBeNull();
    expect(why![1]!).toMatch(/tier will not fall/);
    expect(why![1]!).toMatch(/slot/);
  });

  it('says it on the pricing page too, beside the promise it qualifies', () => {
    const pricing = read('site/pages/en/pricing.md');
    const finishing = pricing.indexOf('Finishing lowers your bill');
    expect(finishing, 'the paragraph this one qualifies is gone').toBeGreaterThan(-1);
    const unless = pricing.indexOf('Unless you ask us to keep copying');
    expect(unless, 'the pricing page no longer says the lane keeps counting').toBeGreaterThan(-1);
    // BESIDE it, not in a footnote. Three paragraphs is the width of the
    // "parts worth knowing" list; further than that and a reader has met the
    // promise and moved on before meeting the exception.
    const between = pricing.slice(finishing, unless).split('\n\n').length;
    expect(between, 'the exception drifted away from the promise it qualifies').toBeLessThan(4);
  });

  it('offers the switch only where a migration has ended', () => {
    // `cutover` and `done` are the two states the lane is entered from (§4A).
    // Offering it on an `active` migration would be offering something that is
    // already happening, which is how a person ends up in a priced state
    // believing they changed nothing.
    const finish = read('apps/web/src/pages/Finish.tsx');
    expect(finish).toMatch(/m\.lifecycle === 'cutover' \|\| m\.lifecycle === 'done'/);
    expect(finish).toMatch(/lane\.why/);
  });
});
