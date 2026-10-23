// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Release preflight's checks, so its guard can run each on the
 * repository's own files and recorded runs.
 */

import type { Line } from './release-github.mjs';
import type { Run } from './release-nights.mjs';
import type { Decision } from './release-cut-tag.mjs';

export type { Line } from './release-github.mjs';

export declare const MODES: string[];
export declare const REQUIRED_CI_JOBS: string[];
export declare const EXPECTED_CHECKS: { full: string[]; verify: string[] };
export declare const FOLD_WINDOW: { daysBefore: number; daysAfter: number };

export declare function validateInputs(inputs: { version: string; commit: string; mode: string }): Line[];
export declare function dispatchedFromMain(options: { ref?: string; workflowRef?: string; repository?: string }): Line;
export declare function previousTag(tags: string[], version: string): string | null;
export declare function candidateOnMain(options: { commit: string; isAncestor: boolean; firstParent: boolean }): Line;
export declare function changelogFolded(changelog: string, version: string, today: string | Date): Line[];
export declare function openapiAgrees(openapi: string, version: string): Line;
export declare function ciGreen(
  run: Partial<Run> | null,
  jobs: Array<{ name: string; status?: string; conclusion: string | null }> | null,
  commit: string,
): Line;
export declare function scanGreenOnMain(run: Partial<Run> | null, commit: string): Line;
export declare function tagFree(decision: Decision): Line;
export declare function refUnambiguous(options: {
  version: string;
  commit: string;
  branch: { object?: { sha?: string } } | null;
  gate: { object?: { sha?: string } } | null;
}): Line[];
export declare function calleesDispatchable(workflows: Record<string, unknown>): Line[];
export declare function approvalNote(environment: unknown, readable?: boolean): Line;
export declare function alertsNote(counts: { critical: number; high: number } | null): Line;
export declare function candidateEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
export declare function notChecked(): Line[];
export declare function verdict(options: {
  lines: Line[];
  mode: string;
  outcomes?: Record<string, string>;
  commit?: string;
}): { refused: number; exitCode: 0 | 1; summary: string; lines: Line[]; extra: Line[] };
