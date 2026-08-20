// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * How many requests a DAV write costs, and that cutting them changed nothing
 * about what gets written.
 *
 * Migrating 203 calendar events — **52 KB in total** — took 76 seconds in a
 * real run: 374 ms an item, essentially none of it data transfer. The cost was
 * round trips. Each item did a `calendar-query` REPORT to ask "is this already
 * here?", then a PUT. One of those two is answerable for the whole collection
 * in a single request, because `listEntries` already enumerates it.
 *
 * These tests COUNT requests rather than trusting the code to look right, so a
 * regression that reintroduces the per-item probe fails here rather than in
 * someone's migration window.
 *
 * The behaviour they hold fixed while it gets faster:
 *   - an item already on the target is still adopted, not rewritten;
 *   - an item not on the target is still created exactly once;
 *   - a target that cannot be enumerated still migrates, via the old path.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

/** A ledger that knows nothing — so every item takes the target-check path. */
const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

interface Call {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A CalDAV collection holding `existing` UIDs, counting every request. */
function calServer(existing: string[]) {
  const calls: Call[] = [];
  const present = new Set(existing);

  const client = {
    async request(o: { method: string; url: string; headers?: Record<string, string>; body?: unknown }) {
      calls.push({ method: o.method, url: o.url, headers: o.headers, body: o.body });

      if (o.method === 'REPORT') {
        const responses = [...present]
          .map(
            (uid) =>
              `<d:response><d:href>/remote.php/dav/calendars/alice/personal/${uid}.ics</d:href>` +
              `<d:propstat><d:prop><cal:calendar-data>BEGIN:VEVENT\nUID:${uid}\nEND:VEVENT` +
              `</cal:calendar-data></d:prop></d:propstat></d:response>`,
          )
          .join('');
        return {
          status: 207,
          body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`,
          headers: {},
        };
      }

      if (o.method === 'PUT') {
        const uid = decodeURIComponent(o.url.split('/').pop() ?? '').replace(/\.ics$/, '');
        // A server honouring If-None-Match: * refuses to replace.
        if (present.has(uid) && o.headers?.['If-None-Match'] === '*') {
          return { status: 412, body: '', headers: {} };
        }
        present.add(uid);
        return { status: 201, body: '', headers: {} };
      }

      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;

  const writer = new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls, present };
}

function event(uid: string) {
  return { icalendar: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR` };
}

/**
 * The create-only precondition, and the one case that must not send it.
 *
 * `If-None-Match: *` is what makes hard rule 2 hold in the server rather than
 * merely in our code: the existence check and the PUT are separate requests, so
 * without it anything appearing at that href in between would be silently
 * replaced. A 412 back means "someone got there first", which is not an error.
 *
 * Update propagation adds the one case where replacing IS the intent — and the
 * first version of it reused the same helper, so the server refused with 412,
 * the writer reported that as success, and the pass counted `updated: 1` for a
 * rewrite that never happened. Green unit suite, green everything, wrong data
 * on the target. CI's real Nextcloud is what caught it.
 */
/**
 * A directory where a file has to go.
 *
 * Found by the E2E, and not the way it was meant to be: the fixture planted a
 * source file at a path where the target already held a directory, expecting
 * the write to fail. Instead the pass reported `created` — the item sailed
 * through. Both existence checks answer "is something at this path" and
 * neither asks "is it a FILE": the snapshot holds only files so a directory
 * reads as ABSENT, and the per-item fallback returns the path on any 207 so a
 * directory reads as an EXISTING FILE.
 *
 * Two different wrong answers, both bad. One PUTs over a directory the customer
 * already had; the other adopts it and records an item whose bytes were never
 * written. The writer cannot resolve this on its own, so it fails the item and
 * lets the owner decide.
 */
describe('WebDAV file/directory collision', () => {
  const dirName = 'reports';

  /** A target holding a DIRECTORY at `reports`, and nothing else. */
  function serverWithDirectory() {
    const calls: Call[] = [];
    const client = {
      async request(o: { method: string; url: string; headers?: Record<string, string>; body?: unknown }) {
        calls.push({ method: o.method, url: o.url, headers: o.headers, body: o.body });
        if (o.method === 'PROPFIND') {
          const self = new URL(o.url).pathname;
          const collection = (href: string) =>
            `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
            `<d:resourcetype><d:collection/></d:resourcetype>` +
            `</d:prop></d:propstat></d:response>`;
          // The root lists itself plus one child collection; the child lists
          // only itself (it is empty). Depth:1 always includes the collection
          // being asked about, which is why the walk skips `self`.
          const isRoot = !self.replace(/\/$/, '').endsWith(dirName);
          // The child href must carry the SAME endpoint prefix as the request,
          // or `hrefRelativeTo` correctly discards it as pointing outside this
          // endpoint — which is what a hand-written '/files/alice/...' did.
          const child = `${self.replace(/\/$/, '')}/${dirName}`;
          const body =
            `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">` +
            collection(self) +
            (isRoot ? collection(child) : '') +
            `</d:multistatus>`;
          return { status: 207, body, headers: {} };
        }
        return { status: 201, body: '', headers: {} };
      },
    } as unknown as HttpClient;

    const writer = new WebDAVTargetWriter(
      { url: `${BASE}/files/alice/`, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );
    return { writer, calls };
  }

  it('fails the item instead of writing over the directory or adopting it', async () => {
    const { writer, calls } = serverWithDirectory();

    await expect(
      writer.upsertFile(
        '',
        { item: { path: dirName, name: dirName, isDirectory: false, size: 1, modifiedAt: '', sourceRef: '' }, content: new Uint8Array([1]) } as never,
      ),
    ).rejects.toThrow(/already holds a DIRECTORY/);

    // The two wrong outcomes, ruled out explicitly.
    expect(
      calls.filter((c) => c.method === 'PUT'),
      'writing would destroy a directory the destination already had',
    ).toHaveLength(0);
  });
});

describe('CalDAV overwrite', () => {
  const collection = '/calendars/alice/personal/';

  it('sends no create-only precondition when rewriting, and replaces the body', async () => {
    const { writer, calls } = calServer(['e1']);

    const result = await writer.upsertCalendarEvent(
      collection,
      { icalendar: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:NEW\r\nEND:VEVENT\r\nEND:VCALENDAR' } as never,
      { overwrite: true },
    );

    expect(result.updated).toBe(true);
    expect(result.created).toBe(false);

    const put = calls.find((c) => c.method === 'PUT');
    expect(put, 'a rewrite must actually write').toBeDefined();
    expect(
      put!.headers?.['If-None-Match'],
      'the create-only precondition makes the server refuse the very write we intend',
    ).toBeUndefined();
    expect(String(put!.body)).toContain('SUMMARY:NEW');
  });

  it('still sends the precondition on an ordinary create', async () => {
    const { writer, calls } = calServer([]);
    await writer.upsertCalendarEvent(collection, event('e9') as never);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put!.headers?.['If-None-Match']).toBe('*');
  });

  it('refuses to report a rewrite the server rejected', async () => {
    // A server that answers 412 even with no precondition has NOT replaced the
    // item. Returning success here would record a copy the target does not
    // hold — the same false-green shape as the original bug, one layer down.
    const client = {
      async request() {
        return { status: 412, body: '', headers: {} };
      },
    } as unknown as HttpClient;
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    await expect(
      writer.upsertCalendarEvent(collection, event('e1') as never, { overwrite: true }),
    ).rejects.toThrow(/refused with 412/);
  });

  it('never claims the version of an object it did not write', async () => {
    // Found by mutation on 2026-08-07: making the 412 branch return the
    // response's ETag survived all 1920 tests. It survived because every 412
    // fixture in this file answers `headers: {}` — no server here has ever
    // offered one, so the one line that refuses it was never exercised.
    //
    // WHY IT MATTERS. A 412 on the create path means something was already at
    // that href, and this writer does not know whose bytes they are. Record
    // that object's ETag as `targetVersion` and the ledger now says *we wrote
    // this, at this version* — so the next pass's `ownershipOf(recorded,
    // current)` answers 'unchanged', the item becomes ours to replace, and a
    // rewrite overwrites the destination's own copy. Hard rule 2, defeated by
    // one optional response header.
    //
    // RFC 9110 does not forbid a 412 carrying representation metadata, and
    // servers vary. The guarantee must not depend on which one a customer runs.
    const recorded: Array<Record<string, unknown>> = [];
    const client = {
      async request(o: { method: string }) {
        if (o.method === 'PUT') {
          // The header that was never present in any fixture.
          return { status: 412, body: '', headers: { etag: '"not-ours-7f3"' } };
        }
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      {
        ledger: {
          find: async () => undefined,
          recordIfAbsent: async (row: Record<string, unknown>) => {
            recorded.push(row);
          },
        } as unknown as Ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
        httpClient: client,
      },
    );

    const result = await writer.upsertCalendarEvent(collection, event('e1') as never);

    expect(result.targetVersion, 'the writer claimed a version it did not produce').toBeUndefined();
    expect(recorded).toHaveLength(1);
    expect(
      recorded[0]!.targetVersion,
      'the ledger now believes we own bytes the destination already had',
    ).toBeUndefined();
  });
});

describe('CalDAV write cost', () => {
  it('asks the collection once, not once per item', async () => {
    const { writer, calls } = calServer([]);
    const collection = '/calendars/alice/personal/';

    for (let i = 1; i <= 20; i++) {
      await writer.upsertCalendarEvent(collection, event(`e${i}`) as never);
    }

    const reports = calls.filter((c) => c.method === 'REPORT');
    const puts = calls.filter((c) => c.method === 'PUT');

    // One listing for the whole collection, and one write per item. Before
    // this, `reports` was 20 — a round trip per item to ask a question the
    // listing already answers.
    expect(reports).toHaveLength(1);
    expect(puts).toHaveLength(20);
  });

  it('still adopts what the target already has, without writing over it', async () => {
    const { writer, calls } = calServer(['e1', 'e2']);
    const collection = '/calendars/alice/personal/';

    const first = await writer.upsertCalendarEvent(collection, event('e1') as never);
    const third = await writer.upsertCalendarEvent(collection, event('e3') as never);

    expect(first.created).toBe(false);
    expect(first.adopted).toBe(true);
    expect(third.created).toBe(true);

    // The adopted item was never written to.
    const writtenUids = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => decodeURIComponent(c.url.split('/').pop() ?? ''));
    expect(writtenUids).toEqual(['e3.ics']);
  });

  it('sends a create-only precondition, so a stale snapshot cannot overwrite', async () => {
    // The check and the write are separate requests. `If-None-Match: *` is what
    // makes the pair safe rather than merely usually-safe: the server refuses
    // to replace, instead of us finding out afterwards.
    const { writer, calls } = calServer([]);
    await writer.upsertCalendarEvent('/calendars/alice/personal/', event('e1') as never);

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers?.['If-None-Match']).toBe('*');
  });

  it('treats the precondition failing as "already there", not as an error', async () => {
    // Something landed at that href after our snapshot was taken. The resource
    // exists and is keyed the way we would have keyed it, so this is an
    // adoption, not a failure — and certainly not something to retry over.
    const { writer, present } = calServer([]);
    const collection = '/calendars/alice/personal/';
    // Populate the server AFTER the snapshot is built.
    await writer.upsertCalendarEvent(collection, event('warm') as never);
    present.add('racer');

    const result = await writer.upsertCalendarEvent(collection, event('racer') as never);
    expect(result.targetId).toContain('racer.ics');
  });

  it('falls back to the per-item check when the collection cannot be listed', async () => {
    // A target we cannot enumerate must still migrate — just not as fast.
    const calls: Call[] = [];
    const client = {
      async request(o: { method: string; url: string; headers?: Record<string, string> }) {
        calls.push({ method: o.method, url: o.url, headers: o.headers });
        if (o.method === 'REPORT') return { status: 403, body: 'no listing for you', headers: {} };
        if (o.method === 'PUT') return { status: 201, body: '', headers: {} };
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;

    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    const result = await writer.upsertCalendarEvent('/calendars/alice/personal/', event('e1') as never);

    expect(result.created).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });
});

describe('CardDAV write cost', () => {
  function cardServer() {
    const calls: Call[] = [];
    const client = {
      async request(o: { method: string; url: string; headers?: Record<string, string> }) {
        calls.push({ method: o.method, url: o.url, headers: o.headers });
        if (o.method === 'REPORT')
          return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
        if (o.method === 'PUT') return { status: 201, body: '', headers: {} };
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client as never },
    );
    return { writer, calls };
  }

  it('never claims the version of a contact it did not write', async () => {
    // The CalDAV twin of this, and a separate line in a separate file — the
    // three writers each carry their own copy of "its version is not ours to
    // claim", so a test on one does not protect the others. See the CalDAV
    // case for why an ETag lifted off a 412 defeats hard rule 2.
    const recorded: Array<Record<string, unknown>> = [];
    const client = {
      async request(o: { method: string }) {
        if (o.method === 'PUT') return { status: 412, body: '', headers: { etag: '"theirs-1"' } };
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      {
        ledger: {
          find: async () => undefined,
          recordIfAbsent: async (row: Record<string, unknown>) => {
            recorded.push(row);
          },
        } as unknown as Ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
        httpClient: client as never,
      },
    );

    const result = await writer.upsertContact('/addressbooks/users/alice/contacts/', {
      vcard: 'BEGIN:VCARD\r\nUID:c1\r\nFN:n\r\nEND:VCARD',
    } as never);

    expect(result.targetVersion).toBeUndefined();
    expect(recorded).toHaveLength(1);
    expect(
      recorded[0]!.targetVersion,
      'the ledger now believes we own a contact the destination already had',
    ).toBeUndefined();
  });

  it('asks the address book once, not once per contact', async () => {
    const { writer, calls } = cardServer();
    const book = '/addressbooks/users/alice/contacts/';

    for (let i = 1; i <= 15; i++) {
      await writer.upsertContact(book, { vcard: `BEGIN:VCARD\r\nUID:c${i}\r\nFN:n\r\nEND:VCARD` } as never);
    }

    expect(calls.filter((c) => c.method === 'REPORT')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(15);
    expect(calls.find((c) => c.method === 'PUT')?.headers?.['If-None-Match']).toBe('*');
  });
});
