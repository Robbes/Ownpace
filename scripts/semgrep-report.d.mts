// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Semgrep report, so its guard can import it.
 *
 * `.mjs` because `semgrep.yml` runs it on a bare checkout, with no
 * `node_modules`: `node scripts/semgrep-report.mjs` needs no type stripping.
 */

/** Semgrep's own image by a release tag and its index digest; the tag is the first group. */
export declare const IMAGE: RegExp;
/** The seconds between the pull's attempts. */
export declare const PULL_DELAYS: ReadonlyArray<number>;
/** The image's own `semgrep` user, by number. */
export declare const SEMGREP_USER: string;
/** The fewest files a finished scan reads. */
export declare const MIN_FILES: number;
/** The two reports' file names. */
export declare const JSON_REPORT: string;
export declare const SARIF_REPORT: string;

export interface Rule {
  /** The registry id, fetched as `r/<id>`. */
  readonly id: string;
  /** The outside check's finding this answers, or null. */
  readonly finding: number | null;
  /** True for the two ReDoS rules, which never block (D3). */
  readonly never: boolean;
  /** What it reports, in a few words. */
  readonly what: string;
}

/** The eight rules, in the summary's order. */
export declare const RULES: ReadonlyArray<Rule>;
/** A rule's own name: the last part of its id. */
export declare function nameOf(id: string): string;
/** Which named rule an id Semgrep reports is, or null. */
export declare function ruleOf(reported: string, rules?: ReadonlyArray<Rule>): Rule | null;
/** What workplan 0163 read and left, by rule name and file, with why. */
export declare const KNOWN_FINDINGS: Readonly<Record<string, Readonly<Record<string, string>>>>;
/** A test file, by its path. */
export declare const TEST_FILE: RegExp;
/** What Semgrep's exit codes say. */
export declare const EXIT_MEANINGS: Readonly<Record<number, string>>;

/** Why a spot of `rule` in `file` stands, or null. */
export declare function knownAs(rule: string, file: string, known?: Readonly<Record<string, Readonly<Record<string, string>>>>): string | null;

/** The `docker run` that scans the checkout. */
export declare function scanArgs(image: string, at: { root: string; out: string }, rules?: ReadonlyArray<Rule>): string[];

/** What one `docker` command did, as `spawnSync` reports it. */
export interface Ran {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error & { code?: string };
  readonly signal?: string | null;
}

export type Docker = (args: string[]) => Ran;

export interface Finding {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

export interface Note {
  readonly level: string;
  readonly type: string;
  readonly path: string;
  readonly message: string;
}

/** One run's reading, or why there is none. */
export interface Scan {
  readonly stopped?: string;
  readonly version?: string;
  readonly scanned?: number;
  readonly findings?: ReadonlyArray<Finding>;
  readonly notes?: ReadonlyArray<Note>;
  readonly ran?: ReadonlyArray<string>;
  readonly sarif?: string;
}

/** What one run of Semgrep left in `out`. */
export declare function readScan(ran: Ran, out: string): Scan;

export interface Report {
  /** The job summary's Markdown. */
  readonly markdown: string;
  /** What the log prints, the annotations among them. */
  readonly lines: ReadonlyArray<string>;
  /** 0, or 1 outside a pull request when the scan did not finish. */
  readonly code: 0 | 1;
  /** The SARIF report's path when the scan finished, else empty. */
  readonly sarif: string;
}

export declare function report(
  input: Scan & {
    image: string;
    event: string;
    rules?: ReadonlyArray<Rule>;
    known?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  },
): Report;

/** One run, with `docker` and `wait` the guard's to stub. */
export declare function run(options?: {
  root?: string;
  env?: Readonly<Record<string, string | undefined>>;
  docker?: Docker;
  wait?: (ms: number) => Promise<unknown>;
  out?: string;
}): Promise<Report>;
