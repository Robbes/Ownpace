// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `enterCutover` and `closeCutover` — the two cutover steps that stop the
 * mapping, over fakes that record what was written and in what order
 * (ADR-0048).
 *
 * Every case is a way the old `execute` went half-way (ledger moved, mapping
 * untouched) or a way this one could still. The integration test beside the
 * CLI drives the same functions against a real ledger; this pins the RULE.
 */

import { describe, it, expect, vi } from 'vitest';
import { asMappingId, asTenantId } from '@openmig/shared';
import { closeCutover, CutoverRefused, enterCutover } from './cutover-lifecycle.ts';
import type { CutoverState } from './cutover-state.ts';

const TENANT = asTenantId('5e1b0000-e29b-41d4-a716-446655440801' as never);
const MAPPING = asMappingId('5e1b0000-e29b-41d4-a716-446655440802' as never);

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
    deps: () => ({
      tenantId: TENANT,
      mappingId: MAPPING,
      cutoverStore: store as never,
      mapping,
      by: 'test',
      log: (m: string) => logs.push(m),
    }),
  };
}

describe('enterCutover — the mapping stops BEFORE the ledger says the cutover is in progress', () => {
  it("stops an 'active' mapping first, then moves APPROVED -> CUTOVER_IN_PROGRESS", async () => {
    const h = harness('APPROVED', 'active');

    const outcome = await enterCutover(h.deps());

    // The order is the point: CUTOVER_IN_PROGRESS beside a running mapping
    // is the defect, and `execute` refuses to run again from that state.
    expect(h.order).toEqual(['mapping:active->cutover', 'ledger:CUTOVER_IN_PROGRESS']);
    expect(h.mapping.setStatus).toHaveBeenCalledWith({ from: 'active', to: 'cutover', via: 'cutover' });
    expect(outcome).toMatchObject({
      state: 'CUTOVER_IN_PROGRESS',
      from: 'APPROVED',
      mapping: { from: 'active', to: 'cutover', changed: true },
    });
  });

  it("records the mapping half in the cutover event's metadata", async () => {
    const h = harness('APPROVED', 'active');

    await enterCutover(h.deps());

    expect(h.store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'CUTOVER_IN_PROGRESS',
      expect.objectContaining({ stoppedSync: true, mappingStatus: 'cutover', startedBy: 'test' }),
    );
  });

  it("stops a 'paused' mapping too — the phase moves on, and Start must not resume it", async () => {
    const h = harness('APPROVED', 'paused');

    const outcome = await enterCutover(h.deps());

    expect(h.order).toEqual(['mapping:paused->cutover', 'ledger:CUTOVER_IN_PROGRESS']);
    expect(outcome.mapping).toEqual({ from: 'paused', to: 'cutover', changed: true });
  });

  it("leaves 'continuous' alone, says why, and still moves the ledger", async () => {
    const h = harness('APPROVED', 'continuous');

    const outcome = await enterCutover(h.deps());

    expect(h.mapping.setStatus).not.toHaveBeenCalled();
    expect(h.order).toEqual(['ledger:CUTOVER_IN_PROGRESS']);
    expect(outcome.mapping).toMatchObject({ from: 'continuous', to: 'continuous', changed: false });
    expect(outcome.mapping.note).toContain('by design');
    expect(h.store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'CUTOVER_IN_PROGRESS',
      expect.objectContaining({ stoppedSync: false, mappingStatus: 'continuous' }),
    );
  });

  it("leaves 'done' alone and says out loud that a rollback will be refused", async () => {
    const h = harness('APPROVED', 'done');

    const outcome = await enterCutover(h.deps());

    expect(h.mapping.setStatus).not.toHaveBeenCalled();
    expect(outcome.mapping.changed).toBe(false);
    expect(outcome.mapping.warning).toContain('rollback');
    expect(h.logs.join('\n')).toContain('rollback');
  });

  it('refuses when there is no cutover state, and reads the mapping not at all', async () => {
    const h = harness(undefined, 'active');

    await expect(enterCutover(h.deps())).rejects.toBeInstanceOf(CutoverRefused);

    expect(h.mapping.readStatus).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
  });

  it('refuses a cutover state the machine does not enter from, naming the one it does, touching nothing', async () => {
    const h = harness('READY_FOR_CUTOVER', 'active');

    const err = await enterCutover(h.deps()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CutoverRefused);
    expect((err as CutoverRefused).message).toContain('READY_FOR_CUTOVER');
    expect((err as CutoverRefused).hint).toContain('APPROVED');
    expect(h.order).toEqual([]);
  });

  it('refuses a mapping lifecycle it does not know before writing anything', async () => {
    const h = harness('APPROVED', 'ready');

    await expect(enterCutover(h.deps())).rejects.toThrow("'ready' is not a mapping lifecycle");

    expect(h.order).toEqual([]);
  });

  it('a mapping write that fails leaves the ledger untouched — that is what the order buys', async () => {
    const h = harness('APPROVED', 'active');
    h.mapping.setStatus.mockRejectedValueOnce(new Error('connection reset'));

    await expect(enterCutover(h.deps())).rejects.toThrow('connection reset');

    expect(h.store.transitionState).not.toHaveBeenCalled();
  });
});

describe('closeCutover — the grace window closes, and nothing is left running behind a terminal ledger', () => {
  it("stops a mapping still 'active' — a cutover executed before ADR-0048 — BEFORE COMPLETED", async () => {
    const h = harness('GRACE_PERIOD', 'active');

    const outcome = await closeCutover(h.deps());

    expect(h.order).toEqual(['mapping:active->cutover', 'ledger:COMPLETED']);
    expect(outcome).toMatchObject({
      state: 'COMPLETED',
      from: 'GRACE_PERIOD',
      mapping: { from: 'active', to: 'cutover', changed: true },
    });
  });

  it("converges on a mapping already 'cutover': no mapping write, the ledger closes", async () => {
    const h = harness('GRACE_PERIOD', 'cutover');

    await closeCutover(h.deps());

    expect(h.mapping.setStatus).not.toHaveBeenCalled();
    expect(h.store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'COMPLETED',
      expect.objectContaining({ completedBy: 'test', stoppedSync: false, mappingStatus: 'cutover' }),
    );
  });

  it('refuses from any state but GRACE_PERIOD, naming it, touching nothing', async () => {
    const h = harness('CUTOVER_IN_PROGRESS', 'cutover');

    const err = await closeCutover(h.deps()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CutoverRefused);
    expect((err as CutoverRefused).hint).toContain('GRACE_PERIOD');
    expect(h.order).toEqual([]);
  });
});
