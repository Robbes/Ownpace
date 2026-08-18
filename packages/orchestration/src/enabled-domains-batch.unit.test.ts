// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One query for every due mapping's scope, not one per mapping (workplan 0082 T3).
 *
 * The tick called `enabledDomains` inside its loop, on a one-minute cron. The
 * N+1 mattered less for its cost per call than for what the total does to the
 * tick's wall time: cross sixty seconds and ticks overlap.
 *
 * A fake pool rather than a database, because what is being pinned is the
 * SHAPE of the access — that it is one round trip, that a mapping with no
 * selected domains is absent rather than empty, and that a row whose tenant
 * does not match is refused. None of those need Postgres to be true, and a real
 * database would make the "exactly one query" assertion harder, not easier.
 */

import { describe, it, expect } from 'vitest';
import { enabledDomainsForMappings } from './enabled-domains';
import type { Pool } from 'pg';

const T1 = '7d1b0000-e29b-41d4-a716-446655441601';
const T2 = '7d1b0000-e29b-41d4-a716-446655441602';
const M1 = '7d1b0000-e29b-41d4-a716-446655441611';
const M2 = '7d1b0000-e29b-41d4-a716-446655441612';
const M3 = '7d1b0000-e29b-41d4-a716-446655441613';

interface Row {
  mapping_id: string;
  tenant_id: string;
  domain: 'email' | 'calendar' | 'contact' | 'file';
}

/** A pool that records what it was asked, and answers with fixed rows. */
function fakePool(rows: Row[]): { pool: Pool; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const asked = new Set((params[0] as string[]) ?? []);
      return { rows: rows.filter((r) => asked.has(r.mapping_id)) };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe('enabledDomainsForMappings', () => {
  it('asks once for every mapping, not once per mapping', async () => {
    const { pool, calls } = fakePool([
      { mapping_id: M1, tenant_id: T1, domain: 'email' },
      { mapping_id: M2, tenant_id: T1, domain: 'calendar' },
    ]);
    await enabledDomainsForMappings(pool, [
      { id: M1, tenantId: T1 },
      { id: M2, tenantId: T1 },
      { id: M3, tenantId: T2 },
    ]);
    // The whole point of the change.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params[0]).toEqual([M1, M2, M3]);
  });

  it('groups the domains under their own mapping', async () => {
    const { pool } = fakePool([
      { mapping_id: M1, tenant_id: T1, domain: 'email' },
      { mapping_id: M1, tenant_id: T1, domain: 'file' },
      { mapping_id: M2, tenant_id: T1, domain: 'calendar' },
    ]);
    const map = await enabledDomainsForMappings(pool, [
      { id: M1, tenantId: T1 },
      { id: M2, tenantId: T1 },
    ]);
    expect([...(map.get(M1) ?? [])].sort()).toEqual(['email', 'file']);
    expect([...(map.get(M2) ?? [])]).toEqual(['calendar']);
  });

  it('leaves a mapping with nothing selected ABSENT, not empty', async () => {
    // The caller must be able to tell "the owner selected nothing" from "I did
    // not ask about that one". An empty set for both would erase the
    // difference, and the tick's rule is that no scope_selection row means NOT
    // SELECTED, never "default to everything".
    const { pool } = fakePool([{ mapping_id: M1, tenant_id: T1, domain: 'email' }]);
    const map = await enabledDomainsForMappings(pool, [
      { id: M1, tenantId: T1 },
      { id: M2, tenantId: T1 },
    ]);
    expect(map.has(M1)).toBe(true);
    expect(map.has(M2)).toBe(false);
  });

  it('refuses a row whose tenant is not the one that mapping belongs to', async () => {
    // This cannot happen while mapping ids are unique — and acting on it if it
    // ever did would run a job against another tenant's scope, so it is checked
    // rather than assumed.
    const { pool } = fakePool([
      { mapping_id: M1, tenant_id: T2, domain: 'email' },
      { mapping_id: M1, tenant_id: T1, domain: 'calendar' },
    ]);
    const map = await enabledDomainsForMappings(pool, [{ id: M1, tenantId: T1 }]);
    expect([...(map.get(M1) ?? [])]).toEqual(['calendar']);
  });

  it('asks nothing at all when there is nothing due', async () => {
    const { pool, calls } = fakePool([]);
    const map = await enabledDomainsForMappings(pool, []);
    expect(map.size).toBe(0);
    // A quiet minute should cost zero queries, not one that returns nothing.
    expect(calls).toHaveLength(0);
  });
});
