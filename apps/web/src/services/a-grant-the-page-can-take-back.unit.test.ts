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

/** A migration's page's grant; a person's page has one per account instead. */
async function grantRead(): Promise<unknown> {
  const read = await viewApi.read('abc.def');
  if ('kind' in read) throw new Error('read as a person’s page');
  return read.grant;
}

describe('the grant, as the progress page receives it', () => {
  it('keeps each of its three states, and the day of a withdrawal', async () => {
    getMock.mockResolvedValueOnce(view({ state: 'granted' }));
    getMock.mockResolvedValueOnce(view({ state: 'withdrawn', withdrawnAt: '2026-09-24T06:00:00.000Z' }));
    getMock.mockResolvedValueOnce(view({ state: 'none' }));

    expect(await grantRead()).toEqual({ state: 'granted' });
    expect(await grantRead()).toEqual({
      state: 'withdrawn',
      withdrawnAt: '2026-09-24T06:00:00.000Z',
    });
    expect(await grantRead()).toEqual({ state: 'none' });
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

describe('a person’s page (0153 T5 (b), slice 3)', () => {
  const person = (accounts: unknown) => ({
    data: {
      kind: 'person',
      organisation: 'Example Care',
      expiresAt: '2026-12-24T00:00:00.000Z',
      migrations: [
        { from: 'google', to: 'nextcloud', state: 'active', started: false, domains: [], account: 'a'.repeat(32) },
        { from: 'imap', to: 'soverin', state: 'paused', started: false, domains: [], account: null },
      ],
      accounts,
    },
  });

  it('keeps each account’s grant, named by its ref', async () => {
    getMock.mockResolvedValue(person([{ ref: 'a'.repeat(32), grant: { state: 'granted' } }]));
    const read = await viewApi.read('p.abc.def');
    expect('kind' in read && read.kind).toBe('person');
    if (!('kind' in read)) return;
    expect(read.accounts).toEqual([{ ref: 'a'.repeat(32), grant: { state: 'granted' } }]);
    expect(read.migrations.map((m) => m.account)).toEqual(['a'.repeat(32), null]);
  });

  it('refuses an account grant it has no sentence for', async () => {
    getMock.mockResolvedValue(person([{ ref: 'a'.repeat(32), grant: { state: 'suspended' } }]));
    await expect(viewApi.read('p.abc.def')).rejects.toThrow();
  });

  it('takes one account’s grant back by naming its ref in the body', async () => {
    postMock.mockResolvedValue({ data: { withdrawnAt: '2026-09-24T06:00:00.000Z', atGoogle: 'revoked' } });
    const answer = await viewApi.withdrawAccount('p.abc.def', 'a'.repeat(32));
    expect(postMock).toHaveBeenCalledWith('/view/p.abc.def/withdraw', { account: 'a'.repeat(32) });
    expect(answer.atGoogle).toBe('revoked');
  });
});
