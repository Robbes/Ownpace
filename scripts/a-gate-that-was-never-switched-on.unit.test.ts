// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A supply-chain gate with an exclude list, an escape hatch, and no gate.
 *
 * `pnpm-workspace.yaml` carried a `minimumReleaseAgeExclude` list from
 * 2026-08-18 (#443) and grew it entry by entry for three weeks — including one
 * annotated *"Dependabot-pinned major bump, newer than the release-age gate;
 * reviewed via its PR"*. It reads exactly like the escape hatch of a live
 * control.
 *
 * `minimumReleaseAge` was never set. Not removed — never written, in any form,
 * in the whole history of the repository: `pnpm config get minimumReleaseAge`
 * answered `undefined`, there was no `.npmrc`, and `git log -S` over this file
 * and `package.json` returned nothing. Every entry on that list was inert, and
 * the list was the only thing suggesting otherwise.
 *
 * The owner switched the gate on at **three days** on 2026-09-09. These tests
 * hold the four things that were, or could become, wrong about it.
 *
 * ## 1. The list may not outlive the setting
 *
 * The original defect, stated as a property: a non-empty exclude list with no
 * `minimumReleaseAge` beside it is a control that does nothing while looking
 * like it does something. Deleting the setting must fail here, not go unnoticed
 * for three weeks.
 *
 * ## 2. The unit is MINUTES
 *
 * pnpm computes the cutoff as `Date.now() - minimumReleaseAge * 60 * 1000`.
 * `minimumReleaseAge: 3` is therefore three MINUTES, which disables the gate
 * while looking like the owner's "three days" — the single most likely way this
 * value gets quietly broken. Anything under a day is refused.
 *
 * ## 3. No bare package names
 *
 * pnpm's exclude matcher returns `true` for a bare name and stops checking, so
 * `lodash` on that list exempts **every version of lodash for ever**.
 * `lodash@4.18.1` exempts one release and expires by itself when the tree moves
 * past it. Only the second shape is an exception; the first is a hole.
 *
 * ## 4. Entries must name versions the lockfile actually has
 *
 * Seven of the fourteen entries were fossils on 2026-09-09 — `fast-uri@3.1.6`
 * against an installed 3.1.7, `body-parser@1.20.6` against 2.3.0,
 * `recharts@3.10.0` against 3.10.1, `engine.io@6.6.7` against nothing at all.
 * Harmless individually, and collectively the reason nobody could tell which
 * exemptions were still load-bearing. A list that prunes itself stays readable.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8');

const workspace = parseYaml(read('pnpm-workspace.yaml')) as {
  minimumReleaseAge?: number;
  minimumReleaseAgeExclude?: string[];
};
const lockfile = read('pnpm-lock.yaml');

/** The owner's number, 2026-09-09: three days, expressed the way pnpm reads it. */
const THREE_DAYS_IN_MINUTES = 3 * 24 * 60;
const ONE_DAY_IN_MINUTES = 24 * 60;

/** Split `name@version` the way pnpm's own parser does — scoped names have two `@`. */
function splitEntry(entry: string): { name: string; version: string | null } {
  const at = entry.startsWith('@') ? entry.indexOf('@', 1) : entry.indexOf('@');
  if (at === -1) return { name: entry, version: null };
  return { name: entry.slice(0, at), version: entry.slice(at + 1) };
}

describe('the release-age gate, and the list that outlived it', () => {
  it('is switched on at all — the list may not exist without the setting', () => {
    const excludes = workspace.minimumReleaseAgeExclude ?? [];
    if (excludes.length > 0) {
      expect(
        workspace.minimumReleaseAge,
        'minimumReleaseAgeExclude has entries but minimumReleaseAge is not set, so every one ' +
          'of them is inert — the exact state this repository sat in from 2026-08-18 to ' +
          '2026-09-09. Set the age, or delete the list.',
      ).toBeTypeOf('number');
    }
    expect(workspace.minimumReleaseAge).toBe(THREE_DAYS_IN_MINUTES);
  });

  it('is expressed in MINUTES, so a plausible-looking number cannot disable it', () => {
    // pnpm: `new Date(Date.now() - minimumReleaseAge * 60 * 1000)`. A value of 3
    // means three minutes, which is indistinguishable from off and reads like
    // the decision it is meant to encode.
    const age = workspace.minimumReleaseAge!;
    expect(
      age,
      `minimumReleaseAge is ${age} minutes — under a day. If this was meant to be a number of ` +
        'DAYS, multiply by 1440: pnpm reads this value in minutes.',
    ).toBeGreaterThanOrEqual(ONE_DAY_IN_MINUTES);
    expect(age % ONE_DAY_IN_MINUTES, 'keep it a whole number of days, for readability').toBe(0);
  });

  it('exempts single releases, never whole packages', () => {
    for (const entry of workspace.minimumReleaseAgeExclude ?? []) {
      const { name, version } = splitEntry(entry);
      expect(
        version,
        `"${entry}" has no version. pnpm treats a bare name as "exempt this package for ever, ` +
          `every version" — write ${name}@<the one version you are taking> instead.`,
      ).toBeTruthy();
      expect(version, `"${entry}" is not an exact version`).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('names only versions the lockfile actually installs, so the list cannot fossilise', () => {
    const stale = (workspace.minimumReleaseAgeExclude ?? []).filter((entry) => {
      const { name, version } = splitEntry(entry);
      return !new RegExp(`^  ${escapeForRegExp(`${name}@${version}`)}[:(]`, 'm').test(lockfile);
    });
    expect(
      stale,
      `these exemptions name versions that are not in pnpm-lock.yaml, so they exempt nothing ` +
        `and only obscure the entries that do: ${stale.join(', ')}. Delete them — a versioned ` +
        'entry is meant to expire when the tree moves past it.',
    ).toEqual([]);
  });

  it('and the workspace file explains the unit, because the error message will not', () => {
    // pnpm's violation names the package and the cutoff date; nothing in it says
    // where the number lives or what it is measured in. This file is where the
    // person who hits it will land.
    const raw = read('pnpm-workspace.yaml');
    expect(raw).toMatch(/UNIT IS MINUTES/i);
    expect(raw).toContain('4320');
  });
});

/** Escape a package spec for use inside a RegExp (versions carry dots and plus signs). */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
