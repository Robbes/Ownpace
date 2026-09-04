// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A QUALIFIER WIRED TO A GUARD THAT NEVER LETS IT RUN.
 *
 * Found by the managed gate on 2026-09-04, in work written the same evening
 * (workplan 0116 T7), and it is worth recording exactly because of how quiet it
 * was.
 *
 * `qualifyAndRememberNow` dispatches across the qualifiers in a chain:
 *
 *     qualifyAccount(…) ?? qualifyGoogleGrant(…) ?? qualifyDropbox(…) ?? qualifyArchive(…)
 *
 * and `qualifyArchive` was added to it correctly. One function EARLIER there is
 * a guard that returns before the chain runs at all, naming the kinds worth
 * qualifying — and `archive` was not in it. So the dispatch was **dead code**:
 * an archive connection stored fine, its probe answered fine, and the Measured
 * line — the entire point of that task — simply never appeared.
 *
 * ## Why nothing was red
 *
 * The unit tests for T7 call `qualifyArchive` directly, which is the right way
 * to test a qualifier and says nothing about whether anything calls it. The
 * route's own tests do not reach the qualification path. And the failure has no
 * error in it: `undefined` is the honest answer for a kind with no qualifier,
 * so the code did precisely what it says on kinds where that is true.
 *
 * **A value only one surface reads is a value no test asserts** — the same
 * sentence 0115 T9 was written under, one layer along. Here the surface is the
 * connection card's Measured line, and its absence looks like a provider that
 * cannot be measured rather than like a bug.
 *
 * ## What this holds
 *
 * The guard and the dispatch are ONE decision expressed twice, so they are
 * pinned against each other rather than each being checked alone. Read as text,
 * because importing the route module would drag in the database, the secret
 * store and the whole express app — and what is asserted is which predicates
 * the two lists name, which is a property of the source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), 'connections.ts');

function source(): string {
  return readFileSync(ROUTE, 'utf8');
}

/** The `is*Kind` predicates the pre-dispatch guard tests. */
function guardedKinds(): Set<string> {
  const text = source();
  const start = text.indexOf('async function qualifyAndRemember(');
  expect(start, 'qualifyAndRemember is no longer recognisable in the route').toBeGreaterThan(-1);
  const end = text.indexOf('return withinBudget', start);
  expect(end, "the guard's shape has changed — it no longer ends at withinBudget").toBeGreaterThan(
    start,
  );
  return new Set(
    [...text.slice(start, end).matchAll(/!?(is\w+Kind|isGoogleGrantKind)\(kind\)/g)].map(
      (m) => m[1]!,
    ),
  );
}

/** The qualifiers the dispatch chain actually calls. */
function dispatchedQualifiers(): Set<string> {
  const text = source();
  const start = text.indexOf('const qualification =');
  expect(start, 'the qualifier dispatch chain is no longer recognisable').toBeGreaterThan(-1);
  const end = text.indexOf('if (!qualification) return undefined;', start);
  expect(end, "the dispatch chain's shape has changed").toBeGreaterThan(start);
  return new Set([...text.slice(start, end).matchAll(/await (qualify\w+)\(/g)].map((m) => m[1]!));
}

/**
 * Which guard predicate belongs to which qualifier.
 *
 * A table, so a new qualifier arriving without its predicate fails on the
 * pairing rather than on a name this file invented. `qualifyAccount` is the
 * odd one: it covers the whole Basic-auth family and its predicate is
 * `isQualifiableKind`, which is why the mapping cannot be derived from the
 * names alone.
 */
const PREDICATE_FOR: Readonly<Record<string, string>> = {
  qualifyAccount: 'isQualifiableKind',
  qualifyGoogleGrant: 'isGoogleGrantKind',
  qualifyDropbox: 'isDropboxKind',
  qualifyArchive: 'isArchiveKind',
};

describe('every qualifier the route dispatches is one the guard lets through', () => {
  it('finds a dispatch chain and a guard at all', () => {
    // Guards the rest: two regexes that matched nothing would make every
    // assertion below pass having read no code.
    expect(dispatchedQualifiers().size).toBeGreaterThan(2);
    expect(guardedKinds().size).toBeGreaterThan(2);
  });

  it.each([...Object.keys(PREDICATE_FOR)])(
    '%s is dispatched AND its kind is named in the guard',
    (qualifier) => {
      const predicate = PREDICATE_FOR[qualifier]!;
      expect(
        dispatchedQualifiers().has(qualifier),
        `${qualifier} is no longer in the dispatch chain`,
      ).toBe(true);
      expect(
        guardedKinds().has(predicate),
        `${qualifier} is dispatched, but the guard one function earlier does not name ` +
          `${predicate} — so it returns before the chain runs and the qualifier is DEAD CODE. ` +
          'The connection stores fine, the probe answers fine, and the Measured line simply ' +
          'never appears. This is exactly how 0116 T7 shipped broken for an hour.',
      ).toBe(true);
    },
  );

  it('names no predicate the dispatch does not use', () => {
    // The other direction. A guard that lets a kind through to a chain with no
    // arm for it is cheap — the chain answers `undefined` — but it means the
    // two lists have drifted, and the next reader cannot tell which is right.
    const expected = new Set(Object.values(PREDICATE_FOR));
    const stray = [...guardedKinds()].filter((p) => !expected.has(p));
    expect(
      stray,
      `the guard names ${stray.join(', ')}, which no qualifier in the dispatch chain matches. ` +
        'Either a qualifier was removed and its predicate left behind, or this table is stale.',
    ).toEqual([]);
  });
});
