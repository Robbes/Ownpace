// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE RELEASE AN UPGRADE STARTS FROM (workplan 0179 T5; the maintainer's D2 (a)
 * of 2026-11-27): the upgrade gate must name it the same way every night, or a
 * green night proves an upgrade from nobody knows what.
 *
 * `scripts/previous-release.mjs` reads it from the checkout and the repository
 * alone, never from a clock or a registry listing:
 *
 *  - the releases are `CHANGELOG.md`'s `## [x.y.z]` headings, newest first;
 *  - a release counts once its tag `v<x.y.z>` is published on the repository;
 *  - a release whose tag is this very commit is this build, not the one before
 *    it: the night after a release, on the tagged commit, the gate upgrades
 *    from the release before, so it never upgrades a build onto itself;
 *  - the image is named after the repository's name at that release (ADR-0040:
 *    `open-migrate-selfhost` up to 0.1.0-rc, `ownpace-selfhost` after).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previousRelease, registryFor, releasesIn, tagCommitsFrom } from './previous-release.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- something not yet released',
  '',
  '## [0.2.0-alpha.21] - 2026-11-27',
  '',
  'prose that mentions ## [0.0.1] in passing',
  '',
  '## [0.2.0-alpha.20] - 2026-11-25',
  '',
  '## [0.2.0-alpha.19] - 2026-11-21',
].join('\n');

const HEAD = 'dc1ac95aa5f9e774e2579b7b9bc8952be97d7484';
const A21 = 'c34b30f84e77f83e76553c16a982cfc0e046fd2d';
const A20 = '70582df27ee470c1b14255cdda19fc944d7d57ae';
const A19 = '0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a';

/** `git ls-remote --tags` as the repository answers it: annotated tags with their peeled line. */
const LS_REMOTE = [
  `e9aef490b31895cc927ddb5346e72af5947475f9\trefs/tags/v0.2.0-alpha.21`,
  `${A21}\trefs/tags/v0.2.0-alpha.21^{}`,
  `1ceab167808e595a3b0619c39133331e0c98dfc2\trefs/tags/v0.2.0-alpha.20`,
  `${A20}\trefs/tags/v0.2.0-alpha.20^{}`,
  `${A19}\trefs/tags/v0.2.0-alpha.19`,
].join('\n');

describe('the releases a changelog names', () => {
  it('reads the released headings newest first, and neither Unreleased nor a heading quoted in prose', () => {
    expect(releasesIn(CHANGELOG)).toEqual(['0.2.0-alpha.21', '0.2.0-alpha.20', '0.2.0-alpha.19']);
  });

  it("reads this repository's own changelog, whose newest release is a version", () => {
    const versions = releasesIn(readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'));
    expect(versions.length).toBeGreaterThan(10);
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  });
});

describe('the commit each tag names', () => {
  it('takes the peeled commit of an annotated tag, and the commit of a lightweight one', () => {
    const tags = tagCommitsFrom(LS_REMOTE);
    expect(tags.get('v0.2.0-alpha.21')).toBe(A21);
    expect(tags.get('v0.2.0-alpha.20')).toBe(A20);
    expect(tags.get('v0.2.0-alpha.19')).toBe(A19);
  });
});

describe('the release an upgrade starts from', () => {
  const tags = tagCommitsFrom(LS_REMOTE);

  it('is the newest published release, between releases', () => {
    const from = previousRelease({ versions: releasesIn(CHANGELOG), tags, head: HEAD });
    expect(from).toMatchObject({
      version: '0.2.0-alpha.21',
      tag: 'v0.2.0-alpha.21',
      commit: A21,
      image: 'ghcr.io/robbes/ownpace-selfhost:0.2.0-alpha.21',
      skipped: [],
    });
  });

  it('is the release before, on the tagged commit itself: never this build onto itself', () => {
    const from = previousRelease({ versions: releasesIn(CHANGELOG), tags, head: A21 });
    expect(from.version).toBe('0.2.0-alpha.20');
    expect(from.skipped).toEqual([{ version: '0.2.0-alpha.21', why: 'its tag is this build' }]);
  });

  it('passes over a release the changelog names before its tag is published', () => {
    const unpublished = tagCommitsFrom(LS_REMOTE.split('\n').filter((l) => !l.includes('alpha.21')).join('\n'));
    const from = previousRelease({ versions: releasesIn(CHANGELOG), tags: unpublished, head: HEAD });
    expect(from.version).toBe('0.2.0-alpha.20');
    expect(from.skipped).toEqual([{ version: '0.2.0-alpha.21', why: 'no tag published' }]);
  });

  it('refuses, naming what it passed over, when no release is left', () => {
    expect(() => previousRelease({ versions: ['0.2.0-alpha.21'], tags, head: A21 })).toThrow(
      /no published release before this build.*0\.2\.0-alpha\.21: its tag is this build/s,
    );
  });

  it('names the image after the repository name at that release (ADR-0040)', () => {
    expect(registryFor('0.1.0-rc.1')).toBe('ghcr.io/robbes/open-migrate-selfhost');
    expect(registryFor('0.1.0')).toBe('ghcr.io/robbes/ownpace-selfhost');
    expect(registryFor('0.2.0-alpha.21')).toBe('ghcr.io/robbes/ownpace-selfhost');
  });
});

describe('the command the workflow runs', () => {
  it('prints one line of JSON, reading the changelog, the tags and the head it is given', () => {
    const out = execFileSync('node', [join(REPO_ROOT, 'scripts/previous-release.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PREVIOUS_RELEASE_TAGS: LS_REMOTE, PREVIOUS_RELEASE_HEAD: HEAD },
    });
    const parsed = JSON.parse(out) as { version: string; image: string };
    expect(out.trim().split('\n')).toHaveLength(1);
    // This repository's changelog, not the fixture's: its newest release with a tag in the fixture.
    expect(parsed.image).toBe(`ghcr.io/robbes/ownpace-selfhost:${parsed.version}`);
  });
});
