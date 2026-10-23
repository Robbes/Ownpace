// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Release preflight's checks, so its guard can run each on the
 * repository's own files and recorded runs.
 */

import type { Alert, Client, Line } from './release-github.mjs';
import type { Run } from './release-nights.mjs';
import type { Decision } from './release-cut-tag.mjs';

export type { Alert, Line } from './release-github.mjs';

export declare const MODES: string[];
export declare const REQUIRED_CI_JOBS: string[];
export declare const EXPECTED_CHECKS: { full: string[]; verify: string[] };
/** The resolve step's checks: a refusal of one ends a rehearsal at the preflight. */
export declare const RESOLVE_CHECKS: string[];
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
export declare const ALERT_SEVERITIES: string[];
export declare const TOP_RULES: number;
export declare const REPOSITORY_SCAN_CATEGORY: string;
/** One tool's alerts in one analysis category, with its rules, critical first. */
export interface AlertGroup {
  tool: string;
  category: string;
  /** The image, for a `trivy-image-<name>` category of the weekly image scan; else null. */
  image: string | null;
  critical: number;
  high: number;
  rules: Array<{ id: string; severity: string; alerts: number }>;
}
export declare function readOpenAlerts(client: Pick<Client, 'get'>): Promise<Alert[]>;
export declare function alertGroups(alerts: Alert[]): AlertGroup[];
export declare function alertsNote(counts: { critical: number; high: number; groups?: number } | null, reason?: string): Line;
export declare function alertsNotes(alerts: Alert[] | null, reason?: string): Line[];
export declare function candidateEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
export declare function notChecked(): Line[];
export declare function namesStep(candidate: string, version: string, env?: Record<string, string | undefined>): Line;
export declare function verdict(options: {
  lines: Line[];
  mode: string;
  outcomes?: Record<string, string>;
  commit?: string;
}): { refused: number; exitCode: 0 | 1; summary: string; lines: Line[]; extra: Line[] };
