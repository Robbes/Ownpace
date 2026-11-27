// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH KIND OF SOVERIN MAILBOX THIS IS, decided on recorded answers
 * (workplan 0175 §5.2, T8).
 *
 * One case per row of §5.2's table. The rows whose answer the maintainer's
 * live test (T0) fixes are held at `unknown` until it has: a mailbox is never
 * called Suite on a guess, and never personal where Suite may also answer.
 * What no test here proves is a real Soverin mailbox of either kind; T0 is
 * that proof, and the maintainer runs it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { askPrincipal, decideSoverinKind, measureSoverinKind, type PrincipalAnswer } from './soverin-kind.ts';

const AT = '2026-11-27T10:00:00.000Z';
const ROOT = 'https://caldav.soverin.net/';
const principal = (href = '/principals/<mailbox>/'): PrincipalAnswer => ({ answered: 'principal', principal: href });
const refused = (status = 401, words = '401 Unauthorized'): PrincipalAnswer => ({ answered: 'refused', status, words });
const nothing = (words = 'The server did not answer within 20 seconds.'): PrincipalAnswer => ({
  answered: 'nothing',
  words,
});

describe("§5.2's table, row by row (C, Suite's Nextcloud, is not asked before T0 names its host)", () => {
  it('row 1: the personal server answers a principal and lists collections, Suite does not answer: personal', () => {
    expect(decideSoverinKind({ davRoot: ROOT, b: principal(), collections: 3, measuredAt: AT })).toEqual({
      kind: 'personal',
      davRoot: ROOT,
      principal: '/principals/<mailbox>/',
      measuredAt: AT,
    });
    // C refused reads the same as C not asked.
    expect(decideSoverinKind({ davRoot: ROOT, b: principal(), collections: 1, c: refused(), measuredAt: AT }).kind).toBe(
      'personal',
    );
  });

  it('row 2 (T0 decides): the personal server refuses: unknown, with its words verbatim', () => {
    const record = decideSoverinKind({ davRoot: ROOT, b: refused(401, '401 Unauthorized'), measuredAt: AT });
    expect(record.kind).toBe('unknown');
    expect(record.reason).toContain('401 Unauthorized');
    expect(record.davRoot).toBeUndefined();
  });

  it('row 2 (T0 decides): the personal server answers an empty account: unknown, never guessed personal', () => {
    const record = decideSoverinKind({ davRoot: ROOT, b: principal(), collections: 0, measuredAt: AT });
    expect(record.kind).toBe('unknown');
    expect(record.reason).toMatch(/no calendars and no address books/);
  });

  it('row 4 (T0 names the tie-breaker): both servers answer a principal: unknown', () => {
    const record = decideSoverinKind({ davRoot: ROOT, b: principal(), collections: 2, c: principal('/x/'), measuredAt: AT });
    expect(record.kind).toBe('unknown');
    expect(record.reason).toMatch(/both/i);
  });

  it('row 5: neither answers (a time-out, a 5xx): unknown, with the words of what failed verbatim', () => {
    const record = decideSoverinKind({ davRoot: ROOT, b: nothing('503 Service Unavailable'), measuredAt: AT });
    expect(record).toEqual({
      kind: 'unknown',
      reason: "Soverin's personal server did not answer: 503 Service Unavailable",
      measuredAt: AT,
    });
  });

  it('never writes the kind suite before T0: no recorded answer reaches it', () => {
    const answers: PrincipalAnswer[] = [principal(), refused(), nothing()];
    for (const b of answers) {
      for (const c of [undefined, ...answers]) {
        for (const collections of [undefined, 0, 4]) {
          const kind = decideSoverinKind({ davRoot: ROOT, b, collections, ...(c ? { c } : {}), measuredAt: AT }).kind;
          expect(kind).not.toBe('suite');
        }
      }
    }
  });

  it('a principal whose listing failed is unknown, with the listing’s words', () => {
    const record = decideSoverinKind({
      davRoot: ROOT,
      b: principal(),
      listing: 'Unmeasured — the probe was refused: 403',
      measuredAt: AT,
    });
    expect(record.kind).toBe('unknown');
    expect(record.reason).toContain('Unmeasured — the probe was refused: 403');
  });
});

describe('asking a DAV root for its principal (B), read-only', () => {
  afterEach(() => vi.unstubAllGlobals());

  const multistatus = (href: string) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop>
<d:current-user-principal><d:href>${href}</d:href></d:current-user-principal>
</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

  it('a 207 naming a principal is a principal, asked with PROPFIND and Depth 0', async () => {
    const fetch = vi.fn(async () => new Response(multistatus('/principals/mailbox/'), { status: 207 }));
    vi.stubGlobal('fetch', fetch);
    expect(await askPrincipal(ROOT, 'u', 'p')).toEqual({ answered: 'principal', principal: '/principals/mailbox/' });
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].method).toBe('PROPFIND');
    expect((init[1].headers as Record<string, string>).Depth).toBe('0');
  });

  it('a 401 is a refusal, with the status and its text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401, statusText: 'Unauthorized' })));
    expect(await askPrincipal(ROOT, 'u', 'p')).toEqual({ answered: 'refused', status: 401, words: '401 Unauthorized' });
  });

  it('a 207 that names no principal is an answer without one: a refusal, not a principal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<d:multistatus xmlns:d="DAV:"/>', { status: 207 })));
    const answer = await askPrincipal(ROOT, 'u', 'p');
    expect(answer.answered).toBe('refused');
  });

  it('a 5xx and a network failure are no answer at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502, statusText: 'Bad Gateway' })));
    expect(await askPrincipal(ROOT, 'u', 'p')).toEqual({ answered: 'nothing', words: '502 Bad Gateway' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND caldav.soverin.net');
      }),
    );
    expect(await askPrincipal(ROOT, 'u', 'p')).toEqual({
      answered: 'nothing',
      words: 'getaddrinfo ENOTFOUND caldav.soverin.net',
    });
  });
});

describe('measuring the kind of a row with none (D6: once, by its next pass, before its DAV faces)', () => {
  it('asks the principal and the collections at the row’s DAV root, with the mailbox login', async () => {
    const asked: string[] = [];
    const record = await measureSoverinKind(
      { host: 'caldav.soverin.net', port: 443 },
      { username: '<mailbox>', password: 'p' },
      {
        now: () => new Date(AT),
        principal: async (url, username) => {
          asked.push(`principal ${url} ${username}`);
          return principal();
        },
        calendars: async () => 2,
        addressBooks: async () => 1,
      },
    );
    expect(asked).toEqual(['principal https://caldav.soverin.net:443/ <mailbox>']);
    expect(record).toEqual({
      kind: 'personal',
      davRoot: 'https://caldav.soverin.net:443/',
      principal: '/principals/<mailbox>/',
      measuredAt: AT,
    });
  });

  it('a listing that fails leaves the kind unknown with its words; nothing is swallowed', async () => {
    const record = await measureSoverinKind(
      { host: 'caldav.soverin.net' },
      { username: '<mailbox>', password: 'p' },
      {
        now: () => new Date(AT),
        principal: async () => principal(),
        calendars: async () => {
          throw new Error('PROPFIND calendar-home-set: 500');
        },
        addressBooks: async () => 1,
      },
    );
    expect(record.kind).toBe('unknown');
    expect(record.reason).toContain('PROPFIND calendar-home-set: 500');
  });
});
