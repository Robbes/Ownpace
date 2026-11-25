// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the SBOM completeness check, so its guard can import it.
 *
 * `.mjs` because Security Scan runs it with nothing but Node, right after the
 * SBOM is written: `node scripts/sbom-complete.mjs bom.json`.
 */

/** Imported by the apps, and missing from alpha.18's SBOM. A production set without them was not read. */
export declare const CANARIES: ReadonlyArray<string>;

/** `name@version` for every package in the output of `pnpm ls -r --prod --depth Infinity --json`, sorted. */
export declare function productionSet(projects: ReadonlyArray<object> | null | undefined): string[];

/** The problems with `bom` against `production`: empty when every package is listed and none excluded. */
export declare function incompleteness(bom: { bomFormat?: string; components?: ReadonlyArray<object> } | null | undefined, production: ReadonlyArray<string>): string[];

/** The CLI: the exit status, with the count or the refusal printed. */
export declare function main(
  argv?: ReadonlyArray<string>,
  out?: { log(message: string): void; error(message: string): void },
  root?: string,
): number;
