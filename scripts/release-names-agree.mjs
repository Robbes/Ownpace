#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TAG, THE VERSION AND THE CHANGELOG NAME ONE RELEASE (workplan 0146 T2).
 *
 * A release is named three times: the tag the publishing workflows read, the
 * root `package.json`'s `version` that `/version` and the build stamp answer,
 * and the `CHANGELOG.md` heading the release body links to.
 * `docs/release.md` asks for all three to be set before the tag, and until
 * this script nothing checked that they had been. This refuses when:
 *
 * - the tag is not `v` followed by the root `package.json`'s version;
 * - `CHANGELOG.md` has no `## [<version>] - <YYYY-MM-DD>` heading for it;
 * - SemVer orders the tag at or below a release tag that already exists. That
 *   is how `v0.1.0-alpha.1` would go wrong: `alpha` sorts before `rc`, so it
 *   is older than `v0.1.0-rc.1` to anything that compares versions.
 *
 * It says every disagreement it finds, not only the first.
 *
 * Usage, from any directory (it finds the repository by its own location):
 *
 *   node scripts/release-names-agree.mjs [<tag>]
 *
 * The tag is the argument, or else `GITHUB_REF_NAME`, which a workflow run on
 * a tag sets to the tag's name. The existing tags come from
 * `git tag --list 'v*'`, so fetch them first (`git fetch origin --tags`, or
 * in a shallow checkout
 * `git fetch --depth=1 origin '+refs/tags/v*:refs/tags/v*'`): a checkout
 * that holds only the tag being cut has nothing to compare it with. Exit 0
 * when the names agree, 1 when they do not or when the check cannot run.
 *
 * A re-run of an older tag's workflows, once a newer release is tagged, is
 * refused too: the check cannot tell a re-run from a new tag.
 *
 * It runs as the first step after the checkout of each job that publishes on
 * a tag (`images.yml`, `security-scan.yml`, `windows-payload.yml`), before any
 * install, so it imports only Node's own modules and SemVer's order is written
 * out below rather than taken from a package. The workflows and this script are
 * held together by `scripts/a-release-that-names-itself.unit.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// SemVer 2.0.0 (https://semver.org), the grammar and section 11's precedence
// ---------------------------------------------------------------------------

const NUMERIC = '0|[1-9]\\d*';
const PRERELEASE_ID = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const BUILD_ID = '[0-9a-zA-Z-]+';
/** semver.org's own regular expression, in parts. */
const SEMVER = new RegExp(
  `^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})` +
    `(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?` +
    `(?:\\+(${BUILD_ID}(?:\\.${BUILD_ID})*))?$`,
);

/**
 * A SemVer version's parts, or null when the text is not one. The numbers stay
 * strings: SemVer sets no limit on them, and a JavaScript number is exact only
 * to 2^53.
 */
export function parseSemVer(text) {
  const m = typeof text === 'string' ? SEMVER.exec(text) : null;
  if (!m) return null;
  return {
    major: m[1],
    minor: m[2],
    patch: m[3],
    prerelease: m[4] === undefined ? [] : m[4].split('.'),
    build: m[5] === undefined ? [] : m[5].split('.'),
  };
}

/** Two digit strings without leading zeros, compared as numbers. */
function compareDigits(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * -1, 0 or 1 as SemVer orders `a` before, with, or after `b` (semver.org,
 * section 11). Major, minor and patch compare as numbers. A version with a
 * pre-release comes before the same version without one. Pre-release
 * identifiers compare left to right: numbers as numbers, others in ASCII
 * order, a number before any other identifier, and a longer list after a
 * shorter one it starts with. Build metadata does not count.
 *
 * Throws on text that is not a SemVer version: an order it made up would be
 * worse than none.
 */
export function compareSemVer(a, b) {
  const x = parseSemVer(a);
  const y = parseSemVer(b);
  for (const [text, parsed] of [
    [a, x],
    [b, y],
  ]) {
    if (!parsed) throw new Error(`${JSON.stringify(text)} is not a SemVer version`);
  }
  for (const part of ['major', 'minor', 'patch']) {
    const c = compareDigits(x[part], y[part]);
    if (c !== 0) return c;
  }
  const p = x.prerelease;
  const q = y.prerelease;
  if (p.length === 0 || q.length === 0) {
    if (p.length === q.length) return 0;
    return p.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(p.length, q.length); i += 1) {
    const numP = /^\d+$/.test(p[i]);
    const numQ = /^\d+$/.test(q[i]);
    let c;
    if (numP && numQ) c = compareDigits(p[i], q[i]);
    else if (numP) c = -1;
    else if (numQ) c = 1;
    else c = p[i] === q[i] ? 0 : p[i] < q[i] ? -1 : 1;
    if (c !== 0) return c;
  }
  return p.length === q.length ? 0 : p.length < q.length ? -1 : 1;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `YYYY-MM-DD` is a day the calendar has. */
function isCalendarDate(text) {
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/**
 * Why the changelog has no section for `version`, or null when it has one: a
 * level-two heading `## [<version>] - <YYYY-MM-DD>`, as Keep a Changelog
 * writes it and as `[0.1.0-rc.1] - 2026-08-04` already is.
 */
function changelogProblem(changelog, version) {
  const wanted = `## [${version}] - <YYYY-MM-DD>`;
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](.*)$`, 'm').exec(changelog);
  if (!heading) {
    return (
      `CHANGELOG.md has no section for ${version}: it needs a heading "${wanted}". ` +
      'docs/release.md renames [Unreleased] to it before the tag.'
    );
  }
  const dated = /^ - (\d{4}-\d{2}-\d{2})\s*$/.exec(heading[1]);
  if (!dated) {
    return `CHANGELOG.md's heading for ${version} has no date: write it "${wanted}".`;
  }
  if (!isCalendarDate(dated[1])) {
    return `CHANGELOG.md's heading for ${version} is dated ${dated[1]}, which is not a day in the calendar.`;
  }
  return null;
}

/**
 * Why SemVer orders `version` at or below `other`, as one sentence: the rule
 * of section 11 that decided it, read from the first part that differs, with
 * the parts it compared. It follows `compareSemVer`'s own steps, so the reason
 * given is the one that applied. Called only when `version` is not above
 * `other`.
 */
function whyBelow(version, other) {
  if (compareSemVer(version, other) === 0) {
    return ` They have equal precedence (build metadata is ignored), so ${version} would not come after ${other}.`;
  }
  const a = parseSemVer(version);
  const b = parseSemVer(other);
  // No leading zeros, so digit strings that differ are numbers that differ.
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return ` The ${part} version decides: ${a[part]} is lower than ${b[part]}.`;
  }
  const core = `${a.major}.${a.minor}.${a.patch}`;
  if (b.prerelease.length === 0) return ` A pre-release sorts before the release of the same version, ${core}.`;
  const p = a.prerelease;
  const q = b.prerelease;
  const i = p.findIndex((id, k) => k < q.length && id !== q[k]);
  if (i === -1) {
    // Below and not equal, with no identifier differing: `p` is the shorter.
    return (
      ` Both are pre-releases of ${core}, and ${q.join('.')} starts with ${p.join('.')}: ` +
      'when one list of identifiers starts with the other, fewer identifiers sort first.'
    );
  }
  const lead = ` Both are pre-releases of ${core}, and the first identifier after the hyphen that differs decides`;
  const numP = /^\d+$/.test(p[i]);
  const numQ = /^\d+$/.test(q[i]);
  if (numP && numQ) return `${lead}: ${p[i]} is lower than ${q[i]}.`;
  if (numP) return `${lead}: ${p[i]} against "${q[i]}", and a number sorts before a word.`;
  // Both words (a word against a number would sort above, not below).
  return `${lead}: words compare in ASCII order, and "${p[i]}" sorts before "${q[i]}".`;
}

/**
 * Every way a tag, the root version and the changelog disagree, one sentence
 * each, and the existing `v*` tags that are not SemVer versions and so could
 * not be ordered. No refusals means they name one release, newer than every
 * release already tagged.
 *
 * `existingTags` is `git tag --list 'v*'`. The tag being checked may be among
 * them (on its own run the checkout has fetched it) and is not compared with
 * itself.
 */
export function checkReleaseNames({ tag, version, changelog, existingTags = [] }) {
  const refusals = [];
  const ignoredTags = [];

  const tagVersion = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : null;
  const tagIsSemVer = tagVersion !== null && parseSemVer(tagVersion) !== null;
  if (!tagIsSemVer) {
    refusals.push(
      `The tag ${JSON.stringify(tag)} is not a release name: a release tag is "v" followed by a SemVer ` +
        'version, such as v0.2.0-alpha.1.',
    );
  } else if (tagVersion !== version) {
    refusals.push(
      `The tag is ${tag}, and the root package.json's version is ${version}. They must name the same ` +
        `release: set package.json's version to ${tagVersion} and tag the commit that carries it ` +
        '(docs/release.md, before the tag).',
    );
  }

  // The tag's own version when it is one, so the section looked for is the
  // release being published; package.json's when the tag is not a version.
  const sectionFor = tagIsSemVer ? tagVersion : version;
  const section = changelogProblem(changelog, sectionFor);
  if (section) refusals.push(section);

  if (tagIsSemVer) {
    const notNewer = [];
    for (const raw of existingTags) {
      const existing = raw.trim();
      if (existing === '' || existing === tag) continue;
      if (!existing.startsWith('v') || parseSemVer(existing.slice(1)) === null) {
        ignoredTags.push(existing);
        continue;
      }
      if (compareSemVer(tagVersion, existing.slice(1)) <= 0) notNewer.push(existing);
    }
    if (notNewer.length > 0) {
      notNewer.sort((a, b) => compareSemVer(b.slice(1), a.slice(1)));
      refusals.push(
        `SemVer orders ${tag} at or below ${notNewer.join(', ')}, which ${
          notNewer.length === 1 ? 'is' : 'are'
        } already tagged. A release must come after every release before it: choose a version above ` +
          `${notNewer[0]}.${whyBelow(tagVersion, notNewer[0].slice(1))}`,
      );
    }
  }

  return { refusals, ignoredTags };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

function main() {
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  const error = (message) => console.log(inActions ? `::error::${message}` : `refused: ${message}`);

  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
  if (!tag) {
    error(
      'No tag to check. Name it as the argument, or run this where GITHUB_REF_NAME is set (a workflow run on a tag).',
    );
    return 1;
  }

  let version;
  let changelog;
  let listed;
  try {
    version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    listed = execFileSync('git', ['tag', '--list', 'v*'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // A check that cannot read what it compares has not passed.
    error(`The check could not read what it compares: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (typeof version !== 'string') {
    error('The root package.json has no "version".');
    return 1;
  }

  const existingTags = listed.split('\n').filter((t) => t.trim() !== '');
  const { refusals, ignoredTags } = checkReleaseNames({ tag, version, changelog, existingTags });
  if (ignoredTags.length > 0) {
    console.log(`Not ordered, since they are not "v" and a SemVer version: ${ignoredTags.join(', ')}.`);
  }
  if (refusals.length > 0) {
    for (const r of refusals) error(r);
    console.log(`${tag}: nothing is published under a tag whose names disagree.`);
    return 1;
  }
  const earlier = existingTags.map((t) => t.trim()).filter((t) => t !== tag && !ignoredTags.includes(t));
  console.log(
    `${tag}: the tag, package.json (${version}) and CHANGELOG.md's section agree` +
      (earlier.length > 0
        ? `, and it comes after every release already tagged (${earlier.join(', ')}).`
        : '. No other release is tagged, so there is nothing to come after.'),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
