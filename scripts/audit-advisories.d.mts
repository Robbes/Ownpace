// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the advisory reporter's pure half, so its guard can import them.
 *
 * `.mjs` for the same reason `dav-target-probe.mjs` is: this runs inside a CI
 * step whose whole job is to still work when something else is wrong, and
 * `node scripts/audit-advisories.mjs` needs no type stripping on any Node this
 * project has used.
 */

/** Least to most severe, as npm and pnpm name them. */
export declare const SEVERITY_ORDER: readonly string[];

/** Index into SEVERITY_ORDER; -1 for an unrecognised name. */
export declare function rank(severity: unknown): number;

export interface AdvisoryRow {
  severity: string;
  module: string;
  title: string;
  url: string;
  vulnerable: string;
  patched: string;
  installed: string[];
  /** True only when EVERY path to the package is a dev path. */
  dev: boolean;
  paths: string[];
}

/** One row per advisory in `pnpm audit --json`, worst first. */
export declare function collect(report: unknown): AdvisoryRow[];

/**
 * True when a row at or above `failAt` exists. `never` is always false.
 *
 * Throws on any other unrecognised name: a typo that matched nothing would
 * silently turn this gate into a no-op.
 */
export declare function shouldFail(rows: AdvisoryRow[], failAt?: string): boolean;

/** The job-summary table. */
export declare function renderSummary(rows: AdvisoryRow[]): string;

/** `::error::` at high and above, `::warning::` below it. */
export declare function annotations(rows: AdvisoryRow[]): string[];
