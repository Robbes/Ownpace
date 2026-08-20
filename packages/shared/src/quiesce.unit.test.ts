// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The decision that stands between a leaving customer and a duplicated mailbox
 * (workplan 0085 T8).
 *
 * Two failures are possible and they are not symmetric, so the tests are not
 * either. Purging under a live pass re-copies everything into the target of
 * somebody who just asked to leave — a data incident they experience. Blocking
 * forever breaks a promised erasure date — serious, but visible and
 * recoverable. So every uncertain case must resolve to "do not purge", and the
 * tests below spend most of their effort proving exactly that.
 */

import { describe, it, expect } from 'vitest';
import { quiescePlan, DEFAULT_STALE_AFTER_MS, type QuiescingRun } from './quiesce.ts';

const NOW = new Date('2026-08-19T12:00:00Z');
const agoMs = (ms: number) => new Date(NOW.getTime() - ms);

const run = (over: Partial<QuiescingRun> = {}): QuiescingRun => ({
  id: 'run-1',
  status: 'running',
  since: agoMs(60_000),
  verdict: 'unknown',
  ...over,
});

describe('nothing in flight', () => {
  it('purges', () => {
    const plan = quiescePlan([], NOW);
    expect(plan.mayPurge).toBe(true);
    expect(plan.blockedBy).toEqual([]);
    expect(plan.landStale).toEqual([]);
    expect(plan.cancel).toEqual([]);
    expect(plan.needsAttention).toBe(false);
  });
});

describe('the orchestrator says it is still executing', () => {
  const plan = quiescePlan([run({ orchestratorRef: 'tr_1', verdict: 'live' })], NOW);

  it('does NOT purge — this is the case the rule exists for', () => {
    expect(plan.mayPurge).toBe(false);
  });

  it('asks it to stop, which is the half that was missing', () => {
    // Before this, a live pass was waited out and never stopped.
    expect(plan.cancel).toEqual(['run-1']);
  });

  it('does not land a run that is genuinely running', () => {
    expect(plan.landStale).toEqual([]);
  });

  it('is ordinary waiting, not something to page a human about', () => {
    expect(plan.needsAttention).toBe(false);
  });
});

describe('the orchestrator says it is finished', () => {
  const plan = quiescePlan([run({ orchestratorRef: 'tr_1', verdict: 'finished' })], NOW);

  it('lands the stale row and purges — there is nothing to wait for', () => {
    expect(plan.landStale.map((s) => s.id)).toEqual(['run-1']);
    expect(plan.mayPurge).toBe(true);
  });

  it('records WHY the row says cancelled, for whoever reads it next', () => {
    expect(plan.landStale[0]!.reason).toMatch(/no longer executing/i);
  });

  it('does not bother cancelling something already finished', () => {
    expect(plan.cancel).toEqual([]);
  });

  it('lands it however young it is — age is irrelevant when we KNOW', () => {
    const fresh = quiescePlan(
      [run({ orchestratorRef: 'tr_1', verdict: 'finished', since: NOW })],
      NOW,
    );
    expect(fresh.mayPurge).toBe(true);
  });
});

describe('we could not ask the orchestrator', () => {
  // The asymmetry, stated as tests: not knowing is not permission.
  it('blocks even when the row is ancient', () => {
    const plan = quiescePlan(
      [run({ orchestratorRef: 'tr_1', verdict: 'unknown', since: agoMs(30 * 24 * 3_600_000) })],
      NOW,
    );
    expect(plan.mayPurge).toBe(false);
    expect(plan.landStale).toEqual([]);
  });

  it('says a person has to look — this will not resolve itself', () => {
    const plan = quiescePlan([run({ orchestratorRef: 'tr_1', verdict: 'unknown' })], NOW);
    expect(plan.needsAttention).toBe(true);
    expect(plan.blockedBy[0]).toMatch(/could not be asked/i);
  });
});

describe('a row with no orchestrator handle at all', () => {
  // Legacy rows, and every run the appliance makes: there is nothing to ask.
  it('blocks while it is still young enough to be real', () => {
    const plan = quiescePlan([run({ orchestratorRef: null, since: agoMs(60_000) })], NOW);
    expect(plan.mayPurge).toBe(false);
    expect(plan.needsAttention).toBe(false);
    expect(plan.blockedBy[0]).toMatch(/no orchestrator handle/i);
  });

  it('lands it once no live pass could still be behind it', () => {
    const plan = quiescePlan(
      [run({ orchestratorRef: null, since: agoMs(DEFAULT_STALE_AFTER_MS + 1000) })],
      NOW,
    );
    expect(plan.landStale.map((s) => s.id)).toEqual(['run-1']);
    expect(plan.mayPurge).toBe(true);
  });

  it('is exactly at the boundary, not almost', () => {
    const at = quiescePlan(
      [run({ orchestratorRef: null, since: agoMs(DEFAULT_STALE_AFTER_MS) })],
      NOW,
    );
    expect(at.mayPurge).toBe(true);
    const just = quiescePlan(
      [run({ orchestratorRef: null, since: agoMs(DEFAULT_STALE_AFTER_MS - 1) })],
      NOW,
    );
    expect(just.mayPurge).toBe(false);
  });

  it('honours a caller-supplied window', () => {
    const plan = quiescePlan([run({ orchestratorRef: null, since: agoMs(5000) })], NOW, 1000);
    expect(plan.mayPurge).toBe(true);
  });
});

describe('several runs at once', () => {
  // The realistic shape: one row the orchestrator has forgotten, one genuinely
  // live. The live one must dominate.
  const plan = quiescePlan(
    [
      run({ id: 'stale', orchestratorRef: 'tr_a', verdict: 'finished' }),
      run({ id: 'alive', orchestratorRef: 'tr_b', verdict: 'live' }),
    ],
    NOW,
  );

  it('lands the stale one AND still refuses to purge', () => {
    expect(plan.landStale.map((s) => s.id)).toEqual(['stale']);
    expect(plan.mayPurge).toBe(false);
  });

  it('cancels only the one that is actually running', () => {
    expect(plan.cancel).toEqual(['alive']);
  });

  it('names what is blocking, per run', () => {
    expect(plan.blockedBy).toHaveLength(1);
    expect(plan.blockedBy[0]).toContain('alive');
  });
});

describe('queued runs count as in flight', () => {
  // A queued run has not written anything yet, but it is about to, and the
  // purge would land between the two.
  it('blocks on a queued run the same as a running one', () => {
    const plan = quiescePlan([run({ status: 'queued', orchestratorRef: 'tr_1', verdict: 'live' })], NOW);
    expect(plan.mayPurge).toBe(false);
    expect(plan.cancel).toEqual(['run-1']);
  });
});
