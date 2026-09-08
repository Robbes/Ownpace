// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE JOB HALF OF THE PREFLIGHT'S DOMAIN DEFAULT.
 *
 * `apps/api/.../a-preflight-that-counts-a-domain-nobody-asked-for.unit.test.ts`
 * pins that the API stops naming the domains. That only helps if the job then
 * asks the right question — and it did not: `run-discovery` had the SAME
 * default the route did,
 *
 *     const domains = typed.domains ?? [...DISCOVERY_DOMAINS];
 *
 * so removing it at the API alone would have moved the bug one process along
 * and changed nothing the owner sees. Both halves land together, and this file
 * is why the second one cannot quietly regress.
 *
 * ## The rule
 *
 * No list in the payload means the mapping's OWN selection — the
 * `scope_selection` rows with `included = true`, read through the same
 * `enabledDomains` the sync tick and `run-delta-sync` use, so the preflight
 * and the pass it is a preview of cannot disagree about what a migration
 * carries.
 *
 * ## The trap this file exists for
 *
 * An empty selection must stay empty. It is genuinely tempting to write
 *
 *     const domains = selected.size > 0 ? [...selected] : [...DISCOVERY_DOMAINS];
 *
 * because a preflight showing nothing looks broken. It is not broken: no
 * `scope_selection` row means "not selected", the same thing it means in the
 * tick and in the sync job, and filling it back in is exactly the defect this
 * work removed — wearing a friendlier face. The test named for it below fails
 * on that line.
 *
 * The real pool is never touched: `enabledDomains` takes a `pg` Pool and calls
 * `query`, so a recording stub is a complete substitute and lets this assert
 * on the SQL as well as the answer.
 */

import { describe, it, expect } from 'vitest';
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from '@openmig/shared';

// The job builds a Pool at module load and refuses without a URL. Nothing here
// connects — `pg` builds the pool lazily and every query below is the stub.
process.env.DATABASE_URL ??= 'postgres://discovery.test.invalid/none';

const { domainsToCount } = await import('./run-discovery.ts');

const TENANT = '00000000-0000-0000-0000-000000000001';
const MAPPING = '00000000-0000-0000-0000-000000000002';

/** A `pg` Pool that answers one fixed row set and records what it was asked. */
function poolAnswering(domains: readonly DiscoveryDomain[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  return {
    queries,
    pool: {
      query: (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return Promise.resolve({ rows: domains.map((domain) => ({ domain })) });
      },
    } as never,
  };
}

describe('the preflight counts the domains the mapping selected', () => {
  it('asks scope_selection when the payload named none', async () => {
    const { pool, queries } = poolAnswering(['calendar', 'contact', 'file', 'task']);

    const domains = await domainsToCount(pool, TENANT as never, MAPPING as never, undefined);

    expect(domains).toEqual(['calendar', 'contact', 'file', 'task']);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.text).toMatch(/scope_selection/);
    expect(queries[0]!.values).toEqual([TENANT, MAPPING]);
  });

  it('does not count a domain the owner switched off', async () => {
    // The owner's own migration, 2026-09-07: everything but mail. The Email
    // row it used to grow said "Unsupported target type: undefined", because
    // the mail arm resolved a target this mapping was never given.
    const { pool } = poolAnswering(['calendar', 'contact', 'file', 'task']);

    const domains = await domainsToCount(pool, TENANT as never, MAPPING as never, undefined);

    expect(
      domains,
      'an unselected domain on the preflight is a row that can only fail, next to real ones',
    ).not.toContain('email');
  });

  it('leaves an empty selection empty rather than filling it back in', async () => {
    const { pool } = poolAnswering([]);

    const domains = await domainsToCount(pool, TENANT as never, MAPPING as never, undefined);

    expect(
      domains,
      'no scope_selection row means "not selected" — here as in the tick and the sync job',
    ).toEqual([]);
  });

  it('never defaults to every domain the product carries', async () => {
    const { pool } = poolAnswering(['calendar']);

    const domains = await domainsToCount(pool, TENANT as never, MAPPING as never, undefined);

    expect(domains).not.toEqual([...DISCOVERY_DOMAINS]);
    expect(domains).toHaveLength(1);
    // Were the list ever one domain long the assertion above would pass by
    // accident, so the premise is asserted rather than assumed.
    expect(DISCOVERY_DOMAINS.length).toBeGreaterThan(1);
  });

  it('honours an explicit list without asking the database', async () => {
    // A narrower re-count stays possible; it just cannot happen by accident.
    const { pool, queries } = poolAnswering(['calendar', 'file']);

    const domains = await domainsToCount(pool, TENANT as never, MAPPING as never, ['file']);

    expect(domains).toEqual(['file']);
    expect(queries, 'a caller who named domains has already made the decision').toHaveLength(0);
  });

  it('copies the caller list rather than holding their array', async () => {
    const { pool } = poolAnswering([]);
    const asked: DiscoveryDomain[] = ['calendar'];

    const domains = await domainsToCount(pool, TENANT as never, MAPPING as never, asked);
    asked.push('email');

    expect(domains).toEqual(['calendar']);
  });
});
