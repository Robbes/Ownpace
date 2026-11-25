// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Free space at the destination, as each connector's writer reads it
 * (workplan 0171 T9): the IMAP writer's `GETQUOTAROOT`, the JMAP writers'
 * `Quota/get`, Cirrux Drive's storage, each over a recorded answer, and the
 * unknowns each one says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** What the fake IMAP server announces, and what `getQuota` gives back. */
let capabilities: string[];
let quota: unknown;
let quotaAsked: string[];

vi.mock('imapflow', () => {
  class FakeImapFlow {
    capabilities = new Map<string, boolean>();
    on(): void {}
    async connect(): Promise<void> {
      for (const c of capabilities) this.capabilities.set(c, true);
    }
    async logout(): Promise<void> {}
    close(): void {}
    async getQuota(path: string): Promise<unknown> {
      quotaAsked.push(path);
      return quota;
    }
  }
  return { ImapFlow: FakeImapFlow };
});

import { ImapFlowDavMailTarget } from './imapflow-dav-target.ts';
import { jmapPool, jmapQuotaAnnounced, readJmapCapacity } from './jmap-quota.ts';
import { CirruxDriveTarget } from './cirrux-drive-target.ts';
import type { CirruxDriveApi } from './cirrux-drive-api.ts';

const imapWriter = () =>
  new ImapFlowDavMailTarget({ host: 'imap.test', port: 993, tls: true, username: 'ana@example.org', password: 'pw' });

beforeEach(() => {
  capabilities = ['IMAP4rev1'];
  quota = undefined;
  quotaAsked = [];
});

describe('IMAP: GETQUOTAROOT INBOX, asked only when QUOTA is announced', () => {
  it('reads STORAGE from a server that announces QUOTA', async () => {
    capabilities = ['IMAP4rev1', 'QUOTA'];
    // Stalwart's `* QUOTA "" (STORAGE 2048 102400)`, as imapflow returns it (bytes).
    quota = { path: 'INBOX', quotaRoot: '', storage: { usage: 2048 * 1024, limit: 102400 * 1024, status: '2%' } };
    await expect(imapWriter().capacity()).resolves.toEqual({
      known: true,
      freeBytes: (102400 - 2048) * 1024,
      totalBytes: 102400 * 1024,
      pool: 'imap://ana@example.org@imap.test:993#quota-root:',
    });
    expect(quotaAsked).toEqual(['INBOX']);
  });

  it('does not ask a server without QUOTA, and says it is not offered', async () => {
    await expect(imapWriter().capacity()).resolves.toEqual({ known: false, why: 'not_offered' });
    expect(quotaAsked).toEqual([]);
  });

  it('reads the library’s false from a server that announces QUOTA as not answered', async () => {
    capabilities = ['QUOTA=RES-STORAGE'];
    quota = false;
    await expect(imapWriter().capacity()).resolves.toEqual({ known: false, why: 'not_answered' });
  });
});

/** A `fetch` that answers one recorded JMAP response and remembers the request. */
function recorded(status: number, body: unknown) {
  const sent: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { sent, fetchImpl };
}

const jmapOpts = { apiUrl: 'https://mail.example.org/jmap', authHeader: 'Basic x', accountId: 'b', pool: 'jmap:p' };

describe('JMAP: Quota/get (RFC 9425)', () => {
  it('knows the capability on the session or on the account', () => {
    expect(jmapQuotaAnnounced({ capabilities: { 'urn:ietf:params:jmap:quota': {} } }, 'b')).toBe(true);
    expect(
      jmapQuotaAnnounced({ accounts: { b: { accountCapabilities: { 'urn:ietf:params:jmap:quota': {} } } } }, 'b'),
    ).toBe(true);
    expect(jmapQuotaAnnounced({ capabilities: { 'urn:ietf:params:jmap:mail': {} } }, 'b')).toBe(false);
  });

  it('names the pool by server and account, so mail and files to one account are one pool', () => {
    expect(jmapPool('https://mail.example.org/', 'b')).toBe(jmapPool('https://mail.example.org', 'b'));
  });

  it('reads Stalwart’s recorded answer, asking with the quota capability', async () => {
    const { sent, fetchImpl } = recorded(200, {
      methodResponses: [
        [
          'Quota/get',
          {
            accountId: 'b',
            state: 's1',
            list: [{ id: 'q', resourceType: 'octets', scope: 'account', used: 1_310_720, hardLimit: 104_857_600, name: 'ana' }],
            notFound: [],
          },
          'q',
        ],
      ],
      sessionState: 'x',
    });
    await expect(readJmapCapacity({ ...jmapOpts, announced: true, fetchImpl })).resolves.toEqual({
      known: true,
      freeBytes: 104_857_600 - 1_310_720,
      totalBytes: 104_857_600,
      pool: 'jmap:p',
    });
    expect(sent[0]!.body).toMatchObject({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:quota'],
      methodCalls: [['Quota/get', { accountId: 'b', ids: null }, 'q']],
    });
  });

  it('asks nothing of a server without the capability', async () => {
    const { sent, fetchImpl } = recorded(200, {});
    await expect(readJmapCapacity({ ...jmapOpts, announced: false, fetchImpl })).resolves.toEqual({
      known: false,
      why: 'not_offered',
    });
    expect(sent).toEqual([]);
  });

  it('throws on a method error and on an HTTP failure, never reading them as room', async () => {
    const methodError = recorded(200, { methodResponses: [['error', { type: 'unknownMethod' }, 'q']] });
    await expect(readJmapCapacity({ ...jmapOpts, announced: true, fetchImpl: methodError.fetchImpl })).rejects.toThrow(
      /Quota\/get failed: unknownMethod/,
    );
    const http = recorded(503, 'busy');
    await expect(readJmapCapacity({ ...jmapOpts, announced: true, fetchImpl: http.fetchImpl })).rejects.toThrow(
      /HTTP 503/,
    );
  });
});

describe('Cirrux Drive: the workspace pool', () => {
  const target = (storage: () => Promise<unknown>) =>
    new CirruxDriveTarget({
      api: {
        profile: async () => ({ workspace: { uuid: 'w-1' } }),
        storage,
      } as unknown as CirruxDriveApi,
    });

  it('reads the pool, named by the workspace', async () => {
    await expect(target(async () => ({ used_bytes: 3_000, pool_bytes: 10_000 })).capacity()).resolves.toEqual({
      known: true,
      freeBytes: 7_000,
      totalBytes: 10_000,
      pool: 'cirrux:w-1',
    });
  });

  it('is not answered when the answer lacks the pool', async () => {
    await expect(target(async () => ({ used_bytes: 3_000 })).capacity()).resolves.toEqual({
      known: false,
      why: 'not_answered',
    });
  });

  it('throws when the read fails, for the route to say so', async () => {
    await expect(target(async () => Promise.reject(new Error('HTTP 502'))).capacity()).rejects.toThrow('HTTP 502');
  });
});
