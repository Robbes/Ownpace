// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The stage, the totals and the time survive the parse, and a newer server's
 * words do not blank an older page (workplan 0154 T8).
 *
 * `z.object` strips what it does not name, and the page's tests mock this
 * service, so a schema that forgot `stage` or `time` would pass every page
 * test while the person read none of it. And the other way: a stage or a time
 * this page cannot say must be dropped, never fail the read, or the page that
 * says whether somebody's mail has arrived would say nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('./link-client.ts', () => ({ linkClient: { get: getMock, post: vi.fn() } }));

import { viewApi } from './view-service.ts';

const row = (over: Record<string, unknown> = {}) => ({
  domain: 'email',
  state: 'completed',
  itemsSynced: 4211,
  itemsFailed: 0,
  bytesTransferred: 91_000_000,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  ...over,
});

const view = (over: Record<string, unknown>) => ({
  data: {
    organisation: 'Example Care',
    state: 'active',
    started: true,
    domains: [row()],
    expiresAt: '2026-12-24T00:00:00.000Z',
    grant: { state: 'none' },
    ...over,
  },
});

async function read() {
  const page = await viewApi.read('abc.def');
  if ('kind' in page) throw new Error('read as a person’s page');
  return page;
}

beforeEach(() => getMock.mockReset());

describe('a progress page’s stage, totals and time, as it receives them', () => {
  it('keeps each row’s stage and counts, and the migration’s check and time', async () => {
    const time = {
      kind: 'whileCopying',
      estimate: { kind: 'range', unit: 'hours', low: 10, high: 11, passes: 3, slowed: false },
    };
    getMock.mockResolvedValueOnce(
      view({
        domains: [row({ stage: 'kept_in_step', itemsFound: 5000, bytesFound: 95_000_000, itemsAdopted: 17 })],
        from: 'gmail',
        checkPassedAt: '2026-10-02T09:00:00.000Z',
        time,
      }),
    );
    const page = await read();
    expect(page.domains[0]).toMatchObject({
      stage: 'kept_in_step',
      itemsFound: 5000,
      bytesFound: 95_000_000,
      itemsAdopted: 17,
    });
    expect(page.from).toBe('gmail');
    expect(page.checkPassedAt).toBe('2026-10-02T09:00:00.000Z');
    expect(page.time).toEqual(time);
  });

  it('reads a stage it does not know as none, and the rest of the page still stands', async () => {
    getMock.mockResolvedValueOnce(view({ domains: [row({ stage: 'teleporting', itemsFound: 5000 })] }));
    const page = await read();
    expect(page.domains[0]!.stage).toBeUndefined();
    expect(page.domains[0]!.itemsSynced).toBe(4211);
  });

  it('drops a time it cannot say, rather than failing the read or saying it wrongly', async () => {
    getMock.mockResolvedValueOnce(view({ time: { kind: 'whileCopying', estimate: { kind: 'fortnights', n: 2 } } }));
    expect((await read()).time).toBeUndefined();
    getMock.mockResolvedValueOnce(view({ time: { kind: 'someday' } }));
    expect((await read()).time).toBeUndefined();
  });

  it('keeps them on each migration of a person’s page too', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        kind: 'person',
        organisation: 'Example Care',
        expiresAt: '2026-12-24T00:00:00.000Z',
        migrations: [
          {
            from: 'gmail',
            to: 'soverin',
            state: 'active',
            started: false,
            domains: [],
            time: { kind: 'beforeStart', estimate: { kind: 'notKnownYet' } },
            account: null,
          },
        ],
        accounts: [],
      },
    });
    const page = await viewApi.read('p.abc.def');
    if (!('kind' in page)) throw new Error('read as a migration’s page');
    expect(page.migrations[0]!.time).toEqual({ kind: 'beforeStart', estimate: { kind: 'notKnownYet' } });
  });
});
