// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the conflict detector, so its guard can import it.
 *
 * `.mjs` because `docs-hygiene` runs it on every change, docs-only ones
 * included, and that job installs nothing: `node scripts/conflict-markers.mjs
 * --check` needs no type stripping on any Node this project has used.
 */

/** git's four marker runs, seven characters each. */
export declare const OURS: string;
export declare const BASE: string;
export declare const SPLIT: string;
export declare const THEIRS: string;

export type Marker = 'ours' | 'base' | 'split' | 'theirs';

/** The files that quote a conflict on purpose, and how many each quotes. */
export declare const QUOTATIONS: Readonly<Record<string, number>>;

/** Which marker a line is, if any. */
export declare function markerOf(line: string): Marker | undefined;

export interface Fences {
  /** Per line (0-based): the line its fence opened on, or -1 outside every fence. */
  readonly within: ReadonlyArray<number>;
  /** Fences that open and never close (1-based), and so quote nothing. */
  readonly unclosed: ReadonlyArray<number>;
}

/** Where the CommonMark fenced blocks are. */
export declare function fencesOf(lines: ReadonlyArray<string>): Fences;

export declare function isMarkdown(file: string): boolean;

export interface Finding {
  /** 1-based; 0 for the file as a whole. */
  readonly line: number;
  readonly what: string;
}

export interface Verdict {
  readonly findings: ReadonlyArray<Finding>;
  /** Lines (1-based) of the conflicts and marker lines that stand inside one fence. */
  readonly quoted: ReadonlyArray<number>;
}

/** Every unresolved conflict and stray marker in one file's text. */
export declare function conflictsIn(file: string, text: string): Verdict;

export type FileFinding = Finding & { readonly file: string };

/** The quoted conflicts that `declared` does not account for, both ways. */
export declare function quotationFindings(
  quoted: Readonly<Record<string, ReadonlyArray<number>>>,
  declared?: Readonly<Record<string, number>>,
): FileFinding[];

/** git's own test for binary: a NUL in the first 8,000 bytes. */
export declare function isBinary(bytes: Uint8Array): boolean;

export interface Tree {
  readonly scanned: ReadonlyArray<string>;
  readonly binary: ReadonlyArray<string>;
  /** Conflicts, strays, and quotations `declared` does not account for. */
  readonly findings: ReadonlyArray<FileFinding>;
  /** Per file, the lines of the conflicts that stand inside a fence. */
  readonly quoted: Readonly<Record<string, ReadonlyArray<number>>>;
}

/** Every file `git ls-files` lists under `root`, untracked ones included, read and judged. */
export declare function scanTree(root?: string, declared?: Readonly<Record<string, number>>): Tree;

/** The failure message: every file and line, and what to do about each. */
export declare function verdictMessage(found: ReadonlyArray<FileFinding>): string;

/** `--check`: the exit status, with the verdict printed. */
export declare function main(argv?: ReadonlyArray<string>, root?: string): number;
