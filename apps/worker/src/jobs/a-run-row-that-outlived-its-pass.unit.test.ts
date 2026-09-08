// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN ROW NOBODY CLOSED MUST NOT STOP A MIGRATION FOR EVER (2026-09-08).
 *
 * The tick skips a mapping that has an open `running` run row. That is right
 * while a pass is genuinely running, and catastrophic once one is not: a pass
 * killed rather than finished — `maxDuration`, an OOM, a supervisor restart —
 * never reaches the code that closes its row. The row stays `running`, this
 * tick skips that mapping on every subsequent firing, and the migration stops.
 *
 * Silently. `retention` deliberately never touches a `running` run's rows, and
 * before this nothing else looked either, so the only symptom was a customer
 * eventually noticing nothing had moved.
 *
 * The query is read rather than executed, the way `managed-digest-sql` reads
 * its two predicates: what can go wrong here is not an exception, it is a
 * clause that quietly changes who gets enqueued. Executing it needs a database
 * and would still not tell you whether the two clauses PARTITION the open rows
 * — which is the property that matters and the one a reader can check.
 *
 * Importing this module has SIDE EFFECTS (a Pool at import, which throws
 * without DATABASE_URL), so the variable is set before a dynamic import — the
 * same shape, and the same reason, as the digest's test.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PASS_HARD_LIMIT_MS } from '@openmig/shared';

let ACTIVE_MAPPINGS_SQL: string;
let STALE_RUN_AFTER_MS: number;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  const mod = await import('./managed-sync-tick.ts');
  ACTIVE_MAPPINGS_SQL = mod.ACTIVE_MAPPINGS_SQL;
  STALE_RUN_AFTER_MS = mod.STALE_RUN_AFTER_MS;
});

describe('how long a running row is believed', () => {
  it('outlasts the runner ceiling, so a live pass is never cut loose', () => {
    // A row is the only evidence a pass exists. Declaring one dead while its
    // process still runs would let two passes touch one mapping — and while
    // the queue's `concurrencyKey: mappingId` stands behind that, the right
    // order of defences is not to rely on the last one.
    expect(STALE_RUN_AFTER_MS).toBeGreaterThan(PASS_HARD_LIMIT_MS);
  });

  it('is a multiple of the ceiling rather than a number of its own', () => {
    // Derived, so raising `maxDuration` cannot leave this behind believing a
    // shorter ceiling than the one the runner enforces.
    expect(STALE_RUN_AFTER_MS % PASS_HARD_LIMIT_MS).toBe(0);
  });
});

/**
 * JUST the two clauses this file is about.
 *
 * The assertions below count operators and bind parameters, and they used to
 * count them across the WHOLE query. That was fine while the query held
 * nothing else measured against a clock — and wrong the moment it did: adding
 * the failing-mapping back-off (2026-09-08) put two more `started_at > now()`
 * comparisons and a second `$n::int` into the string, and both assertions went
 * red over a partition that had not changed at all. A guard that fails when
 * something ELSE is added is a guard that teaches people to edit guards.
 *
 * Everything between the two column aliases is the running/stale pair and
 * nothing else, so a clause inserted BETWEEN them is still caught — which is
 * the case that would actually break the partition.
 */
function stalenessClauses(sql: string): string {
  const from = sql.indexOf('AS last_started');
  const to = sql.indexOf('AS stale_since');
  expect(from, 'the last_started column is no longer recognisable').toBeGreaterThan(-1);
  expect(to, 'the stale_since column is no longer recognisable').toBeGreaterThan(from);
  return sql.slice(from, to);
}

describe('the clauses that decide whether a mapping is enqueued', () => {
  it('only counts a row as running while it is younger than the threshold', () => {
    // Without the age bound this is the original defect verbatim: any open
    // row, however old, skips the mapping for ever.
    expect(ACTIVE_MAPPINGS_SQL).toMatch(
      /EXISTS[\s\S]*?status\s*=\s*'running'[\s\S]*?started_at\s*>\s*now\(\)/,
    );
  });

  it('reports the stale row rather than passing over it in silence', () => {
    // A mapping that resumes because its old row was ignored has still lost a
    // pass to something, and "it started working again" is not a diagnosis.
    expect(ACTIVE_MAPPINGS_SQL).toMatch(/stale_since/);
    expect(ACTIVE_MAPPINGS_SQL).toMatch(
      /min\(r\.started_at\)[\s\S]*?status\s*=\s*'running'[\s\S]*?started_at\s*<=\s*now\(\)/,
    );
  });

  it('PARTITIONS the open rows: strictly newer is running, at-or-older is stale', () => {
    // The pair has to be `>` and `<=` (or `>=` and `<`). Two `>`s and a row on
    // the boundary is both running and stale; two `<`s and it is neither —
    // a mapping neither skipped nor reported, which is the silent case again
    // wearing a different hat.
    const comparisons = [
      ...stalenessClauses(ACTIVE_MAPPINGS_SQL).matchAll(/started_at\s*(>=|<=|>|<)\s*now\(\)/g),
    ].map((m) => m[1]);
    expect(comparisons).toEqual(['>', '<=']);
  });

  it('measures both clauses against the SAME threshold parameter', () => {
    // Two thresholds would reopen the gap between them by hand. One `$1`, used
    // twice, cannot drift from itself.
    const params = [...stalenessClauses(ACTIVE_MAPPINGS_SQL).matchAll(/\$(\d+)::int/g)].map(
      (m) => m[1],
    );
    expect(params).toEqual(['1', '1']);
  });

  it('still asks only about ACTIVE mappings', () => {
    // The vacuity floor. Every assertion above is about which rows are
    // believed; none of them would notice if the tick started enumerating
    // paused and finished mappings too.
    expect(ACTIVE_MAPPINGS_SQL).toMatch(/WHERE m\.status = 'active'/);
  });
});
