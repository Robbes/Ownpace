// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the squawk report over the migrations (workplan 0165), so its
 * guard can import it.
 *
 * `.mjs` because the Migration locks workflow runs it in a CI step: `node
 * scripts/migration-locks-report.mjs` needs no type stripping.
 */

/** One squawk finding in one file. */
export interface Finding {
  readonly line: number;
  readonly column: number;
  readonly level: string;
  readonly rule: string;
  readonly message: string;
}

/** What one squawk run over one file says. */
export type Run = { readonly findings: ReadonlyArray<Finding>; readonly unread?: undefined } | { readonly unread: string; readonly findings?: undefined };

export const CHAINS: ReadonlyArray<string>;
export const SQUAWK_ARGS: ReadonlyArray<string>;
export const CANNOT_BE_MET: ReadonlyMap<string, string>;

export function parseGcc(output: string): Finding[];
export function readRun(run: { status: number | null; stdout?: string; stderr?: string; error?: Error }): Run;
export function report(input: {
  version: string;
  files: ReadonlyArray<string>;
  changed: ReadonlySet<string>;
  results: ReadonlyMap<string, Run>;
}): { markdown: string; annotations: string[]; warnings: string[] };
export function migrationFiles(root: string): string[];
