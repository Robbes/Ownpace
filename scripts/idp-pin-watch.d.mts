// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the identity provider's pin watch, so its guard can run it with a
 * stubbed tag list and a fake `gh`.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: the watch
 * runs in a CI step on a bare checkout and needs no type stripping.
 */

export declare const COMPOSE: string;
export declare const UPSTREAM: string;
export declare const ISSUE_TITLE: string;
export declare const WINDOW_DAYS: number;

export interface PinResult {
  pin: string;
  newest: string;
  state: 'current' | 'behind' | 'ahead';
}

export declare function compareTags(a: string, b: string): number;
export declare function readPin(compose: string): string;
export declare function newestRelease(major: number, lsRemote: string): string;
export declare function comparePin(pin: string, lsRemote: string): PinResult;
export declare function issueBody(result: Pick<PinResult, 'pin' | 'newest'>): string;
export declare function keepIssue(
  result: PinResult,
  gh: (args: string[]) => string,
): 'opened' | 'updated' | 'unchanged' | 'closed' | 'untouched';
