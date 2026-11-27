// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A calendar's supported components, from a reply holding many `comp` tags
 * that never end, read in one pass. The pattern it was read with took about a
 * second at this size; it must take well under a quarter of one, and answer
 * as before.
 */

import { describe, it, expect } from 'vitest';
import { componentsDeclaredIn } from './caldav-target-writer.ts';

describe('a DAV reader, in one pass', () => {
  it("a calendar's supported components", () => {
    const body = `<C:supported-calendar-component-set>${'<C:comp '.repeat(40_000)}</C:supported-calendar-component-set>`;
    const started = performance.now();
    componentsDeclaredIn(body);
    expect(performance.now() - started).toBeLessThan(250);
    expect(
      componentsDeclaredIn(
        `<C:supported-calendar-component-set><C:comp name="VEVENT"/><cal:comp name='vtodo'/></C:supported-calendar-component-set>`,
      ),
    ).toEqual(['VEVENT', 'VTODO']);
  });

  it('reads what the pattern read, over 50,000 random sets of whole tags', () => {
    const was = /<(?:[A-Za-z0-9._-]+:)?comp\s[^>]*name=["']([^"']+)["']/gi;
    const pieces = ['<C:comp name="VEVENT"/>', "<comp name='vtodo'>", '<a.b-1:COMP\tNAME="VJOURNAL" x="1">', '<C:comp name=""/>', '<C:comp name="a" name="b">', '<C:compx name="X">', '<C:comp/>', '<C:other name="Y">', 'text', ' '];
    let n = 41;
    const known = new Set(['VEVENT', 'VTODO', 'VJOURNAL']);
    for (let i = 0; i < 50_000; i++) {
      let set = '';
      for (let j = 0; j < i % 9; j++) {
        n = (n * 1103515245 + 12345) % 2147483648;
        set += pieces[n % pieces.length];
      }
      const body = `<C:supported-calendar-component-set>${set}</C:supported-calendar-component-set>`;
      const before = [...new Set([...set.matchAll(was)].map((m) => m[1]!.toUpperCase()).filter((x) => known.has(x)))];
      expect(componentsDeclaredIn(body) ?? [], JSON.stringify(set)).toEqual(before);
    }
  });
});
