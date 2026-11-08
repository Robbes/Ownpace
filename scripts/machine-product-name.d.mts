// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the product-name detector, so its guard can import it.
 *
 * `.mjs` because `docs-hygiene` runs it on every change, docs-only ones
 * included, and that job installs nothing: `node scripts/machine-product-name.mjs
 * --check` needs no type stripping on any Node this project has used.
 */

/** SHA-256 digests of the lowercased names of one word. */
export declare const WORD_DIGESTS: ReadonlyArray<string>;

/** Per name of two words: the digest of its first word, and of both joined by one space. */
export declare const PAIR_DIGESTS: ReadonlyArray<readonly [string, string]>;

/** The paths passed over by name. */
export declare const SKIPPED: ReadonlyArray<string>;

/** The files that still hold an occurrence waiting for a decision, and on how many lines. */
export declare const OWED: Readonly<Record<string, number>>;

export interface Hit {
  /** 1-based. */
  readonly line: number;
  /** 1-based: where the word, or the first word of a pair, starts. */
  readonly column: number;
}

/** Where one file's text names it: each line once. */
export declare function hitsIn(text: string): Hit[];

export interface Finding extends Hit {
  readonly file: string;
  /** Empty for a file that declares nothing; otherwise why the count is wrong. Line 0 for the file as a whole. */
  readonly what: string;
}

/** The lines `owed` does not account for, and a declaration nothing uses. */
export declare function owedFindings(
  byFile: Readonly<Record<string, ReadonlyArray<Hit>>>,
  owed?: Readonly<Record<string, number>>,
): Finding[];

/** git's own test for binary: a NUL in the first 8,000 bytes. */
export declare function isBinary(bytes: Uint8Array): boolean;

export interface Tree {
  readonly scanned: ReadonlyArray<string>;
  readonly binary: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
  /** Per file that names it, its hits, owed ones included. */
  readonly byFile: Readonly<Record<string, ReadonlyArray<Hit>>>;
  /** Every line `owed` does not account for. */
  readonly findings: ReadonlyArray<Finding>;
}

/** Every file `git ls-files` lists under `root`, untracked ones included, read and judged. */
export declare function scanTree(root?: string, owed?: Readonly<Record<string, number>>): Tree;

/** The failure message: each file, line and column, and what to write instead. Never the word. */
export declare function verdictMessage(found: ReadonlyArray<Finding>): string;

/** `--check`: the exit status, with the verdict printed. */
export declare function main(argv?: ReadonlyArray<string>, root?: string): number;
