// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Each DAV reader in this package, over a reply that opens an element many
 * times and never closes it, or opens a tag and never ends it.
 *
 * A pattern of the shape `<p:name[^>]*>…</p:name>` reads such a reply in time
 * quadratic in its length: about a second or more at these sizes. Each reader
 * here reads it a tag at a time (`davElement` in `@openmig/shared`), and must
 * take well under a quarter of a second. What each reads from a reply a
 * server sends is held by its own tests and by
 * `a-dav-element-read-a-tag-at-a-time` in `@openmig/shared`.
 */

import { describe, it, expect } from 'vitest';
import { CalDAVSource } from './caldav-source.ts';
import { CarddavSource } from './carddav-source.ts';
import { parseRemovedHrefs } from './dav-removals.ts';
import { bodyText, withoutTags } from './graph-todo-source.ts';
import { parseMultistatus } from './webdav-archive-store.ts';
import { WebdavFileSource } from './webdav-source.ts';
import { parseTrashbinOriginalLocations } from './webdav-trashbin.ts';

const ms = (read: () => unknown): number => {
  const started = performance.now();
  read();
  return performance.now() - started;
};
const LIMIT_MS = 250;
const N = 40_000;

/** Openings of `tag` that never close. */
const neverClosed = (tag: string): string => `<d:multistatus>${`<${tag}>`.repeat(N)}`;
/** One response holding openings of `tag` that never end. */
const neverEnded = (tag: string, prefix = 'd'): string =>
  `<${prefix}:multistatus><${prefix}:response><${prefix}:href>/a</${prefix}:href>${`<${prefix}:${tag} `.repeat(N)}</${prefix}:response></${prefix}:multistatus>`;

/** A private reader of a connector, without constructing one. */
function reader<T>(of: { prototype: object }, name: string): (...args: unknown[]) => T {
  const self = Object.create(of.prototype) as Record<string, (...args: unknown[]) => T>;
  return (...args) => self[name]!(...args);
}

describe('a DAV reader, in one pass', () => {
  it('the removals a sync report lists', () => {
    expect(ms(() => parseRemovedHrefs(neverClosed('d:response')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => parseRemovedHrefs(neverEnded('status')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => parseRemovedHrefs(neverEnded('propstat')))).toBeLessThan(LIMIT_MS);
  });

  it("the trash bin's original locations", () => {
    expect(ms(() => parseTrashbinOriginalLocations(neverClosed('d:response')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => parseTrashbinOriginalLocations(neverEnded('trashbin-original-location')))).toBeLessThan(LIMIT_MS);
  });

  it("an archive store's multistatus", () => {
    expect(ms(() => parseMultistatus(neverClosed('d:response')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => parseMultistatus(neverEnded('getcontentlength')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => parseMultistatus(neverEnded('resourcetype')))).toBeLessThan(LIMIT_MS);
  });

  it("a WebDAV source's PROPFIND", () => {
    const parse = reader(WebdavFileSource, 'parsePropfindResponse');
    expect(ms(() => parse(neverClosed('D:response')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => parse(neverEnded('getetag', 'D')))).toBeLessThan(LIMIT_MS);
  });

  it("a CardDAV source's collections and sync report", () => {
    const collections = reader(CarddavSource, 'parseCollectionsResponse');
    const sync = reader(CarddavSource, 'parseSyncCollectionResponse');
    expect(ms(() => collections(neverClosed('d:response'), '/home/'))).toBeLessThan(LIMIT_MS);
    expect(ms(() => collections(neverEnded('displayname'), '/home/'))).toBeLessThan(LIMIT_MS);
    expect(ms(() => sync(neverClosed('d:response')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => sync(neverEnded('sync-token')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => sync(neverEnded('address-data')))).toBeLessThan(LIMIT_MS);
  });

  it("a CalDAV source's collections and sync report", () => {
    const collections = reader(CalDAVSource, 'parseCollectionsResponse');
    const sync = reader(CalDAVSource, 'parseSyncCollectionResponse');
    expect(ms(() => collections(neverClosed('d:response'), '/home/'))).toBeLessThan(LIMIT_MS);
    expect(ms(() => collections(`<d:response><d:href>/c/</d:href><d:calendar/>${'<d:color '.repeat(N)}</d:response>`, '/home/'))).toBeLessThan(LIMIT_MS);
    expect(ms(() => sync(neverClosed('d:response')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => sync(neverEnded('calendar-data')))).toBeLessThan(LIMIT_MS);
    expect(ms(() => sync(neverEnded('propstat')))).toBeLessThan(LIMIT_MS);
  });

  it("a Graph task's HTML body, its tags taken out", () => {
    expect(ms(() => bodyText(`<p>${'<'.repeat(N * 5)}x`, 'html'))).toBeLessThan(LIMIT_MS);
    const pieces = ['<', '>', '<>', '<b>', '</p>', 'x', ' ', '<a<b>', '&amp;'];
    let n = 43;
    for (let i = 0; i < 50_000; i++) {
      let html = '';
      for (let j = 0; j < i % 11; j++) {
        n = (n * 1103515245 + 12345) % 2147483648;
        html += pieces[n % pieces.length];
      }
      expect(withoutTags(html), JSON.stringify(html)).toBe(html.replace(/<[^>]+>/g, ''));
    }
  });
});
