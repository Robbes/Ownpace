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
/** What code scanning receives: SARIF_REPORT without the rules that never block (forCodeScanning). */
export declare const CODE_SCANNING_REPORT: string;

/** One result of a SARIF run, as far as forCodeScanning reads it. */
export interface SarifResult {
  readonly ruleId?: string;
  readonly [key: string]: unknown;
}

/** One SARIF run, as far as forCodeScanning reads it. */
export interface SarifRun {
  readonly results?: ReadonlyArray<SarifResult>;
  readonly [key: string]: unknown;
}

/** A SARIF report, as far as forCodeScanning reads it. */
export interface Sarif {
  readonly runs?: ReadonlyArray<SarifRun>;
  readonly [key: string]: unknown;
}

/** How many results code scanning receives, and how many stay in the summary only. */
export interface Uploaded {
  readonly kept: number;
  readonly dropped: number;
}

export interface Rule {
  /** The registry id, fetched as `r/<id>`. */
  readonly id: string;
  /** The outside check's finding this answers, or null. */
  readonly finding: number | null;
  /** True for the two ReDoS rules, which never block (D3). */
  readonly never: boolean;
  /**
   * True for a rule that blocks (0163 T5): a spot of it fails the job, no
   * entry excuses it, and a time-out it can have makes the scan unfinished.
   */
  readonly blocks: boolean;
  /** The languages its own `languages:` names: the files it reads, and so where it can time out. */
  readonly languages: ReadonlyArray<Language>;
  /** What it reports, in a few words. */
  readonly what: string;
}

/** The eight rules, in the summary's order. */
export declare const RULES: ReadonlyArray<Rule>;
/**
 * Semgrep's SARIF with each result of a rule that never blocks taken out,
 * every run's other fields kept, and how many results it kept and left out.
 * The report it is given is not changed.
 */
export declare function forCodeScanning(
  sarif: Sarif,
  rules?: ReadonlyArray<Rule>,
): { sarif: Sarif & { readonly runs: ReadonlyArray<SarifRun & { readonly results: ReadonlyArray<SarifResult> }> } } & Uploaded;
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

/** A place Semgrep's taint analysis timed out in, from `time.fixpoint_timeouts`. */
export interface Timeout {
  /** The file, or empty when the entry does not say. */
  readonly path: string;
  /** The function's line, 1 for the file's top level, 0 when the entry does not say. */
  readonly line: number;
  /** How many rules timed out there, or null when the entry does not say. */
  readonly rules: number | null;
  /** The first rule that timed out there, as Semgrep names it, or null. */
  readonly first: string | null;
}

/** A language a rule names, by the name Semgrep gives it. */
export type Language = 'javascript' | 'typescript' | 'yaml';

/** Each language's file extensions, as Semgrep reads them. */
export declare const EXTENSIONS: Readonly<Record<Language, ReadonlyArray<string>>>;

/** A file's language by its extension, or null. */
export declare function languageOf(path: string): Language | null;

/**
 * The rules that can have timed out at a place: the first alone when it was
 * the only one, else every rule whose languages include the file there, and
 * any rule when the file has no language or the first does not read it.
 */
export declare function timedOut(timeout: Timeout, rules?: ReadonlyArray<Rule>): Rule[];

/** One run's reading, or why there is none. */
export interface Scan {
  readonly stopped?: string;
  readonly version?: string;
  readonly scanned?: number;
  readonly findings?: ReadonlyArray<Finding>;
  readonly notes?: ReadonlyArray<Note>;
  /** The places read only in part, or null when the report has no timing section. */
  readonly timeouts?: ReadonlyArray<Timeout> | null;
  readonly ran?: ReadonlyArray<string>;
  /** CODE_SCANNING_REPORT's path when the scan finished. */
  readonly sarif?: string;
  /** What that report holds, or null when there is none. */
  readonly uploaded?: Uploaded | null;
}

/** What one run of Semgrep left in `out`. */
export declare function readScan(ran: Ran, out: string): Scan;

export interface Report {
  /** The job summary's Markdown. */
  readonly markdown: string;
  /** What the log prints, the annotations among them. */
  readonly lines: ReadonlyArray<string>;
  /** 0, or 1 when a rule that blocks found a spot or the scan did not finish, on every event. */
  readonly code: 0 | 1;
  /** CODE_SCANNING_REPORT's path when the scan finished, else empty: the file the upload sends. */
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
