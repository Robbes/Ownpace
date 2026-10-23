// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the upgrade gates the Release preflight reads, so the guard can
 * judge recorded vitest reports.
 */

import type { Line } from './release-github.mjs';

export declare const UPGRADE_GATES: Array<{ chain: 'ledger' | 'managed'; file: string; migrations: string }>;
export declare const NOT_AN_UPGRADE_PROOF: string[];

/** The parts of vitest's JSON report the verdict reads. */
export interface VitestReport {
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{ ancestorTitles: string[]; title: string; fullName: string; status: string }>;
  }>;
}

export declare function judgeUpgradeGates(options: {
  report: VitestReport | null;
  /** Repository-relative file to whether it exists at the candidate. */
  present: Record<string, boolean>;
  from: string;
  counts?: Record<string, { from: number; to: number }>;
}): Line[];

export declare function withoutTokens(env: Record<string, string | undefined>): Record<string, string | undefined>;
