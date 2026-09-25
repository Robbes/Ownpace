// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A data type the mapping file switched off is recorded as what it is, at
 * startup and on every pass (workplan 0125 T7).
 *
 * The store decides between `stopped` and `skipped` (its own test, on
 * PGlite, pins which). What is pinned here is who asks it, and when:
 *
 *   1. at startup, `recordSwitchedOff` records every switched-off data type
 *      and hands back the stopped ones with their counts, for the line the
 *      appliance says about each;
 *   2. a data type switched back on loses its `stopped` there too;
 *   3. every pass records the same thing again, through `runAllDomains`,
 *      rather than writing the one word `skipped` for both.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMappingConfig,
  DISCOVERY_DOMAINS,
  type DiscoveryDomain,
  type MigrationStatusStore,
  type SwitchedOffState,
  phasesOfTheMigration,
} from '@openmig/shared';
import { recordSwitchedOff, runAllDomains } from './orchestration.ts';

const dav = (enabled: boolean) => ({
  enabled,
  source: {
    type: 'caldav',
    url: 'https://cloud.example.invalid/remote.php/dav',
    user: 'source',
    auth: { kind: 'login', passwordFromEnv: 'SOURCE_DAV_PASSWORD' },
  },
  target: {
    type: 'caldav',
    url: 'https://cloud.example.invalid/remote.php/dav',
    user: 'target',
    auth: { kind: 'login', passwordFromEnv: 'TARGET_DAV_PASSWORD' },
  },
});

/** A mapping whose `domains` block is exactly what it is handed. A DAV source
 *  at the top level, so the "no domains ⇒ mail only" fallback switches nothing on. */
const mapping = (domains: Record<string, unknown>) =>
  parseMappingConfig({
    tenantId: '00000000-0000-4000-8000-000000000057',
    mappingId: '11111111-1111-4111-8111-111111110057',
    source: dav(true).source,
    target: dav(true).target,
    domains,
  });

/** A store that answers from a table of copies and records every call. */
function fakeStore(copies: Partial<Record<DiscoveryDomain, number>>) {
  const calls: string[] = [];
  const store: MigrationStatusStore = {
    initDomainStatus: async (_t, _m, d) => void calls.push(`init ${d}`),
    markInProgress: async (_t, _m, d) => void calls.push(`inProgress ${d}`),
    markCompleted: async (_t, _m, d) => void calls.push(`completed ${d}`),
    markPaused: async (_t, _m, d) => void calls.push(`paused ${d}`),
    markFailed: async (_t, _m, d) => void calls.push(`failed ${d}`),
    markSwitchedOff: async (_t, _m, d): Promise<SwitchedOffState> => {
      calls.push(`off ${d}`);
      const n = copies[d] ?? 0;
      return n > 0 ? { state: 'stopped', copies: n } : { state: 'skipped' };
    },
    markSwitchedOn: async (_t, _m, d) => void calls.push(`on ${d}`),
    getStatus: async () => [],
  };
  return { store, calls };
}

describe('at startup', () => {
  it('hands back each stopped data type with its count, and nothing for one with none', async () => {
    const { store } = fakeStore({ contact: 412, file: 0, task: 1 });
    const stopped = await recordSwitchedOff(mapping({ calendar: dav(true) }), store);
    expect(stopped).toEqual([
      { domain: 'contact', copies: 412 },
      { domain: 'task', copies: 1 },
    ]);
  });

  it('records every switched-off data type, and switches the ticked one back on', async () => {
    const { store, calls } = fakeStore({});
    await recordSwitchedOff(mapping({ calendar: dav(true) }), store);
    expect(calls).toEqual(
      DISCOVERY_DOMAINS.map((d) => (d === 'calendar' ? 'on calendar' : `off ${d}`)),
    );
  });

  it('a data type that is off in the file is never switched back on', async () => {
    const { store, calls } = fakeStore({ calendar: 5 });
    const stopped = await recordSwitchedOff(mapping({ calendar: dav(false) }), store);
    expect(calls).not.toContain('on calendar');
    expect(stopped).toEqual([{ domain: 'calendar', copies: 5 }]);
  });
});

describe('on every pass', () => {
  it('records each switched-off data type through the store that tells the two apart', async () => {
    // Nothing is ticked, so the pass has no lane to run and reaches no
    // connector: what is left is exactly the part of a pass under test.
    const { store, calls } = fakeStore({ calendar: 3 });
    const results = await runAllDomains(mapping({ calendar: dav(false) }), store, phasesOfTheMigration('active'));

    for (const d of DISCOVERY_DOMAINS) expect(calls).toContain(`off ${d}`);
    expect(results.map((r) => [r.domain, r.disabled])).toEqual(
      DISCOVERY_DOMAINS.map((d) => [d, true]),
    );
  });
});
