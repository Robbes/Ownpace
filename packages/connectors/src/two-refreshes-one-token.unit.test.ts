// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO REFRESHES, ONE TOKEN (workplan 0160 T5; ADR-0052).
 *
 * Cirrux retires a refresh token the moment it is used, and a retired one
 * presented again SIGNS THE PERSON OUT (`https://cirrux.co/help/api`). So the
 * one thing that must never happen is two refreshes reading the same stored
 * token: two passes, a pass and a Test, or two items of one pass. The fake
 * token endpoint here is as strict as the page — a retired token presented
 * again signs the person out, for good — and records every token it was shown.
 *
 * The store is `MemoryRotatingGrantStore`, which holds the contract the
 * database's holds: one rotation at a time, the token read under the lock, the
 * outcome stored before the lock is let go. The database's own lock is proven
 * against a real Postgres in
 * `packages/orchestration/src/cirrux-grant-store.integration.test.ts`; this
 * file proves the provider's half: that it asks the store for every refresh,
 * single-flights inside a process, and sorts what Cirrux answered so a token
 * Cirrux may have spent is never sent again.
 */

import { describe, it, expect } from 'vitest';
import { CirruxTokenProvider } from './cirrux-token-provider.ts';
import { FakeCirrux, MemoryRotatingGrantStore } from './__testing__/cirrux-fake.ts';

const CLIENT = 'ownpace-test-client';

function provider(cirrux: FakeCirrux, store: MemoryRotatingGrantStore, now = () => Date.now()) {
  return new CirruxTokenProvider({ clientId: CLIENT, store, fetchImpl: cirrux.fetch, now, sleep: async () => undefined });
}

describe('two runs on one account never present one token twice', () => {
  it('two processes refreshing at once: both get a token, Cirrux sees each refresh token once, and nobody is signed out', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.tokenDelayMs = 20;
    const store = new MemoryRotatingGrantStore('rt-start');
    const pass = provider(cirrux, store);
    const test = provider(cirrux, store);

    const tokens = await Promise.all([pass.getAccessToken(), test.getAccessToken(), pass.getAccessToken(), test.getAccessToken()]);

    expect(tokens.every((t) => t.startsWith('at-'))).toBe(true);
    expect(cirrux.signedOut).toBe(false);
    expect(new Set(cirrux.presented).size, `presented twice: ${cirrux.presented.join(', ')}`).toBe(cirrux.presented.length);
    // One refresh per process: each provider joined its own refresh in flight.
    expect(cirrux.presented).toHaveLength(2);
    // And what is stored is the token Cirrux will take next.
    expect(store.refreshToken).toBe(cirrux.liveRefresh);
  });

  it('many items of one pass share one refresh', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start');
    const pass = provider(cirrux, store);
    const tokens = await Promise.all(Array.from({ length: 12 }, () => pass.getAccessToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(cirrux.presented).toEqual(['rt-start']);
  });

  it('writes the successor back after every refresh, so the next pass starts from it', async () => {
    let clock = 1_000_000;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start', accessSeconds: 900 });
    const store = new MemoryRotatingGrantStore('rt-start');
    const pass = provider(cirrux, store, () => clock);
    await pass.getAccessToken();
    const first = store.refreshToken;
    expect(first).not.toBe('rt-start');
    // Fifteen minutes on: the access token is spent, and the next refresh
    // presents the successor that was written back, not the token it replaced.
    clock += 15 * 60_000;
    await pass.getAccessToken();
    expect(cirrux.presented).toEqual(['rt-start', first]);
    expect(store.refreshToken).toBe(cirrux.liveRefresh);
    expect(store.writes).toBe(2);
    expect(cirrux.signedOut).toBe(false);
  });

  it('keeps the access token in memory until a minute before it expires', async () => {
    let clock = 0;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start', accessSeconds: 900 });
    const store = new MemoryRotatingGrantStore('rt-start');
    const pass = provider(cirrux, store, () => clock);
    const a = await pass.getAccessToken();
    clock = 13 * 60_000;
    expect(await pass.getAccessToken()).toBe(a);
    clock = 14 * 60_000 + 1;
    expect(await pass.getAccessToken()).not.toBe(a);
    expect(cirrux.presented).toHaveLength(2);
  });
});

describe('a token Cirrux may have spent is never sent again (ADR-0052, decision 5)', () => {
  it('a refresh whose answer never arrived removes the stored token, and says to connect again', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.tokenFault = 'reset';
    const store = new MemoryRotatingGrantStore('rt-start');
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/Connect Cirrux Drive/);
    // Cirrux did retire it; presenting it again would sign the person out.
    expect(store.refreshToken).toBeUndefined();
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);
    expect(cirrux.presented).toEqual(['rt-start']);
    expect(cirrux.signedOut).toBe(false);
  });

  it('a 2xx that names no successor is spent the same way', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.tokenFault = 'no-successor';
    const store = new MemoryRotatingGrantStore('rt-start');
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/never arrived/);
    expect(store.refreshToken).toBeUndefined();
  });

  it('invalid_grant removes the stored token: sent again, every pass would sign the person out', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-live' });
    const store = new MemoryRotatingGrantStore('rt-withdrawn');
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/no longer accepts/);
    expect(store.refreshToken).toBeUndefined();
  });

  it('a 429 is waited out and the same token goes again, once', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.rateLimitTokenNext = 1;
    const waits: number[] = [];
    const store = new MemoryRotatingGrantStore('rt-start');
    const p = new CirruxTokenProvider({
      clientId: CLIENT,
      store,
      fetchImpl: cirrux.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await p.getAccessToken();
    expect(waits).toEqual([2000]);
    expect(cirrux.presented).toEqual(['rt-start']);
    expect(store.refreshToken).toBe(cirrux.liveRefresh);
  });

  it('a 5xx keeps the token: Cirrux said nothing was done', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.tokenFault = 'server-error';
    const store = new MemoryRotatingGrantStore('rt-start');
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/Nothing was spent/);
    expect(store.refreshToken).toBe('rt-start');
    // And the next attempt works with it.
    await provider(cirrux, store).getAccessToken();
    expect(cirrux.signedOut).toBe(false);
  });

  it('a connection that never opened keeps the token', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    cirrux.tokenFault = 'refused-connection';
    const store = new MemoryRotatingGrantStore('rt-start');
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/could not be reached/);
    expect(store.refreshToken).toBe('rt-start');
  });

  it('with no grant stored, says the Drive is not connected and asks Cirrux nothing', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    await expect(provider(cirrux, new MemoryRotatingGrantStore(undefined)).getAccessToken()).rejects.toThrow(
      /no Cirrux Drive connected/,
    );
    expect(cirrux.presented).toEqual([]);
  });

  it('a refused access token is forgotten, so the next call refreshes', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start');
    const p = provider(cirrux, store);
    const a = await p.getAccessToken();
    p.invalidate(a);
    expect(await p.getAccessToken()).not.toBe(a);
    expect(cirrux.presented).toHaveLength(2);
  });

  it('never puts a token in an error', async () => {
    const cirrux = new FakeCirrux({ refreshToken: 'rt-live' });
    const store = new MemoryRotatingGrantStore('rt-secret-withdrawn');
    const failure = await provider(cirrux, store).getAccessToken().catch((e: unknown) => e as Error);
    expect(String(failure)).not.toContain('rt-secret-withdrawn');
  });
});
