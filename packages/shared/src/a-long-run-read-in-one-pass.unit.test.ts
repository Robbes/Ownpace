// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A long run of one character, read in one pass where this package reads a
 * remote server's words or a message's own lines.
 *
 * Each case is a text a few tens of kilobytes long with a run that is not at
 * its end: the shape a pattern ending `X+$` reads in time quadratic in the run
 * (about a second at these sizes). Each must take well under a quarter of a
 * second, and answer as before.
 */

import { describe, it, expect } from 'vitest';
import { withoutABody } from './provider-answer.ts';
import { keyMaterial } from './generated-message-id.ts';

const ms = (f: () => unknown): number => {
  const start = performance.now();
  f();
  return performance.now() - start;
};
const LIMIT_MS = 250;

describe('a long run, read in one pass', () => {
  it('a failure message whose words end in a long run of spaces before more text', () => {
    const message = `x${' '.repeat(50_000)}x`;
    expect(ms(() => withoutABody(message))).toBeLessThan(LIMIT_MS);
    expect(withoutABody('Refused:  \t— ')).toBe('Refused');
    expect(withoutABody('Refused — <html>')).toBe('Refused');
  });

  it("a message's line with a long run of spaces before more text, for its key", () => {
    const rfc822 = new TextEncoder().encode(`Subject: x\r\n\r\na${' '.repeat(50_000)}b\r\n`);
    expect(ms(() => keyMaterial(rfc822))).toBeLessThan(LIMIT_MS);
  });
});
