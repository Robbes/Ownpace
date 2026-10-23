// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Release workflow's tag job, so its guard can drive it
 * against a scripted API.
 */

import type { Client, Line } from './release-github.mjs';

export type { Client } from './release-github.mjs';

export declare const RELEASE_WORKFLOW: string;
export declare const TAG_JOB: string;

/** A git ref as `GET git/ref/...` answers it. */
export interface Ref {
  ref?: string;
  object?: { type?: string; sha?: string };
}

/** An annotated tag object as `GET git/tags/{sha}` answers it. */
export interface TagObject {
  sha?: string;
  tag?: string;
  message?: string;
  object?: { type?: string; sha?: string };
}

export interface Decision {
  action: 'create' | 'reuse' | 'refuse';
  why: string;
  runId?: number;
}

export declare function releaseRunId(message: string | undefined | null): number | null;
export declare function tagMessage(options: { version: string; runUrl: string; proof: string }): string;
export declare function isReleaseRun(run: Record<string, unknown> | null | undefined, version: string): boolean;
/** A job as `GET actions/runs/{id}/jobs` answers it, as far as the tag reads it. */
export interface RunJob {
  name: string;
  status?: string;
  conclusion?: string | null;
}

export declare function madeByItsTagJob(jobs: RunJob[] | null | undefined, options: { id: number; currentRunId: number | null }): boolean;
export declare function tagDecision(options: {
  ref: Ref | null;
  tagObject: TagObject | null;
  commit: string;
  releaseRun: Record<string, unknown> | null;
  releaseJobs?: RunJob[] | null;
  currentRunId?: number | null;
  version: string;
}): Decision;
export declare function peelTag(
  client: Client,
  version: string,
  options?: { currentRunId?: number | null },
): Promise<{
  ref: Ref | null;
  tagObject: TagObject | null;
  releaseRun: Record<string, unknown> | null;
  releaseJobs: RunJob[] | null;
  currentRunId: number | null;
}>;
export declare function cutTag(
  client: Client,
  options: {
    version: string;
    commit: string;
    runId: number;
    runUrl: string;
    proof: string;
    readNights: () => Promise<{ verdict: 'pass' | 'refuse'; lines: Line[]; proof: string }>;
  },
): Promise<Line[]>;
