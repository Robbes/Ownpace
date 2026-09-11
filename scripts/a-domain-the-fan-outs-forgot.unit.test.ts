// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every place that asks "is this domain switched on?" asks it about EVERY
 * domain (workplan 0113 T5).
 *
 * `orchestration.ts` fans out per domain in five places, and each one is a
 * hand-written `if (config.domains?.X?.enabled)` chain: the sync loop, the
 * discovery pass, the delta pass's enabled list, the verification gate's
 * reindexers, and the gate's own per-domain switches. Nothing makes them
 * agree. `config.domains.tasks` is an optional field, so a chain that never
 * mentions it compiles perfectly and simply never runs that domain.
 *
 * That is not a hypothetical: when `task` was added to `DISCOVERY_DOMAINS`,
 * the compiler named sixteen sites across six files and NONE of these five,
 * because there was nothing to name. A person could have ticked Tasks in the
 * wizard, watched the mapping activate, and got a migration that copied
 * nothing, discovered nothing, and — worst of the three — passed its
 * verification gate having never looked at the domain at all (hard rule 9:
 * a green run that checked nothing).
 *
 * So this counts. Each domain's config key must appear in exactly as many
 * `enabled` tests as every other domain's: five chains, five mentions each.
 * A sixth domain that reaches `MappingConfig` and misses a chain fails here
 * with the count that gives it away.
 *
 * Read as TEXT rather than imported, for the reason
 * `a-fifth-domain-the-database-would-refuse.unit.test.ts` gives: a root-level
 * test cannot resolve workspace imports (`vitest.config.ts` says so), and the
 * thing under test is the SHAPE of the source anyway.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ORCHESTRATION = 'packages/orchestration/src/orchestration.ts';
const REINDEXERS = 'packages/orchestration/src/build-reindexers.ts';
const FAN_OUT = 'packages/orchestration/src/target-fan-out.ts';
const REPORT = 'packages/shared/src/verification-report.ts';

/**
 * The `MappingConfig.domains` key for each sync domain.
 *
 * A FOURTH spelling of the domains, and not one this test invented: the
 * config block has said `mail`/`contacts`/`files`/`tasks` since before
 * `DISCOVERY_DOMAINS` existed, and renaming a stored config's keys would
 * break every mapping row already written. Listed here so the mapping is
 * visible rather than guessed at by a regex.
 */
const CONFIG_KEYS = ['mail', 'calendar', 'contacts', 'files', 'tasks'] as const;

/** How many `config.domains?.<key>?.enabled` tests the source makes. */
function fanOutCount(source: string, key: string): number {
  return source.split(`domains?.${key}?.enabled`).length - 1;
}

describe('no domain is left out of a fan-out', () => {
  const source = readFileSync(join(ROOT, ORCHESTRATION), 'utf8');

  it('asks about every domain the same number of times', () => {
    const counts = Object.fromEntries(
      CONFIG_KEYS.map((key) => [key, fanOutCount(source, key)]),
    );
    // `mail` is the exception and says why: it carries the pre-domains
    // fallback (`?? isTopLevelMailSource(...)`), so it is asked about in
    // shapes the other four never take. Every OTHER domain must match
    // `calendar`, the plainest of them.
    const expected = counts.calendar;
    for (const key of CONFIG_KEYS) {
      if (key === 'mail') continue;
      expect(
        counts[key],
        `${ORCHESTRATION} asks whether '${key}' is enabled ${counts[key]} times and whether ` +
          `'calendar' is enabled ${expected} times. One of the per-domain fan-outs — the sync ` +
          'loop, the discovery pass, the delta pass, the verification reindexers, or the gate ' +
          "switches — does not mention '" +
          key +
          "'. A domain missing from one of those is silently not synced, not discovered, or " +
          'not verified (0113 T5).',
      ).toBe(expected);
    }
  });

  it('is not passing vacuously — the fan-outs are still spelled this way', () => {
    // Both assertions above compare counts, and equal counts of ZERO would
    // pass while proving nothing. The source must actually contain the shape.
    expect(
      fanOutCount(source, 'calendar'),
      `${ORCHESTRATION} no longer tests domains this way, so the comparison above is vacuous. ` +
        'Fix `fanOutCount` to match however the fan-outs are written now',
    ).toBeGreaterThanOrEqual(4);
  });
});

describe('ONE fan-out, and no edition carries its own copy', () => {
  /**
   * `build-reindexers.ts` used to be the OTHER place that built reindexers —
   * a hand-written list of `collect()` calls that `run-verification.ts` used
   * for the managed plane's whole verification path. It named mail, calendar,
   * contacts and files, and not tasks, from the day workplan 0113 landed until
   * 2026-09-09.
   *
   * NOTHING FAILED, which is why it survived seven months of green runs.
   * `reindexerFor('tasks')` returned undefined, `canVerifyTarget` answered no,
   * and the report carried the domain as NOT_VERIFIABLE with `targetCount: 0`
   * — severity ERROR, and read by nobody. E2E (managed) #168 is where it showed
   * alone: `tasks 0/4` on a run whose own log said "the task lane landed — 2
   * VTODO row(s) copied" four minutes earlier. The tasks were on the target.
   * Nothing had been built to look at them.
   *
   * **The lists are gone (owner decision 2026-09-11, option (b)).** There was a
   * SECOND copy of that loop inside `verifyMapping` for the appliance, and a
   * third was about to be written for the confirmation pass. Both editions now
   * feed one `fanOutTargets`, driven by `DISCOVERY_DOMAINS` rather than by
   * anything hand-written — so the defect this guard was built for cannot be
   * spelled any more.
   *
   * What it therefore checks has changed with it: not "does each list mention
   * every domain" but **"is there still exactly one list, and is it the
   * enum"**. A fourth copy of the loop is the way back to `tasks 0/4`, and it
   * is what these assertions refuse.
   */
  const reindexers = readFileSync(join(ROOT, REINDEXERS), 'utf8');
  const fanOut = readFileSync(join(ROOT, FAN_OUT), 'utf8');
  const orchestration = readFileSync(join(ROOT, ORCHESTRATION), 'utf8');
  const report = readFileSync(join(ROOT, REPORT), 'utf8');

  /** The report's own domain list, read out of its source. */
  const domains =
    report
      .match(/export const VERIFICATION_DOMAINS = \[([^\]]*)\]/)?.[1]
      ?.match(/'([a-z]+)'/g)
      ?.map((q) => q.slice(1, -1)) ?? [];

  /**
   * The source with its comments removed.
   *
   * Because the assertions below are about what the CODE does, and this file's
   * own prose names the very shapes it refuses. A guard that fires on a
   * sentence is one somebody weakens rather than answers.
   */
  const codeOf = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** One `key: 'value',` map, read out of a source file by name. */
  function mapEntries(source: string, name: string): Record<string, string> {
    const body = source.match(new RegExp(`${name}[^=]*=\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/([a-z]+)\s*:\s*'([a-z]+)'/g)) out[m[1]!] = m[2]!;
    return out;
  }

  it('the report still declares its domains where this guard reads them', () => {
    // A rename in the report that this regex stops matching would empty the
    // list and pass every assertion below over nothing.
    expect(domains.length).toBeGreaterThanOrEqual(5);
    expect(domains).toContain('tasks');
  });

  it('translates every verification domain, out of ONE map', () => {
    // `GATE_NAME` is a total `Record<DiscoveryDomain, VerificationDomain>`, so
    // a sixth ledger domain fails to compile. This is the other direction: a
    // domain the REPORT knows about that nothing translates to would be
    // reported NOT_VERIFIABLE for ever, which is the `tasks 0/4` sentence.
    const gate = mapEntries(fanOut, 'GATE_NAME');
    expect(Object.keys(gate).length, 'GATE_NAME not found where this guard reads it').toBe(5);
    const missing = domains.filter((d) => !Object.values(gate).includes(d));
    expect(
      missing,
      `${FAN_OUT}'s GATE_NAME translates nothing to ${missing.join(', ')}. ` +
        'Verification will report that domain NOT_VERIFIABLE with targetCount 0 — ' +
        'an ERROR that looks exactly like a domain nothing copied, on a domain ' +
        'that copied fine. This is the shape that hid the task domain for seven ' +
        'months (E2E managed #168).',
    ).toEqual([]);
  });

  it('drives the fan-out off the ENUM, never a list somebody typed', () => {
    // THE FIX, asserted. The old defect needed a hand-written list to go stale
    // against; a fan-out over `DISCOVERY_DOMAINS` has nothing to go stale.
    expect(
      reindexers,
      `${REINDEXERS} no longer fans out over DISCOVERY_DOMAINS. If the domains it ` +
        'tries are written out by hand again, a sixth one can be added to the enum ' +
        'and silently never reach a target — which is exactly E2E #168.',
    ).toContain('wanted: DISCOVERY_DOMAINS');
  });

  it('asks the deps layer for ITS spelling of each domain, from a total map', () => {
    // A FIFTH vocabulary, and not one this test invented: the report says
    // `contacts`/`files`/`tasks`, the ledger says `contact`/`file`/`task`, and
    // `buildDomainDepsFromMapping` says `mail` where the ledger says `email`.
    // A wrong entry here builds nothing for that domain — and the fan-out
    // swallows a build failure by design, so it would go quiet rather than red.
    expect(mapEntries(reindexers, 'DEPS_NAME')).toEqual({
      email: 'mail',
      calendar: 'calendar',
      contact: 'contact',
      file: 'file',
      task: 'task',
    });
  });

  it('has exactly ONE collect-and-release loop, fed by both editions', () => {
    // The duplication itself, refused. `build-confirmation-readers.ts` states
    // the rule in prose — "Building a second assembler beside it is how this
    // repository ends up with two copies of a fan-out and one of them silently
    // stops being the product" — and this is that rule with a test behind it.
    //
    // Both editions must CALL the shared fan-out, and neither may carry the
    // loop itself: the appliance had its own inside `verifyMapping` until
    // 2026-09-11, which is how there came to be two lists to keep in step.
    for (const [file, source] of [
      [REINDEXERS, reindexers],
      [ORCHESTRATION, orchestration],
    ] as const) {
      expect(source, `${file} no longer feeds the shared fan-out`).toContain('fanOutTargets');
      // The predicate too: "can this target enumerate itself" is one question,
      // and `orchestration.ts` answered it twice — once for reindexers and
      // once for the discovery pass's counting — until 2026-09-11.
      //
      // NOT covered here, and deliberately: the discovery pass has its own
      // per-domain chain building SOURCE and target together, which is a
      // different fan-out with a different shape. The counting guard in the
      // first describe is what watches that one.
      expect(
        codeOf(source).includes('listEntries'),
        `${file} tests for listEntries itself. That check belongs to the one fan-out ` +
          '(`asReindexer` in target-fan-out.ts); a copy here is a second loop, and a ' +
          'second loop is what let the task domain go unbuilt for seven months.',
      ).toBe(false);
    }
  });
});
