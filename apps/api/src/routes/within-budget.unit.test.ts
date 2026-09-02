// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { withinBudget } from './within-budget.ts';

describe('withinBudget', () => {
  afterEach(() => vi.useRealTimers());

  it('answers the work when it fits', async () => {
    await expect(withinBudget(Promise.resolve('done'), 1000)).resolves.toBe('done');
  });

  it("answers 'pending' once the budget is spent, and lets the work finish on its own", async () => {
    vi.useFakeTimers();
    let finished = false;
    const work = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000)).then(
      (v) => {
        finished = true;
        return v;
      },
    );
    const answer = withinBudget(work, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(answer).resolves.toBe('pending');
    expect(finished).toBe(false);
    // The work is not cancelled: it completes after the door has answered.
    await vi.advanceTimersByTimeAsync(3000);
    expect(finished).toBe(true);
  });

  it('a budget already spent still answers pending, never hangs', async () => {
    vi.useFakeTimers();
    const answer = withinBudget(new Promise<never>(() => {}), -50);
    await vi.advanceTimersByTimeAsync(0);
    await expect(answer).resolves.toBe('pending');
  });

  it('a rejection is the caller\'s to see', async () => {
    await expect(withinBudget(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});
