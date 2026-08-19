// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The verification state machine, against a scan the test controls.
 *
 * Every transition here is DETERMINISTIC: the scan is a promise the test
 * resolves or rejects by hand, so "a second start while running" is a fact
 * rather than a race. (The first attempt proved the same properties over HTTP
 * by holding a real scan open with a TCP server that never answered — and
 * lost a round to connector retry backoff. The state machine was never the
 * thing in doubt; now the network is not involved in proving it.)
 */

import { describe, it, expect } from 'vitest';
import { createVerifyRunner } from './verify-run.ts';
import type { VerifyResponse } from '@openmig/shared';

/** A scan whose completion belongs to the test. */
function controlled() {
  let resolve!: (r: VerifyResponse) => void;
  let reject!: (e: unknown) => void;
  const calls: number[] = [];
  const runner = createVerifyRunner(() => {
    calls.push(Date.now());
    return new Promise<VerifyResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return { runner, resolve: () => resolve, reject: () => reject, calls };
}

const REPORT: VerifyResponse = { 'mapping-1': { overall: 'PASS' } as never };

/** The microtask hop that lets the runner's .then() observe a settled scan. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the verification state machine', () => {
  it('is never-run until somebody starts it, however often it is read', () => {
    const { runner } = controlled();
    expect(runner.current()).toEqual({ state: 'never-run' });
    expect(runner.current()).toEqual({ state: 'never-run' });
  });

  it('start begins exactly one scan and reports running from that moment', () => {
    const { runner, calls } = controlled();
    const outcome = runner.start();
    expect(outcome.started).toBe(true);
    expect(outcome.report.state).toBe('running');
    expect(calls).toHaveLength(1);
    expect(runner.current().state).toBe('running');
  });

  it('a second start JOINS the running scan — one scan, not two', () => {
    const { runner, calls } = controlled();
    runner.start();
    const second = runner.start();
    expect(second.started).toBe(false);
    expect(second.report.state).toBe('running');
    // The invariant underneath the flag: the scan ran ONCE. Verification reads
    // every enabled domain's target; stacking scans doubles that load to
    // answer a question once.
    expect(calls).toHaveLength(1);
  });

  it('a resolved scan becomes done, with the report and both timestamps', async () => {
    const { runner, resolve } = controlled();
    runner.start();
    resolve()(REPORT);
    await settle();
    const r = runner.current();
    expect(r.state).toBe('done');
    if (r.state === 'done') {
      expect(r.report).toEqual(REPORT);
      expect(r.finishedAt >= r.startedAt).toBe(true);
    }
  });

  it('a rejected scan becomes failed and KEEPS the reason — never never-run again', async () => {
    // hard rule 9: a verification that could not run must not read as one that
    // found nothing wrong, and must not silently reset as if never asked.
    const { runner, reject } = controlled();
    runner.start();
    reject()(new Error('the scan fell over'));
    await settle();
    const r = runner.current();
    expect(r.state).toBe('failed');
    if (r.state === 'failed') {
      expect(r.error).toBe('the scan fell over');
      expect(r.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('a start after a terminal state begins a FRESH scan', async () => {
    const { runner, resolve, calls } = controlled();
    runner.start();
    resolve()(REPORT);
    await settle();

    const again = runner.start();
    expect(again.started).toBe(true);
    expect(calls).toHaveLength(2);
    // The old report is gone the moment the new run starts — a poller must
    // never mistake last week's PASS for this run's progress.
    expect(runner.current().state).toBe('running');
  });
});
