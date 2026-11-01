// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the check of the documents `llms.txt` links, so its guard can
 * import it.
 *
 * `.mjs` because `docs-hygiene` runs it on every change, docs-only ones
 * included, and that job installs nothing: `node scripts/llms-docs.mjs
 * --check` needs no type stripping on any Node this project has used.
 */

/** One document of `MAINTAINED_DOCS`: its path in the tree, and its own first heading. */
export interface Doc {
  readonly path: string;
  readonly title: string;
}

/** One section of `llms.txt`'s documentation: a topic, and its documents. */
export interface Topic {
  readonly topic: string;
  readonly docs: ReadonlyArray<Doc>;
}

/** What is wrong with one document, or with the list (`path` empty). */
export interface Problem {
  readonly path: string;
  readonly what: string;
}

/** A document's first `# ` heading, outside HTML comments and fenced code. */
export declare function firstHeading(text: string): string | undefined;

/** What is wrong with the list against the tree at `root`, or nothing. */
export declare function docProblems(root?: string, list?: ReadonlyArray<Topic>): Problem[];

/** The failure message: every problem, and what to do. */
export declare function verdictMessage(problems: ReadonlyArray<Problem>): string;

/** `--check`: the exit status, with the verdict printed. */
export declare function main(argv?: ReadonlyArray<string>, root?: string): number;
