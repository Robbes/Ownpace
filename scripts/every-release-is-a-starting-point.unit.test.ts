// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY RELEASE IS A STARTING POINT: the upgrade gates a pull request runs started from rc.1 (the shared chain) and alpha.1 (the managed chain) alone, so three releases later no pull request proved an upgrade from the release `ownpace-live` runs (workplan 0146 T4).
 *
 * ## What there was
 *
 * §22.1 asks for upgrades "from N-1 (and at least one older) to N". Each
 * gate read one release, `UPGRADE_FROM_REF` or a default written into the
 * file: `v0.1.0-rc.1` for the shared chain, `v0.2.0-alpha.1` for the
 * managed one. Release's preflight sets `UPGRADE_FROM_REF` to the release
 * before, so N-1 was proved once, on the day of the tag, after every pull
 * request since the last tag had merged. By then live had run alpha.2 and
 * alpha.3, and an edit that broke the upgrade from alpha.3 would have been
 * found at the fold.
 *
 * ## What holds now
 *
 * `scripts/release-line.json` lists every release and, per chain, the
 * oldest one an upgrade is still proved from. Both unit gates and the
 * managed chain's Postgres leg start from that oldest one and from the
 * newest release (`packages/ledger/src/__tests__/release-line.ts`, `startingPoints`), or from
 * `UPGRADE_FROM_REF` alone when it is set. This guard holds the list to the
 * repository's tags:
 *
 * - it is in SemVer order, each entry a release name, with no repeats, and
 *   `preReleaseEndedAt` and each chain's oldest supported release are in it;
 * - under `CI` (the unit job checks out with `fetch-depth: 0`), every `v*`
 *   tag is in it, and every entry is a tag but the last, which may be the
 *   version the root `package.json` names, listed by the fold before Release
 *   tags it. So the pull request after a tag nobody listed is red, which is
 *   the moment it matters; locally a missing tag is a warning;
 * - the three gate files read their starting points from it, and say which
 *   chain they are;
 * - `startingPoints` itself, on lines made up for it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseLine, releasedOnly, rootVersion, startingPoints, type ReleaseLine } from '../packages/ledger/src/__tests__/release-line.ts';
import { compareSemVer, parseSemVer } from './release-names-agree.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

function isTagged(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', `refs/tags/${ref}^{commit}`], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function releaseTags(): string[] {
  return execFileSync('git', ['tag', '--list', 'v*'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => parseSemVer(t.slice(1)) !== null);
}

const GATES = [
  { file: 'packages/ledger/src/migrate-upgrade.unit.test.ts', chain: 'ledger' },
  { file: 'packages/managed/src/migrate-upgrade.unit.test.ts', chain: 'managed' },
  { file: 'packages/managed/src/migrate-upgrade.integration.test.ts', chain: 'managed' },
] as const;

describe('the release line is well formed', () => {
  const line = readReleaseLine(ROOT);

  it('lists releases by name, in SemVer order, once each', () => {
    expect(line.releases.length).toBeGreaterThan(0);
    for (const tag of line.releases) {
      expect(tag.startsWith('v') && parseSemVer(tag.slice(1)) !== null, `${tag} is not a release name`).toBe(true);
    }
    for (let i = 1; i < line.releases.length; i += 1) {
      expect(
        compareSemVer(line.releases[i - 1]!.slice(1), line.releases[i]!.slice(1)),
        `${line.releases[i - 1]} must come before ${line.releases[i]}, once`,
      ).toBe(-1);
    }
  });

  it('names the end of pre-release and each chain’s oldest supported release from the list', () => {
    expect(line.releases).toContain(line.preReleaseEndedAt);
    expect(Object.keys(line.oldestSupported).sort()).toEqual(['ledger', 'managed']);
    for (const tag of Object.values(line.oldestSupported)) expect(line.releases).toContain(tag);
  });
});

describe('the release line holds every release tag, and nothing that is not one', () => {
  const line = readReleaseLine(ROOT);
  const version = rootVersion(ROOT);
  const tags = releaseTags();
  const haveTags = tags.length > 0;

  it('can see the repository’s tags', () => {
    if (!haveTags && process.env.CI) {
      throw new Error('no v* tag is reachable, so the list cannot be checked. CI must check out with tags (fetch-depth: 0).');
    }
    if (!haveTags) console.warn('[every-release-is-a-starting-point] no tags locally — skipped.');
    expect(true).toBe(true);
  });

  it.skipIf(!haveTags)('lists every v* tag, the newest included', () => {
    const newest = [...tags].sort((a, b) => compareSemVer(a.slice(1), b.slice(1))).pop()!;
    expect(
      line.releases,
      `${newest} is the newest release tag and scripts/release-line.json does not list it: add it as ` +
        'the last of `releases` (the fold does, docs/release.md §1), so the upgrade gates start from it',
    ).toContain(newest);
    expect(tags.filter((t) => !line.releases.includes(t)), 'release tags scripts/release-line.json leaves out').toEqual([]);
  });

  it.skipIf(!haveTags)('lists no release that is not tagged, but the one being prepared', () => {
    const released = releasedOnly(line, { version, isTagged });
    expect(released.filter((t) => !isTagged(t)), `untagged entries (the root package.json says ${version})`).toEqual([]);
  });
});

describe('the upgrade gates read their starting points from the release line', () => {
  it.each(GATES)('$file starts from the $chain chain’s points, or UPGRADE_FROM_REF alone', ({ file, chain }) => {
    const text = read(file);
    expect(text).toMatch(/from '(?:\.\/|\.\.\/\.\.\/ledger\/src\/)__tests__\/release-line\.ts'/);
    expect(text).toMatch(new RegExp(`startingPoints\\(readReleaseLine\\(REPO_ROOT\\), '${chain}', \\{\\s*fromRef: process\\.env\\.UPGRADE_FROM_REF,`));
    expect(text, `${file} still writes a release of its own`).not.toMatch(/process\.env\.UPGRADE_FROM_REF \|\|/);
  });
});

describe('startingPoints, on lines made up for it', () => {
  const line: ReleaseLine = {
    preReleaseEndedAt: 'v0.2.0-alpha.1',
    releases: ['v0.1.0-rc.1', 'v0.2.0-alpha.1', 'v0.2.0-alpha.2', 'v0.2.0-alpha.3'],
    oldestSupported: { ledger: 'v0.1.0-rc.1', managed: 'v0.2.0-alpha.1' },
  };
  const all = (): boolean => true;

  it('starts each chain from its oldest supported release and the newest', () => {
    expect(startingPoints(line, 'ledger', { version: '0.2.0-alpha.3', isTagged: all })).toEqual(['v0.1.0-rc.1', 'v0.2.0-alpha.3']);
    expect(startingPoints(line, 'managed', { version: '0.2.0-alpha.3', isTagged: all })).toEqual(['v0.2.0-alpha.1', 'v0.2.0-alpha.3']);
  });

  it('leaves out the release being prepared until it is tagged, and takes it once it is', () => {
    const folded = { ...line, releases: [...line.releases, 'v0.2.0-alpha.4'] };
    const untagged = (t: string): boolean => t !== 'v0.2.0-alpha.4';
    expect(startingPoints(folded, 'managed', { version: '0.2.0-alpha.4', isTagged: untagged })).toEqual(['v0.2.0-alpha.1', 'v0.2.0-alpha.3']);
    expect(startingPoints(folded, 'managed', { version: '0.2.0-alpha.4', isTagged: all })).toEqual(['v0.2.0-alpha.1', 'v0.2.0-alpha.4']);
    // An untagged entry that is not the version being prepared stays in, so
    // the gate meets a ref it cannot reach and says so, rather than quietly
    // starting from an older one.
    expect(startingPoints(folded, 'managed', { version: '0.2.0-alpha.3', isTagged: untagged })).toEqual(['v0.2.0-alpha.1', 'v0.2.0-alpha.4']);
  });

  it('starts once when the oldest supported release is the newest', () => {
    const one = { ...line, releases: ['v0.2.0-alpha.1'] };
    expect(startingPoints(one, 'managed', { version: '0.2.0-alpha.1', isTagged: all })).toEqual(['v0.2.0-alpha.1']);
  });

  it('takes UPGRADE_FROM_REF alone when it is set, as the Release preflight sets it', () => {
    expect(startingPoints(line, 'ledger', { fromRef: 'v0.2.0-alpha.2', version: '0.2.0-alpha.3', isTagged: all })).toEqual(['v0.2.0-alpha.2']);
  });

  it('refuses a chain no gate proves, and a line that names no oldest release for one', () => {
    // @ts-expect-error -- a chain the type does not allow, as a caller in .mjs could pass
    expect(() => startingPoints(line, 'billing', { version: '0.2.0-alpha.3', isTagged: all })).toThrow(/no upgrade gate/);
    const partial = { ...line, oldestSupported: { ledger: 'v0.1.0-rc.1' } } as unknown as ReleaseLine;
    expect(() => startingPoints(partial, 'managed', { version: '0.2.0-alpha.3', isTagged: all })).toThrow(/oldest supported/);
  });
});
