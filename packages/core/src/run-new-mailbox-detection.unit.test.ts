// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Running the detector (workplan 0028 T2).
 *
 * `detect-new-mailboxes.unit.test.ts` proves what gets raised. This proves
 * what happens around it, and every test here is a production failure mode:
 * the same email twenty-four times a day, a blind spot that reads as "all
 * covered", one bad mailbox stopping the rest, and a bounced email losing the
 * decision it was announcing.
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId } from '@openmig/shared';
import { runNewMailboxDetection, type DetectionDeps } from './run-new-mailbox-detection';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111' as never);

function deps(overrides: Partial<DetectionDeps> = {}): DetectionDeps & {
  raised: string[];
  announced: string[];
  warnings: string[];
  errors: string[];
} {
  const raised: string[] = [];
  const announced: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    raised,
    announced,
    warnings,
    errors,
    tenantId: TENANT,
    listDirectory: async () => ({ kind: 'listed', addresses: ['info@acme.nl'] }),
    coveredAddresses: async () => [],
    dismissedAddresses: async () => [],
    raise: async (input) => {
      raised.push(input.subjectKey);
      return { created: true };
    },
    onRaised: async (input) => {
      announced.push(input.subjectKey);
    },
    warn: (m) => warnings.push(m),
    error: (m) => errors.push(m),
    ...overrides,
  };
}

describe('the happy path', () => {
  it('raises and announces a new mailbox', async () => {
    const d = deps();
    const summary = await runNewMailboxDetection(d);

    expect(summary).toMatchObject({ raised: 1, alreadyPending: 0, failed: 0 });
    expect(d.raised).toEqual(['info@acme.nl']);
    expect(d.announced).toEqual(['info@acme.nl']);
  });

  it('says nothing at all when everything is covered', async () => {
    const d = deps({ coveredAddresses: async () => ['info@acme.nl'] });
    const summary = await runNewMailboxDetection(d);

    expect(summary).toMatchObject({ raised: 0, alreadyPending: 0 });
    expect(d.announced).toEqual([]);
    expect(d.warnings).toEqual([]);
  });
});

describe('one condition, one email', () => {
  it('does NOT announce a subject that was already pending', async () => {
    // The store's raise is idempotent. Without this check, an hourly detector
    // would email about the same mailbox twenty-four times a day until it was
    // answered — and the channel would be filtered by the second day.
    const d = deps({ raise: async () => ({ created: false }) });
    const summary = await runNewMailboxDetection(d);

    expect(summary).toMatchObject({ raised: 0, alreadyPending: 1 });
    expect(d.announced).toEqual([]);
  });

  it('still counts it, so a working detector does not look idle', async () => {
    const d = deps({ raise: async () => ({ created: false }) });
    expect((await runNewMailboxDetection(d)).alreadyPending).toBe(1);
  });
});

describe('a directory that could not be read', () => {
  it('warns every run and raises nothing', async () => {
    const d = deps({
      listDirectory: async () => ({
        kind: 'not_enumerable',
        reason: 'delegated permissions cannot enumerate a tenant',
      }),
    });
    const summary = await runNewMailboxDetection(d);

    expect(summary.blindSpot).toContain('delegated permissions');
    expect(d.raised).toEqual([]);
    // No decisions AND no message would read as "all covered". The warning is
    // the most important output this run has.
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain('delegated permissions cannot enumerate a tenant');
  });

  it('warns on EVERY run, not just the first', async () => {
    const d = deps({
      listDirectory: async () => ({ kind: 'not_enumerable', reason: 'nope' }),
    });
    await runNewMailboxDetection(d);
    await runNewMailboxDetection(d);
    // An operator reading today's log must see that today's run could not
    // look, without digging back to when it started.
    expect(d.warnings).toHaveLength(2);
  });
});

describe('when something fails', () => {
  it('keeps going after a raise throws, and reports it', async () => {
    const raise = vi.fn(async (input: { subjectKey: string }) => {
      if (input.subjectKey === 'bad@acme.nl') throw new Error('duplicate key');
      return { created: true };
    });
    const d = deps({
      listDirectory: async () => ({
        kind: 'listed',
        addresses: ['bad@acme.nl', 'good@acme.nl'],
      }),
      raise: raise as unknown as DetectionDeps['raise'],
    });
    const summary = await runNewMailboxDetection(d);

    // A tenant with one problematic mailbox still hears about the others.
    expect(summary).toMatchObject({ raised: 1, failed: 1 });
    expect(d.announced).toEqual(['good@acme.nl']);
    expect(d.errors).toHaveLength(1);
    expect(d.errors[0]).toContain('bad@acme.nl');
  });

  it('keeps the decision when the announcement fails', async () => {
    const d = deps({
      onRaised: async () => {
        throw new Error('535 authentication failed');
      },
    });
    const summary = await runNewMailboxDetection(d);

    // The decision is in the queue and the screen will show it; the email was
    // the courtesy. Losing the courtesy must not lose the record.
    expect(summary.raised).toBe(1);
    expect(d.raised).toEqual(['info@acme.nl']);
    expect(d.errors[0]).toContain('could not announce it');
  });

  it('does not announce a decision it failed to raise', async () => {
    const d = deps({
      raise: async () => {
        throw new Error('database is down');
      },
    });
    await runNewMailboxDetection(d);
    // Announcing something that is not in the queue would send the owner to a
    // screen that does not show it.
    expect(d.announced).toEqual([]);
  });
});
