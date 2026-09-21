// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the commit-subject gate's pure half, so its guard can import them.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: the script
 * runs inside a CI step and needs no type stripping on any Node this project
 * has used.
 */

/** A commit as the gate judges it: the parent count decides merge-ness. */
export interface CommitSubject {
  readonly sha: string;
  /** 2 or more means a merge, and a merge is never judged. */
  readonly parents?: number;
  readonly subject: string;
}

export type Verdict =
  | { readonly ok: true; readonly exempt?: string }
  | { readonly ok: false; readonly reason: string };

/** Every type a subject may carry. A superset of CONTRIBUTING.md's list. */
export declare const TYPES: readonly string[];

/** Why this commit is not judged, or `null` when it is. */
export declare function exemption(commit: CommitSubject): string | null;

/** Whether this subject follows the convention, and if not, what is wrong. */
export declare function judge(commit: CommitSubject): Verdict;

/** Every commit in `base..head`, newest first. Shells out to `git log`. */
export declare function commitsIn(base: string, head: string): CommitSubject[];

/** The printed lines, and the commits that failed, as data. */
export declare function report(commits: readonly CommitSubject[]): {
  readonly lines: string[];
  readonly bad: ReadonlyArray<CommitSubject & { readonly reason: string }>;
};
