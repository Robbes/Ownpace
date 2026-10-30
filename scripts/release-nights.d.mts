// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the nights a release tag waits for (workplan 0141 T14), so its
 * guard can run the rule on recorded runs. `.mjs` beside this because it
 * runs in a release job before anything is installed.
 */

import type { Client, Line } from './release-github.mjs';

/** A workflow run, as `release-github.mjs` keeps it. */
export interface Run {
  id: number;
  run_number: number;
  event: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
  head_sha: string;
  head_branch: string | null;
  path?: string;
  created_at: string;
  run_started_at?: string;
  updated_at?: string;
}

export declare const NIGHTS: number;
export declare const APPLIANCE_RUNS: number;
export declare const MAX_GAP_HOURS: number;
export declare const COUNTED: {
  managed: { workflow: string; name: string };
  appliance: { workflow: string; name: string };
};

export interface NightsInput {
  managedRuns: Run[];
  applianceRuns: Run[];
  /** A run's id to its earlier attempts. */
  attempts?: Record<string, Run[]>;
  commit: string;
  /** When the commit reached main. */
  mergedAt: string | null;
  now?: string | Date;
}

export interface NightsVerdict {
  /** `waived` only from `waiveNights`, when the nights did not hold and the owner waived them. */
  verdict: 'pass' | 'refuse' | 'waived';
  lines: Line[];
  managed: Run[];
  appliance: Run[];
  /** The counted runs, as the tag message names them; empty when the nights were waived. */
  proof: string;
  /** Set by `waiveNights`: whether the waiver was used. */
  waived?: boolean;
}

/** The owner's waiver of the nights: the reason in their words, and the run's actor. */
export interface Waiver {
  reason: string;
  actor: string;
}

export declare const WAIVER_MAX: number;
export declare const WAIVER_MODES: string[];
export declare function waiverProblems(text: string): string[];
export declare function waivedBy(waiver: Waiver): string;
export declare function readWaiver(options: { text: string | undefined | null; mode: string | undefined; actor: string | undefined }): {
  waiver: Waiver | null;
  lines: Line[];
};
export declare function waiveNights<T extends Pick<NightsVerdict, 'verdict' | 'lines' | 'proof'>>(
  nights: T,
  waiver: Waiver | null,
): T & { verdict: 'pass' | 'refuse' | 'waived'; waived?: boolean };

export declare function pickCommit(managedRuns: Run[], now?: string | Date): string | null;
export declare function countNights(input: NightsInput): NightsVerdict;
export declare function mergedAtOf(client: Client, commit: string): Promise<string | null>;
export declare function readNights(
  client: Client,
  options?: { commit?: string | null; now?: Date },
): Promise<NightsVerdict & { commit: string | null }>;
