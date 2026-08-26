// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The in-process byte meter (workplan 0090 T2) — the semantics the pg twin
 * must agree with, pinned where they are cheapest to prove. The three that
 * are load-bearing: `spend` records and NEVER refuses (the bytes were already
 * fetched — hiding them is masking), the window is a fixed 24 hours anchored
 * at the first byte, and over the ceiling the truth stays visible while
 * `remainingBytes` floors at zero — the caller's signal to stop, per 0090 T4.
 */

import { describe, it, expect } from 'vitest';
import { InProcessByteBudget, UNLIMITED_BYTE_BUDGET } from './rate-budget.ts';

const TENANT = '5aab0000-e29b-41d4-a716-446655442001';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('InProcessByteBudget', () => {
  it('accumulates within the window and answers the state after each spend', async () => {
    const budget = new InProcessByteBudget({ bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 300);
    const after = await budget.spend(TENANT, 'gmail-imap', 300);
    expect(after.spentBytes).toBe(600);
    expect(after.remainingBytes).toBe(400);
    expect(after.ceilingBytes).toBe(1000);
    expect(after.windowResetsAt).not.toBeNull();
  });

  it('records past the ceiling rather than refusing — the truth, with remaining floored at zero', async () => {
    // By the time the number exists the bytes were fetched. A meter that
    // refused or clamped the count would hide exactly what 0090 T4's refusal
    // has to say out loud.
    const budget = new InProcessByteBudget({ bytesPerDay: 1000 });
    const state = await budget.spend(TENANT, 'gmail-imap', 1500);
    expect(state.spentBytes).toBe(1500);
    expect(state.remainingBytes).toBe(0);
  });

  it('starts a fresh window after 24 hours, anchored at the next byte', async () => {
    let now = 1_000_000;
    const budget = new InProcessByteBudget({ bytesPerDay: 1000 }, () => now);
    await budget.spend(TENANT, 'gmail-imap', 900);
    now += DAY_MS + 1;
    // Before any new byte, the expired window reads as untouched.
    const idle = await budget.state(TENANT, 'gmail-imap');
    expect(idle.spentBytes).toBe(0);
    expect(idle.windowResetsAt).toBeNull();
    // The next byte anchors the new window at ITS moment, not at the old edge.
    const fresh = await budget.spend(TENANT, 'gmail-imap', 100);
    expect(fresh.spentBytes).toBe(100);
    expect(fresh.windowResetsAt!.getTime()).toBe(now + DAY_MS);
  });

  it('keeps tenants and providers on separate meters', async () => {
    const budget = new InProcessByteBudget({ bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 800);
    expect((await budget.state('other-tenant', 'gmail-imap')).spentBytes).toBe(0);
    expect((await budget.state(TENANT, 'other-provider')).spentBytes).toBe(0);
  });

  it('counts garbage as nothing — a NaN size must not refill or spend the meter', async () => {
    const budget = new InProcessByteBudget({ bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 400);
    const after = await budget.spend(TENANT, 'gmail-imap', Number.NaN);
    expect(after.spentBytes).toBe(400);
    expect((await budget.spend(TENANT, 'gmail-imap', -50)).spentBytes).toBe(400);
  });

  it('refuses a ceiling that could never grant anything', () => {
    expect(() => new InProcessByteBudget({ bytesPerDay: 0 })).toThrow(/positive/);
    expect(() => new InProcessByteBudget({ bytesPerDay: -1 })).toThrow(/positive/);
  });

  it('reads state without spending', async () => {
    const budget = new InProcessByteBudget({ bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 250);
    await budget.state(TENANT, 'gmail-imap');
    await budget.state(TENANT, 'gmail-imap');
    expect((await budget.state(TENANT, 'gmail-imap')).spentBytes).toBe(250);
  });
});

describe('UNLIMITED_BYTE_BUDGET', () => {
  it('counts nothing and never runs out — the named decision for servers with no ceiling', async () => {
    await UNLIMITED_BYTE_BUDGET.spend(TENANT, 'dovecot', 10_000_000_000);
    const state = await UNLIMITED_BYTE_BUDGET.state(TENANT, 'dovecot');
    expect(state.remainingBytes).toBe(Number.POSITIVE_INFINITY);
    expect(state.spentBytes).toBe(0);
  });
});
