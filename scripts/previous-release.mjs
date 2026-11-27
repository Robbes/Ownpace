#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE RELEASE AN UPGRADE STARTS FROM, named the same way every night (workplan
 * 0179 T5). The upgrade gate in `.github/workflows/e2e.yml` starts the release
 * this prints, by digest and signature, and upgrades it to the build it runs on.
 * `scripts/the-release-an-upgrade-starts-from.unit.test.ts` holds the rules:
 *
 *  - the releases are `CHANGELOG.md`'s `## [x.y.z]` headings, newest first;
 *  - a release counts once its tag `v<x.y.z>` is published on the repository
 *    (`git ls-remote --tags origin`), so a changelog folded before its tag is
 *    passed over, not guessed at;
 *  - a release whose tag is this very commit is this build: on the night after
 *    a release, on the tagged commit, the gate starts from the release before
 *    it, and never upgrades a build onto itself;
 *  - the image is named after the repository's name at that release (ADR-0040).
 *
 * Nothing here reads a clock or a registry listing: the same checkout and the
 * same tags give the same answer.
 *
 * Usage, from any directory:
 *
 *   node scripts/previous-release.mjs
 *
 * Prints one line of JSON: `{ version, tag, commit, image, skipped }`. Exit 1,
 * naming every release it passed over and why, when none is left. The tags and
 * the head can be given in PREVIOUS_RELEASE_TAGS (ls-remote's output) and
 * PREVIOUS_RELEASE_HEAD; otherwise they are asked of git, and the head is
 * GITHUB_SHA where the workflow sets it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A released heading: `## [x.y.z]` or `## [x.y.z-pre]`, at the start of a line. */
const RELEASED = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\]/gm;

/** The versions a changelog has released, newest first, as it lists them. */
export function releasesIn(changelog) {
  return [...changelog.matchAll(RELEASED)].map((m) => m[1]);
}

/**
 * Each tag's commit, from `git ls-remote --tags` output: an annotated tag's
 * peeled line (`^{}`) wins over the tag object's own.
 */
export function tagCommitsFrom(lsRemote) {
  const tags = new Map();
  const peeled = new Map();
  for (const line of lsRemote.split('\n')) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (!m) continue;
    (m[3] ? peeled : tags).set(m[2], m[1]);
  }
  for (const [tag, commit] of peeled) tags.set(tag, commit);
  return tags;
}

/** The image a release was published as: renamed after 0.1.0-rc (ADR-0040). */
export function registryFor(version) {
  return /^0\.1\.0-rc\./.test(version) ? 'ghcr.io/robbes/open-migrate-selfhost' : 'ghcr.io/robbes/ownpace-selfhost';
}

/**
 * The newest release whose tag is published and is not `head`.
 * Throws, naming what it passed over, when none is left.
 */
export function previousRelease({ versions, tags, head }) {
  const skipped = [];
  for (const version of versions) {
    const tag = `v${version}`;
    const commit = tags.get(tag);
    if (!commit) {
      skipped.push({ version, why: 'no tag published' });
      continue;
    }
    if (commit === head) {
      skipped.push({ version, why: 'its tag is this build' });
      continue;
    }
    return { version, tag, commit, image: `${registryFor(version)}:${version}`, skipped };
  }
  const passed = skipped.map((s) => `${s.version}: ${s.why}`).join('; ') || 'the changelog names none';
  throw new Error(`There is no published release before this build to upgrade from (${passed}).`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const lsRemote =
      process.env.PREVIOUS_RELEASE_TAGS ??
      execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'], { cwd: root, encoding: 'utf8' });
    const head =
      process.env.PREVIOUS_RELEASE_HEAD ??
      process.env.GITHUB_SHA ??
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const versions = releasesIn(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
    process.stdout.write(`${JSON.stringify(previousRelease({ versions, tags: tagCommitsFrom(lsRemote), head }))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
