// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// `listEntries` for the three DAV target writers — what makes calendar,
// contacts and files verifiable at all.
//
// Until these existed, only the two mail targets implemented `TargetReindexer`.
// `runVerification` therefore had no way to read a DAV target and reported the
// whole domain NOT_VERIFIABLE, blocking any cutover that had actually copied
// events, contacts or files.
//
// The contract each test defends: the `naturalKey` these yield must be the SAME
// string the corresponding writer hashes when it records an item. If they drift,
// the gate compares two disjoint sets and reports a complete migration as total
// data loss — the exact failure #139 fixed for mail.

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  calendarNaturalKeyHash,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
  type Ledger,
} from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient as CalHttp } from './caldav-target-writer';
import { CardDAVTargetWriter } from './carddav-target-writer';
import { WebDAVTargetWriter } from './webdav-target-writer';

const TENANT = asTenantId('5f9b0000-e29b-41d4-a716-4466554437a1' as never);
const MAPPING = asMappingId('5f9b0000-e29b-41d4-a716-4466554437a2' as never);

/** The ledger is never touched by listEntries; this fails loudly if it is. */
const ledger = new Proxy({} as Ledger, {
  get(_t, prop) {
    throw new Error(`listEntries must not touch the ledger (called ${String(prop)})`);
  },
});

interface Recorded {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

/** An HTTP client answering from a canned routing table, recording every call. */
function fakeHttp(routes: Array<{ match: RegExp; status?: number; body: string }>) {
  const calls: Recorded[] = [];
  const client = {
    async request(options: { method: string; url: string; headers?: Record<string, string>; body?: unknown }) {
      calls.push({
        method: options.method,
        url: options.url,
        headers: options.headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      });
      const route = routes.find((r) => r.match.test(`${options.method} ${options.url}`));
      if (!route) {
        return { status: 404, body: `no canned route for ${options.method} ${options.url}`, headers: {} };
      }
      return { status: route.status ?? 207, body: route.body, headers: {} };
    },
  } as unknown as CalHttp;
  return { client, calls };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

// ---------------------------------------------------------------------------
// CalDAV
// ---------------------------------------------------------------------------

const CAL_BASE = 'https://cloud.example.com/remote.php/dav';

const CAL_HOME_SET = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/personal/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/inbox/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype></d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const CAL_EVENTS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/personal/event-1.ics</d:href>
    <d:propstat><d:prop>
      <d:getetag>"e1"</d:getetag>
      <cal:calendar-data>BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
UID:event-1@example.com&#13;
END:VEVENT&#13;
END:VCALENDAR</cal:calendar-data>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/personal/Team%20sync.ics</d:href>
    <d:propstat><d:prop>
      <d:getetag>"e2"</d:getetag>
      <cal:calendar-data>BEGIN:VEVENT
UID:team-sync&amp;weekly@example.com
END:VEVENT</cal:calendar-data>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

function calWriter(routes: Parameters<typeof fakeHttp>[0]) {
  const { client, calls } = fakeHttp(routes);
  const writer = new CalDAVTargetWriter(
    { url: CAL_BASE, username: 'alice', password: 'pw' },
    { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls };
}

describe('CalDAVTargetWriter.listEntries', () => {
  it('yields the VEVENT UID as the natural key — the same string upsert hashes', async () => {
    const { writer } = calWriter([
      { match: /^PROPFIND .*\/calendars\/alice/, body: CAL_HOME_SET },
      { match: /^REPORT .*\/calendars\/alice\/personal/, body: CAL_EVENTS },
    ]);

    const entries = await collect(writer.listEntries());

    expect(entries.map((e) => e.naturalKey)).toEqual([
      'event-1@example.com',
      'team-sync&weekly@example.com',
    ]);
    // The load-bearing property: hashing what we yield reproduces what the
    // ledger stores. If these ever diverge the gate matches nothing.
    expect(calendarNaturalKeyHash(entries[0]!.naturalKey)).toBe(
      calendarNaturalKeyHash('event-1@example.com'),
    );
  });

  it('decodes hrefs into target ids', async () => {
    const { writer } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, body: CAL_EVENTS },
    ]);

    const entries = await collect(writer.listEntries());
    expect(entries[1]!.targetId).toBe('/remote.php/dav/calendars/alice/personal/Team sync.ics');
  });

  it('walks only real calendar collections, not the home set or the scheduling inbox', async () => {
    const { writer, calls } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, body: CAL_EVENTS },
    ]);

    await collect(writer.listEntries());

    const reports = calls.filter((c) => c.method === 'REPORT').map((c) => c.url);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('/calendars/alice/personal/');
  });

  it('can be scoped to a single calendar without discovering the home set', async () => {
    const { writer, calls } = calWriter([{ match: /^REPORT/, body: CAL_EVENTS }]);

    const entries = await collect(writer.listEntries('/calendars/alice/personal/'));

    expect(entries).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'PROPFIND')).toHaveLength(0);
  });

  it('throws when the home set cannot be read, instead of reporting an empty target', async () => {
    // The dangerous failure: an unreadable target that returns [] is
    // indistinguishable from an empty one, and verification calls that total
    // data loss.
    const { writer } = calWriter([{ match: /^PROPFIND/, status: 403, body: 'forbidden' }]);

    await expect(collect(writer.listEntries())).rejects.toThrow(/failed with status 403/);
  });

  it('throws when the query fails', async () => {
    const { writer } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, status: 500, body: 'boom' },
    ]);

    await expect(collect(writer.listEntries())).rejects.toThrow(/REPORT on .* failed with status 500/);
  });

  it('throws on an event with no UID rather than inventing a key for it', async () => {
    // Yielding the href as a stand-in would mis-key a present event so it looks
    // missing — the ADR-0020 failure mode fixed in the mail reindexers.
    const noUid = CAL_EVENTS.replace(/UID:event-1@example.com&#13;\n/, '');
    const { writer } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, body: noUid },
    ]);

    await expect(collect(writer.listEntries())).rejects.toThrow(/returned no UID/);
  });

  it('asks for the UID only, not whole event bodies', async () => {
    const { writer, calls } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, body: CAL_EVENTS },
    ]);

    await collect(writer.listEntries());

    const report = calls.find((c) => c.method === 'REPORT');
    expect(report?.body).toContain('<C:prop name="UID"/>');
    expect(report?.headers?.Depth).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// CardDAV
// ---------------------------------------------------------------------------

const CARD_HOME_SET = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/remote.php/dav/addressbooks/users/alice/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/addressbooks/users/alice/contacts/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const CARD_CONTACTS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/remote.php/dav/addressbooks/users/alice/contacts/a.vcf</d:href>
    <d:propstat><d:prop>
      <card:address-data>BEGIN:VCARD
UID:contact-a
END:VCARD</card:address-data>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/addressbooks/users/alice/contacts/b.vcf</d:href>
    <d:propstat><d:prop>
      <card:address-data><![CDATA[BEGIN:VCARD
UID:contact-b
END:VCARD]]></card:address-data>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

function cardWriter(routes: Parameters<typeof fakeHttp>[0]) {
  const { client, calls } = fakeHttp(routes);
  const writer = new CardDAVTargetWriter(
    { url: CAL_BASE, username: 'alice', password: 'pw' },
    { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client as never },
  );
  return { writer, calls };
}

describe('CardDAVTargetWriter.listEntries', () => {
  it('yields the vCard UID as the natural key, CDATA included', async () => {
    const { writer } = cardWriter([
      { match: /^PROPFIND/, body: CARD_HOME_SET },
      { match: /^REPORT/, body: CARD_CONTACTS },
    ]);

    const entries = await collect(writer.listEntries());

    expect(entries.map((e) => e.naturalKey)).toEqual(['contact-a', 'contact-b']);
    expect(contactNaturalKeyHash(entries[0]!.naturalKey)).toBe(contactNaturalKeyHash('contact-a'));
  });

  it('throws when the address book home set cannot be read', async () => {
    const { writer } = cardWriter([{ match: /^PROPFIND/, status: 401, body: 'nope' }]);
    await expect(collect(writer.listEntries())).rejects.toThrow(/failed with status 401/);
  });

  it('throws on a vCard with no UID', async () => {
    const noUid = CARD_CONTACTS.replace('UID:contact-a\n', '');
    const { writer } = cardWriter([
      { match: /^PROPFIND/, body: CARD_HOME_SET },
      { match: /^REPORT/, body: noUid },
    ]);
    await expect(collect(writer.listEntries())).rejects.toThrow(/returned no UID/);
  });
});

// ---------------------------------------------------------------------------
// WebDAV files
// ---------------------------------------------------------------------------

const FILES_BASE = 'https://cloud.example.com/remote.php/dav/files/alice';

const ROOT_LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/readme.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const DOCS_LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Documents/Meeting%20notes.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>34</d:getcontentlength></d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

function fileWriter(routes: Parameters<typeof fakeHttp>[0]) {
  const { client, calls } = fakeHttp(routes);
  const writer = new WebDAVTargetWriter(
    { url: FILES_BASE, username: 'alice', password: 'pw' },
    { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client as never },
  );
  return { writer, calls };
}

describe('WebDAVTargetWriter.listEntries', () => {
  it('yields root-relative, percent-decoded paths — the shape the ledger stores', async () => {
    const { writer } = fileWriter([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, body: DOCS_LISTING },
      { match: /^PROPFIND/, body: ROOT_LISTING },
    ]);

    const entries = await collect(writer.listEntries());

    expect(entries.map((e) => e.naturalKey).sort()).toEqual([
      'Documents/Meeting notes.txt',
      'readme.txt',
    ]);
    // `upsertFile` hashes `raw.item.path`, which WebdavFileSource produces in
    // exactly this form. A still-encoded "Meeting%20notes.txt" would hash
    // differently and read as missing on the target.
    expect(fileNaturalKeyHash(entries.map((e) => e.naturalKey).sort()[0]!)).toBe(
      fileNaturalKeyHash('Documents/Meeting notes.txt'),
    );
  });

  it('recurses with Depth:1 rather than relying on Depth: infinity', async () => {
    // Infinite depth is optional (RFC 4918 §9.1) and off by default on
    // Nextcloud, where it answers 403 — which would look like an empty target.
    const { writer, calls } = fileWriter([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, body: DOCS_LISTING },
      { match: /^PROPFIND/, body: ROOT_LISTING },
    ]);

    await collect(writer.listEntries());

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers?.Depth).toBe('1');
    }
  });

  it('does not yield directories', async () => {
    const { writer } = fileWriter([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, body: DOCS_LISTING },
      { match: /^PROPFIND/, body: ROOT_LISTING },
    ]);

    const entries = await collect(writer.listEntries());
    expect(entries.map((e) => e.naturalKey)).not.toContain('Documents');
  });

  it('throws when a directory cannot be listed, instead of skipping it', async () => {
    // Skipping a folder yields a ledger that looks complete while missing
    // everything under it — one of the five swallowed-error sites fixed in the
    // mail reindexers (#136).
    const { writer } = fileWriter([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, status: 502, body: 'bad gateway' },
      { match: /^PROPFIND/, body: ROOT_LISTING },
    ]);

    await expect(collect(writer.listEntries())).rejects.toThrow(/failed with status 502/);
  });

  it('ignores config.rootPath, which would shift every key out of alignment', async () => {
    // `upsertFile` keys items by the bare `raw.item.path`. Listing from
    // `rootPath` would yield "<rootPath>/<path>" and the gate would match
    // nothing — a complete migration reported as total data loss.
    const { client } = fakeHttp([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, body: DOCS_LISTING },
      { match: /^PROPFIND/, body: ROOT_LISTING },
    ]);
    const writer = new WebDAVTargetWriter(
      { url: FILES_BASE, username: 'alice', password: 'pw', rootPath: 'Documents' },
      { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client as never },
    );

    const entries = await collect(writer.listEntries());

    expect(entries.map((e) => e.naturalKey).sort()).toEqual([
      'Documents/Meeting notes.txt',
      'readme.txt',
    ]);
  });

  it('can be scoped to one directory', async () => {
    const { writer, calls } = fileWriter([{ match: /^PROPFIND/, body: DOCS_LISTING }]);

    const entries = await collect(writer.listEntries('Documents'));

    expect(entries.map((e) => e.naturalKey)).toEqual(['Documents/Meeting notes.txt']);
    expect(calls).toHaveLength(1);
  });
});
