// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * GraphMailSource (workplan 0023 T1 — ADR-0006's IMAP-disabled fallback).
 *
 * A fake HTTP client scripted per-URL proves the wire behavior: well-known
 * folders drive special-use authoritatively (localized names included), delta
 * pages are followed to the deltaLink, unkeyable messages are COUNTED rather
 * than dropped, `@removed` entries are skipped, and MIME comes back as the
 * exact bytes — never through a UTF-8 string round-trip.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TokenProvider } from '@openmig/shared';
import type { HttpClient, HttpResponse } from './dav-http.types.ts';
import { GraphMailSource } from './graph-mail-source.ts';

const BASE = 'https://graph.microsoft.com/v1.0';

function tokenProvider(): TokenProvider {
  const token = { accessToken: 'tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  return {
    getToken: vi.fn().mockResolvedValue(token),
    refresh: vi.fn().mockResolvedValue(token),
    isTokenValid: vi.fn().mockReturnValue(true),
    getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
  } as unknown as TokenProvider;
}

function json(status: number, body: unknown): HttpResponse {
  const text = JSON.stringify(body);
  return { status, body: text, headers: {} };
}

/** Routes URL (without query) or full URL to a scripted response. */
function fakeClient(routes: Record<string, HttpResponse | HttpResponse[]>): {
  client: HttpClient;
  seen: string[];
} {
  const seen: string[] = [];
  const remaining = new Map<string, HttpResponse[]>(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  const client: HttpClient = {
    async request(options) {
      seen.push(options.url);
      const queue = remaining.get(options.url) ?? remaining.get(options.url.split('?')[0]!);
      const res = queue?.length === 1 ? queue[0] : queue?.shift();
      if (!res) throw new Error(`fakeClient: unrouted URL ${options.url}`);
      return res;
    },
  };
  return { client, seen };
}

/** The six well-known lookups, all resolving; deleteditems localized. */
function wellKnownRoutes(): Record<string, HttpResponse> {
  return {
    [`${BASE}/me/mailFolders/inbox`]: json(200, { id: 'id-inbox', displayName: 'Inbox' }),
    [`${BASE}/me/mailFolders/sentitems`]: json(200, { id: 'id-sent', displayName: 'Sent Items' }),
    [`${BASE}/me/mailFolders/drafts`]: json(200, { id: 'id-drafts', displayName: 'Drafts' }),
    [`${BASE}/me/mailFolders/archive`]: json(200, { id: 'id-archive', displayName: 'Archive' }),
    [`${BASE}/me/mailFolders/junkemail`]: json(200, { id: 'id-junk', displayName: 'Junk Email' }),
    [`${BASE}/me/mailFolders/deleteditems`]: json(200, { id: 'id-trash', displayName: 'Verwijderde items' }),
  };
}

function source(client: HttpClient): GraphMailSource {
  return new GraphMailSource(tokenProvider(), 'tenant-1', undefined, { httpClient: client });
}

describe('listFolders', () => {
  it('maps special-use from well-known ids — localized display names included', async () => {
    const { client } = fakeClient({
      ...wellKnownRoutes(),
      [`${BASE}/me/mailFolders`]: json(200, {
        value: [
          { id: 'id-inbox', displayName: 'Inbox', childFolderCount: 1 },
          { id: 'id-trash', displayName: 'Verwijderde items' },
          { id: 'id-projects', displayName: 'Projects' },
        ],
      }),
      [`${BASE}/me/mailFolders/id-inbox/childFolders`]: json(200, {
        value: [{ id: 'id-receipts', displayName: 'Receipts' }],
      }),
    });

    const folders = await source(client).listFolders();
    const byPath = new Map(folders.map((f) => [f.path, f]));

    // The localized bin is trash BY ID — a name heuristic could never say so.
    expect(byPath.get('Verwijderde items')?.specialUse).toBe('trash');
    expect(byPath.get('Inbox')?.specialUse).toBe('inbox');
    expect(byPath.get('Projects')?.specialUse).toBe('normal');
    // Nesting builds IMAP-shaped paths.
    expect(byPath.get('Inbox/Receipts')?.specialUse).toBe('normal');
  });

  it('tolerates a missing well-known folder (404) instead of failing the listing', async () => {
    const routes = wellKnownRoutes();
    routes[`${BASE}/me/mailFolders/archive`] = json(404, { error: { code: 'ErrorItemNotFound' } });
    const { client } = fakeClient({
      ...routes,
      [`${BASE}/me/mailFolders`]: json(200, { value: [{ id: 'id-inbox', displayName: 'Inbox' }] }),
    });

    const folders = await source(client).listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]!.specialUse).toBe('inbox');
  });
});

describe('listSince', () => {
  const inboxFolder = { path: 'Inbox', name: 'Inbox', specialUse: 'inbox' as const };

  function listingRoutes(extra: Record<string, HttpResponse | HttpResponse[]>) {
    return {
      ...wellKnownRoutes(),
      [`${BASE}/me/mailFolders`]: json(200, { value: [{ id: 'id-inbox', displayName: 'Inbox' }] }),
      ...extra,
    };
  }

  it('follows pages to the deltaLink and maps items (keywords, receivedAt, sourceRef)', async () => {
    const { client } = fakeClient(
      listingRoutes({
        [`${BASE}/me/mailFolders/id-inbox/messages/delta`]: json(200, {
          value: [
            {
              id: 'g1',
              internetMessageId: '<a@x>',
              receivedDateTime: '2026-08-01T10:00:00Z',
              isRead: true,
              flag: { flagStatus: 'flagged' },
            },
          ],
          '@odata.nextLink': `${BASE}/page2`,
        }),
        [`${BASE}/page2`]: json(200, {
          value: [{ id: 'g2', internetMessageId: '<b@x>', isDraft: true }],
          '@odata.deltaLink': `${BASE}/delta-token-1`,
        }),
      }),
    );

    const s = source(client);
    await s.listFolders();
    const { items, nextCursor, unkeyable } = await s.listSince(inboxFolder);

    expect(items.map((i) => i.messageId)).toEqual(['<a@x>', '<b@x>']);
    expect(items[0]!.keywords).toEqual(['$seen', '$flagged']);
    expect(items[0]!.receivedAt).toBe('2026-08-01T10:00:00Z');
    expect(items[0]!.sourceRef).toBe('g1');
    expect(items[1]!.keywords).toEqual(['$draft']);
    expect(nextCursor.value).toBe(`graph-mail-delta:${BASE}/delta-token-1`);
    expect(unkeyable).toBeUndefined();
  });

  it('resumes from a persisted deltaLink cursor without re-resolving the folder', async () => {
    const { client, seen } = fakeClient({
      [`${BASE}/delta-token-1`]: json(200, {
        value: [{ id: 'g3', internetMessageId: '<c@x>' }],
        '@odata.deltaLink': `${BASE}/delta-token-2`,
      }),
    });

    const { items, nextCursor } = await source(client).listSince(inboxFolder, {
      value: `graph-mail-delta:${BASE}/delta-token-1`,
    });

    expect(items.map((i) => i.messageId)).toEqual(['<c@x>']);
    expect(nextCursor.value).toBe(`graph-mail-delta:${BASE}/delta-token-2`);
    // No folder listing happened — the cursor alone drove the request.
    expect(seen).toEqual([`${BASE}/delta-token-1`]);
  });

  it('counts unkeyable messages instead of dropping them silently', async () => {
    const { client } = fakeClient(
      listingRoutes({
        [`${BASE}/me/mailFolders/id-inbox/messages/delta`]: json(200, {
          value: [
            { id: 'g1', internetMessageId: null },
            { id: 'g2', internetMessageId: '<b@x>' },
          ],
          '@odata.deltaLink': `${BASE}/delta-token-1`,
        }),
      }),
    );

    const s = source(client);
    await s.listFolders();
    const { items, unkeyable } = await s.listSince(inboxFolder);
    expect(items).toHaveLength(1);
    expect(unkeyable).toBe(1);
  });

  it('reports @removed entries by id — and does not count them as unkeyable', async () => {
    const { client } = fakeClient(
      listingRoutes({
        [`${BASE}/me/mailFolders/id-inbox/messages/delta`]: json(200, {
          value: [
            { id: 'g1', '@removed': { reason: 'deleted' } },
            { id: 'g2', internetMessageId: '<b@x>' },
          ],
          '@odata.deltaLink': `${BASE}/delta-token-1`,
        }),
      }),
    );

    const s = source(client);
    await s.listFolders();
    const { items, unkeyable, removed } = await s.listSince(inboxFolder);
    expect(items.map((i) => i.messageId)).toEqual(['<b@x>']);
    expect(unkeyable).toBeUndefined();
    // The id, because a removed entry has no internetMessageId left — it is
    // matched back to the ledger row through the sourceRef recorded at copy.
    expect(removed).toEqual(['g1']);
  });

  it('omits `removed` entirely when the server reported none', async () => {
    // Omitted, not [] — "reported none" and "cannot report" must not read
    // the same downstream.
    const { client } = fakeClient(
      listingRoutes({
        [`${BASE}/me/mailFolders/id-inbox/messages/delta`]: json(200, {
          value: [{ id: 'g2', internetMessageId: '<b@x>' }],
          '@odata.deltaLink': `${BASE}/delta-token-1`,
        }),
      }),
    );

    const s = source(client);
    await s.listFolders();
    const result = await s.listSince(inboxFolder);
    expect('removed' in result).toBe(false);
  });

  it('throws an honest error (status + body) on a failed delta call', async () => {
    const { client } = fakeClient(
      listingRoutes({
        [`${BASE}/me/mailFolders/id-inbox/messages/delta`]: json(401, {
          error: { code: 'InvalidAuthenticationToken' },
        }),
      }),
    );

    const s = source(client);
    await s.listFolders();
    await expect(s.listSince(inboxFolder)).rejects.toThrow(/401.*InvalidAuthenticationToken/s);
  });
});

describe('fetch', () => {
  const item = {
    messageId: '<a@x>',
    folder: { path: 'Inbox', specialUse: 'inbox' as const },
    keywords: [],
    receivedAt: '2026-08-01T10:00:00Z',
    sourceRef: 'g1',
  };

  it('returns the exact bytes — never a UTF-8 string round-trip', async () => {
    // 0xFF 0xFE is invalid UTF-8: a decode/encode round trip would mangle it
    // into replacement characters (the measured failure dav-http.types.ts
    // documents for file content).
    const bytes = new Uint8Array([0x4d, 0x49, 0x4d, 0x45, 0xff, 0xfe, 0x00, 0x01]);
    const { client } = fakeClient({
      [`${BASE}/me/messages/g1/$value`]: {
        status: 200,
        body: new TextDecoder().decode(bytes),
        bodyBytes: bytes,
        headers: {},
      },
    });

    const raw = await source(client).fetch(item);
    expect(Array.from(raw.rfc822)).toEqual(Array.from(bytes));
  });

  it('refuses a client that cannot provide bodyBytes rather than corrupting MIME', async () => {
    const { client } = fakeClient({
      [`${BASE}/me/messages/g1/$value`]: { status: 200, body: 'MIME…', headers: {} },
    });

    await expect(source(client).fetch(item)).rejects.toThrow(/bodyBytes/);
  });
});
