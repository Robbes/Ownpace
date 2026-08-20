// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NOTICE carries the one restriction this project places on an otherwise
 * permissive licence (ADR-0040), so it gets a guard.
 *
 * Apache-2.0 §6 grants no trade-mark rights, which makes the mark the only
 * protection the licence leaves us — ADR-0039 calls it the mission-compatible
 * moat, because a fork may run every line and still may not trade under our
 * name. A NOTICE that quietly lost that paragraph would surrender it silently,
 * and NOTICE is a file people edit for unrelated reasons (a new bundled
 * dependency, a copyright year). Nothing else in the suite reads this file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const notice = readFileSync(join(REPO_ROOT, 'NOTICE'), 'utf8');

describe('NOTICE asserts the trade mark', () => {
  it('names the mark and its owner', () => {
    expect(notice).toContain('"Ownpace" is a trademark');
  });

  it('cites Apache-2.0 §6 rather than merely asserting', () => {
    // The assertion without its basis reads as a preference. The licence
    // section is WHY the claim survives an otherwise permissive grant.
    expect(notice).toMatch(/Apache License, Version 2\.0[\s\S]{0,120}section 6/);
  });

  it('permits nominative use and forking explicitly', () => {
    // A trade-mark claim that does not say what IS allowed reads as a
    // restriction on the code, which would contradict ADR-0001 and scare off
    // exactly the MSPs ADR-0039 identifies as the mission's multiplier.
    expect(notice).toMatch(/No permission is needed to/);
    expect(notice).toMatch(/fork of Ownpace/);
  });

  it('states what needs permission, so the boundary is not guesswork', () => {
    expect(notice).toMatch(/Written permission is needed to/);
  });

  it('still disclaims third-party marks — the assertion did not displace it', () => {
    // The new section was inserted directly above this one; an edit that
    // replaced rather than preceded it would drop Microsoft's disclaimer.
    expect(notice).toContain('trademarks of Microsoft Corporation');
    expect(notice.indexOf('"Ownpace" is a trademark'))
      .toBeLessThan(notice.indexOf('trademarks of Microsoft Corporation'));
  });

  it('does not claim a registration we do not have', () => {
    // TMView (2026-08-20) found no live mark anywhere and none ever in classes
    // 9/38/42 — good grounds for an unregistered claim, not for an ® symbol.
    expect(notice).not.toContain('®');
    expect(notice).not.toMatch(/registered trade ?mark of/i);
  });
});
