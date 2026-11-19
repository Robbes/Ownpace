// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DISCONNECT LEAVES NO ACCESS TOKEN USABLE (workplan 0160; ADR-0052).
 *
 * *Disconnect Cirrux Drive* removes the Drive grant from the account's record,
 * and Cirrux offers no way for an app to withdraw what it issued
 * (`https://cirrux.co/help/api`). An access token already in memory would go
 * on working at Cirrux for the rest of its 15 minutes, and the provider keeps
 * one per writer and shares it between every item of a pass. So:
 *
 * - **in the process that disconnects**, `forgetCirruxAccess` makes every
 *   provider over a store of that connection drop its token at its next call,
 *   and hand out none from a refresh the disconnect overtook; the next call
 *   goes to the store, which holds no grant, and Cirrux is asked nothing;
 * - only that connection's providers: another account's keep theirs, and a
 *   provider made after the disconnect starts clean;
 * - **in another process**, which `forgetCirruxAccess` cannot reach, a token in
 *   memory is handed out only while the store, asked at most once a minute and
 *   once for every item waiting at that moment, still holds a grant;
 * - a store that cannot answer fails the call rather than counting as a yes,
 *   and a store that has no way to be asked is never asked.
 *
 * The store is `MemoryRotatingGrantStore`, with the database's contract; a
 * disconnect is its `refreshToken` going, as the database's removes the key
 * (`cirrux-grant-store.unit.test.ts` holds that half).
 */

import { describe, it, expect } from 'vitest';
import {
  CirruxTokenProvider,
  GRANT_RECHECK_MS,
  forgetCirruxAccess,
  type RotatingGrantStore,
} from './cirrux-token-provider.ts';
import { FakeCirrux, MemoryRotatingGrantStore } from './__testing__/cirrux-fake.ts';

const CLIENT = 'ownpace-test-client';
let made = 0;
/** A connection id no other case uses, so one case's disconnects are not another's. */
const aConnection = () => `0160dc00-e29b-41d4-a716-${String(++made).padStart(12, '0')}`;

function provider(cirrux: FakeCirrux, store: RotatingGrantStore, now: () => number = () => Date.now()) {
  return new CirruxTokenProvider({ clientId: CLIENT, store, fetchImpl: cirrux.fetch, now, sleep: async () => undefined });
}

/** What the database's removal does to the store, and what the route then says to this process. */
function disconnect(store: MemoryRotatingGrantStore, connection: string): void {
  store.refreshToken = undefined;
  forgetCirruxAccess(connection);
}

describe('in the process that disconnects', () => {
  it('the token in memory is dropped at once, the store is asked, and Cirrux is asked nothing', async () => {
    const id = aConnection();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start', id);
    const pass = provider(cirrux, store);
    await pass.getAccessToken();
    expect(cirrux.presented).toEqual(['rt-start']);

    disconnect(store, id);

    await expect(pass.getAccessToken()).rejects.toThrow(/no Cirrux Drive connected[\s\S]*Connect Cirrux Drive/);
    // Not refreshed, and not handed out from memory either: still one refresh.
    expect(cirrux.presented).toEqual(['rt-start']);
    expect(cirrux.signedOut).toBe(false);
  });

  it('connected again afterwards: the same provider refreshes the new grant, and never hands out the old token', async () => {
    const id = aConnection();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start', id);
    const pass = provider(cirrux, store);
    const old = await pass.getAccessToken();
    disconnect(store, id);
    await expect(pass.getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);

    // The person presses Connect Cirrux Drive again: a new grant is stored.
    store.refreshToken = cirrux.liveRefresh = 'rt-connected-again';
    const fresh = await pass.getAccessToken();
    expect(fresh).toMatch(/^at-/);
    expect(fresh).not.toBe(old);
    expect(cirrux.presented).toEqual(['rt-start', 'rt-connected-again']);
  });

  it('every item of the pass is refused alike, and none is handed the old token', async () => {
    const id = aConnection();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start', id);
    const pass = provider(cirrux, store);
    await pass.getAccessToken();
    disconnect(store, id);
    const answers = await Promise.allSettled(Array.from({ length: 6 }, () => pass.getAccessToken()));
    expect(answers.map((a) => a.status)).toEqual(Array(6).fill('rejected'));
  });

  it('only this connection’s providers forget: another account keeps its token, and a provider made afterwards starts clean', async () => {
    const ours = aConnection();
    const theirs = aConnection();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-a' });
    const other = new FakeCirrux({ refreshToken: 'rt-b' });
    const ourStore = new MemoryRotatingGrantStore('rt-a', ours);
    const theirStore = new MemoryRotatingGrantStore('rt-b', theirs);
    const theirPass = provider(other, theirStore);
    const kept = await theirPass.getAccessToken();
    await provider(cirrux, ourStore).getAccessToken();

    disconnect(ourStore, ours);

    expect(await theirPass.getAccessToken()).toBe(kept);
    expect(other.presented).toEqual(['rt-b']);

    // Connected again afterwards: a provider made now is not told about the
    // disconnect before it, and refreshes the new grant.
    ourStore.refreshToken = cirrux.liveRefresh = 'rt-again';
    const again = provider(cirrux, ourStore);
    expect(await again.getAccessToken()).toMatch(/^at-/);
    expect(cirrux.presented.at(-1)).toBe('rt-again');
  });

  it('a refresh the disconnect overtook hands out no token', async () => {
    const id = aConnection();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const inner = new MemoryRotatingGrantStore('rt-start', id);
    // The disconnect waits for the refresh's lock, as the row lock makes it
    // wait, and lands between the refresh storing its successor and the
    // provider handing the new token out.
    const store: RotatingGrantStore = {
      connection: id,
      holdsGrant: () => inner.holdsGrant(),
      rotate: async (use) => {
        const value = await inner.rotate(use);
        disconnect(inner, id);
        return value;
      },
    };
    await expect(provider(cirrux, store).getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);
    // One refresh; its successor went with the disconnect, and was never presented.
    expect(cirrux.presented).toEqual(['rt-start']);
    expect(cirrux.signedOut).toBe(false);
  });

  it('a store that names no connection is not reached by a disconnect here, and holds to its own answer', async () => {
    const id = aConnection();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start');
    const pass = provider(cirrux, store);
    const token = await pass.getAccessToken();
    forgetCirruxAccess(id);
    expect(await pass.getAccessToken()).toBe(token);
  });
});

describe('in another process, which forgetCirruxAccess cannot reach', () => {
  it('a token in memory is handed out only while the store still holds a grant, asked at most once a minute', async () => {
    let clock = 1_000_000;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start', accessSeconds: 900 });
    // The worker's store of the same row; the API removed the grant, and told only itself.
    const store = new MemoryRotatingGrantStore('rt-start', aConnection());
    const pass = provider(cirrux, store, () => clock);
    const token = await pass.getAccessToken();

    // Within the minute after the refresh that read the grant: not asked again.
    clock += GRANT_RECHECK_MS - 1;
    expect(await pass.getAccessToken()).toBe(token);
    expect(store.asked).toBe(0);

    // Past it: asked, still held, handed out, and not asked again for a minute.
    clock += 2;
    expect(await pass.getAccessToken()).toBe(token);
    expect(store.asked).toBe(1);
    clock += GRANT_RECHECK_MS / 2;
    expect(await pass.getAccessToken()).toBe(token);
    expect(store.asked).toBe(1);

    // Disconnected elsewhere: the next question after the minute finds no grant.
    store.refreshToken = undefined;
    clock += GRANT_RECHECK_MS;
    await expect(pass.getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);
    expect(store.asked).toBe(2);
    // The token is gone from memory: the next call goes to the store, and Cirrux is asked nothing.
    await expect(pass.getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);
    expect(cirrux.presented).toEqual(['rt-start']);
  });

  it('the items waiting at that moment share one question', async () => {
    let clock = 0;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start', accessSeconds: 900 });
    const store = new MemoryRotatingGrantStore('rt-start', aConnection());
    const pass = provider(cirrux, store, () => clock);
    await pass.getAccessToken();
    clock += GRANT_RECHECK_MS + 1;
    store.refreshToken = undefined;
    const answers = await Promise.allSettled(Array.from({ length: 8 }, () => pass.getAccessToken()));
    expect(answers.every((a) => a.status === 'rejected')).toBe(true);
    expect(store.asked).toBe(1);
  });

  it('a token the consent handed in counts as the grant just read: asked a minute later, not before', async () => {
    let clock = 0;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start' });
    const store = new MemoryRotatingGrantStore('rt-start', aConnection());
    const initial = { accessToken: 'at-from-the-consent', expiresAt: 15 * 60_000 };
    const measure = new CirruxTokenProvider({ clientId: CLIENT, store, fetchImpl: cirrux.fetch, now: () => clock, initial });
    expect(await measure.getAccessToken()).toBe('at-from-the-consent');
    expect(store.asked).toBe(0);
    clock = GRANT_RECHECK_MS + 1;
    expect(await measure.getAccessToken()).toBe('at-from-the-consent');
    expect(store.asked).toBe(1);
    expect(cirrux.presented).toEqual([]);
  });

  it('a store that cannot answer fails the call, keeps nothing as a yes, and is asked again next time', async () => {
    let clock = 0;
    let failing = true;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start', accessSeconds: 900 });
    const inner = new MemoryRotatingGrantStore('rt-start', aConnection());
    const store: RotatingGrantStore = {
      connection: inner.connection,
      rotate: (use) => inner.rotate(use),
      holdsGrant: async () => {
        if (failing) throw new Error('the database is not answering');
        return inner.holdsGrant();
      },
    };
    const pass = provider(cirrux, store, () => clock);
    const token = await pass.getAccessToken();
    clock += GRANT_RECHECK_MS + 1;
    await expect(pass.getAccessToken()).rejects.toThrow(/not answering/);
    failing = false;
    expect(await pass.getAccessToken()).toBe(token);
    expect(inner.asked).toBe(1);
  });

  it('a store with no way to be asked is never asked, and its token lasts until it is refreshed', async () => {
    let clock = 0;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-start', accessSeconds: 900 });
    const inner = new MemoryRotatingGrantStore('rt-start');
    const store: RotatingGrantStore = { rotate: (use) => inner.rotate(use) };
    const pass = provider(cirrux, store, () => clock);
    const token = await pass.getAccessToken();
    clock += 10 * 60_000;
    expect(await pass.getAccessToken()).toBe(token);
    expect(inner.asked).toBe(0);
  });
});
