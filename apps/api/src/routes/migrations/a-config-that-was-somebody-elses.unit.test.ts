// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CONFIG THAT WAS SOMEBODY ELSE'S (found 2026-09-18, workplan 0125).
 *
 * `GET /api/migrations/:mappingId` returned `sourceConfig` spread from the
 * CONNECTION's config alone. A connection is shared; the fields that say whose
 * data a mapping moves are the MAPPING's, in `source_config_override` — a Box
 * subject, a Drive root folder, a Dropbox root path, and since 0042 the Google
 * export policy. So for any mapping that overrode one of those, this route
 * reported the connection's answer: a setting belonging to whichever migration
 * was created first.
 *
 * Quiet, because it reads perfectly: a value, of the right shape, from a real
 * column. Nothing throws and nothing is blank.
 *
 * It became load-bearing with 0125 T3, which made the export policy
 * changeable. A chooser showing the wrong current value is worse than no
 * chooser — it reads as "this migration exports to PDF" about one that refuses
 * them, and a press to change it is a change away from something it never had.
 *
 * WHY A SOURCE-LEVEL GUARD. Like `mapping-updated-at`, the mistake is an
 * OMISSION: a handler that forgets the merge returns exactly what one that
 * remembers it returns, for every mapping with no override — which is every
 * mapping created before overrides existed, and most of them since.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf-8');
const DEPS = readFileSync(
  join(import.meta.dirname, '../../../../../packages/orchestration/src/build-deps-from-mapping.ts'),
  'utf-8',
);

/**
 * The object literal the DETAIL RESPONSE builds a key from, to its closing
 * brace.
 *
 * `sourceConfig: {` appears more than once in this file — the create schema
 * declares one too — so the occurrence is chosen by a marker only the response
 * has (`usernameFor`, which is defined in that handler). Taking the first
 * match found the Zod schema and asserted nothing about the route, which is
 * how this test passed its first run against code that had the bug.
 */
function literalFor(key: string): string {
  let from = 0;
  for (;;) {
    const at = SOURCE.indexOf(`${key}: {`, from);
    expect(at, `${key} is not built as an object literal in the detail response`).toBeGreaterThan(-1);
    from = at + 1;
    let depth = 0;
    let i = SOURCE.indexOf('{', at);
    for (; i < SOURCE.length; i++) {
      if (SOURCE[i] === '{') depth++;
      else if (SOURCE[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const literal = SOURCE.slice(at, i + 1);
    if (literal.includes('usernameFor(')) return literal;
  }
}

describe('the detail route reports what THIS migration runs under', () => {
  it.each([
    ['sourceConfig', 'sourceConfigOverride'],
    ['targetConfig', 'targetConfigOverride'],
  ])('%s merges the mapping\'s own %s', (key, override) => {
    const literal = literalFor(key);
    expect(literal, `${key} does not read ${override}`).toContain(`mapping.${override}`);
  });

  it('puts the OVERRIDE second, so it wins key by key', () => {
    // Order is the whole of it. Connection-over-override would type-check,
    // return an object of the right shape, and silently answer the connection
    // for every field a mapping overrode — which is the bug, spelled the other
    // way round.
    for (const key of ['sourceConfig', 'targetConfig'] as const) {
      const literal = literalFor(key);
      const conn = literal.indexOf('Conn?.config');
      const over = literal.indexOf('ConfigOverride');
      expect(conn, `${key} no longer spreads the connection`).toBeGreaterThan(-1);
      expect(over, `${key} no longer spreads the override`).toBeGreaterThan(-1);
      expect(over, `${key} spreads the override BEFORE the connection`).toBeGreaterThan(conn);
    }
  });

  it('keeps the password masked after the merge', () => {
    // An override is an ordinary jsonb blob. It has never carried a credential
    // and must not be able to unmask one by carrying a `password` key, so the
    // mask is stamped after both spreads rather than before either.
    for (const key of ['sourceConfig', 'targetConfig'] as const) {
      const literal = literalFor(key);
      expect(literal.indexOf("password: '***'")).toBeGreaterThan(literal.indexOf('ConfigOverride'));
    }
  });

  it('merges the way a sync pass merges, so a screen and a pass cannot disagree', () => {
    // The rule is stated once in `build-deps-from-mapping`: *"Override-over-
    // connection, key by key: an absent key keeps whatever the connection
    // said."* This asserts the pass still says that — a second merge rule
    // invented there would make this route right about a pass that had moved.
    expect(DEPS).toMatch(/Override-over-connection, key by key/);
    expect(DEPS).toMatch(/\.\.\.\(\(conn\.config \?\? \{\}\) as Record<string, unknown>\),\s*\n\s*\.\.\.\(override \?\? \{\}\),/);
  });
});
