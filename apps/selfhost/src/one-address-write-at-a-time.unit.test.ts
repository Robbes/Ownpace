// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE WRITE ON THE PAGE AT A TIME (`oneAtATime`, address-changes.ts).
 *
 * The queue keeps the order of the writes on the address-change page, and a
 * write that fails hands its failure to the request that asked for it, and
 * to nobody else: the next write waits for it to settle and then runs.
 * Since 2026-11-23 the queue keeps that order with `Promise.allSettled`,
 * where a catch that dropped the error kept it before (workplan 0163).
 */

import { describe, it, expect } from 'vitest';
import type { LedgerDriver } from '@openmig/ledger';
import { oneAtATime } from './address-changes.ts';

describe('one write on the page at a time', () => {
  it('a write that fails is its caller’s failure, and the next runs after it settles', async () => {
    const driver = {} as LedgerDriver;
    const failed = new Error('the first write failed');
    const order: string[] = [];
    let failFirst!: () => void;

    const first = oneAtATime(driver, async () => {
      order.push('first starts');
      await new Promise<void>((resolve) => (failFirst = resolve));
      order.push('first fails');
      throw failed;
    });
    const second = oneAtATime(driver, async () => {
      order.push('second starts');
      return 'second written';
    });

    // The second waits while the first is out.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['first starts']);

    failFirst();
    await expect(first).rejects.toBe(failed);
    await expect(second).resolves.toBe('second written');
    expect(order).toEqual(['first starts', 'first fails', 'second starts']);
  });

});
