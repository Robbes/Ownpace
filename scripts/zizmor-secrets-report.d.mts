// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the report of zizmor's `secrets-outside-env`, so its guard can
 * import it.
 *
 * `.mjs` because zizmor.yml runs it in a CI step: `node
 * scripts/zizmor-secrets-report.mjs` needs no type stripping.
 */

/** One secret read in a job that names no GitHub environment, where the finding's primary location puts it. */
export interface Secret {
  /** The workflow, as the tree names it. */
  readonly file: string;
  /** Counted from 1. */
  readonly line: number;
  readonly job: string;
  /** What the job reads, as the workflow writes it: `secrets.NAME`. */
  readonly reads: string;
}

/** What a run means: how many findings it read, the secrets among them, and why the run cannot be trusted, if it cannot. */
export interface Verdict {
  readonly total: number;
  readonly secrets: ReadonlyArray<Secret>;
  readonly problems: ReadonlyArray<string>;
}

export type Severity = 'Informational' | 'Low' | 'Medium' | 'High';

/** The audit the report reads, and the only one it lists. */
export declare const AUDIT: string;
/** What zizmor's exit codes say. */
export declare const EXIT_MEANINGS: Readonly<Record<number, string>>;
/** The exit zizmor gives when this is the highest severity among its findings. */
export declare const SEVERITY_EXIT: Readonly<Record<Severity, number>>;

export declare function meaning(code: number): string;
export declare function versionOf(image: unknown): string;
/** The report read: every finding counted, the highest severity, and each secret read outside an environment. Throws for a report not in zizmor's shape. */
export declare function collect(report: unknown): { total: number; highest: Severity | undefined; secrets: Secret[] };
/** The run judged from zizmor's exit code and its report. */
export declare function judge(exitCode: number, report: unknown): Verdict;
export declare function renderSummary(verdict: { version: string; total: number; secrets: ReadonlyArray<Secret> }): string;
export declare function annotations(secrets: ReadonlyArray<Secret>): string[];
