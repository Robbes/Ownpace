// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { listImapGroups } from '@openmig/connectors';
import { runGroupDiscovery, type GroupDiscoveryDeps, type RecordGroupInput } from './run-group-discovery.ts';

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

describe('a source with no directory at all (IMAP)', () => {
  it('is RUN, not skipped, and its refusal becomes the stated blind spot', async () => {
    // This is what `listImapGroups()` is for, and for a day it was for
    // nothing: both editions skipped an IMAP-only tenant entirely, so the
    // operator got no rows, no warning and no reason. Silence and "you have
    // none" are the same output — the failure hard rule 9 exists to prevent.
    const d = deps({ listGroups: async () => listImapGroups() });
    const summary = await runGroupDiscovery(d);

    expect(summary.blindSpot).toContain('IMAP has no directory');
    expect(d.recorded).toEqual([]);
    expect(d.warnings).toHaveLength(1);
    // And it names the way out, rather than leaving the operator stuck.
    expect(d.warnings[0]).toContain('entered by hand');
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

describe('asking which pattern it is (workplan 0028 T3)', () => {
  function asking(overrides: Partial<GroupDiscoveryDeps> = {}) {
    const raised: string[] = [];
    const announced: string[] = [];
    const d = deps({
      listGroups: async () => ({ kind: 'listed', groups: [{ ...DL, store: 'unknown' }] }),
      raise: async (input) => {
        raised.push(input.subjectKey);
        return { created: true, id: `decision-${input.subjectKey}` };
      },
      onRaised: async (input) => {
        announced.push(input.subjectKey);
      },
      ...overrides,
    });
    return { d, raised, announced };
  }

  it('raises a shared_address_pattern decision for an address it could not classify', async () => {
    const { d, raised, announced } = asking();
    const summary = await runGroupDiscovery(d);

    expect(raised).toEqual(['sales@acme.nl']);
    expect(announced).toEqual(['sales@acme.nl']);
    expect(summary).toMatchObject({ unclassified: 1, asked: 1, alreadyAsked: 0 });
  });

  it('does NOT ask about an address it could classify', async () => {
    // A group we can tell apart is not a question, and asking anyway is the
    // noise that teaches owners to ignore the queue.
    const { d, raised } = asking({
      listGroups: async () => ({ kind: 'listed', groups: [DL, M365] }),
    });
    const summary = await runGroupDiscovery(d);

    expect(raised).toEqual([]);
    expect(summary.asked).toBe(0);
  });

  it('keys the question on the ADDRESS, not the group id', async () => {
    const { d } = asking();
    let seen: { subjectKey: string; category: string } | undefined;
    const withCapture = deps({
      ...d,
      raise: async (input) => {
        seen = { subjectKey: input.subjectKey, category: input.category };
        return { created: true, id: 'x' };
      },
    });
    await runGroupDiscovery(withCapture);

    // A group renamed or recreated with the same address is the SAME open
    // question; the partial unique index is on (tenant, category, subject).
    expect(seen).toEqual({ subjectKey: 'sales@acme.nl', category: 'shared_address_pattern' });
  });

  it('proposes NO default — that is what is being asked', async () => {
    let proposed: string | undefined = 'set';
    const d = deps({
      listGroups: async () => ({ kind: 'listed', groups: [{ ...DL, store: 'unknown' }] }),
      raise: async (input) => {
        proposed = input.proposedDefault;
        return { created: true, id: 'x' };
      },
    });
    await runGroupDiscovery(d);

    // The screen renders `proposedDefault` as an accept button. A default
    // here would be the guess this whole category exists to avoid.
    expect(proposed).toBeUndefined();
  });

  it('does not re-announce a question that was already open', async () => {
    // The store's raise is idempotent. Without this, a daily pass would email
    // about the same address every morning until it was answered.
    const { d, announced } = asking({ raise: async () => ({ created: false, id: 'existing' }) });
    const summary = await runGroupDiscovery(d);

    expect(announced).toEqual([]);
    expect(summary).toMatchObject({ asked: 0, alreadyAsked: 1 });
  });

  it('keeps the group recorded when the question could not be raised', async () => {
    const { d } = asking({
      raise: async () => {
        throw new Error('database is down');
      },
    });
    const summary = await runGroupDiscovery(d);

    // The address is discovered either way; the next pass asks again.
    expect(d.recorded).toHaveLength(1);
    expect(summary).toMatchObject({ discovered: 1, asked: 0 });
    expect(d.errors[0]).toContain('could not ask which pattern');
  });

  it('keeps the question when the announcement fails', async () => {
    const { d } = asking({
      onRaised: async () => {
        throw new Error('535 authentication failed');
      },
    });
    const summary = await runGroupDiscovery(d);

    // The decision is in the queue and the screen will show it; the email was
    // the courtesy. Losing the courtesy must not lose the record.
    expect(summary.asked).toBe(1);
    expect(d.errors[0]).toContain('could not announce it');
  });

  it('discovers without asking when no queue is wired', async () => {
    // The dep is optional: an edition that discovers but has no decision
    // queue records the group and says nothing, rather than crashing.
    const d = deps({ listGroups: async () => ({ kind: 'listed', groups: [{ ...DL, store: 'unknown' }] }) });
    const summary = await runGroupDiscovery(d);

    expect(summary).toMatchObject({ discovered: 1, unclassified: 1, asked: 0 });
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
