// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PREFLIGHT COUNTED TASKS BY OPENING THE FILE STORE.
 *
 * `buildTask` chose a domain's source with three `if`s and a bare `else`:
 *
 *     if (domain === 'email')    → mail deps
 *     if (domain === 'calendar') → calendar deps
 *     if (domain === 'contact')  → contact deps
 *     …                          → FILE deps
 *
 * Four domains existed when that was written. `task` arrived as the fifth in
 * workplan 0113, joined `DISCOVERY_DOMAINS`, got a builder, a target, a delta
 * pass and a deletion arm — and here it fell into the else and was counted
 * through the FILE source.
 *
 * ## Why nobody saw it for a month
 *
 * Because on the accounts it first ran against it is INVISIBLE. A `soverin`
 * or `apple` row resolves both its task face and its file face to `dav`, so
 * the wrong source still lists, still returns collections, and reports a
 * plausible number of tasks that is actually a number of folders. A count
 * being wrong looks like nothing at all.
 *
 * It became visible on a Microsoft 365 account, where the two faces are
 * different connectors: the owner's Tasks row came back
 *
 *     graph-drive source: clientId is not set (the Entra app registration id).
 *
 * **A domain naming another domain's connector in its own error** — which is
 * the only reason this was found by a person rather than by a customer's
 * wrong figure.
 *
 * ## What this pins
 *
 * That every domain in `DISCOVERY_DOMAINS` opens ITS OWN deps, asked for by
 * name. Derived from that list, so a sixth domain is covered on the day it is
 * added — and the table `buildTask` reads is `Record<DiscoveryDomain, …>`, so
 * a sixth domain will not compile until somebody says what it counts through.
 * Both halves matter: the type stops a silent fall-through, this file stops a
 * row that compiles and points at the wrong domain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from '@openmig/shared';

/** Which domain literal each call asked `buildDomainDepsFromMapping` for. */
const asked: string[] = [];
/** Whether the deps this run opened were released. */
let closed = 0;

vi.mock('@openmig/orchestration/build-deps-from-mapping', () => ({
  buildDomainDepsFromMapping: (
    _pool: unknown,
    _tenantId: string,
    _mappingId: string,
    domain: string,
  ) => {
    asked.push(domain);
    return Promise.resolve({
      source: { listFolders: () => Promise.resolve([]) },
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    });
  },
}));

// The job constructs a Pool at module load and refuses without a URL. Nothing
// here connects — `pg` builds the pool lazily, and every source is the stub
// above — but the variable has to be there before the import runs.
process.env.DATABASE_URL ??= 'postgres://discovery.test.invalid/none';

const { buildTask } = await import('./run-discovery.ts');

/**
 * The literal each domain must ask for. `email` is the one rename in the set —
 * the deps builder has called that face `mail` since the 0001 baseline — and
 * every other domain asks for its own name.
 */
const DEPS_LITERAL: Readonly<Record<DiscoveryDomain, string>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contact',
  file: 'file',
  task: 'task',
};

const POOL = {} as never;
const TENANT = '00000000-0000-0000-0000-000000000001' as never;
const MAPPING = '00000000-0000-0000-0000-000000000002' as never;

beforeEach(() => {
  asked.length = 0;
  closed = 0;
});

describe('every discovery domain is counted through its own source', () => {
  it('covers every domain — the fall-through is only invisible while a domain is missing', () => {
    expect(Object.keys(DEPS_LITERAL).sort()).toEqual([...DISCOVERY_DOMAINS].sort());
    expect(DISCOVERY_DOMAINS.length).toBeGreaterThan(4);
  });

  for (const domain of DISCOVERY_DOMAINS) {
    it(`opens the ${domain} deps for the ${domain} domain`, async () => {
      await buildTask(POOL, TENANT, MAPPING, domain).run();
      expect(
        asked,
        `the '${domain}' domain was counted through the '${asked[0]}' source: its figure is ` +
          "another domain's, and where the two faces are different connectors it refuses " +
          "naming a connector this domain never asked for",
      ).toEqual([DEPS_LITERAL[domain]]);
    });

    it(`releases the pool after counting ${domain}`, async () => {
      await buildTask(POOL, TENANT, MAPPING, domain).run();
      expect(closed, 'a discovery that does not close leaks a pool per domain').toBe(1);
    });
  }

  it('names the domain it was asked for on the task it returns', async () => {
    for (const domain of DISCOVERY_DOMAINS) {
      expect(buildTask(POOL, TENANT, MAPPING, domain).domain).toBe(domain);
    }
  });
});
