// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the release-names check's pure half, so its guard can import them.
 *
 * `.mjs` because it runs as the first step of a publishing job, before any
 * install: `node scripts/release-names-agree.mjs` needs nothing but Node.
 */

/** A SemVer version's parts. The numbers stay strings, since SemVer sets no limit on them. */
export interface SemVer {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
  build: string[];
}

/** A SemVer version's parts, or null when the text is not one. */
export declare function parseSemVer(text: string): SemVer | null;

/** -1, 0 or 1 as SemVer orders `a` before, with, or after `b`. Throws on text that is not a version. */
export declare function compareSemVer(a: string, b: string): -1 | 0 | 1;

export interface ReleaseNames {
  /** The tag being published, such as `v0.2.0-alpha.1`. */
  tag: string;
  /** The root package.json's `version`. */
  version: string;
  /** CHANGELOG.md's text. */
  changelog: string;
  /** `git tag --list 'v*'`; the tag itself may be among them. */
  existingTags?: readonly string[];
}

export interface ReleaseNamesVerdict {
  /** One sentence per disagreement; empty when the names agree. */
  refusals: string[];
  /** Existing `v*` tags that are not SemVer versions, and so were not ordered. */
  ignoredTags: string[];
}

/** Every way a tag, the root version and the changelog disagree. */
export declare function checkReleaseNames(names: ReleaseNames): ReleaseNamesVerdict;
