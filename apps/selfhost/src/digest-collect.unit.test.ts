// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance's digest collection (workplan 0030 T3).
 *
 * The twin of `managed-digest-run.unit.test.ts`, and deliberately so: the two
 * editions collect differently — the appliance walks the mappings in its
 * config file and asks each one's own lifecycle status, managed enumerates
 * tenants from a database — but they must agree on what any of it MEANS.
 * Where the two files assert the same rule in the same words, that is the
 * point, not duplication.
 *
 * The rules under test are the ones that decide whether an owner is told
 * something, or told nothing, or told a zero that was really a failure.
 */

import { describe, it, expect, vi } from 'vitest';
import { collectAttention, type CollectDeps, collectTenantAttention } from './digest-collect.ts';
import { wantsAttention } from '@openmig/shared';

const MAPPING = { mappingId: 'm-1', tenantId: 't-1' };

function deps(overrides: Partial<CollectDeps> = {}): CollectDeps {
  return {
    mappings: [MAPPING],
    status: async () => 'shadow',
    listDeletions: async () => [],
    listMoves: async () => [],
    listFailures: async () => [],
    countAutoApplied: async () => 0,
    countSharingOpen: async () => 0,
    countPendingDecisions: async () => 0,
    ...overrides,
  };
}

describe('a finished migration stops nagging', () => {
  it('leaves a done mapping out entirely', async () => {
    expect(await collectAttention(deps({ status: async () => 'done' }))).toEqual([]);
  });

  it('does not even read its queues', async () => {
    // Not just "reports nothing": a finished migration should cost the
    // appliance no queries every morning for the rest of its life.
    const listFailures = vi.fn(async () => []);
    await collectAttention(deps({ status: async () => 'done', listFailures }));
    expect(listFailures).not.toHaveBeenCalled();
  });

  it('still reports a mapping whose status could not be READ', async () => {
    // Unknown is not done. The mapping whose status failed to load is exactly
    // the one worth mentioning, and the failure rides along in its own words.
    const [one] = await collectAttention(
      deps({
        status: async () => {
          throw new Error('database is starting up');
        },
      }),
    );
    expect(one).toBeDefined();
    expect(one?.blindSpots?.[0]).toContain('database is starting up');
    expect(wantsAttention(one!)).toBe(true);
  });
});

describe('a blind spot is never a zero (hard rule 9)', () => {
  it('names the queue and keeps the server’s words', async () => {
    const [one] = await collectAttention(
      deps({
        listMoves: async () => {
          throw new Error('no such table: item');
        },
      }),
    );
    expect(one?.blindSpots).toEqual(['the moves queue: no such table: item']);
    // Every count is zero and it STILL wants attention — otherwise "I could
    // not look" would arrive as "nothing is waiting".
    expect(wantsAttention(one!)).toBe(true);
  });

  it('collects several blind spots rather than stopping at the first', async () => {
    const boom = async () => {
      throw new Error('boom');
    };
    const [one] = await collectAttention(
      deps({ listDeletions: boom, listMoves: boom, listFailures: boom }),
    );
    expect(one?.blindSpots).toHaveLength(3);
  });

  it('still counts the queues it COULD read', async () => {
    const [one] = await collectAttention(
      deps({
        listDeletions: async () => {
          throw new Error('boom');
        },
        listMoves: async () => [{}, {}],
      }),
    );
    expect(one?.movesWaiting).toBe(2);
    expect(one?.blindSpots).toHaveLength(1);
  });

  it('reports no blind spots at all when everything could be read', async () => {
    const [one] = await collectAttention(deps());
    expect(one?.blindSpots).toBeUndefined();
    expect(wantsAttention(one!)).toBe(false);
  });
});

describe('the decision count belongs to the tenant', () => {
  it('is taken once, however many mappings that tenant has', async () => {
    const countPendingDecisions = vi.fn(async () => 3);
    const result = await collectAttention(
      deps({
        mappings: [MAPPING, { mappingId: 'm-2', tenantId: 't-1' }],
        countPendingDecisions,
      }),
    );

    expect(countPendingDecisions).toHaveBeenCalledTimes(1);
    // Carried by the first, zero on the rest — three decisions reported twice
    // would tell the owner there are six.
    expect(result.map((r) => r.pendingDecisions)).toEqual([3, 0]);
  });

  it('is taken per tenant when the appliance serves more than one', async () => {
    const countPendingDecisions = vi.fn(async (tenantId: string) => (tenantId === 't-1' ? 1 : 2));
    const result = await collectAttention(
      deps({
        mappings: [MAPPING, { mappingId: 'm-2', tenantId: 't-2' }],
        countPendingDecisions,
      }),
    );
    expect(countPendingDecisions).toHaveBeenCalledTimes(2);
    expect(result.map((r) => r.pendingDecisions)).toEqual([1, 2]);
  });

  it('does not let a DONE first mapping swallow its tenant’s count', async () => {
    // The done mapping is skipped before the count is taken, so the next
    // reportable mapping carries it. Getting this wrong would silently drop
    // every pending decision for a tenant whose first mapping had finished.
    const result = await collectAttention(
      deps({
        mappings: [MAPPING, { mappingId: 'm-2', tenantId: 't-1' }],
        status: async (m) => (m.mappingId === 'm-1' ? 'done' : 'shadow'),
        countPendingDecisions: async () => 4,
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.pendingDecisions).toBe(4);
  });

  it('turns an unreadable decision queue into a blind spot, not a zero', async () => {
    const [one] = await collectAttention(
      deps({
        countPendingDecisions: async () => {
          throw new Error('permission denied for table decision');
        },
      }),
    );
    expect(one?.pendingDecisions).toBe(0);
    expect(one?.blindSpots?.[0]).toContain('permission denied for table decision');
    expect(wantsAttention(one!)).toBe(true);
  });
});

describe('what it reports', () => {
  it('flags a mapping waiting at the cutover gate', async () => {
    const [one] = await collectAttention(deps({ status: async () => 'cutover' }));
    expect(one?.readyForCutover).toBe(true);
    expect(wantsAttention(one!)).toBe(true);
  });

  it('uses the id the OWNER knows, not the ledger row id', async () => {
    // The digest prints this; it has to match what the screens and the config
    // file call the mapping.
    const [one] = await collectAttention(deps());
    expect(one?.mappingId).toBe('m-1');
  });

  it('returns an empty list when the appliance has no mappings at all', async () => {
    expect(await collectAttention(deps({ mappings: [] }))).toEqual([]);
  });
});

describe('collectTenantAttention (0043 T4)', () => {
  // The appliance twin of the managed rule. It exists for parity as much as for
  // correctness — hard rule 5 — and these assert the same things in the same
  // words as managed's, which is the point rather than duplication.

  it('counts a tenant decision even when every mapping is done', () => {
    // The hole: `collectAttention` skips a `done` mapping BEFORE its reads, so
    // an appliance whose migrations are finished never counted decisions at all.
    return expect(
      collectTenantAttention({
        mappings: [{ mappingId: 'm-1', tenantId: 't-1' }],
        status: async () => 'done',
        listDeletions: async () => [],
        listMoves: async () => [],
        listFailures: async () => [],
    countAutoApplied: async () => 0,
    countSharingOpen: async () => 0,
        countPendingDecisions: async () => 2,
      }),
    ).resolves.toEqual({ pendingDecisions: 2 });
  });

  it('counts each tenant once, however many mappings it has', () => {
    // Several mappings must not each claim the same tenant-level decision, or
    // the owner is told there are three when there is one.
    let calls = 0;
    return expect(
      collectTenantAttention({
        mappings: [
          { mappingId: 'm-1', tenantId: 't-1' },
          { mappingId: 'm-2', tenantId: 't-1' },
        ],
        status: async () => 'done',
        listDeletions: async () => [],
        listMoves: async () => [],
        listFailures: async () => [],
    countAutoApplied: async () => 0,
    countSharingOpen: async () => 0,
        countPendingDecisions: async () => {
          calls += 1;
          return 1;
        },
      }),
    ).resolves.toEqual({ pendingDecisions: 1 }).then(() => expect(calls).toBe(1));
  });

  it('reports a decision queue it could not READ, rather than zero', async () => {
    // "I could not look" is not "nothing is waiting" (rule 9).
    const out = await collectTenantAttention({
      mappings: [{ mappingId: 'm-1', tenantId: 't-1' }],
      status: async () => 'done',
      listDeletions: async () => [],
      listMoves: async () => [],
      listFailures: async () => [],
    countAutoApplied: async () => 0,
    countSharingOpen: async () => 0,
      countPendingDecisions: async () => {
        throw new Error('decisions table unreachable');
      },
    });

    expect(out.pendingDecisions).toBeUndefined();
    expect(out.blindSpots?.[0]).toContain('decisions table unreachable');
  });

  it('says nothing at all when there is genuinely nothing pending', async () => {
    // Silence stays the signal: an empty result must render no email.
    const out = await collectTenantAttention({
      mappings: [{ mappingId: 'm-1', tenantId: 't-1' }],
      status: async () => 'done',
      listDeletions: async () => [],
      listMoves: async () => [],
      listFailures: async () => [],
    countAutoApplied: async () => 0,
    countSharingOpen: async () => 0,
      countPendingDecisions: async () => 0,
    });

    expect(out).toEqual({});
  });
});

