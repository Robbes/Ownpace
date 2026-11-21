// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the osv-scanner report, so its guard can import it.
 *
 * `.mjs` because the Security Scan runs it in a CI step: `node
 * scripts/osv-report.mjs` needs no type stripping.
 */

/** One advisory on one package, as the report names it. */
export interface Finding {
  readonly name: string;
  readonly version: string;
  readonly id: string;
  readonly aliases: ReadonlyArray<string>;
  readonly summary: string;
  /** An OSV malicious-package record: its id or an alias starts with `MAL-`. */
  readonly malicious: boolean;
  readonly source: string;
}

/** What a run means: what was read, what was found, and why the scan cannot be trusted, if it cannot. */
export interface Verdict {
  readonly packagesRead: number | undefined;
  readonly findings: ReadonlyArray<Finding>;
  readonly malicious: ReadonlyArray<Finding>;
  readonly problems: ReadonlyArray<string>;
}

/** The one lockfile in the tree, and the only source the report reads. */
export declare const LOCKFILE: string;
/** Fewer packages than this read from the lockfile is a scan that did not read it. */
export declare const MIN_PACKAGES: number;
/** What osv-scanner's exit codes say. */
export declare const EXIT_MEANINGS: Readonly<Record<number, string>>;

export declare function meaning(code: number): string;
export declare function isMalicious(vulnerability: { id?: unknown; aliases?: ReadonlyArray<unknown> }): boolean;
/** The report read: packages read from the lockfile, and every advisory. Throws for a report not in osv-scanner's shape. */
export declare function collect(report: unknown): { packagesRead: number | undefined; findings: Finding[] };
/** The run judged from osv-scanner's exit code and its report. */
export declare function judge(exitCode: number, report: unknown): Verdict;
export declare function renderSummary(verdict: Pick<Verdict, 'packagesRead' | 'findings' | 'malicious'>): string;
export declare function annotations(findings: ReadonlyArray<Finding>): string[];
