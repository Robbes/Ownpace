// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the release an upgrade starts from, so its guard can import it
 * (`scripts/the-release-an-upgrade-starts-from.unit.test.ts`).
 */

export interface Skipped {
  readonly version: string;
  readonly why: 'no tag published' | 'its tag is this build';
}

export interface PreviousRelease {
  readonly version: string;
  readonly tag: string;
  readonly commit: string;
  readonly image: string;
  readonly skipped: readonly Skipped[];
}

/** The versions a changelog has released, newest first. */
export declare function releasesIn(changelog: string): string[];

/** Each tag's commit, from `git ls-remote --tags` output, peeled where annotated. */
export declare function tagCommitsFrom(lsRemote: string): Map<string, string>;

/** The image a release was published as (ADR-0040). */
export declare function registryFor(version: string): string;

/** The newest release whose tag is published and is not `head`; throws when none is left. */
export declare function previousRelease(input: {
  readonly versions: readonly string[];
  readonly tags: ReadonlyMap<string, string>;
  readonly head: string;
}): PreviousRelease;
