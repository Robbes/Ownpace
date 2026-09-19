// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `performRollback` — the one rollback, over fakes that record what was
 * written and in what order (ADR-0047).
 *
 * Every case here is a way the two old implementations disagreed, or a way a
 * single one could still go half-way. The integration test beside the job
 * drives the same function against a real ledger; this pins the RULE.
 */

import { describe, it, expect, vi } from 'vitest';
import { asMappingId, asTenantId } from '@openmig/shared';
import { performRollback, RollbackRefused, TARGET_MAIL_STAYS } from './cutover-rollback.ts';
import type { CutoverState } from './cutover-state.ts';

const TENANT = asTenantId('5e1b0000-e29b-41d4-a716-446655440701' as never);
const MAPPING = asMappingId('5e1b0000-e29b-41d4-a716-446655440702' as never);

function harness(cutoverState: CutoverState | undefined, mappingStatus: string) {
  const order: string[] = [];
  const store = {
    loadCutoverState: vi.fn(async () =>
      cutoverState ? { state: cutoverState, currentState: cutoverState } : undefined,
    ),
    transitionState: vi.fn(async (_t: unknown, _m: unknown, to: CutoverState) => {
      order.push(`ledger:${to}`);
      return { state: to, currentState: to };
    }),
  };
  const mapping = {
    readStatus: vi.fn(async () => mappingStatus),
    setStatus: vi.fn(async (c: { from: string; to: string }) => {
      order.push(`mapping:${c.from}->${c.to}`);
    }),
  };
  const logs: string[] = [];
  return {
    order,
    store,
    mapping,
    logs,
    deps: (extra: Partial<Parameters<typeof performRollback>[0]> = {}) => ({
      tenantId: TENANT,
      mappingId: MAPPING,
      cutoverStore: store as never,
      mapping,
      rolledBackBy: 'test',
      reason: 'because',
      log: (m: string) => logs.push(m),
      ...extra,
    }),
  };
}

describe('performRollback — the setback, whole or not at all', () => {
  it('reactivates the mapping BEFORE marking the ledger, from GRACE_PERIOD', async () => {
    const h = harness('GRACE_PERIOD', 'cutover');

    const outcome = await performRollback(h.deps());

    // The order is the point: ROLLED_BACK is terminal, so the write that can
    // be retried has to come first.
    expect(h.order).toEqual(['mapping:cutover->active', 'ledger:ROLLED_BACK']);
    expect(outcome).toMatchObject({
      state: 'ROLLED_BACK',
      from: 'GRACE_PERIOD',
      mapping: { from: 'cutover', to: 'active', changed: true },
      notified: 'not_asked',
    });
  });

  it("records the mapping half in the cutover event's metadata", async () => {
    const h = harness('CUTOVER_IN_PROGRESS', 'cutover');

    await performRollback(h.deps({ rolledBackBy: 'cli', reason: 'mail bouncing' }));

    expect(h.store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'ROLLED_BACK',
      expect.objectContaining({
        rolledBackBy: 'cli',
        rollbackReason: 'mail bouncing',
        resumedSync: true,
        mappingStatus: 'active',
      }),
    );
  });

  it("leaves an 'active' mapping alone, says so, and still marks the ledger", async () => {
    // The CLI-driven cutover never touches the mapping, so this is the common
    // case there. The old job would have rewritten active -> active and the
    // old CLI would have warned that nothing resumed; both wrong.
    const h = harness('GRACE_PERIOD', 'active');

    const outcome = await performRollback(h.deps());

    expect(h.mapping.setStatus).not.toHaveBeenCalled();
    expect(h.order).toEqual(['ledger:ROLLED_BACK']);
    expect(outcome.mapping).toMatchObject({ from: 'active', to: 'active', changed: false });
    expect(outcome.mapping.note).toContain('already syncing');
    expect(h.store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'ROLLED_BACK',
      expect.objectContaining({ resumedSync: false, mappingStatus: 'active' }),
    );
  });

  it("refuses a 'done' mapping before writing ANYTHING — not the ledger either", async () => {
    const h = harness('GRACE_PERIOD', 'done');

    await expect(performRollback(h.deps())).rejects.toBeInstanceOf(RollbackRefused);

    expect(h.order).toEqual([]);
    expect(h.mapping.setStatus).not.toHaveBeenCalled();
    expect(h.store.transitionState).not.toHaveBeenCalled();
  });

  it('refuses when there is no cutover state, and reads the mapping not at all', async () => {
    const h = harness(undefined, 'cutover');

    await expect(performRollback(h.deps())).rejects.toThrow(/nothing to roll back/);

    expect(h.mapping.readStatus).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
  });

  it('refuses a cutover state the machine does not roll back from, naming it, touching nothing', async () => {
    const h = harness('COMPLETED', 'cutover');

    const err = await performRollback(h.deps()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RollbackRefused);
    expect((err as Error).message).toContain('COMPLETED');
    expect((err as RollbackRefused).hint).toContain('terminal');
    expect(h.order).toEqual([]);
  });

  it('rolls back from FAILED — the state a propagation timeout leaves behind', async () => {
    const h = harness('FAILED', 'cutover');

    const outcome = await performRollback(h.deps());

    expect(outcome.from).toBe('FAILED');
    expect(h.order).toEqual(['mapping:cutover->active', 'ledger:ROLLED_BACK']);
  });

  it('a notification that fails does not undo a rollback that succeeded', async () => {
    const h = harness('GRACE_PERIOD', 'cutover');

    const outcome = await performRollback(
      h.deps({
        notify: async () => {
          throw new Error('SMTP down');
        },
      }),
    );

    expect(h.order).toEqual(['mapping:cutover->active', 'ledger:ROLLED_BACK']);
    expect(outcome.notified).toEqual({ failed: 'SMTP down' });
  });

  it('notifies only after both writes, and reports that it did', async () => {
    const h = harness('GRACE_PERIOD', 'cutover');
    const notify = vi.fn(async () => {
      h.order.push('notify');
    });

    const outcome = await performRollback(h.deps({ notify }));

    expect(h.order).toEqual(['mapping:cutover->active', 'ledger:ROLLED_BACK', 'notify']);
    expect(outcome.notified).toBe('sent');
  });

  it('says out loud that mail on the target stays there', async () => {
    const h = harness('GRACE_PERIOD', 'cutover');

    await performRollback(h.deps());

    expect(h.logs).toContain(TARGET_MAIL_STAYS);
  });
});
