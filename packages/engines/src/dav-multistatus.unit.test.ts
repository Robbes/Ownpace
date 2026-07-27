// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
  isCollection,
  hasResourceType,
  decodeHref,
  hrefRelativeTo,
  unescapeXml,
  extractUid,
} from './dav-multistatus';

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
