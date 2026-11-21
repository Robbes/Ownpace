// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The loop *Delete all of these here too* orders a run with (workplan 0164
 * T3): in turn, each answered before the next is ordered; the breaker stops
 * the rest of its data type and no other; a stop is honoured between items;
 * a failure is that item's result. What each press decides is the gates',
 * and `packages/core/src/a-delete-all-through-every-gate.unit.test.ts` runs
 * this loop over the real `applyDeletion`.
 */

import { describe, it, expect } from 'vitest';
import { applyEachInTurn, BREAKER_CODES, type ApplyEachItem, type OneApplyAnswer } from './apply-each-in-turn.ts';

const item = (naturalKeyHash: string, domain: ApplyEachItem['domain'] = 'calendar'): ApplyEachItem => ({
  naturalKeyHash,
  domain,
});

const removed: OneApplyAnswer = { ok: true };
const refused = (code: string): OneApplyAnswer => ({ ok: false, code, reason: `the gate said ${code}` });

describe('in turn', () => {
  it('orders the next item only once the one before it has answered', async () => {
    const events: string[] = [];
    let release!: () => void;
    const firstHeld = new Promise<void>((resolve) => (release = resolve));

    const run = applyEachInTurn([item('a'), item('b')], async (it) => {
      events.push(`start ${it.naturalKeyHash}`);
      if (it.naturalKeyHash === 'a') await firstHeld;
      events.push(`end ${it.naturalKeyHash}`);
      return removed;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['start a']);
    release();
    await run;
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('gives every item exactly one result, in the order given, and tells each as it is known', async () => {
    const told: string[] = [];
    const results = await applyEachInTurn(
      [item('a'), item('b'), item('c')],
      async (it) => (it.naturalKeyHash === 'b' ? refused('not_ours') : removed),
      { onResult: (r) => told.push(r.item.naturalKeyHash) },
    );
    expect(results.map((r) => r.item.naturalKeyHash)).toEqual(['a', 'b', 'c']);
    expect(told).toEqual(['a', 'b', 'c']);
    // A refusal that is not the breaker's leaves the rest going on.
    expect(results[1]).toEqual({ item: item('b'), answered: refused('not_ours') });
    expect(results[2]).toEqual({ item: item('c'), answered: removed });
  });
});

describe('the breaker', () => {
  it.each([...BREAKER_CODES])('%s stops the rest of its data type, and no other', async (code) => {
    const ordered: string[] = [];
    const results = await applyEachInTurn(
      [item('a'), item('b'), item('m', 'email'), item('c'), item('n', 'email')],
      async (it) => {
        ordered.push(it.naturalKeyHash);
        return it.naturalKeyHash === 'b' ? refused(code) : removed;
      },
    );
    expect(ordered).toEqual(['a', 'b', 'm', 'n']);
    expect(results[3]).toEqual({
      item: item('c'),
      notTried: { by: 'breaker', code, reason: `the gate said ${code}` },
    });
    expect(results[4]).toEqual({ item: item('n', 'email'), answered: removed });
  });

  it('is the only refusal that stops anything', async () => {
    const ordered: string[] = [];
    await applyEachInTurn(
      ['not_enabled', 'after_cutover', 'edited_on_target', 'weak_evidence', 'removed_not_recorded'].map((c) => item(c)),
      async (it) => {
        ordered.push(it.naturalKeyHash);
        return refused(it.naturalKeyHash);
      },
    );
    expect(ordered).toHaveLength(5);
  });
});

describe('a stop', () => {
  it('is asked before each order, and nothing after it is ordered', async () => {
    let stop = false;
    const ordered: string[] = [];
    const results = await applyEachInTurn(
      [item('a'), item('b'), item('c')],
      async (it) => {
        ordered.push(it.naturalKeyHash);
        if (it.naturalKeyHash === 'a') stop = true;
        return removed;
      },
      { stopRequested: () => stop },
    );
    expect(ordered).toEqual(['a']);
    expect(results.slice(1)).toEqual([
      { item: item('b'), notTried: { by: 'stop' } },
      { item: item('c'), notTried: { by: 'stop' } },
    ]);
  });
});

describe('a failure', () => {
  it('is that item’s result, said in its own words, and the next item is ordered', async () => {
    const results = await applyEachInTurn([item('a'), item('b')], async (it) => {
      if (it.naturalKeyHash === 'a') throw new Error('the request did not complete');
      return removed;
    });
    expect(results).toEqual([
      { item: item('a'), failed: 'the request did not complete' },
      { item: item('b'), answered: removed },
    ]);
  });
});
