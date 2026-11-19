// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the hadolint report, so its guard can import it.
 *
 * `.mjs` because `hadolint.yml` runs it on a bare checkout, with no
 * `node_modules`: `node scripts/hadolint-report.mjs` needs no type stripping.
 */

/** The six rules `a-dockerfile-that-ends-as-root` holds, by its names for them. */
export type Rule = 'non-root' | 'numeric-user' | 'exec-form' | 'pipefail' | 'no-add' | 'tagged';

/** `.hadolint.yaml`, at the repository's root. */
export declare const CONFIG: string;
/** What that config ignores, and nothing else: DL3008 and DL3018. */
export declare const IGNORED: ReadonlyArray<string>;
/** hadolint's own image by a release tag and its index digest. */
export declare const IMAGE: RegExp;
/** A Dockerfile by its path as git lists it. */
export declare const DOCKERFILE: RegExp;
/** The seconds between the pull's attempts. */
export declare const PULL_DELAYS: ReadonlyArray<number>;

/** Every Dockerfile git lists under `root`, tracked or new, that is on disk, sorted. */
export declare function dockerfiles(root?: string): string[];

/** hadolint's codes for each rule the guard holds. */
export declare const RULE_CODES: Readonly<Record<Rule, ReadonlyArray<string>>>;
/** The files that keep a rule of the guard broken, by rule, with why. */
export declare const EXCEPTIONS: Readonly<Record<string, Partial<Record<Rule, string>>>>;
/** What hadolint reports that no rule of the guard holds, read and left, by file and code, with why. */
export declare const KNOWN_FINDINGS: Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface Finding {
  readonly line: number;
  readonly code: string;
  readonly level: string;
  readonly message: string;
}

/** One file's reading: its findings, or why there are none to read. */
export interface Result {
  readonly file: string;
  readonly findings?: ReadonlyArray<Finding>;
  readonly error?: string;
}

/** What one `docker` command did, as `spawnSync` reports it. */
export interface Ran {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error & { code?: string };
  readonly signal?: string | null;
}

export type Docker = (args: string[]) => Ran;

/** The `docker run` that lints one file. */
export declare function lintArgs(image: string, file: string, at: { root: string; uid: number; gid: number }): string[];

/** What one run said about `file`. */
export declare function findingsOf(file: string, ran: Ran): Result;

/** Why a finding of `code` in `file` stands, or null. */
export declare function knownAs(
  file: string,
  code: string,
  exceptions?: Readonly<Record<string, Partial<Record<Rule, string>>>>,
  known?: Readonly<Record<string, Readonly<Record<string, string>>>>,
): { by: string; why: string } | null;

export interface Report {
  /** The job summary's Markdown. */
  readonly markdown: string;
  /** What the log prints, an annotation among them when a Dockerfile went unlinted. */
  readonly lines: ReadonlyArray<string>;
  /** 0, or 1 outside a pull request when a Dockerfile went unlinted or there was none. */
  readonly code: 0 | 1;
}

export declare function report(input: {
  image: string;
  event: string;
  files: ReadonlyArray<string>;
  results?: ReadonlyArray<Result>;
  stopped?: string | null;
  exceptions?: Readonly<Record<string, Partial<Record<Rule, string>>>>;
  known?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): Report;

/** One run, with `docker` and `wait` the guard's to stub. */
export declare function run(options?: {
  root?: string;
  env?: Readonly<Record<string, string | undefined>>;
  docker?: Docker;
  wait?: (ms: number) => Promise<unknown>;
  uid?: number;
  gid?: number;
}): Promise<Report>;
