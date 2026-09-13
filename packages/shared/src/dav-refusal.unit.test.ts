// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import { davRefusalBody } from './dav-refusal.ts';

const GOOGLE_403 =
  '<?xml version="1.0" encoding="UTF-8"?>\n<errors xmlns="http://schemas.google.com/g/2005">' +
  '<error><domain>GData</domain><code>accessNotConfigured</code><internalReason>CalDAV API ' +
  'has not been used in project 123 before or it is disabled. Enable it by visiting ' +
  'https://console.developers.google.com/apis/api/caldav.googleapis.com/overview?project=123 ' +
  'then retry.</internalReason></error></errors>';

/** Nextcloud's answer when its SQLite is mid-write, as the owner's pass met it. */
const SABRE_LOCKED =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">\n' +
  '  <s:exception>Doctrine\\DBAL\\Exception\\DriverException</s:exception>\n' +
  '  <s:message>An exception occurred while executing a query: SQLSTATE[HY000]: ' +
  'General error: 5 database is locked</s:message>\n' +
  '</d:error>';

describe("Google's GData refusal, read without its envelope (2026-09-02)", () => {
  it("keeps Google's code and reason, in Google's words, and drops the markup", () => {
    const out = davRefusalBody(GOOGLE_403);
    expect(out).toBe(
      'accessNotConfigured — CalDAV API has not been used in project 123 before or it is ' +
        'disabled. Enable it by visiting ' +
        'https://console.developers.google.com/apis/api/caldav.googleapis.com/overview?project=123 ' +
        'then retry.',
    );
    expect(out).not.toContain('<');
  });

  it('a GData document with nothing readable in it stays as it came — better a wall than nothing', () => {
    const empty = '<errors xmlns="http://schemas.google.com/g/2005"></errors>';
    expect(davRefusalBody(empty)).toBe(empty);
  });
});

describe("Sabre's refusal, read without its envelope (2026-09-13)", () => {
  /**
   * THIS FILE USED TO ASSERT THE OPPOSITE.
   *
   * The test replaced here was called "passes any other body through
   * untouched — a Nextcloud refusal is not ours to reshape", and it pinned
   * the SABRE_ONLY_EXCEPTION document below as returned verbatim. Its premise
   * was that only Google wraps its reason in enough markup to hide it.
   *
   * The owner's live Google → Nextcloud migration disproved the premise: two
   * contact PUTs failed, and the record of why began with thirty-eight
   * characters of XML declaration and fifty-seven of namespace declarations,
   * so every bounded view of the ledger row showed him the prolog and no part
   * of the reason. The assertion is reversed deliberately, on that evidence —
   * not relaxed to make anything pass.
   */
  it('the envelope alone is longer than most views of a ledger row', () => {
    // The measurement behind the reversal: what a reader spends their width on
    // before Sabre says its first word.
    const prologue = SABRE_LOCKED.slice(0, SABRE_LOCKED.indexOf('Doctrine'));
    expect(prologue.length).toBeGreaterThan(100);
    expect(prologue).not.toMatch(/database|locked|exception occurred/);
  });

  it("keeps Sabre's exception and message, in Sabre's order, and drops the markup", () => {
    const out = davRefusalBody(SABRE_LOCKED);
    expect(out).toBe(
      'Doctrine\\DBAL\\Exception\\DriverException — An exception occurred while executing a ' +
        'query: SQLSTATE[HY000]: General error: 5 database is locked',
    );
    expect(out).not.toContain('<');
  });

  it('a document carrying only an exception is reduced to it, with no dangling dash', () => {
    const SABRE_ONLY_EXCEPTION =
      '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:exception>Sabre\\DAV\\Exception\\NotAuthenticated</s:exception></d:error>';
    expect(davRefusalBody(SABRE_ONLY_EXCEPTION)).toBe('Sabre\\DAV\\Exception\\NotAuthenticated');
  });

  it('drops the stack trace a debug Nextcloud attaches — that is the wall, not the sentence', () => {
    const debug =
      '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:exception>Sabre\\DAV\\Exception\\BadRequest</s:exception>' +
      '<s:message>VCard object with uid already exists in this addressbook collection.</s:message>' +
      '<s:file>/var/www/html/3rdparty/sabre/dav/lib/CardDAV/Plugin.php</s:file>' +
      '<s:line>320</s:line>' +
      '<s:trace>#0 /var/www/html/3rdparty/sabre/event/lib/WildcardEmitterTrait.php(89)</s:trace>' +
      '</d:error>';
    expect(davRefusalBody(debug)).toBe(
      'Sabre\\DAV\\Exception\\BadRequest — VCard object with uid already exists in this ' +
        'addressbook collection.',
    );
  });

  it('reads the prefix the document bound the namespace to, rather than assuming `s`', () => {
    const odd =
      '<d:error xmlns:d="DAV:" xmlns:sab="http://sabredav.org/ns">' +
      '<sab:message>Bad Request</sab:message></d:error>';
    expect(davRefusalBody(odd)).toBe('Bad Request');
  });

  it('a Sabre document with neither field stays as it came — better a wall than nothing', () => {
    const empty =
      '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:sabre-version>4.7.0</s:sabre-version></d:error>';
    expect(davRefusalBody(empty)).toBe(empty);
  });
});

describe('everything that is neither', () => {
  it('passes through untouched — a plain-text refusal is not ours to reshape', () => {
    expect(davRefusalBody('Forbidden')).toBe('Forbidden');
    expect(davRefusalBody('')).toBe('');
    expect(davRefusalBody('{"error":{"code":400}}')).toBe('{"error":{"code":400}}');
  });
});

describe('an entity is how XML carries a character, not a character the server chose', () => {
  it('decodes the five predefined entities in the words it hands back', () => {
    const escaped =
      '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:message>Could not parse &quot;X-ABLabel&quot; &lt;item1&gt; &amp; gave up</s:message></d:error>';
    expect(davRefusalBody(escaped)).toBe('Could not parse "X-ABLabel" <item1> & gave up');
  });

  it('decodes the ampersand last, so an escaped entity in the text survives', () => {
    const escaped =
      '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:message>write &amp;lt; verbatim</s:message></d:error>';
    expect(davRefusalBody(escaped)).toBe('write &lt; verbatim');
  });

  it('decodes on the Google path too — a console URL with two parameters carries one', () => {
    const gdata =
      '<errors xmlns="http://schemas.google.com/g/2005"><error><code>accessNotConfigured</code>' +
      '<internalReason>Enable it at https://console.developers.google.com/x?project=1&amp;hl=nl ' +
      'then retry.</internalReason></error></errors>';
    expect(davRefusalBody(gdata)).toBe(
      'accessNotConfigured — Enable it at https://console.developers.google.com/x?project=1&hl=nl then retry.',
    );
  });
});
