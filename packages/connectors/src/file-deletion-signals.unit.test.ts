// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two ways a file source can say the owner deleted something.
 *
 * Before this the file domain had only absence-counting — a file stops appearing in
 * two consecutive complete listings — which is the weakest of the three signals and
 * the slowest to trust. Both sources could do better and neither was asked to:
 *
 *   - **Nextcloud** keeps a bin at its own endpoint, and every entry in it carries
 *     the ORIGINAL path of the file. That is `trashed` evidence: a positive
 *     observation of the item in a place that means "the person deleted this".
 *   - **OneDrive/SharePoint** answer a delta query with the items that CHANGED and
 *     the ones that were DELETED, the latter carrying a `deleted` facet. That is
 *     the Graph equivalent of a CalDAV `sync-collection` 404 — `reported` evidence
 *     — and `graph-drive-source` was reading it and throwing it away, under a
 *     comment saying deletions "should be handled separately" with nothing
 *     anywhere handling them.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebdavFileSource } from './webdav-source.ts';
import { GraphDriveSource } from './graph-drive-source.ts';
import type { HttpClient, HttpResponse } from './dav-http.types.ts';

function client(handler: (opts: { method?: string; url: string }) => HttpResponse): HttpClient {
  return { request: vi.fn(async (opts) => handler(opts as { method?: string; url: string })) };
}

const TRASHBIN_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/trashbin/alice/trash/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/trashbin/alice/trash/report.pdf.d1697029384</d:href>
    <d:propstat><d:prop>
      <nc:trashbin-original-location>Documents/report.pdf</nc:trashbin-original-location>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

describe('WebdavFileSource.listTrashedPaths', () => {
  it('asks the account\'s own trashbin and returns original paths', async () => {
    const seen: Array<{ method?: string; url: string }> = [];
    const source = new WebdavFileSource(
      { url: 'https://cloud.example.com/remote.php/dav/files/alice/', username: 'alice', password: 'pw' },
      {
        httpClient: client((opts) => {
          seen.push(opts);
          return { status: 207, body: TRASHBIN_BODY, headers: {} };
        }),
      },
    );

    expect((await source.listTrashedPaths()).paths).toEqual(['Documents/report.pdf']);
    // Derived from the files endpoint, not configured — the two are the same
    // account by construction, and asking an operator to write the second URL by
    // hand is asking them to get it subtly wrong.
    expect(seen[0]!.url).toBe('https://cloud.example.com/remote.php/dav/trashbin/alice/trash/');
    expect(seen[0]!.method).toBe('PROPFIND');
  });

  it('reports nothing, and asks nothing, when the endpoint is not Nextcloud-shaped', async () => {
    // A bin is not a WebDAV concept. Probing a guessed path on somebody else's
    // server is worse than admitting we cannot tell.
    const request = vi.fn();
    const source = new WebdavFileSource(
      { url: 'https://dav.example.com/webdav/', username: 'alice', password: 'pw' },
      { httpClient: { request } as unknown as HttpClient },
    );

    expect((await source.listTrashedPaths()).paths).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('treats "no such collection" as no bin, and anything else as an error', async () => {
    // The distinction matters: a server that does not serve a trashbin should not
    // produce a warning on every pass forever, while a server that fails to answer
    // one it does serve must not be silently read as "nothing was deleted".
    for (const status of [404, 405, 501]) {
      const quiet = new WebdavFileSource(
        { url: 'https://cloud.example.com/remote.php/dav/files/alice/', username: 'alice', password: 'pw' },
        { httpClient: client(() => ({ status, body: '', headers: {} })) },
      );
      expect((await quiet.listTrashedPaths()).paths).toEqual([]);
    }

    const broken = new WebdavFileSource(
      { url: 'https://cloud.example.com/remote.php/dav/files/alice/', username: 'alice', password: 'pw' },
      { httpClient: client(() => ({ status: 503, body: 'busy', headers: {} })) },
    );
    await expect(broken.listTrashedPaths()).rejects.toThrow(/503/);
  });

  it('drops a deletion from outside the synced subtree', async () => {
    // `rootPath` means `FileItem.path` is relative to the subtree, while the bin
    // reports paths relative to the account. A file deleted elsewhere in the
    // account is not in scope.
    const body = TRASHBIN_BODY.replace(
      'Documents/report.pdf',
      'Personal/taxes.pdf',
    );
    const source = new WebdavFileSource(
      {
        url: 'https://cloud.example.com/remote.php/dav/files/alice/',
        username: 'alice',
        password: 'pw',
        rootPath: 'Documents',
      },
      { httpClient: client(() => ({ status: 207, body, headers: {} })) },
    );

    expect((await source.listTrashedPaths()).paths).toEqual([]);
  });

  it('strips the rootPath so the key matches what was recorded', async () => {
    const source = new WebdavFileSource(
      {
        url: 'https://cloud.example.com/remote.php/dav/files/alice/',
        username: 'alice',
        password: 'pw',
        rootPath: 'Documents',
      },
      { httpClient: client(() => ({ status: 207, body: TRASHBIN_BODY, headers: {} })) },
    );

    expect((await source.listTrashedPaths()).paths).toEqual(['report.pdf']);
  });
});

/** A delta answer with one live file and one the service says is deleted. */
const DELTA_BODY = JSON.stringify({
  value: [
    {
      id: 'item-live',
      name: 'kept.txt',
      parentReference: { path: '/drive/root:' },
      size: 4,
      lastModifiedDateTime: '2026-07-01T00:00:00Z',
      file: { mimeType: 'text/plain' },
      cTag: 'ctag-1',
    },
    { id: 'item-gone', name: 'deleted.txt', deleted: { state: 'deleted' } },
  ],
  '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=next',
});

describe('GraphDriveSource.listSince', () => {
  const source = () =>
    new GraphDriveSource({
      tenantId: 'tenant',
      tokenProvider: { getAccessToken: async () => 'token' } as never,
    });

  it('surfaces the deleted item ids alongside the live files', async () => {
    const src = source();
    (src as any).makeRequest = async () => ({ status: 200, body: DELTA_BODY, headers: {} });

    const result = await src.listSince({ path: '/' } as never);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.item.path).toContain('kept.txt');
    expect(result.removed).toEqual(['item-gone']);
  });

  it('records the id as the item\'s source ref, which is what makes the match possible', async () => {
    // A deleted delta entry carries the id and no reliable path — no `path`, and
    // `parentReference` may be partial — so the id is the only way back from
    // "item X is gone" to the row we wrote. Which means the LIVE item has to record
    // it, or there is nothing to look up.
    const src = source();
    (src as any).makeRequest = async () => ({ status: 200, body: DELTA_BODY, headers: {} });

    const result = await src.listSince({ path: '/' } as never);
    expect(result.items[0]!.item.sourceRef).toBe('item-live');
  });

  it('omits the field when nothing was deleted', async () => {
    // Absent and `[]` are different claims: a full `children` listing reports no
    // deletions either, and must not be spelled the same way as "none happened".
    const src = source();
    const body = JSON.stringify({
      value: [
        {
          id: 'item-live',
          name: 'kept.txt',
          parentReference: { path: '/drive/root:' },
          size: 4,
          lastModifiedDateTime: '2026-07-01T00:00:00Z',
          file: {},
        },
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=next',
    });
    (src as any).makeRequest = async () => ({ status: 200, body, headers: {} });

    expect((await src.listSince({ path: '/' } as never)).removed).toBeUndefined();
  });

  it('reports a deleted FOLDER too', async () => {
    // A deleted folder is an item whose id we may have recorded. Graph also emits
    // an entry per child, but dropping the folder itself here would make that one
    // silently unreportable — and `item.folder` is not even set on a delete.
    const src = source();
    const body = JSON.stringify({
      value: [{ id: 'folder-gone', name: 'Archive', deleted: { state: 'deleted' }, folder: {} }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=next',
    });
    (src as any).makeRequest = async () => ({ status: 200, body, headers: {} });

    expect((await src.listSince({ path: '/' } as never)).removed).toEqual(['folder-gone']);
  });
});
