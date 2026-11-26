// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A long run, read in one pass where the connectors read what a server sent
 * back or what a person typed.
 *
 * Each case is an input a few tens or hundreds of kilobytes long, shaped so
 * that a pattern which backtracks over it is quadratic (about a second or more
 * at these sizes): a run of slashes in an href or a path, a run of padding in
 * a key, a run of dots in an address, a calendar's component set that never
 * closes. Each must take well under a quarter of a second, and answer as
 * before.
 */

import { describe, it, expect } from 'vitest';
import { joinStorePath, splitStorePath } from './archive-store.ts';
import { CalDAVSource, compNamesIn, componentSetIn } from './caldav-source.ts';
import { dataKeyBytes } from './cirrux-drive-format.ts';
import { looksLikeUpn, resolveMailboxScope } from './graph-scope.ts';
import { parseMultistatus } from './webdav-archive-store.ts';

const ms = (f: () => unknown): number => {
  const start = performance.now();
  try {
    f();
  } catch {
    // A refusal is an answer; only the time is measured here.
  }
  return performance.now() - start;
};
const LIMIT_MS = 250;

describe('a long run, read in one pass', () => {
  it('an href with a long run of slashes inside it', () => {
    const body = `<d:multistatus><d:response><d:href>/x${'/'.repeat(50_000)}a</d:href></d:response></d:multistatus>`;
    expect(ms(() => parseMultistatus(body))).toBeLessThan(LIMIT_MS);
    expect(parseMultistatus('<d:multistatus><d:response><d:href>/files/a%20b/</d:href><d:resourcetype><d:collection/></d:resourcetype></d:response></d:multistatus>')).toEqual([
      { path: '/files/a b', isCollection: true, size: undefined },
    ]);
  });

  it('a store path with a long run of slashes inside it', () => {
    const path = `${'/'.repeat(50_000)}a`;
    expect(ms(() => splitStorePath(path))).toBeLessThan(LIMIT_MS);
    expect(ms(() => joinStorePath(path, 'b'))).toBeLessThan(LIMIT_MS);
    expect(splitStorePath('a/b/c.zip//')).toEqual({ folder: 'a/b', name: 'c.zip' });
    expect(joinStorePath('a/b//', 'c.zip')).toBe('a/b/c.zip');
  });

  it("a key with a long run of padding inside it", () => {
    expect(ms(() => dataKeyBytes(`${'='.repeat(50_000)}a`))).toBeLessThan(LIMIT_MS);
    expect(dataKeyBytes(Buffer.alloc(32, 7).toString('base64'))).toEqual(new Uint8Array(32).fill(7));
  });

  it('an address with a long run of dots and letters after its @', () => {
    expect(ms(() => resolveMailboxScope(`a@${'a.'.repeat(25_000)}@`))).toBeLessThan(LIMIT_MS);
    expect(resolveMailboxScope('pat@example.org')).toMatchObject({ kind: 'user' });
  });

  it('an address answers as the pattern it replaces did, over 50,000 random ones', () => {
    const was = /^[^\s/?@]+@[^\s/?#@]+\.[^\s/?#@]+$/;
    let n = 3;
    const alphabet = 'a.@#/? \u00a0b';
    for (let i = 0; i < 50_000; i++) {
      let address = '';
      for (let j = 0; j < i % 11; j++) {
        n = (n * 1103515245 + 12345) % 2147483648;
        address += alphabet[n % alphabet.length];
      }
      expect(looksLikeUpn(address), JSON.stringify(address)).toBe(was.test(address));
    }
    expect(looksLikeUpn('person_theirdomain.com#EXT#@yourtenant.onmicrosoft.com')).toBe(true);
  });

  it("a calendar's component set that opens many times and never closes", () => {
    const reply = '<a:supported-calendar-component-set>'.repeat(17_000) + 'x';
    expect(ms(() => CalDAVSource.parseComponentSet(reply))).toBeLessThan(LIMIT_MS);
  });

  it("a component set holding a long run of comp tags that never end", () => {
    const reply = `<C:supported-calendar-component-set>${'<comp '.repeat(35_000)}x</C:supported-calendar-component-set>`;
    expect(ms(() => CalDAVSource.parseComponentSet(reply))).toBeLessThan(LIMIT_MS);
    expect(
      CalDAVSource.parseComponentSet(
        '<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="vtodo"/></C:supported-calendar-component-set>',
      ),
    ).toEqual(['VEVENT', 'VTODO']);
  });

  it("a component set and its comp tags read as the patterns they replace did, over 100,000 random replies", () => {
    const setWas = /<[A-Za-z]+:supported-calendar-component-set[^>]*>([\s\S]*?)<\/[A-Za-z]+:supported-calendar-component-set>/i;
    const compWas = /<[A-Za-z]*:?comp\s[^>]*name="([^"]+)"/gi;
    const tokens = ['<', '</', '>', 'C:', 'c', ':', 'comp', 'Comp', ' ', '\n', 'name="', 'NAME="', '"', 'VEVENT', 'x', '/', 'supported-calendar-component-set', 'Supported-Calendar-Component-Set'];
    let n = 5;
    const pick = () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return tokens[n % tokens.length]!;
    };
    for (let i = 0; i < 100_000; i++) {
      let reply = '';
      for (let j = 0; j < i % 23; j++) reply += pick();
      const was = reply.match(setWas)?.[1];
      expect(componentSetIn(reply) ?? '', JSON.stringify(reply)).toBe(was ?? '');
      expect(compNamesIn(reply), JSON.stringify(reply)).toEqual([...reply.matchAll(compWas)].map((m) => m[1]));
    }
  });
});
