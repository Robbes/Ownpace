// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE COLLECTION THAT WAS NEVER MADE (found live 2026-09-11, migration
 * "G to Sov" against Nextcloud).
 *
 * 87 files under `Wieke/Foto shoot Emma/` failed with
 *
 *     PUT failed for Wieke/Foto shoot Emma/IMG20230122144043.jpg with status
 *     404: … <s:exception>Sabre\DAV\Exception\NotFound</s:exception>
 *     <s:message>File with name /Wieke/Foto shoot Emma could not be
 *     located</s:message>
 *
 * — the PARENT's name in the message, not the file's. Sabre throws that from
 * `getNodeForPath(parent)` inside `createFile`: the collection the file was
 * being PUT into did not exist. It did not exist because the writer's MKCOL
 * for it had been sent and its answer never read (a 409 for a missing
 * ancestor, since MKCOL is not recursive), so the folder's "creation" was a
 * silent no-op and every file underneath failed the same way until the
 * consecutive-failure tripwire stopped the pass — 25 in a row, three times a
 * minute, for an hour.
 *
 * Three things this pins:
 *   1. a nested folder is created one collection at a time, ancestors first;
 *   2. a PUT for a file whose collection nobody made makes it itself, and a
 *      refused MKCOL is the error the operator reads, not a PUT 404;
 *   3. the URL a segment is sent to is percent-encoded exactly once — a name
 *      with `#`, `%` or `?` in it was previously an address the server could
 *      not resolve at all.
 */
import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { WebDAVTargetWriter, type HttpClient } from './webdav-target-writer.ts';

const TENANT = asTenantId('7c9e0000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('7c9e0000-e29b-41d4-a716-4466554461a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav/files/alice';

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

interface Call {
  method: string;
  path: string;
  status: number;
}

const SABRE_NOT_FOUND = (parent: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">` +
  `<s:exception>Sabre\\DAV\\Exception\\NotFound</s:exception>` +
  `<s:message>File with name /${parent} could not be located</s:message></d:error>`;

/**
 * A DAV server with real collection semantics: MKCOL needs its parent, PUT
 * needs its collection, and both say so the way Sabre does.
 */
function davServer(options: { refuseMkcol?: string } = {}) {
  const collections = new Set<string>(['']);
  const files = new Set<string>();
  const calls: Call[] = [];
  const decodedPath = (url: string): string =>
    decodeURIComponent(new URL(url).pathname)
      .replace('/remote.php/dav/files/alice', '')
      .replace(/^\/+|\/+$/g, '');
  const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  const client = {
    async request(o: { method: string; url: string; headers?: Record<string, string> }) {
      const path = decodedPath(o.url);
      const answer = (status: number, body = '') => {
        calls.push({ method: o.method, path, status });
        return { status, body, headers: {} };
      };
      if (o.method === 'PROPFIND') {
        const depth = o.headers?.Depth ?? '0';
        if (!collections.has(path) && !files.has(path)) return answer(404, SABRE_NOT_FOUND(path));
        const self = new URL(o.url).pathname;
        const response = (href: string, dir: boolean) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>` +
          `${dir ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`;
        let body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">` + response(self, collections.has(path));
        if (depth === '1') {
          for (const c of collections) {
            if (c !== '' && parentOf(c) === path) body += response(`/remote.php/dav/files/alice/${encodeURI(c)}/`, true);
          }
        }
        return answer(207, body + '</d:multistatus>');
      }
      if (o.method === 'MKCOL') {
        if (options.refuseMkcol === path) return answer(403, 'no folders for you');
        if (collections.has(path)) return answer(405, 'already there');
        if (!collections.has(parentOf(path))) return answer(409, 'parent missing');
        collections.add(path);
        return answer(201);
      }
      if (o.method === 'PUT') {
        if (!collections.has(parentOf(path))) return answer(404, SABRE_NOT_FOUND(parentOf(path)));
        files.add(path);
        return answer(201);
      }
      return answer(500, `unexpected ${o.method}`);
    },
  } as unknown as HttpClient;

  const writer = new WebDAVTargetWriter(
    { url: `${BASE}/`, username: 'alice', password: 'pw' },
    { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls, collections, files };
}

const fileItem = (path: string) =>
  ({
    item: { path, name: path.slice(path.lastIndexOf('/') + 1), isDirectory: false, size: 1, modifiedAt: '', sourceRef: '' },
    content: new Uint8Array([1]),
  }) as never;

describe('a nested folder is created one collection at a time, ancestors first', () => {
  it('MKCOLs Wieke, then Wieke/Foto shoot Emma — and the space is sent as %20', async () => {
    const { writer, calls, collections } = davServer();

    await writer.ensureDirectory({ path: 'Wieke/Foto shoot Emma', name: 'Foto shoot Emma' } as never);

    const mkcols = calls.filter((c) => c.method === 'MKCOL');
    expect(mkcols.map((c) => c.path)).toEqual(['Wieke', 'Wieke/Foto shoot Emma']);
    expect(mkcols.every((c) => c.status === 201)).toBe(true);
    expect(collections.has('Wieke/Foto shoot Emma')).toBe(true);
  });

  it('a second folder under the same parent costs one MKCOL, not two (the cache holds the parent)', async () => {
    const { writer, calls } = davServer();
    await writer.ensureDirectory({ path: 'Wieke/Foto shoot Emma', name: 'Foto shoot Emma' } as never);
    const before = calls.filter((c) => c.method === 'MKCOL').length;

    await writer.ensureDirectory({ path: 'Wieke/Vakantie', name: 'Vakantie' } as never);

    const mkcols = calls.filter((c) => c.method === 'MKCOL').slice(before);
    expect(mkcols.map((c) => c.path)).toEqual(['Wieke/Vakantie']);
  });
});

describe('a PUT for a file whose collection nobody made', () => {
  it('makes the collection itself, so the file lands on the first try', async () => {
    const { writer, calls, files } = davServer();

    // No ensureDirectory first: the source listed the file under a folder it
    // never listed as a folder.
    const result = await writer.upsertFile('', fileItem('Wieke/Foto shoot Emma/IMG20230122144043.jpg'));

    expect(result.created).toBe(true);
    expect(files.has('Wieke/Foto shoot Emma/IMG20230122144043.jpg')).toBe(true);
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.status).toBe(201);
    expect(calls.filter((c) => c.method === 'MKCOL').map((c) => c.path)).toEqual([
      'Wieke',
      'Wieke/Foto shoot Emma',
    ]);
  });

  it('a refused MKCOL is the error the operator reads — not a PUT 404 naming the parent', async () => {
    const { writer, calls } = davServer({ refuseMkcol: 'Wieke' });

    await expect(
      writer.upsertFile('', fileItem('Wieke/Foto shoot Emma/IMG20230122144043.jpg')),
    ).rejects.toThrow(/MKCOL failed for Wieke with status 403: no folders for you/);

    // The PUT was never sent: there was nothing to send it into.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('a collection the target already has is neither re-created nor a failure', async () => {
    const { writer, calls, collections } = davServer();
    collections.add('Wieke');
    collections.add('Wieke/Foto shoot Emma');

    const result = await writer.upsertFile('', fileItem('Wieke/Foto shoot Emma/IMG20230122144043.jpg'));

    expect(result.created).toBe(true);
    expect(calls.filter((c) => c.method === 'MKCOL')).toHaveLength(0);
  });
});

describe('the URL a segment is sent to', () => {
  it('percent-encodes #, % and ? exactly once and keeps the slashes', async () => {
    const seen: string[] = [];
    const client = {
      async request(o: { method: string; url: string; headers?: Record<string, string> }) {
        seen.push(`${o.method} ${o.url}`);
        if (o.method === 'PROPFIND' && (o.headers?.Depth ?? '0') === '1') {
          const self = new URL(o.url).pathname;
          return {
            status: 207,
            body:
              `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${self}</d:href>` +
              `<d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>` +
              `</d:response></d:multistatus>`,
            headers: {},
          };
        }
        if (o.method === 'PROPFIND') return { status: 404, body: '', headers: {} };
        return { status: 201, body: '', headers: {} };
      },
    } as unknown as HttpClient;
    const writer = new WebDAVTargetWriter(
      { url: `${BASE}/`, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    await writer.upsertFile('', fileItem('Q&A/report #2 (50%).pdf'));

    const put = seen.find((s) => s.startsWith('PUT '));
    expect(put).toBe(`PUT ${BASE}/Q%26A/report%20%232%20(50%25).pdf`);
    // And the parent went through the same encoding — one MKCOL, same rule.
    expect(seen).toContain(`MKCOL ${BASE}/Q%26A`);
    // Never doubled: a `%` in a name is `%25`, not `%2525`.
    expect(put).not.toContain('%2525');
  });
});
