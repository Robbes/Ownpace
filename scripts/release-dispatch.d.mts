// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Release workflow's dispatches, so its guard can drive them
 * against a scripted API.
 */

import type { Client, Line } from './release-github.mjs';
import type { Run } from './release-nights.mjs';

export type { Client, Line } from './release-github.mjs';
export type { Run } from './release-nights.mjs';

export declare const GATE_PREFIX: string;
export declare const REHEARSAL_PREFIX: string;
export declare const NAMES_STEP: string;

export declare function gateBranch(version: string): string;
export declare function assertNotARelease(name: string): void;
export declare function rehearsalTagName(runNumber: number | string): string;

export declare function chooseRun(runs: Run[], sha: string): { action: 'reuse' | 'wait' | 'rerun' | 'dispatch'; run?: Run };
export declare function judgeRun(run: Run | null, want: { sha: string; workflow: string; ref: string; check?: string }): Line;

type Sleep = (ms: number) => Promise<unknown>;

export declare function findRun(client: Client, options: { workflow: string; ref: string; sha: string; since?: string }): Promise<Run | null>;
export declare function dispatchRun(
  client: Client,
  options: {
    workflow: string;
    ref: string;
    sha: string;
    inputs?: Record<string, string>;
    since: string;
    sleep?: Sleep;
    searchTries?: number;
    searchMs?: number;
  },
): Promise<number>;
export declare function waitForRun(
  client: Client,
  options: { id: number; minAttempt?: number; sleep?: Sleep; pollMs?: number; timeoutMs?: number },
): Promise<Run>;
export declare function publish(
  client: Client,
  options: {
    workflow: string;
    ref: string;
    sha: string;
    inputs?: Record<string, string>;
    sleep?: Sleep;
    pollMs?: number;
    timeoutMs?: number;
    now?: () => Date;
  },
): Promise<Line[]>;
export declare function openGate(client: Client, options: { version: string; sha: string }): Promise<Line>;
export declare function closeGate(client: Client, options: { version: string; sha: string }): Promise<Line>;
export declare function gateScan(
  client: Client,
  options: { version: string; sha: string; sleep?: Sleep; pollMs?: number; now?: () => Date },
): Promise<{ lines: Line[]; id: number | null }>;

/** A job and its steps, as `release-github.mjs` keeps them. */
export interface Job {
  name: string;
  status: string;
  conclusion: string | null;
  steps?: Array<{ number: number; name: string; status: string; conclusion: string | null }>;
}

export declare function judgeRehearsal(options: { run: Run | null; jobs: Job[]; release: unknown; tag: string }): Line[];
export declare function rehearseTag(
  client: Client,
  options: { version: string; sha: string; runNumber: number | string; url: string; sleep?: Sleep; pollMs?: number; now?: () => Date },
): Promise<Line[]>;
export declare function dropRehearsalTag(client: Client, options: { runNumber: number | string; sha: string }): Promise<Line>;
