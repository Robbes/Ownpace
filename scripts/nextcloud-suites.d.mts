// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Nextcloud suite finder, so its guard can import it.
 *
 * `.mjs` because the second-major leg runs it with nothing but Node, before
 * any test runs: `node scripts/nextcloud-suites.mjs`.
 */

/** Where integration suites live. */
export declare const ROOTS: ReadonlyArray<string>;

/** What a suite reads when it talks to Nextcloud. */
export declare const READS_NEXTCLOUD: RegExp;

/** Every integration suite under `root` that reads a Nextcloud variable, relative, `/`-separated, sorted. */
export declare function nextcloudSuites(root?: string): string[];

/** The CLI: the exit status, with the list or the refusal printed. */
export declare function main(
  root?: string,
  out?: { log(message: string): void; error(message: string): void },
): number;
