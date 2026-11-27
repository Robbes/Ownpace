// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every pattern the DAV readers pulled an element out with, beside the reader
 * that takes its place, on random bodies made of whole tags and text.
 *
 * Each pattern below is copied from the reader it was in (its file named),
 * and each must find, on every body, exactly what its `davElement` reader
 * finds. The bodies are whole tags (openings, closings and self-closing tags,
 * prefixes and cases mixed, a longer name that starts with the one read) and
 * text with no `<` or `>` in it: what a server sends. On a body that opens an
 * element many times and never closes it, a pattern of the shape
 * `<p:name[^>]*>…` reads in time quadratic in the body; the readers read it a
 * tag at a time (`a-dav-reader-in-one-pass` in each package times them).
 */

import { describe, it, expect } from 'vitest';
import { davElement, firstPlainTextOf, firstTextBeforeTag, firstTextOf, textsOf, withoutElements } from './xml-elements.ts';

const LETTERS = /^[A-Za-z]+:/;
const WORD = /^[A-Za-z][\w-]*:/;
const D = /^D:/i;
const Q = /^Q:/i;
const ARCHIVE = /^[\w-]+:/;
const boundary = (rest: string) => !/^\w/.test(rest);

/** A body of `count` pieces: tags around `name`, and text. */
function bodyOf(name: string, count: number, seed: { n: number }): string {
  const pieces = [
    `<d:${name}>`, `<D:${name.toUpperCase()} x="1">`, `</d:${name}>`, `</D:${name}>`, `<${name}>`, `</${name}>`,
    `<a-b:${name}>`, `</a-b:${name}>`, `<d1:${name}>`, `</d1:${name}>`, `<d:${name}x>`, `</d:${name}x>`, `<d:${name}/>`,
    `<Q:${name}>`, `</Q:${name}>`, '<d:other>', '</d:other>', '<d:collection/>', '<collection/>',
    'x', ' ', '\n', '/a b', '200', ' 42 ', 'HTTP/1.1 404 Not Found', '',
  ];
  let out = '';
  for (let i = 0; i < count; i++) {
    seed.n = (seed.n * 1103515245 + 12345) % 2147483648;
    out += pieces[seed.n % pieces.length];
  }
  return out;
}

/** Each pattern as it was, and the reader in its place. */
const blocks: Array<[string, string, RegExp, ReturnType<typeof davElement>]> = [
  ['response', 'caldav-source, carddav-source', /<[A-Za-z]+:response[^>]*>([\s\S]*?)<\/[A-Za-z]+:response>/gi, davElement('response', LETTERS)],
  ['response', 'dav-removals, webdav-trashbin', /<[A-Za-z][\w-]*:response[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:response>/gi, davElement('response', WORD)],
  ['response', 'webdav-source', /<D:response[^>]*>([\s\S]*?)<\/D:response>/gi, davElement('response', D)],
  ['response', 'webdav-archive-store', /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi, davElement('response', ARCHIVE, { optionalPrefix: true, after: boundary })],
];
const firsts: Array<[string, string, RegExp, ReturnType<typeof davElement>]> = [
  ['address-data', 'carddav-source', /<[A-Za-z]+:address-data[^>]*>([\s\S]*?)<\/[A-Za-z]+:address-data>/i, davElement('address-data', LETTERS)],
  ['calendar-data', 'caldav-source', /<[A-Za-z]+:calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z]+:calendar-data>/i, davElement('calendar-data', LETTERS)],
  ['trashbin-original-location', 'webdav-trashbin', /<[A-Za-z][\w-]*:trashbin-original-location[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:trashbin-original-location>/i, davElement('trashbin-original-location', WORD)],
  ['resourcetype', 'caldav-source', /<[A-Za-z][\w-]*:resourcetype[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:resourcetype>/i, davElement('resourcetype', WORD)],
  ['href', 'webdav-archive-store', /<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i, davElement('href', ARCHIVE, { optionalPrefix: true, after: boundary })],
];
const plains: Array<[string, string, RegExp, ReturnType<typeof davElement>, boolean]> = [
  ['status', 'caldav-source, dav-removals', /<[A-Za-z][\w-]*:status[^>]*>([^<]*)<\/[A-Za-z][\w-]*:status>/i, davElement('status', WORD), false],
  ['displayname', 'caldav-source, carddav-source', /<[A-Za-z]+:displayname[^>]*>([^<]*)<\/[A-Za-z]+:displayname>/i, davElement('displayname', LETTERS), false],
  ['color', 'caldav-source', /<[A-Za-z]+:color[^>]*>([^<]*)<\/[A-Za-z]+:color>/i, davElement('color', LETTERS), false],
  ['getetag', 'caldav-source, carddav-source', /<[A-Za-z]+:getetag[^>]*>([^<]+)<\/[A-Za-z]+:getetag>/i, davElement('getetag', LETTERS), true],
  ['sync-token', 'carddav-source', /<[A-Za-z]+:sync-token[^>]*>([^<]+)<\/[A-Za-z]+:sync-token>/i, davElement('sync-token', LETTERS), true],
  ['href', 'webdav-source', /<D:href[^>]*>([^<]+)<\/D:href>/i, davElement('href', D), true],
  ['displayname', 'webdav-source', /<D:displayname[^>]*>([^<]*)<\/D:displayname>/i, davElement('displayname', D), false],
  ['quota-used-bytes', 'webdav-source', /<Q:quota-used-bytes[^>]*>([^<]+)<\/Q:quota-used-bytes>/i, davElement('quota-used-bytes', Q), true],
];

const RUNS = 30_000;

describe('the readers find what the patterns found', () => {
  it.each(blocks)('every %s, as %s read it', (name, _where, pattern, element) => {
    const seed = { n: 17 };
    for (let i = 0; i < RUNS; i++) {
      const body = bodyOf(name, i % 13, seed);
      expect(textsOf(body, element), JSON.stringify(body)).toEqual([...body.matchAll(pattern)].map((m) => m[1]));
    }
  });

  it.each(firsts)('the first %s, as %s read it', (name, _where, pattern, element) => {
    const seed = { n: 19 };
    for (let i = 0; i < RUNS; i++) {
      const body = bodyOf(name, i % 13, seed);
      expect(firstTextOf(body, element), JSON.stringify(body)).toBe(pattern.exec(body)?.[1]);
    }
  });

  it.each(plains)('the first %s holding only text, as %s read it', (name, _where, pattern, element, nonEmpty) => {
    const seed = { n: 23 };
    for (let i = 0; i < RUNS; i++) {
      const body = bodyOf(name, i % 13, seed);
      expect(firstPlainTextOf(body, element, nonEmpty), JSON.stringify(body)).toBe(pattern.exec(body)?.[1]);
    }
  });

  it('every propstat taken out, as caldav-source and dav-removals did', () => {
    const pattern = /<[A-Za-z][\w-]*:propstat[^>]*>[\s\S]*?<\/[A-Za-z][\w-]*:propstat>/gi;
    const element = davElement('propstat', WORD);
    const seed = { n: 29 };
    for (let i = 0; i < RUNS; i++) {
      const body = bodyOf('propstat', i % 13, seed);
      expect(withoutElements(body, element.opens, element.closes), JSON.stringify(body)).toBe(body.replace(pattern, ''));
    }
  });

  it("a getcontentlength's number, as webdav-archive-store read it", () => {
    const pattern = /<(?:[\w-]+:)?getcontentlength\b[^>]*>\s*(\d+)\s*</i;
    const element = davElement('getcontentlength', ARCHIVE, { optionalPrefix: true, after: boundary });
    const seed = { n: 31 };
    for (let i = 0; i < RUNS; i++) {
      const body = bodyOf('getcontentlength', i % 13, seed);
      const text = firstTextBeforeTag(body, element.opens, (t) => /^\s*\d+\s*$/.test(t));
      expect(text === undefined ? undefined : /\d+/.exec(text)![0], JSON.stringify(body)).toBe(pattern.exec(body)?.[1]);
    }
  });

  it("a quota property's text, trimmed and not empty, as destination-capacity read it", () => {
    const name = 'quota-available-bytes';
    const pattern = new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${name}(?:\\s[^>]*)?>\\s*([^<\\s][^<]*?)\\s*</(?:[A-Za-z][\\w.-]*:)?${name}>`);
    const element = davElement(name, /^[A-Za-z][\w.-]*:/, { optionalPrefix: true, after: (rest) => rest === '' || /^\s/.test(rest) });
    const seed = { n: 37 };
    for (let i = 0; i < RUNS; i++) {
      const body = bodyOf(name, i % 13, seed);
      const text = firstTextBeforeTag(body, element.opens, (t, next) => /\S/.test(t) && next !== undefined && element.closes(next));
      expect(text?.trim(), JSON.stringify(body)).toBe(pattern.exec(body)?.[1]);
    }
  });
});
