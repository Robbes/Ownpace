// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the gitleaks report, so its guard can import it.
 *
 * `.mjs` because ci.yml's `gitleaks` job runs it on a bare checkout, with no
 * `node_modules`: `node scripts/gitleaks-report.mjs` needs no type stripping.
 */

/** `.gitleaks.toml`, at the repository's root. */
export declare const CONFIG: string;
/** `.gitleaksignore`, which gitleaks reads by itself and D4 does not allow. */
export declare const IGNORE_FILE: string;
/** The exit code gitleaks is told to give for a finding. */
export declare const LEAK_EXIT: number;
/** The report's file name. */
export declare const REPORT: string;
/** A full commit id. */
export declare const SHA: RegExp;
/** gitleaks' own closing lines, which carry no value. */
export declare const SAID: RegExp;

/** The `gitleaks` arguments that read `<base>..<head>`. */
export declare function scanArgs(at: { base: string; head: string; report: string }): string[];

/** One finding, as much of it as may reach the log. */
export interface Finding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly commit: string;
}

/** What the report holds, or why it cannot be read. */
export declare function readReport(path: string): { findings?: ReadonlyArray<Finding>; error?: string };

/** gitleaks' closing lines out of its log. */
export declare function saidOf(stderr: string | undefined): string[];

export interface Report {
  /** The job summary's Markdown. */
  readonly markdown: string;
  /** What the log prints, an error annotation per finding among them. */
  readonly lines: ReadonlyArray<string>;
  /** 0 when the scan finished and found nothing, else 1. */
  readonly code: 0 | 1;
}

export declare function report(input: {
  base?: string;
  head?: string;
  commits?: number;
  stopped?: string | null;
  status?: number | null;
  read?: { findings?: ReadonlyArray<Finding>; error?: string } | null;
  said?: ReadonlyArray<string>;
}): Report;

/** What one command did, as `spawnSync` reports it. */
export interface Ran {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error & { code?: string };
}

/** One run, with `git` and `gitleaks` the guard's to stub. */
export declare function run(options?: {
  root?: string;
  argv?: ReadonlyArray<string>;
  env?: Readonly<Record<string, string | undefined>>;
  git?: (args: string[], root: string) => Ran;
  gitleaks?: (binary: string, args: string[], root: string) => Ran;
  out?: string;
}): Report;
