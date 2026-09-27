// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REMOVAL THE SERVER CHECKS (workplan 0149 T3).
 *
 * *Apply deletions* is offered to testers (0149 D1), so removal has to fail
 * closed. Two things let it through:
 *
 * - **The check had a gap.** A DELETE, and a rewrite PUT, went out after a HEAD
 *   and a comparison in a separate request, so an edit that landed between the
 *   two was destroyed. And a HEAD that failed meant "proceed".
 * - **No version meant no check.** A row written before versions existed, from
 *   a server that returns no ETag on PUT, or recorded `copied` after a 412,
 *   was removed with nothing compared at all.
 *
 * So the server checks, in the request itself: the DELETE and the rewrite PUT
 * carry `If-Match` with the version we recorded. A 412 means the copy is not
 * the one we wrote: a rewrite is then a conflict, and a removal asks one HEAD
 * whether the copy is gone (already removed) or changed (a conflict). With no
 * version, a removal sends nothing and answers `unversioned`; a rewrite goes
 * ahead unconditioned, as the owner kept it (D3). A weak ETag cannot be matched
 * by `If-Match` (RFC 9110 §13.1.1), so it is recorded as weak: a removal treats
 * it as none, and a rewrite keeps the read and the comparison (D4).
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import { removeDavResource } from './dav-remove.ts';
import { ifMatchFor, readVersion } from './dav-target-version.ts';

// UUID family 0149a300-…, unused elsewhere in the repo.
const TENANT = asTenantId('0149a300-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0149a300-e29b-41d4-a716-446655440002' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';
const EMPTY = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>';

interface Sent {
  readonly method: string;
  readonly headers: Record<string, string>;
  status?: number;
}

/**
 * A DAV server holding one object at version `current` (none when undefined,
 * and nothing at all when `gone`). It honours `If-Match` as a real server does:
 * a PUT or DELETE naming another version, or any version when there is none to
 * match, is refused with 412.
 */
function davServer(options: { current?: string; gone?: boolean; putEtag?: string } = {}) {
  const sent: Sent[] = [];
  const client: HttpClient = {
    async request(o) {
      const call: Sent = { method: o.method, headers: (o.headers ?? {}) as Record<string, string> };
      sent.push(call);
      const answer = (status: number, headers: Record<string, string> = {}) => {
        call.status = status;
        return { status, body: '', headers };
      };
      if (o.method === 'HEAD') {
        if (options.gone) return answer(404);
        return answer(200, options.current !== undefined ? { etag: `"${options.current}"` } : {});
      }
      if (o.method === 'PUT' || o.method === 'DELETE') {
        const ifMatch = call.headers['If-Match'];
        if (ifMatch !== undefined && (options.gone || ifMatch !== `"${options.current}"`)) return answer(412);
        if (o.method === 'DELETE') return answer(204);
        // A server takes the whole body before it answers, which is when a
        // streamed PUT's digest becomes a fact about the file.
        const body = o.body as unknown;
        if (body instanceof ReadableStream) await new Response(body as ReadableStream<Uint8Array>).arrayBuffer();
        return answer(204, { etag: options.putEtag ?? '"after-our-write"' });
      }
      return { status: 207, body: EMPTY, headers: {} };
    },
  };
  return {
    client,
    sent,
    of: (method: string) => sent.filter((s) => s.method === method),
    /** What the server accepted: a refused request is not a write. */
    accepted: (method: string) => sent.filter((s) => s.method === method && s.status === 204),
  };
}

const emptyLedger = { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger;

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:evt-1\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR';
const VCF = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:card-1\r\nFN:n\r\nEND:VCARD';

/** Each writer, its removal, and its rewrite, behind the same server. */
const WRITERS = [
  {
    name: 'CalDAV',
    make: (client: HttpClient, ledger: Ledger = emptyLedger) =>
      new CalDAVTargetWriter(
        { url: BASE, username: 'alice', password: 'pw' },
        { domain: 'calendar', ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
      ),
    remove: (w: never, version?: string) =>
      (w as CalDAVTargetWriter).removeItem('calendars/alice/personal/evt-1.ics', {
        ...(version !== undefined ? { expectedTargetVersion: version } : {}),
      }),
    rewrite: (w: never, version?: string) =>
      (w as CalDAVTargetWriter).upsertCalendarEvent('/calendars/alice/personal/', { icalendar: ICS } as never, {
        overwrite: true,
        ...(version !== undefined ? { expectedTargetVersion: version } : {}),
      }),
    create: (w: never) => (w as CalDAVTargetWriter).upsertCalendarEvent('/calendars/alice/personal/', { icalendar: ICS } as never),
  },
  {
    name: 'CardDAV',
    make: (client: HttpClient, ledger: Ledger = emptyLedger) =>
      new CardDAVTargetWriter(
        { url: BASE, username: 'alice', password: 'pw' },
        { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
      ),
    remove: (w: never, version?: string) =>
      (w as CardDAVTargetWriter).removeItem('addressbooks/alice/contacts/card-1.vcf', {
        ...(version !== undefined ? { expectedTargetVersion: version } : {}),
      }),
    rewrite: (w: never, version?: string) =>
      (w as CardDAVTargetWriter).upsertContact('/addressbooks/alice/contacts/', { vcard: VCF } as never, {
        overwrite: true,
        ...(version !== undefined ? { expectedTargetVersion: version } : {}),
      }),
    create: (w: never) => (w as CardDAVTargetWriter).upsertContact('/addressbooks/alice/contacts/', { vcard: VCF } as never),
  },
  {
    name: 'WebDAV',
    make: (client: HttpClient, ledger: Ledger = emptyLedger) =>
      new WebDAVTargetWriter(
        { url: `${BASE}/files/alice/`, username: 'alice', password: 'pw' },
        { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
      ),
    remove: (w: never, version?: string) =>
      (w as WebDAVTargetWriter).removeItem('notes.txt', {
        ...(version !== undefined ? { expectedTargetVersion: version } : {}),
      }),
    rewrite: (w: never, version?: string) =>
      (w as WebDAVTargetWriter).upsertFile(
        '',
        {
          item: { path: 'notes.txt', name: 'notes.txt', isDirectory: false, size: 3, modifiedAt: '', sourceRef: '' },
          content: new TextEncoder().encode('new'),
        } as never,
        { overwrite: true, ...(version !== undefined ? { expectedTargetVersion: version } : {}) },
      ),
    create: (w: never) =>
      (w as WebDAVTargetWriter).upsertFile('', {
        item: { path: 'notes.txt', name: 'notes.txt', isDirectory: false, size: 3, modifiedAt: '', sourceRef: '' },
        content: new TextEncoder().encode('new'),
      } as never),
  },
] as const;

/**
 * A file whose bytes nobody holds goes out in a PUT of its own, with a body
 * that streams (`uploadStreamed`). That PUT carries the same precondition and
 * is answered the same way, so the WebDAV writer is asked again with one.
 */
const streamedFile = () =>
  ({
    item: { path: 'notes.txt', name: 'notes.txt', isDirectory: false, size: 3, modifiedAt: '', sourceRef: '' },
    body: {
      sizeBytes: 3,
      open: async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('new'));
            controller.close();
          },
        }),
    },
  }) as never;

/** Each writer's writes, the streamed WebDAV one included. A removal has no body. */
const WRITES = [
  ...WRITERS,
  {
    name: 'WebDAV, streamed',
    make: WRITERS[2].make,
    rewrite: (w: never, version?: string) =>
      (w as WebDAVTargetWriter).upsertFile('', streamedFile(), {
        overwrite: true,
        ...(version !== undefined ? { expectedTargetVersion: version } : {}),
      }),
    create: (w: never) => (w as WebDAVTargetWriter).upsertFile('', streamedFile()),
  },
] as const;

describe('a removal', () => {
  for (const w of WRITERS) {
    it(`${w.name}: the DELETE carries If-Match with the recorded version, quoted, and nothing is asked first`, async () => {
      const s = davServer({ current: 'v1' });
      const result = await w.remove(w.make(s.client) as never, 'v1');

      expect(result).toEqual(w.name === 'WebDAV' ? { kind: 'binned' } : { kind: 'deleted' });
      expect(s.sent.map((c) => c.method)).toEqual(['DELETE']);
      expect(s.of('DELETE')[0]!.headers['If-Match']).toBe('"v1"');
    });

    it(`${w.name}: sends no DELETE at all without a version, or with a weak one`, async () => {
      for (const version of [undefined, 'W/v1']) {
        const s = davServer({ current: 'v1' });
        const result = await w.remove(w.make(s.client) as never, version);

        expect(result).toEqual({ unversioned: true });
        expect(s.sent, `nothing sent for ${String(version)}`).toHaveLength(0);
      }
    });

    it(`${w.name}: a copy changed since is refused by the server, and left alone`, async () => {
      const s = davServer({ current: 'somebody-elses-edit' });
      const result = await w.remove(w.make(s.client) as never, 'v1');

      expect(result).toEqual({ conflicted: true });
      expect(s.accepted('DELETE')).toHaveLength(0);
    });
  }

  it('reads a 412 whose HEAD finds nothing as already removed', async () => {
    // RFC 9110 §13.1.1 evaluates If-Match as false with no current
    // representation, so a copy somebody already removed answers 412 too.
    const s = davServer({ gone: true });
    const result = await removeDavResource({
      url: `${BASE}/files/alice/notes.txt`,
      authorization: 'Basic x',
      request: (o) => s.client.request(o),
      expectedTargetVersion: 'v1',
      kind: 'deleted',
    });
    expect(result).toEqual({ kind: 'deleted' });
    expect(s.sent.map((c) => c.method)).toEqual(['DELETE', 'HEAD']);
  });

  it('throws, removing nothing, when the HEAD after a 412 cannot say why', async () => {
    const result = removeDavResource({
      url: `${BASE}/files/alice/notes.txt`,
      authorization: 'Basic x',
      request: async (o) => ({ status: o.method === 'DELETE' ? 412 : 403, body: '', headers: {} }),
      expectedTargetVersion: 'v1',
    });
    await expect(result).rejects.toThrow(/refused with 412, and the HEAD that should say why failed with status 403/);
  });
});

describe('a rewrite', () => {
  for (const w of WRITES) {
    it(`${w.name}: the PUT carries If-Match with the recorded version, and nothing is asked first`, async () => {
      const s = davServer({ current: 'v1' });
      const result = await w.rewrite(w.make(s.client) as never, 'v1');

      expect(result.updated).toBe(true);
      expect(s.of('HEAD')).toHaveLength(0);
      expect(s.of('PUT')[0]!.headers['If-Match']).toBe('"v1"');
    });

    it(`${w.name}: a copy changed since is a conflict, and nothing is written`, async () => {
      const s = davServer({ current: 'somebody-elses-edit' });
      const result = await w.rewrite(w.make(s.client) as never, 'v1');

      expect(result.conflicted).toBe(true);
      expect(s.accepted('PUT')).toHaveLength(0);
    });

    it(`${w.name}: without a version the PUT goes unconditioned, as the owner kept it (D3)`, async () => {
      const s = davServer({ current: 'anything' });
      const result = await w.rewrite(w.make(s.client) as never, undefined);

      expect(result.updated).toBe(true);
      expect(s.of('HEAD')).toHaveLength(0);
      expect(s.of('PUT')[0]!.headers['If-Match']).toBeUndefined();
    });

    it(`${w.name}: a weak version keeps the read and the comparison, and no If-Match (D4)`, async () => {
      const same = davServer({ current: 'v1' });
      expect((await w.rewrite(w.make(same.client) as never, 'W/v1')).updated).toBe(true);
      expect(same.of('HEAD')).toHaveLength(1);
      expect(same.of('PUT')[0]!.headers['If-Match']).toBeUndefined();

      const changed = davServer({ current: 'somebody-elses-edit' });
      expect((await w.rewrite(w.make(changed.client) as never, 'W/v1')).conflicted).toBe(true);
      expect(changed.of('PUT')).toHaveLength(0);
    });
  }
});

describe('a chunked WebDAV rewrite', () => {
  it('keeps the read and the comparison, since chunks cannot carry If-Match', async () => {
    // Each chunk is a PUT of its own, and a precondition would refuse the
    // second. No production path turns chunks on (0149 §1), but a rewrite
    // through them must not go unchecked.
    const s = davServer({ current: 'somebody-elses-edit' });
    const writer = new WebDAVTargetWriter(
      { url: `${BASE}/files/alice/`, username: 'alice', password: 'pw', chunkedUploads: true, chunkSize: 2 },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: s.client },
    );
    const result = await writer.upsertFile(
      '',
      {
        item: { path: 'notes.txt', name: 'notes.txt', isDirectory: false, size: 5, modifiedAt: '', sourceRef: '' },
        content: new TextEncoder().encode('large'),
      } as never,
      { overwrite: true, expectedTargetVersion: 'v1' },
    );

    expect(result.conflicted).toBe(true);
    expect(s.of('HEAD')).toHaveLength(1);
    expect(s.of('PUT'), 'no chunk went out over the edit').toHaveLength(0);
  });
});

describe('what a write records', () => {
  for (const w of WRITES) {
    it(`${w.name}: a weak ETag keeps its W/, so it is never sent as If-Match`, async () => {
      const records: Array<Record<string, unknown>> = [];
      const ledger = {
        find: async () => undefined,
        recordIfAbsent: async (r: Record<string, unknown>) => {
          records.push(r);
        },
      } as unknown as Ledger;
      const s = davServer({ gone: true, putEtag: 'W/"weak-1"' });
      // A create, with nothing on the target: the PUT answers with a weak ETag.
      const result = await w.create(w.make(s.client, ledger) as never);

      expect(result.targetVersion).toBe('W/weak-1');
      expect(records[0]?.targetVersion).toBe('W/weak-1');
    });
  }

  it('reads a strong ETag as it was, and quotes only a strong one for If-Match', () => {
    expect(readVersion({ status: 200, headers: { ETag: '"abc"' } })).toBe('abc');
    expect(readVersion({ status: 200, headers: { etag: 'W/"abc"' } })).toBe('W/abc');
    expect(readVersion({ status: 200, headers: {} })).toBeUndefined();
    expect(ifMatchFor('abc')).toBe('"abc"');
    expect(ifMatchFor('W/abc')).toBeUndefined();
    expect(ifMatchFor(undefined)).toBeUndefined();
  });
});
