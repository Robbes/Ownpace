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

/** One advisory the owner accepted while no release fixes it. */
export interface AcceptedAdvisory {
  /** The GHSA id, as `pnpm audit` gives it in `github_advisory_id`. */
  id: string;
  /** The one package it is accepted on. */
  module: string;
  /** The severity it was accepted at; a higher one ends the acceptance. */
  severity: string;
  /** `YYYY-MM-DD`, UTC. */
  accepted: string;
  /** The last day it holds, `YYYY-MM-DD`, UTC: a month after `accepted` at most. */
  until: string;
  /** The owner's words that accepted it. */
  words: string;
}

/** The accepted advisories, each for a month at most. */
export declare const ACCEPTED: readonly AcceptedAdvisory[];

export interface AdvisoryRow {
  /** The GHSA id, or '' when the report gives none. */
  id: string;
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

/** Whether "fixed in" names a version: not empty, and not `<0.0.0`. */
export declare function hasFix(patched: unknown): boolean;

/** `YYYY-MM-DD` in UTC. */
export declare function utcDay(now?: Date): string;

/**
 * The entry that names this row, whether it still holds on `today`, and if it
 * no longer does, why. `entry` is null when no entry names the row.
 */
export declare function acceptance(
  row: AdvisoryRow,
  accepted?: readonly AcceptedAdvisory[],
  today?: string,
): { entry: AcceptedAdvisory | null; holds: boolean; lapsed: string };

/** The entries no row in this report matches. */
export declare function staleEntries(
  rows: AdvisoryRow[],
  accepted?: readonly AcceptedAdvisory[],
): AcceptedAdvisory[];

/**
 * True when a row at or above `failAt` exists that no entry in `accepted`
 * still holds for. `never` is always false.
 *
 * Throws on any other unrecognised name: a typo that matched nothing would
 * silently turn this gate into a no-op.
 */
export declare function shouldFail(
  rows: AdvisoryRow[],
  failAt?: string,
  accepted?: readonly AcceptedAdvisory[],
  today?: string,
): boolean;

/** The job-summary table, and what `accepted` says about the rows it names. */
export declare function renderSummary(
  rows: AdvisoryRow[],
  accepted?: readonly AcceptedAdvisory[],
  today?: string,
): string;

/**
 * `::error::` at high and above, `::warning::` below it and for a row an
 * accepted entry still holds for.
 */
export declare function annotations(
  rows: AdvisoryRow[],
  accepted?: readonly AcceptedAdvisory[],
  today?: string,
): string[];
