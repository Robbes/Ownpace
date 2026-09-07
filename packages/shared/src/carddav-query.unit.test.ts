// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two filters, and the two ways each of them can be wrong quietly.
 *
 * A filter that a server REFUSES is loud — a 400 on the owner's card, which is
 * how this family was found at all. A filter a server ACCEPTS and matches
 * nothing with is silent: an empty multistatus reads as "the address book is
 * empty" everywhere it is consumed. So these tests are less about the happy
 * shape than about the two silences:
 *
 *   - a match-all filter carrying no prop-filter (an `anyof` over nothing);
 *   - a UID filter left at §10.5.4's `contains` default, which decides
 *     create-vs-update by substring.
 */

import { describe, it, expect } from 'vitest';
import { carddavMatchAllFilter, carddavUidFilter, escapeXmlText } from './carddav-query.ts';

describe('the match-all filter matches every card, and is not empty', () => {
  const filter = carddavMatchAllFilter('C');

  it('is a filter element at all — RFC 6352 §10.3 does not make it optional', () => {
    expect(filter).toContain('<C:filter');
    expect(filter).toContain('</C:filter>');
  });

  it('names at least one property, so it is never an anyof over nothing', () => {
    // THE SILENT FAILURE THIS FILE EXISTS FOR. `<filter/>` is legal per §10.5
    // and reads as "everything"; under the default `test="anyof"` it is an OR
    // over zero tests, and a server taking that literally answers with an
    // empty multistatus — which every listing here reads as an empty book.
    const propFilters = [...filter.matchAll(/<C:prop-filter\b/g)];
    expect(
      propFilters.length,
      'a filter with no prop-filter is an anyof over nothing: a source that ' +
        'answers "0 contacts" rather than refusing',
    ).toBeGreaterThan(0);
  });

  it('ORs them, so a card missing one property still comes back', () => {
    expect(filter).toContain('test="anyof"');
    expect(filter, 'allof would require every named property on every card').not.toContain(
      'test="allof"',
    );
  });

  it('names only properties a conforming vCard must carry', () => {
    // UID: RFC 6352 §5.1. VERSION and FN: RFC 6350 §6.7.9 / §6.2.1 (and
    // RFC 2426 §3.6.9 / §3.1.1 for vCard 3.0). A property that is merely
    // common — EMAIL, TEL — would drop the cards that lack it.
    const named = [...filter.matchAll(/<C:prop-filter name="([^"]+)"/g)].map((m) => m[1]);
    expect(named.sort()).toEqual(['FN', 'UID', 'VERSION']);
  });

  it('carries no comp-filter — that is CalDAV grammar (RFC 4791), not CardDAV', () => {
    // The defect in the writer's per-item query: a VADDRESSBOOK/VCARD nesting
    // borrowed from the calendar writer beside it. RFC 6352 §10.5 has no such
    // element; §8.6's own example filters on a prop-filter directly.
    expect(filter).not.toContain('comp-filter');
  });
});

describe('the UID filter asks for one card, exactly', () => {
  const filter = carddavUidFilter('34222-232@example.com', 'C');

  it('matches on equality, not substring', () => {
    // §10.5.4: match-type defaults to "contains". Without this attribute the
    // existence check that decides create-vs-update is a substring search, so
    // a UID that is a prefix of another card's adopts the wrong resource —
    // and the next write overwrites a different person.
    expect(filter).toContain('match-type="equals"');
  });

  it('filters on the UID property directly', () => {
    expect(filter).toContain('<C:prop-filter name="UID">');
    expect(filter).not.toContain('comp-filter');
  });

  it('carries the UID as the text to match', () => {
    expect(filter).toContain('>34222-232@example.com<');
  });

  it('escapes a UID that would otherwise close the element', () => {
    // vCard UIDs are free-form text; Google's carry `@` and some carry `&`.
    // An unescaped one is not a security question here so much as a malformed
    // request — another 400 with no element named.
    const nasty = carddavUidFilter('a&b<c>"d\'e', 'C');
    expect(nasty).toContain('a&amp;b&lt;c&gt;&quot;d&apos;e');
    expect(nasty.replace(/<\/?C:[a-z-]+[^>]*>/g, ''), 'raw markup survived into the text').not.toMatch(
      /[<>]/,
    );
  });
});

describe('the prefix is the caller document\'s, not this file\'s', () => {
  it('binds every element it emits to the prefix it was given', () => {
    // The source binds CardDAV to `A:` and the writer to `C:`. A fragment
    // emitting the wrong prefix is an undeclared namespace — a refusal, or
    // worse, a server that ignores the element it cannot resolve.
    for (const prefix of ['A', 'C', 'card']) {
      for (const filter of [carddavMatchAllFilter(prefix), carddavUidFilter('u', prefix)]) {
        const prefixes = new Set([...filter.matchAll(/<\/?([A-Za-z0-9-]+):/g)].map((m) => m[1]));
        expect(prefixes, `${filter} used a prefix other than ${prefix}`).toEqual(new Set([prefix]));
      }
    }
  });
});

describe('escapeXmlText', () => {
  it('escapes the five, and leaves everything else', () => {
    expect(escapeXmlText('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&apos;');
    expect(escapeXmlText('Jörg 日本 — ok')).toBe('Jörg 日本 — ok');
  });

  it('escapes the ampersand first, so an entity is not double-written', () => {
    // `&lt;` arriving as text must come out as `&amp;lt;`, not `&lt;`.
    expect(escapeXmlText('&lt;')).toBe('&amp;lt;');
  });
});
