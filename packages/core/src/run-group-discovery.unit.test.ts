// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Running shared-address discovery (workplan 0027 T1).
 *
 * `classify-shared-address.unit.test.ts` proves what an address IS. This
 * proves what happens around it, and every test is a production failure mode:
 * a source that cannot look reporting "no shared addresses", a member list
 * that failed arriving as an empty group, and one bad group stopping the rest.
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId } from '@openmig/shared';
import type { DiscoveredGroup } from '@openmig/shared';
import { runGroupDiscovery, type GroupDiscoveryDeps, type RecordGroupInput } from './run-group-discovery';

const TENANT = asTenantId('22222222-2222-4222-8222-222222222222' as never);
const CONN = '33333333-3333-4333-8333-333333333333';

const DL: DiscoveredGroup = {
  id: 'g1',
  address: 'sales@acme.nl',
  displayName: 'Sales',
  store: 'no_store',
  members: { kind: 'listed', addresses: ['rob@acme.nl', 'jan@acme.nl'] },
};

const M365: DiscoveredGroup = {
  id: 'g2',
  address: 'team@acme.nl',
  store: 'has_store',
  members: { kind: 'listed', addresses: [] },
};

function deps(overrides: Partial<GroupDiscoveryDeps> = {}): GroupDiscoveryDeps & {
  recorded: RecordGroupInput[];
  warnings: string[];
  errors: string[];
} {
  const recorded: RecordGroupInput[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    recorded,
    warnings,
    errors,
    tenantId: TENANT,
    sourceConnectionId: CONN,
    listGroups: async () => ({ kind: 'listed', groups: [DL] }),
    record: async (input) => {
      recorded.push(input);
      return { created: true };
    },
    warn: (m) => warnings.push(m),
    error: (m) => errors.push(m),
    ...overrides,
  };
}

describe('the happy path', () => {
  it('records a discovered group with its pattern and members', async () => {
    const d = deps();
    const summary = await runGroupDiscovery(d);

    expect(summary).toMatchObject({ discovered: 1, known: 0, unclassified: 0, failed: 0 });
    expect(d.recorded[0]).toMatchObject({
      sourceConnectionId: CONN,
      address: 'sales@acme.nl',
      sourceGroupId: 'g1',
      displayName: 'Sales',
      pattern: 'distribution_d',
      membersKnown: true,
    });
    expect(d.recorded[0]?.members).toEqual(['rob@acme.nl', 'jan@acme.nl']);
  });

  it('classifies an M365 group with a store as Pattern S', async () => {
    const d = deps({ listGroups: async () => ({ kind: 'listed', groups: [M365] }) });
    await runGroupDiscovery(d);
    expect(d.recorded[0]?.pattern).toBe('shared_s');
  });

  it('counts a group it already knew as known, not discovered', async () => {
    // Rule 1: discovery runs before every migration and again during shadow.
    // The second pass is not news.
    const d = deps({ record: async () => ({ created: false }) });
    expect(await runGroupDiscovery(d)).toMatchObject({ discovered: 0, known: 1 });
  });
});

describe('a source that could not be asked', () => {
  it('warns and records NOTHING', async () => {
    const d = deps({
      listGroups: async () => ({
        kind: 'not_enumerable',
        reason: 'IMAP has no directory — nothing was looked at',
      }),
    });
    const summary = await runGroupDiscovery(d);

    // Recording zero groups here would put "no shared addresses" on the
    // Review & confirm screen — a claim about the owner's organisation that
    // nobody checked (rule 9).
    expect(d.recorded).toEqual([]);
    expect(summary.blindSpot).toContain('IMAP has no directory');
    expect(d.warnings).toHaveLength(1);
  });

  it('warns on EVERY run, not just the first', async () => {
    const d = deps({ listGroups: async () => ({ kind: 'not_enumerable', reason: 'nope' }) });
    await runGroupDiscovery(d);
    await runGroupDiscovery(d);
    expect(d.warnings).toHaveLength(2);
  });
});

describe('a group the source could not classify', () => {
  it('records it WITHOUT a pattern and counts it as an open question', async () => {
    const d = deps({
      listGroups: async () => ({
        kind: 'listed',
        groups: [{ ...DL, store: 'unknown' }],
      }),
    });
    const summary = await runGroupDiscovery(d);

    // Recorded, because the address is a real finding; unclassified, because
    // §11.2 designed the S-or-D question to be ASKED rather than guessed.
    expect(d.recorded[0]?.pattern).toBeUndefined();
    expect(summary).toMatchObject({ discovered: 1, unclassified: 1 });
  });
});

describe('a member list that could not be read', () => {
  it('records the group, flags the membership as unread, and says so', async () => {
    const d = deps({
      listGroups: async () => ({
        kind: 'listed',
        groups: [{ ...DL, members: { kind: 'not_enumerable', reason: 'Graph answered 403' } }],
      }),
    });
    const summary = await runGroupDiscovery(d);

    // The group exists — that much WAS read, and dropping it would hide a
    // real shared address. But Pattern D recreates from the member list, so
    // an unread one must not reach the target as an empty group.
    expect(d.recorded[0]).toMatchObject({ address: 'sales@acme.nl', membersKnown: false });
    expect(d.recorded[0]?.members).toEqual([]);
    expect(summary).toMatchObject({ discovered: 1, membersUnknown: 1 });
    expect(d.warnings[0]).toContain('Graph answered 403');
  });

  it('does NOT flag a group that genuinely has no members', async () => {
    const d = deps({ listGroups: async () => ({ kind: 'listed', groups: [M365] }) });
    const summary = await runGroupDiscovery(d);

    expect(d.recorded[0]?.membersKnown).toBe(true);
    expect(summary.membersUnknown).toBe(0);
  });
});

describe('when something fails', () => {
  it('keeps going after a write throws, and reports it', async () => {
    const record = vi.fn(async (input: RecordGroupInput) => {
      if (input.address === 'sales@acme.nl') throw new Error('duplicate key');
      return { created: true };
    });
    const d = deps({
      listGroups: async () => ({ kind: 'listed', groups: [DL, M365] }),
      record: record as unknown as GroupDiscoveryDeps['record'],
    });
    const summary = await runGroupDiscovery(d);

    // A tenant with one problematic group still gets the others.
    expect(summary).toMatchObject({ discovered: 1, failed: 1 });
    expect(d.errors[0]).toContain('sales@acme.nl');
  });

  it('does not count an unclassified group it failed to record', async () => {
    const d = deps({
      listGroups: async () => ({ kind: 'listed', groups: [{ ...DL, store: 'unknown' }] }),
      record: async () => {
        throw new Error('database is down');
      },
    });
    const summary = await runGroupDiscovery(d);

    // An address nobody recorded is not an open question, it is a lost one —
    // and a summary saying "1 to decide" with nothing in the ledger to decide
    // about sends the owner to a screen that shows nothing.
    expect(summary).toMatchObject({ failed: 1, unclassified: 0, membersUnknown: 0 });
  });
});
