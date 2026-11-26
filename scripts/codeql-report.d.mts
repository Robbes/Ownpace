// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the CodeQL report, so its guard can import it.
 *
 * `.mjs` because `codeql.yml` runs it on a bare checkout, with no
 * `node_modules`: `node scripts/codeql-report.mjs` needs no type stripping.
 */

/** The known-bad fixture's folder: read by a proof run, left out of every other. */
export declare const FIXTURE: string;
/** What a proof run must report in the fixture, each of them. */
export declare const PROOF_QUERIES: ReadonlyArray<string>;
/** The fewest files a finished scan of this tree extracts. */
export declare const MIN_EXTRACTED: number;
/** The files CodeQL's JavaScript extractor reads, by extension. */
export declare const SOURCE: RegExp;
/** What CodeQL leaves out by default. */
export declare const LEFT_OUT: RegExp;

/** The tracked files a finished scan must have extracted. */
export declare function expectedFiles(tracked: ReadonlyArray<string>, options: { readonly proof: boolean }): string[];

export interface CodeqlAlert {
  readonly rule: string;
  readonly uri: string;
  readonly line: number;
}

/** One SARIF file's alerts, the files CodeQL extracted, and the ones it could not. */
export declare function readSarif(text: string): {
  readonly results: CodeqlAlert[];
  readonly extracted: Set<string>;
  readonly problems: Array<{ readonly uri: string; readonly text: string }>;
};

/** The job's verdict, its log lines and its summary. */
export declare function report(input: {
  readonly sarifs: ReadonlyArray<string>;
  readonly tracked: ReadonlyArray<string>;
  readonly proof: boolean;
}): { readonly code: 0 | 1; readonly lines: string[]; readonly markdown: string };
