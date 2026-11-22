// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The loop *Delete all of these here too* orders a run with (workplan 0164
 * T3): in turn, each answered before the next is ordered; a press that did
 * not answer, the breaker's refusal, `not_enabled`, `removed_not_recorded`
 * and an answer marked `stopsTheRun` each stop the whole run; any other
 * refusal is that item's answer and the next is ordered; a stop is honoured
 * between items. What each press decides is the gates', and
 * `packages/core/src/a-delete-all-through-every-gate.unit.test.ts` runs this
 * loop over the real `applyDeletion`.
 */

import { describe, it, expect } from 'vitest';
import {
  applyEachInTurn,
  BREAKER_CODES,
  RUN_STOPPING_REFUSALS,
  type ApplyEachItem,
  type OneApplyAnswer,
} from './apply-each-in-turn.ts';

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
    // A refusal of that item alone leaves the rest going on.
    expect(results[1]).toEqual({ item: item('b'), answered: refused('not_ours') });
    expect(results[2]).toEqual({ item: item('c'), answered: removed });
  });
});

describe('a refusal that speaks for every item', () => {
  it.each([...RUN_STOPPING_REFUSALS])('%s stops the whole run, every data type included', async (code) => {
    const ordered: string[] = [];
    const results = await applyEachInTurn(
      [item('a'), item('b'), item('m', 'email'), item('c')],
      async (it) => {
        ordered.push(it.naturalKeyHash);
        return it.naturalKeyHash === 'b' ? refused(code) : removed;
      },
    );
    expect(ordered).toEqual(['a', 'b']);
    const said = { by: 'refusal', code, reason: `the gate said ${code}` };
    expect(results.slice(2)).toEqual([
      { item: item('m', 'email'), notTried: said },
      { item: item('c'), notTried: said },
    ]);
  });

  it('is the breaker’s, deleting by hand turned off, or a removal the ledger could not record, and no other', () => {
    expect([...RUN_STOPPING_REFUSALS].sort()).toEqual(
      [...BREAKER_CODES, 'not_enabled', 'removed_not_recorded'].sort(),
    );
  });

  it('does not include any other refusal: each of those is its own item’s answer', async () => {
    const codes = ['after_cutover', 'edited_on_target', 'weak_evidence', 'not_ours', 'already_kept', 'already_applied'];
    const ordered: string[] = [];
    await applyEachInTurn(
      codes.map((c) => item(c)),
      async (it) => {
        ordered.push(it.naturalKeyHash);
        return refused(it.naturalKeyHash);
      },
    );
    expect(ordered).toEqual(codes);
  });
});

describe('an answer marked as stopping the run', () => {
  it('stops it whatever its code, and a code alone that is no gate’s does not', async () => {
    const ordered: string[] = [];
    const results = await applyEachInTurn([item('a'), item('b'), item('c')], async (it) => {
      ordered.push(it.naturalKeyHash);
      if (it.naturalKeyHash === 'a') return { ok: false, code: 'something_new', reason: 'not a gate' };
      if (it.naturalKeyHash === 'b') {
        return { ok: false, code: 'platform_held', reason: 'Nothing was started.', stopsTheRun: true };
      }
      return removed;
    });
    expect(ordered).toEqual(['a', 'b']);
    expect(results[2]).toEqual({
      item: item('c'),
      notTried: { by: 'refusal', code: 'platform_held', reason: 'Nothing was started.' },
    });
  });
});

describe('a press that did not answer', () => {
  it('is that item’s result, said in its own words, and nothing after it is ordered', async () => {
    const ordered: string[] = [];
    const results = await applyEachInTurn([item('a'), item('b'), item('k', 'contact')], async (it) => {
      ordered.push(it.naturalKeyHash);
      if (it.naturalKeyHash === 'a') throw new Error('the request did not complete');
      return removed;
    });
    expect(ordered).toEqual(['a']);
    expect(results).toEqual([
      { item: item('a'), failed: 'the request did not complete' },
      { item: item('b'), notTried: { by: 'failure' } },
      { item: item('k', 'contact'), notTried: { by: 'failure' } },
    ]);
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
