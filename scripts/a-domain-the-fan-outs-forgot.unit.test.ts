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
