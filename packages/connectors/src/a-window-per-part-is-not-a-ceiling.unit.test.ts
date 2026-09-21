// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WINDOW PER PART IS NOT A CEILING.
 *
 * The read-ahead window exists so that a 25 GB library read in 1 MiB steps is
 * a few thousand requests rather than twenty-five thousand (0116 T4). It is
 * per source, and it stays in memory until the source is closed — which is
 * correct for ONE archive and wrong for the shape a real download arrives in.
 *
 * Google delivers a 25 GB Takeout as twenty-five 1 GB parts, and `openZipTree`
 * opens EVERY part at once: it needs each one's central directory before it
 * can answer a single question about the tree, and it holds them open because
 * a pass never closes its source. So "8 MiB of read-ahead" is a per-part
 * figure. Twenty-five parts is two hundred megabytes of buffers, resident for
 * the whole pass, on the edition whose run containers have a network and no
 * disk — and it grows with the size of the person's library, which is the
 * worst thing a ceiling can do.
 *
 * Nothing on the appliance shows this: `openFileSource` holds neither a
 * descriptor nor a buffer. Nothing in the fixtures shows it either — the e2e
 * download is two parts of a few hundred bytes. It is a defect that only
 * exists at the size the product is for, which is why it is worth a test that
 * states the number.
 *
 * The fix is one budget shared by every source of one store, least recently
 * used evicted first. The access pattern is what makes that enough: the reader
 * walks parts in order and members front to back, so one part is being read
 * and the rest are stale. Each test below fails without it.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RANGE_BUDGET_BYTES,
  DEFAULT_RANGE_WINDOW_BYTES,
  openRangeSource,
  rangeBudget,
} from './webdav-archive-store.ts';

/** A WebDAV file that answers any range, counting what it served. */
function fakeDav() {
  let served = 0;
  let requests = 0;
  return {
    servedBytes: () => served,
    requests: () => requests,
    url: (path: string) => `https://cloud.example.org/${path}`,
    async request(_method: string, _path: string, options?: { readonly headers?: Record<string, string> }) {
      const range = /bytes=(\d+)-(\d+)/.exec(options?.headers?.Range ?? '');
      if (!range) throw new Error('a range source asked without a Range header');
      const from = Number(range[1]);
      const to = Number(range[2]);
      const length = to - from + 1;
      requests += 1;
      served += length;
      // Each byte is its own offset modulo 251, so a wrong window shows up as
      // wrong CONTENT rather than only as a wrong count.
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (from + i) % 251;
      return { status: 206, body: '', bodyBytes: bytes, headers: {} };
    },
  };
}

const PART_BYTES = 64 * 1024;
const WINDOW = 8 * 1024;
/** Twenty-five parts, the shape of a 25 GB Takeout at 1 GB a part. */
const PARTS = 25;

describe('the read-ahead ceiling, when the download is multi-part', () => {
  it('holds one window per part without a budget — the defect, stated', async () => {
    const dav = fakeDav();
    const sources = [];
    for (let i = 0; i < PARTS; i += 1) {
      const source = openRangeSource(dav, `part-${i}.zip`, PART_BYTES, { windowBytes: WINDOW });
      await source.read(0, 16);
      sources.push(source);
    }
    // No budget, so every part's window is alive at once. This is the number
    // that becomes 200 MiB at the sizes 0116 is about.
    expect(dav.servedBytes()).toBe(PARTS * WINDOW);
    await Promise.all(sources.map((s) => s.close()));
  });

  it('holds no more than the budget, however many parts there are', async () => {
    const dav = fakeDav();
    const budget = rangeBudget(4 * WINDOW);
    const sources = [];
    for (let i = 0; i < PARTS; i += 1) {
      const source = openRangeSource(dav, `part-${i}.zip`, PART_BYTES, { windowBytes: WINDOW, budget });
      await source.read(0, 16);
      sources.push(source);
    }
    // THE CEILING. Twenty-five parts, four windows — and the same number for
    // fifty parts, which is the property that matters.
    expect(budget.heldBytes()).toBeLessThanOrEqual(4 * WINDOW);
    await Promise.all(sources.map((s) => s.close()));
    expect(budget.heldBytes(), 'closing every source left bytes held').toBe(0);
  });

  it('keeps the part being read, and evicts the ones walked past', async () => {
    const dav = fakeDav();
    const budget = rangeBudget(2 * WINDOW);
    const parts = [];
    for (let i = 0; i < 5; i += 1) {
      parts.push(openRangeSource(dav, `part-${i}.zip`, PART_BYTES, { windowBytes: WINDOW, budget }));
    }
    // Open every part, as the tree does.
    for (const part of parts) await part.read(0, 16);
    const afterOpening = dav.requests();

    // Now read the LAST part front to back, as the reader does. Its window is
    // the most recent, so it is never the one evicted, and every step inside
    // it is served from memory.
    const last = parts[4]!;
    for (let offset = 0; offset < WINDOW; offset += 1024) {
      const chunk = await last.read(offset, 1024);
      expect(chunk[0], 'the window served the wrong bytes').toBe(offset % 251);
    }
    expect(dav.requests(), 'reading inside the live window cost a request').toBe(afterOpening);

    // And a part walked past has lost its window, so it fetches again — a
    // request, never a failure, and never the wrong bytes.
    const first = parts[0]!;
    const before = dav.requests();
    const refetched = await first.read(0, 16);
    expect(dav.requests()).toBe(before + 1);
    expect([...refetched.slice(0, 3)]).toEqual([0, 1, 2]);
    await Promise.all(parts.map((p) => p.close()));
  });

  it('counts a read served from memory as recent, so the part in use is not the one dropped', async () => {
    // The difference between a least-recently-USED policy and a least-recently
    // -FETCHED one, and it is not academic: the reader fetches a window once
    // and then reads inside it for the whole of a large member. Under
    // least-recently-fetched, the part it is reading is the oldest fetch and
    // therefore the first evicted — mid-member, and refetched immediately.
    const dav = fakeDav();
    const budget = rangeBudget(2 * WINDOW);
    const a = openRangeSource(dav, 'a.zip', PART_BYTES, { windowBytes: WINDOW, budget });
    const b = openRangeSource(dav, 'b.zip', PART_BYTES, { windowBytes: WINDOW, budget });
    await a.read(0, 16);
    await b.read(0, 16);

    // A is read again from its own window. Nothing is fetched — and that is
    // exactly why it could go unnoticed as the oldest.
    const beforeTouch = dav.requests();
    await a.read(16, 16);
    expect(dav.requests(), 'the read was not served from A\u2019s window').toBe(beforeTouch);

    // A third part arrives and one window must go. B is now the oldest USE.
    const c = openRangeSource(dav, 'c.zip', PART_BYTES, { windowBytes: WINDOW, budget });
    await c.read(0, 16);

    const beforeProbe = dav.requests();
    await a.read(32, 16);
    expect(dav.requests(), 'the part being read was evicted while it was in use').toBe(beforeProbe);
    await b.read(32, 16);
    expect(dav.requests(), 'the part nobody had touched kept its window').toBe(beforeProbe + 1);

    await Promise.all([a.close(), b.close(), c.close()]);
  });

  it('still serves a read larger than the whole budget', async () => {
    // A central directory can be large (the zip reader allows 256 MiB), and a
    // budget that refused to hold one would turn an archive that is merely
    // expensive into one that cannot be read at all.
    const dav = fakeDav();
    const budget = rangeBudget(1024);
    const source = openRangeSource(dav, 'big.zip', PART_BYTES, { windowBytes: 1024, budget });
    const big = await source.read(0, 32 * 1024);
    expect(big.byteLength).toBe(32 * 1024);
    expect([...big.slice(0, 3)]).toEqual([0, 1, 2]);
    expect(budget.heldBytes(), 'the one window that must survive was evicted').toBe(32 * 1024);
    await source.close();
  });

  it('defaults to a budget that is a few windows, not one per part', () => {
    // The relationship is the claim: a handful of windows, fixed, rather than
    // a number that rises with the size of somebody's photo library.
    expect(DEFAULT_RANGE_BUDGET_BYTES).toBeGreaterThanOrEqual(2 * DEFAULT_RANGE_WINDOW_BYTES);
    expect(DEFAULT_RANGE_BUDGET_BYTES).toBeLessThanOrEqual(8 * DEFAULT_RANGE_WINDOW_BYTES);
  });
});
