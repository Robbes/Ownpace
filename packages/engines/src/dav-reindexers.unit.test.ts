// Copyright 2026 The Ownpace authors (Apache-2.0)
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
  fileContentHash,
  calendarContentHash,
  contactContentHash,
  type Ledger,
} from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient as CalHttp } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';

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
    { domain: 'calendar', ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
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
    // EXACT, not `toContain`. A substring check passed while production sent
    // `…/remote.php/dav/remote.php/dav/calendars/alice/personal/` — the
    // doubled prefix still contains `/calendars/alice/personal/`, and the
    // canned route's regex still matched it, so the double agreed with a URL
    // Nextcloud answers with 404. See the URL-shape test below.
    expect(reports[0]).toBe(`${CAL_BASE}/calendars/alice/personal/`);
  });

  it('does not double the DAV prefix when turning a server href into a URL', async () => {
    // Hrefs in a multistatus are SERVER-absolute (`/remote.php/dav/...`) while
    // `buildUrl` appends to the configured base, so an unconverted href yields
    // `https://host/remote.php/dav/remote.php/dav/...`. Against a real
    // Nextcloud every calendar-query REPORT 404'd with
    // `Sabre\DAV\Exception\NotFound — File not found: remote.php in 'root'`,
    // and verification could not read the calendar target at all.
    const { writer, calls } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, body: CAL_EVENTS },
    ]);

    await collect(writer.listEntries());

    for (const call of calls) {
      expect(call.url.startsWith(`${CAL_BASE}/`), `not rooted at the base: ${call.url}`).toBe(true);
      // The base's own path must appear exactly once.
      expect(call.url.split('/remote.php/dav').length - 1, `doubled prefix: ${call.url}`).toBe(1);
    }
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

  it('does not double the DAV prefix when turning a server href into a URL', async () => {
    // Identical defect to the CalDAV one above; the calendar domain simply
    // failed first, so nothing ever reached the address books.
    const { writer, calls } = cardWriter([
      { match: /^PROPFIND/, body: CARD_HOME_SET },
      { match: /^REPORT/, body: CARD_CONTACTS },
    ]);

    await collect(writer.listEntries());

    const reports = calls.filter((c) => c.method === 'REPORT').map((c) => c.url);
    expect(reports).toEqual([`${CAL_BASE}/addressbooks/users/alice/contacts/`]);
    for (const call of calls) {
      expect(call.url.split('/remote.php/dav').length - 1, `doubled prefix: ${call.url}`).toBe(1);
    }
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

  it('carries the size the server reported, so target bytes can be measured', async () => {
    const { writer } = fileWriter([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, body: DOCS_LISTING },
      { match: /^PROPFIND/, body: ROOT_LISTING },
    ]);

    const entries = await collect(writer.listEntries());
    const bySize = Object.fromEntries(entries.map((e) => [e.naturalKey, e.sizeBytes]));

    expect(bySize['readme.txt']).toBe(12);
    expect(bySize['Documents/Meeting notes.txt']).toBe(34);
  });

  it('leaves sizeBytes undefined when the server omits getcontentlength', async () => {
    // Never a fabricated 0: verification only sums when EVERY item was
    // measured, and a fake zero would make a complete target look short.
    const noLength = ROOT_LISTING.replace(/<d:getcontentlength>\d+<\/d:getcontentlength>/g, '');
    const { writer } = fileWriter([
      { match: /^PROPFIND .*\/files\/alice\/Documents/, body: DOCS_LISTING },
      { match: /^PROPFIND/, body: noLength },
    ]);

    const entries = await collect(writer.listEntries());
    expect(entries.find((e) => e.naturalKey === 'readme.txt')?.sizeBytes).toBeUndefined();
  });

  it('hashes a sampled file from its raw bytes', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const { client } = fakeHttp([]);
    const writer = new WebDAVTargetWriter(
      { url: FILES_BASE, username: 'alice', password: 'pw' },
      {
        ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
        httpClient: {
          async request() {
            return { status: 200, body: '<mangled>', headers: {}, bodyBytes: bytes };
          },
        } as never,
      },
    );
    void client;

    const hash = await writer.contentHashFor({
      naturalKey: 'logo.png',
      targetId: 'logo.png',
      mailboxId: '',
    });

    // Hashing the decoded `body` string instead would differ from this for any
    // non-ASCII byte — every binary file reported as corrupt.
    expect(hash).toBe(fileContentHash(bytes));
  });

  it('returns undefined rather than hashing lossy text when bytes are unavailable', async () => {
    const writer = new WebDAVTargetWriter(
      { url: FILES_BASE, username: 'alice', password: 'pw' },
      {
        ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
        httpClient: {
          async request() {
            return { status: 200, body: 'text only', headers: {} };
          },
        } as never,
      },
    );

    expect(
      await writer.contentHashFor({ naturalKey: 'a.txt', targetId: 'a.txt', mailboxId: '' }),
    ).toBeUndefined();
  });

  it('returns undefined when the file cannot be fetched — unavailable, not corrupt', async () => {
    const writer = new WebDAVTargetWriter(
      { url: FILES_BASE, username: 'alice', password: 'pw' },
      {
        ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
        httpClient: {
          async request() {
            return { status: 404, body: '', headers: {} };
          },
        } as never,
      },
    );

    expect(
      await writer.contentHashFor({ naturalKey: 'gone.txt', targetId: 'gone.txt', mailboxId: '' }),
    ).toBeUndefined();
  });

  it('can be scoped to one directory', async () => {
    const { writer, calls } = fileWriter([{ match: /^PROPFIND/, body: DOCS_LISTING }]);

    const entries = await collect(writer.listEntries('Documents'));

    expect(entries.map((e) => e.naturalKey)).toEqual(['Documents/Meeting notes.txt']);
    expect(calls).toHaveLength(1);
  });
});

describe('DAV writers hash content canonically', () => {
  // This used to assert that CalDAV and CardDAV do NOT implement
  // `contentHashFor` at all (#143). The reasoning was sound — servers
  // re-serialize iCalendar and vCard, so a hash of the returned BYTES could
  // never equal the source's, and every item would read as corrupt — but the
  // consequence was that §20's content leg silently stopped running for two of
  // four domains: 9 of 10 samples came back `checksumUnavailable` on the first
  // real run. The fix is a canonical fingerprint (dav-canonical.ts) rather than
  // no check at all.

  it('CalDAV fetches a sampled event and fingerprints it comparably with the source', async () => {
    const stored = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenMig//Test//EN',
      'BEGIN:VEVENT',
      'UID:event-1@example.com',
      'DTSTART:20260110T100000Z',
      'SUMMARY:Planning',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    // What a server hands back: reordered, refolded, its own PRODID, extra X-.
    const returned = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SabreDAV//SabreDAV//EN',
      'X-WR-CALNAME:personal',
      'BEGIN:VEVENT',
      'SUMMARY:Plann\r\n ing',
      'DTSTART:20260110T100000Z',
      'UID:event-1@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const { writer, calls } = calWriter([
      { match: /^GET/, status: 200, body: returned },
    ]);

    const hash = await writer.contentHashFor({
      naturalKey: 'event-1@example.com',
      targetId: '/remote.php/dav/calendars/alice/personal/event-1.ics',
      mailboxId: '/calendars/alice/personal/',
    });

    // The load-bearing property: equal to what the SYNC recorded for the source.
    expect(hash).toBe(calendarContentHash(stored));
    // And it must not double the DAV prefix on the way there.
    expect(calls[0]!.url).toBe(`${CAL_BASE}/calendars/alice/personal/event-1.ics`);
  });

  it('CardDAV does the same for a sampled contact', async () => {
    const stored = ['BEGIN:VCARD', 'VERSION:4.0', 'UID:c1', 'FN:Ada Lovelace', 'END:VCARD'].join('\r\n');
    const returned = ['BEGIN:VCARD', 'VERSION:4.0', 'PRODID:-//SabreDAV//EN', 'FN:Ada Lovelace', 'REV:20260101T000000Z', 'UID:c1', 'END:VCARD'].join('\r\n');

    const { writer } = cardWriter([{ match: /^GET/, status: 200, body: returned }]);

    const hash = await writer.contentHashFor({
      naturalKey: 'c1',
      targetId: '/remote.php/dav/addressbooks/users/alice/contacts/c1.vcf',
      mailboxId: '/addressbooks/users/alice/contacts/',
    });

    expect(hash).toBe(contactContentHash(stored));
  });

  it('returns undefined rather than a wrong hash when the resource cannot be read', async () => {
    // An unreadable sample is `checksumUnavailable` — absence of evidence, not
    // evidence of corruption.
    const { writer } = calWriter([{ match: /^GET/, status: 404, body: 'gone' }]);

    const hash = await writer.contentHashFor({
      naturalKey: 'event-1@example.com',
      targetId: '/remote.php/dav/calendars/alice/personal/event-1.ics',
      mailboxId: '/calendars/alice/personal/',
    });

    expect(hash).toBeUndefined();
  });

  it('notices a truncated event instead of passing it', async () => {
    const stored = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:e1', 'SUMMARY:Planning', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const truncated = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:e1', 'END:VEVENT'].join('\r\n');

    const { writer } = calWriter([{ match: /^GET/, status: 200, body: truncated }]);

    const hash = await writer.contentHashFor({
      naturalKey: 'e1',
      targetId: '/remote.php/dav/calendars/alice/personal/e1.ics',
      mailboxId: '/calendars/alice/personal/',
    });

    expect(hash).not.toBe(calendarContentHash(stored));
  });

  it('but they do report sizes, so target bytes are still measurable', async () => {
    const withLength = CAL_EVENTS.replace(
      /<d:getetag>"e1"<\/d:getetag>/,
      '<d:getetag>"e1"</d:getetag><d:getcontentlength>512</d:getcontentlength>',
    );
    const { writer } = calWriter([
      { match: /^PROPFIND/, body: CAL_HOME_SET },
      { match: /^REPORT/, body: withLength },
    ]);

    const entries = await collect(writer.listEntries());
    expect(entries[0]!.sizeBytes).toBe(512);
    expect(entries[1]!.sizeBytes).toBeUndefined();
  });
});
