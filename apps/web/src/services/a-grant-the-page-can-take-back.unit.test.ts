// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The grant the progress page can take back survives the parse (workplan 0108
 * T8 (c)).
 *
 * `z.object` strips what it does not name, and the page's tests mock this
 * service, so a schema that forgot `grant` would pass every page test while
 * the page offered nothing to the person it exists for. The same defect as
 * `grant-service.unit.test.ts` guards against, on the other page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('./link-client.ts', () => ({ linkClient: { get: getMock, post: postMock } }));

import { viewApi } from './view-service.ts';

const view = (grant: unknown) => ({
  data: {
    organisation: 'Example Care',
    state: 'active',
    started: false,
    domains: [],
    expiresAt: '2026-12-24T00:00:00.000Z',
    grant,
  },
});

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('the grant, as the progress page receives it', () => {
  it('keeps each of its three states, and the day of a withdrawal', async () => {
    getMock.mockResolvedValueOnce(view({ state: 'granted' }));
    getMock.mockResolvedValueOnce(view({ state: 'withdrawn', withdrawnAt: '2026-09-24T06:00:00.000Z' }));
    getMock.mockResolvedValueOnce(view({ state: 'none' }));

    expect((await viewApi.read('abc.def')).grant).toEqual({ state: 'granted' });
    expect((await viewApi.read('abc.def')).grant).toEqual({
      state: 'withdrawn',
      withdrawnAt: '2026-09-24T06:00:00.000Z',
    });
    expect((await viewApi.read('abc.def')).grant).toEqual({ state: 'none' });
  });

  it('refuses a state it has no sentence for, rather than offering a button it cannot explain', async () => {
    getMock.mockResolvedValue(view({ state: 'suspended' }));

    await expect(viewApi.read('abc.def')).rejects.toThrow();
  });
});

describe('taking it back', () => {
  it('is a POST to the link’s own withdraw address, answered with what Google said', async () => {
    postMock.mockResolvedValue({ data: { withdrawnAt: '2026-09-24T06:00:00.000Z', atGoogle: 'not_confirmed' } });

    const answer = await viewApi.withdraw('abc.def/x');

    expect(postMock).toHaveBeenCalledWith('/view/abc.def%2Fx/withdraw');
    expect(answer).toEqual({ withdrawnAt: '2026-09-24T06:00:00.000Z', atGoogle: 'not_confirmed' });
  });

  it('refuses an answer about Google it cannot put into words', async () => {
    postMock.mockResolvedValue({ data: { withdrawnAt: '2026-09-24T06:00:00.000Z', atGoogle: 'maybe' } });

    await expect(viewApi.withdraw('abc.def')).rejects.toThrow();
  });
});
