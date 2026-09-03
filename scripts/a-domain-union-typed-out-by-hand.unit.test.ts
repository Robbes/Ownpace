// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sync domains are ONE list — nobody types the four out again
 * (workplan 0113 T1).
 *
 * `'email' | 'calendar' | 'contact' | 'file'` was written out by hand
 * **eighty times across eighteen files** — the ledger stores, the
 * orchestration seams, the core engines, the managed metering, the web
 * services, the worker jobs. Every one of those was a copy of a capability
 * list, and a capability list in two places disagrees with itself exactly
 * once: the day a fifth domain arrives, whichever copy was missed keeps
 * refusing it, and the failure surfaces as somebody else's 500 rather than as
 * a compile error here. That is #597's shape, which this repository has paid
 * for twice.
 *
 * So the list lives in `packages/shared/src/discovery.ts` as
 * `DISCOVERY_DOMAINS`, the type is derived from it, and this fails the build
 * on a new copy of either. The exceptions below are files that legitimately
 * carry their own four — each with the reason, and each two-way, so an
 * exception cannot outlive what it excused. When a fifth domain is added, this
 * list is the checklist of every place that has to be visited by hand.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** This file writes both patterns down in order to look for them. */
const SELF = relative(ROOT, import.meta.filename);

/** The type union, in any spacing a formatter might produce. */
const UNION = /'email'\s*\|\s*'calendar'\s*\|\s*'contact'\s*\|\s*'file'/;

/**
 * The values as a runtime list, in any spacing.
 *
 * Anchored on the FIRST FOUR and open-ended after them, so a file keeping its
 * own copy is still caught whether it stopped at four (a list that did not
 * follow the domains) or went on to five (a hand-written copy of today's).
 * The `]` is deliberately not required: `['email', 'calendar', 'contact',
 * 'file', 'task']` must match too, and it is the shape most copies now take.
 */
const ARRAY = /\[\s*'email',\s*'calendar',\s*'contact',\s*'file'\s*[,\]]/;

/** The one home of both. */
const HOME = 'packages/shared/src/discovery.ts';

/**
 * Files that may still write the four values out as a LIST, and why.
 *
 * Nothing may write the TYPE out any more — that is what `DiscoveryDomain` is
 * for, and there is no honest reason to restate it.
 *
 * The home is in this map on purpose: its presence is the vacuity guard — a
 * walk that matched nothing at all would otherwise pass perfectly.
 */
const MAY_LIST_THE_VALUES: Readonly<Record<string, string>> = {
  [HOME]: 'The definition. DISCOVERY_DOMAINS, and the type derived from it.',

  // --- Mirrors of something outside TypeScript, which widen on their own clock.
  //
  // THREE ENTRIES LEFT HERE WHEN T5 LANDED (2026-09-03), and all three are
  // gone: the zod enums in `mapping-service.ts`, `run-discovery.ts` and the
  // migrations routes now read `DISCOVERY_DOMAINS` directly. Their exception
  // was honest while it stood — widening a validator ahead of the ledger
  // accepts a domain the database then refuses, which is a pass that dies
  // half-copied — but T2 put the migration in and
  // `a-fifth-domain-the-database-would-refuse.unit.test.ts` now fails the
  // build if the shared list ever outruns the CHECKs again. With that guard
  // standing, deriving is the safer of the two.

  // --- Lists that are NOT the product's domains and must not widen with them.
  'apps/web/src/pages/Connections.tsx':
    'GRANT_FACES — the faces a GOOGLE account can be asked to serve. Google carries ' +
    'no tasks over CalDAV at all (0113 §"The facts"), so this list answers a ' +
    "question about one provider, not about the product's domains. It stayed four " +
    'when the product went to five (T5, 2026-09-03), which is the exception doing ' +
    'its job rather than the exception going stale.',
  'apps/api/src/routes/migrations/google-account-consent.ts':
    'ORDER — the order the Google consent screen lists the faces it asks for. Same ' +
    'reason as GRANT_FACES: a fact about one provider.',
  'packages/shared/src/provider-accounts.ts':
    'GOOGLE_RESTRICTED_ACCOUNT_DOMAINS — what a deployment running its OWN Google ' +
    'application with the restricted scopes carries. It happens to be four today ' +
    "because Google's four are these four; it is a row in a provider table, not the " +
    "product's list, and it must not gain a domain Google has no scope for.",

  // --- Tests that pin "these four, exactly" as their subject.
  'packages/shared/src/qualification-gate.unit.test.ts':
    'Passes the four as the domains a caller ticked; the literal IS the fixture.',
  'packages/shared/src/target-domains.unit.test.ts':
    'Asks each target type for its answer on all four — the literal is the question.',
  'packages/shared/src/provider-accounts.unit.test.ts':
    'Pins what a deployment-declared restricted Google client carries. A provider ' +
    'row, not the product list.',
  'packages/orchestration/src/domain-lanes.unit.test.ts':
    'Pins the lane planner against a fixed set of four; a fifth would change the ' +
    'expected lanes, which is a test that should be read, not one that should pass ' +
    'quietly.',
  'apps/api/src/routes/migrations/google-account-consent.unit.test.ts':
    'Pins the consent order above.',
  'apps/api/src/routes/migrations/google-account-scope-class.unit.test.ts':
    'Pins what GOOGLE_ACCOUNT_SCOPE_CLASS=restricted widens a Google account to.',
  'apps/api/src/routes/provider-accounts.unit.test.ts':
    'Pins the same answer over HTTP.',
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build' || name.startsWith('.')) {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(full);
  }
}

function sourceFiles(): ReadonlyArray<{ path: string; text: string }> {
  const files: string[] = [];
  for (const top of ['apps', 'packages', 'scripts']) walk(join(ROOT, top), files);
  return files.map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));
}

describe('the sync domains are written once', () => {
  it('nobody types the union out — DiscoveryDomain is the name of that type', () => {
    const naming = sourceFiles()
      .filter(({ path, text }) => path !== SELF && UNION.test(text))
      .map(({ path }) => path)
      .sort();

    expect(
      naming.filter((f) => f !== HOME),
      "these files spell out the domain union instead of naming it. Import " +
        "`DiscoveryDomain` from @openmig/shared — a second copy of a capability list " +
        'disagrees with the first exactly once (0113 T1)',
    ).toEqual([]);
  });

  it('the list is still written in its one home — this guard is not passing vacuously', () => {
    // Both assertions above are "found nothing", and "found nothing" is also
    // what a pattern that stopped matching anything at all returns. The
    // definition itself is the control: if the four are no longer spelled HERE
    // in a shape this file recognises, the two greens above mean nothing.
    const home = sourceFiles().find(({ path }) => path === HOME);
    expect(home, `${HOME} is gone; this guard now proves nothing`).toBeDefined();
    expect(
      ARRAY.test(home!.text),
      `${HOME} no longer writes the domain list in a shape this guard recognises — so its ` +
        'two greens above are vacuous. Fix the patterns at the top of this file to match ' +
        'however the list is spelled now',
    ).toBe(true);
  });

  it('the four VALUES are listed only where an exception says why — and every exception is live', () => {
    const listing = sourceFiles()
      .filter(({ path, text }) => path !== SELF && ARRAY.test(text))
      .map(({ path }) => path)
      .sort();

    expect(
      listing.filter((f) => !(f in MAY_LIST_THE_VALUES)),
      'these files write the four domain VALUES out as a list and are not excepted. Walk ' +
        '`DISCOVERY_DOMAINS` instead, or add the file here with the reason it must keep its ' +
        'own copy (0113 T1)',
    ).toEqual([]);

    expect(
      Object.keys(MAY_LIST_THE_VALUES).filter((f) => !listing.includes(f)),
      'excepted but no longer listing the four — remove the entry so the exception list ' +
        'stays exactly as big as the exception',
    ).toEqual([]);
  });
});
