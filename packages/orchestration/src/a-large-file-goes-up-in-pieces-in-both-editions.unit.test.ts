// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LARGE FILE GOES UP IN PIECES IN BOTH EDITIONS (workplan 0156, hard rule 5).
 *
 * The WebDAV writer sends a file above 64 MiB to Nextcloud as its chunked
 * upload, so that a limit on the size of one request (the demo's Apache at
 * 1 GiB, nginx, a CDN) no longer refuses it: the owner's four largest Dropbox
 * files were parked with 413 on 2026-10-03.
 *
 * Nothing in either edition switches that on, on purpose: the writer derives
 * the account's upload area from the files URL it is given. So what has to
 * hold is that the URL each edition gives it is the one that derivation
 * reads — Nextcloud's `…/dav/files/<user>/` — and that neither factory puts
 * anything in the writer's way. The old chunked path was the opposite case:
 * a config switch that neither edition's factory ever set, so it existed in
 * the writer and nowhere else.
 *
 *  - MANAGED: `fileEndpointFromCreds` appends `files/<user>/` to a
 *    `nextcloud` connection's DAV URL, and `buildFileTargetFor` builds the
 *    writer (`build-deps-from-mapping.ts`).
 *  - SELF-HOST: the operator writes the files URL into the mapping, and the
 *    same `buildFileTargetFor` builds the writer (`build-deps.ts`).
 *  - `buildFileTarget` (`dav-factories.ts`) builds the same writer the same way.
 */

import { describe, expect, it } from 'vitest';
import { asMappingId, asTenantId, type FileBody, type Ledger, type RawFileItem } from '@openmig/shared';
import type { HttpClient, HttpRequestOptions, HttpResponse } from '@openmig/engines/webdav-target-writer';
import { fileEndpointFromCreds } from './dav-endpoint.ts';
import { buildFileTargetFor } from './file-target-factory.ts';
import { buildFileTarget, type DavEndpoint, type DavTargetDeps } from './dav-factories.ts';

// UUID family 0156a500-…, unused elsewhere in the repo.
const TENANT = asTenantId('0156a500-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0156a500-e29b-41d4-a716-446655440002' as never);

/** One byte over the 64 MiB a piece is, made as it is read and never held. */
const SIZE = 64 * 1024 * 1024 + 1;

function zeros(size: number): FileBody {
  return {
    sizeBytes: size,
    open: async () => {
      let at = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= size) {
            controller.close();
            return;
          }
          const n = Math.min(1024 * 1024, size - at);
          at += n;
          controller.enqueue(new Uint8Array(n));
        },
      });
    },
  };
}

const video: RawFileItem = {
  item: { path: 'Videos/VID_20211003_095021.mp4', isDirectory: false, size: SIZE, modifiedAt: '', sourceRef: 'r' },
  body: zeros(SIZE),
};

/** What reached the wire: method, URL and the bytes each body carried. */
function nextcloud(): { client: HttpClient; sent: Array<{ method: string; url: string; bytes: number }> } {
  const sent: Array<{ method: string; url: string; bytes: number }> = [];
  const client: HttpClient = {
    async request(o: HttpRequestOptions): Promise<HttpResponse> {
      let bytes = 0;
      if (o.body instanceof ReadableStream) {
        const reader = o.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
        }
      }
      sent.push({ method: o.method, url: o.url, bytes });
      if (o.method === 'PROPFIND') {
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      }
      return { status: 201, body: '', headers: { ETag: '"assembled"' } };
    },
  };
  return { client, sent };
}

/** The deps both editions hand the factory, with a client the test can read. */
const depsWith = (client: HttpClient): DavTargetDeps =>
  ({
    ledger: { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger,
    tenantId: TENANT,
    mappingId: MAPPING,
    // Not part of `DavTargetDeps`: the writer reads it from the same object,
    // which is how the factories pass their deps straight through.
    httpClient: client,
  }) as DavTargetDeps;

function expectPieces(sent: Array<{ method: string; url: string; bytes: number }>): void {
  const uploads = sent.filter((s) => s.url.startsWith('https://cloud.example/remote.php/dav/uploads/alice/'));
  expect(uploads.map((s) => `${s.method} ${s.url.replace(/.*\/ownpace-[0-9a-f-]+/, '')}`)).toEqual([
    'MKCOL ',
    'PUT /00001',
    'PUT /00002',
    'MOVE /.file',
  ]);
  expect(uploads.filter((s) => s.method === 'PUT').map((s) => s.bytes)).toEqual([64 * 1024 * 1024, 1]);
  expect(
    sent.filter((s) => s.method === 'PUT' && s.url.includes('/dav/files/')),
    'the file went up as one request',
  ).toEqual([]);
}

describe('a large file goes up in pieces in both editions', () => {
  it('managed: the files URL a nextcloud connection resolves to', async () => {
    const endpoint = fileEndpointFromCreds(
      'target',
      { url: 'https://cloud.example/remote.php/dav' },
      { username: 'alice', password: 'pw' },
      'nextcloud',
    );
    expect(endpoint.url).toBe('https://cloud.example/remote.php/dav/files/alice/');
    const { client, sent } = nextcloud();

    const result = await buildFileTargetFor('webdav', endpoint, depsWith(client)).upsertFile('', video);

    expect(result).toMatchObject({ created: true, targetVersion: 'assembled' });
    expectPieces(sent);
  });

  it('self-host: the files URL an operator writes into the mapping', async () => {
    const endpoint: DavEndpoint = {
      url: 'https://cloud.example/remote.php/dav/files/alice/',
      username: 'alice',
      password: 'pw',
    };
    const { client, sent } = nextcloud();

    await buildFileTargetFor('webdav', endpoint, depsWith(client)).upsertFile('', video);

    expectPieces(sent);
  });

  it('dav-factories builds the same writer, the same way', async () => {
    const { client, sent } = nextcloud();
    await buildFileTarget(
      { url: 'https://cloud.example/remote.php/dav/files/alice/', username: 'alice', password: 'pw' },
      depsWith(client),
    ).upsertFile('', video);
    expectPieces(sent);
  });
});
