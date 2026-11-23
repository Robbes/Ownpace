// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A BODY THAT NEVER CLOSES ITS ELEMENT (workplan 0163, 2026-11-23).
 *
 * The DAV readers took an element out of a server's body with a pattern of
 * the shape `<name…>([\s\S]*?)</name>`. On a body that opens the element many
 * times and never closes it, that pattern scans from every opening tag to the
 * end: time quadratic in the body's length. Before the change, the Sabre
 * body below (80,000 `<s:message>`, under 1 MB) took 21 seconds in
 * `davRefusalBody`, and the Google one (100,000 `<errors `, whose `[^>]*` ran
 * to the end from each) 94 seconds. A DAV server is
 * whatever host a person names (workplan 0136), and nothing caps its body. An
 * outside, read-only check found the pattern in six places.
 *
 * `elementsIn` reads the body a tag at a time. These tests hold what it
 * finds to what the patterns found on well-formed tags, and hold its time
 * linear: each crafted body below is one the old patterns took seconds on,
 * and the bound is generous, so a slow runner does not fail it.
 */
import { describe, it, expect } from 'vitest';
import { asciiLower, elementsIn, namesElement, namesPrefixedElement, withoutElements } from './xml-elements.ts';
import { davRefusalBody } from './dav-refusal.ts';
import { davRefusalParts } from './remote-refusal.ts';
import { headerValueIn } from './mail-headers.ts';

/** A bound far above the milliseconds a linear read takes, and far below the seconds the patterns took. */
const GENEROUS_MS = 1500;

function timed<T>(read: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = read();
  return { value, ms: performance.now() - started };
}

const PREFIX = /^[A-Za-z0-9._-]+:/;
const response = {
  opens: (tag: string) => namesElement(tag, 'response', PREFIX, (rest) => rest === '' || /^\s/.test(rest)),
  closes: (tag: string) => tag.startsWith('/') && namesElement(tag.slice(1), 'response', PREFIX, (rest) => rest === ''),
};

describe('elementsIn: what the lazy pattern found, a tag at a time', () => {
  const pattern = /<(?:[A-Za-z0-9._-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9._-]+:)?response>/g;
  const bodies = [
    '<d:multistatus><d:response><d:href>/a</d:href></d:response><D:response x="1">b</D:response></d:multistatus>',
    '<response>no prefix</response><d:responses>not it</d:responses><d:response/>',
    '<d:response><d:response>inner</d:response>after</d:response>',
    '<d:response>never closed',
    '</d:response><d:response>one</d:response><d:response>',
    '<a.b-c:response >spaced</a.b-c:response><d:response>x</d:response >',
  ];

  it.each(bodies)('finds in %j what the pattern found', (body) => {
    expect(elementsIn(body, response.opens, response.closes).map((e) => e.text)).toEqual(
      [...body.matchAll(pattern)].map((m) => m[1]),
    );
    expect(withoutElements(body, response.opens, response.closes)).toBe(body.replace(pattern, ''));
  });

  it('stops at the first element when asked', () => {
    const body = '<d:response>a</d:response><d:response>b</d:response>';
    expect(elementsIn(body, response.opens, response.closes, true)).toEqual([{ start: 0, end: 26, text: 'a' }]);
  });

  it('compares a name as the `i` flag did: A to Z fold, no other letter does', () => {
    expect(asciiLower('D:Calendar-Home-SET')).toBe('d:calendar-home-set');
    expect(namesPrefixedElement('C:Calendar-Home-Set', 'calendar-home-set')).toBe(true);
    expect(namesPrefixedElement('/c:CALENDAR-HOME-SET'.slice(1), 'calendar-home-set', true)).toBe(true);
    // U+017F, the long s, upper-cases to S; without `u` the flag does not fold it.
    expect(/<d:\u017Fync>/i.test('<d:sync>')).toBe(false);
    expect(namesPrefixedElement('d:\u017Fync', 'sync', true)).toBe(false);
    expect(namesPrefixedElement('calendar-home-set', 'calendar-home-set')).toBe(false);
  });

  it('reads a body that opens the element a hundred thousand times and never closes it in linear time', () => {
    const body = '<d:response>'.repeat(100_000);
    const { value, ms } = timed(() => elementsIn(body, response.opens, response.closes));
    expect(value).toEqual([]);
    expect(ms).toBeLessThan(GENEROUS_MS);
  });

  it('reads a body of one tag that never ends in linear time', () => {
    const body = `<${'a'.repeat(1_000_000)}`;
    const { ms } = timed(() => elementsIn(body, response.opens, response.closes));
    expect(ms).toBeLessThan(GENEROUS_MS);
  });
});

describe('the refusals a DAV server sends, crafted to never close', () => {
  it("reads a Sabre error that opens `<s:message>` many times and never closes it in linear time", () => {
    const body =
      '<?xml version="1.0"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:exception>Forbidden</s:exception>' +
      '<s:message>'.repeat(80_000);
    const { value, ms } = timed(() => davRefusalBody(body));
    expect(value).toBe('Forbidden');
    expect(ms).toBeLessThan(GENEROUS_MS);
  });

  it('still reads a Sabre error whose elements close', () => {
    const body =
      '<?xml version="1.0"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:exception>Sabre\\DAV\\Exception\\Forbidden</s:exception><s:message>Not &amp; never</s:message></d:error>';
    expect(davRefusalBody(body)).toBe('Sabre\\DAV\\Exception\\Forbidden — Not & never');
  });

  it("reads a Google error whose `<errors` tag never ends in linear time", () => {
    const body = '<errors '.repeat(100_000);
    const { ms } = timed(() => davRefusalBody(body));
    expect(ms).toBeLessThan(GENEROUS_MS);
  });

  it("names a WebDAV error's conditions by the root's own prefix, as written", () => {
    const parts = davRefusalParts({
      status: 403,
      body: '<?xml version="1.0"?><D:error xmlns:D="DAV:"><D:need-privileges/><x:other/><D:need-privileges/></D:error>',
    });
    expect(parts.providerWords).toBe('DAV:need-privileges');
  });
});

describe('a header read a line at a time', () => {
  it('reads what the pattern read: the first line, any case, space before the colon', () => {
    const section = 'Received: x\r\nsubject  : First\r\n folded\r\nSubject: Second\r\n';
    expect(headerValueIn(section, 'Subject')).toBe('First folded');
    expect(headerValueIn('Subject:\r\nSubject: later\r\n', 'Subject')).toBeUndefined();
    expect(headerValueIn('X-Subject: no\r\n', 'Subject')).toBeUndefined();
    expect(headerValueIn('Message-ID: <a@b>\r\n', 'message-id')).toBe('<a@b>');
  });
});
