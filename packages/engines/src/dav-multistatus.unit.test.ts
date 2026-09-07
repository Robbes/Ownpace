// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// The 207 reader the DAV reindexers are built on.
//
// Every trap here is one that fails SILENTLY in a reindexer: a namespace prefix
// the regex doesn't match, an href left percent-encoded, a folded UID line, an
// XML-escaped ampersand. None of them throw — they just make a present item
// look absent, which the verification gate reports as data loss.

import { describe, it, expect } from 'vitest';
import {
  parseMultiStatus,
  firstElementText,
  findHrefByUid,
  isCollection,
  hasResourceType,
  decodeHref,
  hrefRelativeTo,
  unescapeXml,
  extractUid,
} from './dav-multistatus.ts';

describe('parseMultiStatus', () => {
  it('reads responses whatever prefix the server binds DAV: to', () => {
    // Nextcloud/SabreDAV emit lowercase `d:`. The per-writer regexes this
    // replaces only matched the literal `D:href`, so against those servers they
    // found nothing and reported it as "not present".
    const lower = parseMultiStatus(`
      <?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/a.ics</d:href></d:response>
      </d:multistatus>`);
    const upper = parseMultiStatus(`
      <D:multistatus xmlns:D="DAV:">
        <D:response><D:href>/a.ics</D:href></D:response>
      </D:multistatus>`);
    const none = parseMultiStatus(`
      <multistatus xmlns="DAV:"><response><href>/a.ics</href></response></multistatus>`);

    for (const parsed of [lower, upper, none]) {
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.href).toBe('/a.ics');
    }
  });

  it('returns each response separately, with its own block', () => {
    const parsed = parseMultiStatus(`
      <d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/one.ics</d:href><d:getetag>"1"</d:getetag></d:response>
        <d:response><d:href>/two.ics</d:href><d:getetag>"2"</d:getetag></d:response>
      </d:multistatus>`);

    expect(parsed.map((r) => r.href)).toEqual(['/one.ics', '/two.ics']);
    expect(firstElementText(parsed[1]!.xml, 'getetag')).toBe('"2"');
  });

  it('skips a response with no href — there is nothing to key it by', () => {
    const parsed = parseMultiStatus(`
      <d:multistatus xmlns:d="DAV:"><d:response><d:status>HTTP/1.1 404</d:status></d:response></d:multistatus>`);
    expect(parsed).toEqual([]);
  });
});

describe('resourcetype', () => {
  const collectionXml = `<d:href>/dir/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>`;
  const fileXml = `<d:href>/f.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>`;

  it('distinguishes a collection from a file', () => {
    expect(isCollection(collectionXml)).toBe(true);
    expect(isCollection(fileXml)).toBe(false);
  });

  it('recognises calendar and addressbook collections', () => {
    const cal = `<d:resourcetype><d:collection/><cal:calendar xmlns:cal="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>`;
    const ab = `<d:resourcetype><d:collection/><card:addressbook xmlns:card="urn:ietf:params:xml:ns:carddav"/></d:resourcetype>`;

    expect(hasResourceType(cal, 'calendar')).toBe(true);
    expect(hasResourceType(cal, 'addressbook')).toBe(false);
    expect(hasResourceType(ab, 'addressbook')).toBe(true);
  });
});

describe('href handling', () => {
  it('decodes percent-encoding so keys match the ledger', () => {
    // The ledger stores the source connector's DECODED path. Comparing an
    // encoded href against it makes every file with a space look missing.
    expect(decodeHref('/files/Meeting%20notes.txt')).toBe('/files/Meeting notes.txt');
    expect(decodeHref('/files/r%C3%A9sum%C3%A9.pdf')).toBe('/files/résumé.pdf');
  });

  it('throws on a malformed escape rather than returning a wrong key', () => {
    expect(() => decodeHref('/files/%E0%A4%A.txt')).toThrow(/Cannot decode DAV href/);
  });

  it('makes an href relative to the endpoint', () => {
    const base = 'https://cloud.example.com/remote.php/dav/files/alice';
    expect(hrefRelativeTo('/remote.php/dav/files/alice/Documents/a.txt', base)).toBe('Documents/a.txt');
    expect(hrefRelativeTo('/remote.php/dav/files/alice/', base)).toBe('');
    expect(hrefRelativeTo('https://cloud.example.com/remote.php/dav/files/alice/b.txt', base)).toBe('b.txt');
  });

  it('reports an href outside the endpoint rather than mangling it', () => {
    const base = 'https://cloud.example.com/remote.php/dav/files/alice';
    expect(hrefRelativeTo('/remote.php/dav/files/bob/secret.txt', base)).toBeUndefined();
  });
});

describe('unescapeXml', () => {
  it('undoes entity escaping', () => {
    expect(unescapeXml('UID:a&amp;b')).toBe('UID:a&b');
    expect(unescapeXml('&lt;tag&gt;')).toBe('<tag>');
    expect(unescapeXml('&#65;')).toBe('A');
  });

  it('unwraps CDATA', () => {
    expect(unescapeXml('<![CDATA[BEGIN:VCARD\nUID:x\nEND:VCARD]]>')).toContain('UID:x');
  });

  it('does not double-decode', () => {
    // "&amp;lt;" is the literal text "&lt;", not "<".
    expect(unescapeXml('&amp;lt;')).toBe('&lt;');
  });
});

describe('extractUid', () => {
  it('reads a plain UID', () => {
    expect(extractUid('BEGIN:VEVENT\r\nUID:event-1@example.com\r\nEND:VEVENT')).toBe('event-1@example.com');
  });

  it('unfolds a wrapped UID line (RFC 5545 §3.1)', () => {
    // A server re-serializing a stored event wraps at 75 octets. Reading only
    // the first physical line would key this event by a truncated UID and make
    // it look missing on the target.
    const folded = 'BEGIN:VEVENT\r\nUID:0123456789-abcdefghij-0123456789-abcdefghij-0123456789-abc\r\n defghij-final\r\nEND:VEVENT';
    expect(extractUid(folded)).toBe('0123456789-abcdefghij-0123456789-abcdefghij-0123456789-abcdefghij-final');
  });

  it('handles a UID with parameters', () => {
    expect(extractUid('UID;X-SOMETHING=1:the-uid')).toBe('the-uid');
  });

  it('returns undefined when there is no UID at all', () => {
    // The callers must treat this as an error, never as a usable key.
    expect(extractUid('BEGIN:VEVENT\r\nSUMMARY:no uid here\r\nEND:VEVENT')).toBeUndefined();
    expect(extractUid('UID:\r\n')).toBeUndefined();
  });

  it('does not mistake a property that merely ends in UID', () => {
    expect(extractUid('X-MYUID:nope\r\nUID:real\r\n')).toBe('real');
  });
});

describe('findHrefByUid', () => {
  /** One 207 holding these UIDs, at hrefs named after them, as SabreDAV writes it. */
  const bookHolding = (uids: string[], element = 'card'): string =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">` +
    uids
      .map(
        (uid) =>
          `<d:response><d:href>/remote.php/dav/addressbooks/users/rob/contacts/${uid}.vcf</d:href>` +
          `<d:propstat><d:prop><${element}:address-data>BEGIN:VCARD\nVERSION:3.0\nUID:${uid}\nFN:X\nEND:VCARD` +
          `</${element}:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      )
      .join('') +
    `</d:multistatus>`;

  it('finds the card whose own UID matches', () => {
    expect(findHrefByUid(bookHolding(['abc-123']), 'abc-123', 'address-data')).toBe(
      '/remote.php/dav/addressbooks/users/rob/contacts/abc-123.vcf',
    );
  });

  it('reads a body whatever prefix the server bound DAV: to', () => {
    // THE FIRST DEFECT IN WHAT THIS REPLACES. Both writers matched the literal
    // `<D:href>`; Nextcloud and SabreDAV — the target this product is most
    // often pointed at — emit `<d:href>`. Against those, every existence check
    // answered "not there" and every item took the create path.
    expect(findHrefByUid(bookHolding(['abc-123']), 'abc-123', 'address-data')).toBeDefined();
  });

  it('does not adopt a card whose UID merely CONTAINS the one asked for', () => {
    // THE SECOND DEFECT, and the one with teeth: `href.includes(searchUid)`.
    // Ask for `1234` against a book holding `12345` and the old check returned
    // `/…/12345.vcf` — so the writer adopted a different person's card and the
    // next update PUT over it.
    expect(findHrefByUid(bookHolding(['12345']), '1234', 'address-data')).toBeUndefined();
    // ...and still finds it when it IS the one asked for.
    expect(findHrefByUid(bookHolding(['12345', '1234']), '1234', 'address-data')).toBe(
      '/remote.php/dav/addressbooks/users/rob/contacts/1234.vcf',
    );
  });

  it('answers from the card, not from the path', () => {
    // A server is free to name the resource anything; Google does not use the
    // UID at all. The old check could only ever work where the href happened
    // to embed the UID.
    const body =
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">` +
      `<d:response><d:href>/carddav/v1/principals/rob/lists/default/c9f4a1</d:href>` +
      `<d:propstat><d:prop><card:address-data>BEGIN:VCARD\nUID:the-real-uid\nEND:VCARD` +
      `</card:address-data></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(findHrefByUid(body, 'the-real-uid', 'address-data')).toBe(
      '/carddav/v1/principals/rob/lists/default/c9f4a1',
    );
  });

  it('matches case-sensitively, narrowing what the server matched loosely', () => {
    // CardDAV's default collation is `i;unicode-casemap` and CalDAV's
    // text-match has no equality option at all, so the server's answer is a
    // superset. This comparison is what makes it one card.
    expect(findHrefByUid(bookHolding(['ABC-123']), 'abc-123', 'address-data')).toBeUndefined();
  });

  it('undoes XML escaping and line folding before comparing', () => {
    const body =
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">` +
      `<d:response><d:href>/dav/c/1.vcf</d:href><d:propstat><d:prop><card:address-data>` +
      `BEGIN:VCARD\r\nUID:a&amp;b-0123456789-0123456789-0123456789-0123456789-0123456\r\n 789-end\r\nEND:VCARD` +
      `</card:address-data></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(
      findHrefByUid(body, 'a&b-0123456789-0123456789-0123456789-0123456789-0123456789-end', 'address-data'),
    ).toBe('/dav/c/1.vcf');
  });

  it('decodes the href, so it keys the way the collection listing keys', () => {
    // `listContactsIn` stores `decodeHref(href)`; a fallback returning the raw
    // href would make the same card look like two different ledger rows.
    const body =
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">` +
      `<d:response><d:href>/dav/c/Jan%20de%20Vries.vcf</d:href><d:propstat><d:prop>` +
      `<card:address-data>UID:jan</card:address-data></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(findHrefByUid(body, 'jan', 'address-data')).toBe('/dav/c/Jan de Vries.vcf');
  });

  it('is not a match when the server sent no data for the resource', () => {
    // Deliberate, and in the safe direction: an unconfirmed "yes" overwrites
    // somebody's card, an unconfirmed "no" writes a second copy a person can
    // see and delete. The collection's own <response> lands here too.
    const body =
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">` +
      `<d:response><d:href>/dav/c/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/>` +
      `</d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(findHrefByUid(body, 'anything', 'address-data')).toBeUndefined();
  });

  it('reads calendar-data for the CalDAV writer', () => {
    const body =
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">` +
      `<d:response><d:href>/dav/cal/e1.ics</d:href><d:propstat><d:prop><cal:calendar-data>` +
      `BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:task-9\nEND:VTODO\nEND:VCALENDAR` +
      `</cal:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(findHrefByUid(body, 'task-9', 'calendar-data')).toBe('/dav/cal/e1.ics');
    // ...and does not read one element's data as the other's.
    expect(findHrefByUid(body, 'task-9', 'address-data')).toBeUndefined();
  });

  it('returns nothing for an empty multistatus', () => {
    expect(
      findHrefByUid('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>', 'x', 'address-data'),
    ).toBeUndefined();
  });
});
