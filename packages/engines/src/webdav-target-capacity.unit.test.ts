// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Free space at a WebDAV destination (workplan 0171 T9): one `Depth: 0`
 * PROPFIND for RFC 4331's two quota properties, on the endpoint's root,
 * nothing written. Over recorded Nextcloud answers.
 */
import { describe, expect, it } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';
import type { Ledger, MappingId, TenantId } from '@openmig/shared';

const ledger = { find: async () => undefined } as unknown as Ledger;
const URL_ROOT = 'https://cloud.example.org/remote.php/dav/files/ana';

/** A Nextcloud 30 answer for a user with a 5 GiB quota, 1 MiB used, as recorded. */
const NEXTCLOUD_5G = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:response><d:href>/remote.php/dav/files/ana/</d:href>
  <d:propstat><d:prop>
   <d:quota-available-bytes>5367660544</d:quota-available-bytes>
   <d:quota-used-bytes>1048576</d:quota-used-bytes>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
</d:multistatus>`;

function writer(answer: HttpResponse, opts: { targetFolderPrefix?: string } = {}) {
  const sent: HttpRequestOptions[] = [];
  const httpClient: HttpClient = {
    request: async (o) => {
      sent.push(o);
      return answer;
    },
  };
  const w = new WebDAVTargetWriter(
    { url: URL_ROOT, username: 'ana', password: 'pw', ...opts },
    { ledger, tenantId: 't' as unknown as TenantId, mappingId: 'm' as unknown as MappingId, httpClient },
  );
  return { w, sent };
}

describe('the WebDAV writer’s capacity()', () => {
  it('reads a Nextcloud user quota, from one Depth: 0 PROPFIND on the root, the prefix left out', async () => {
    const { w, sent } = writer({ status: 207, body: NEXTCLOUD_5G, headers: {} }, { targetFolderPrefix: 'Google' });
    await expect(w.capacity()).resolves.toEqual({
      known: true,
      freeBytes: 5367660544,
      totalBytes: 5367660544 + 1048576,
      pool: `${URL_ROOT}/`,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'PROPFIND', url: `${URL_ROOT}/`, headers: { Depth: '0' } });
    expect(String(sent[0]!.body)).toContain('quota-available-bytes');
  });

  it('is unlimited for a Nextcloud user without a quota (−3)', async () => {
    const { w } = writer({ status: 207, body: NEXTCLOUD_5G.replace('5367660544', '-3'), headers: {} });
    await expect(w.capacity()).resolves.toEqual({ known: false, why: 'unlimited' });
  });

  it('throws on a refused PROPFIND, for the route to say it was not answered', async () => {
    const { w } = writer({ status: 401, body: 'nope', headers: {} });
    await expect(w.capacity()).rejects.toThrow(/PROPFIND for the quota .* failed with status 401/);
  });
});
