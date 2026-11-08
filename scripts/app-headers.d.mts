// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for `app-headers.mjs`, what the app's page must carry and whether an
 * answer carries it (workplan 0158 T4). `.mjs` beside this for the reason
 * `audit-advisories.d.mts` gives: `deploy-live.sh` and the outside probe run
 * it on a bare checkout, with no type stripping.
 */

/** The app's nginx template, from the repository root. */
export declare const APP_TEMPLATE: string;

/** Content-Security-Policy and Strict-Transport-Security: a template that states neither for the page is refused. */
export declare const REQUIRED_HEADERS: readonly string[];

/** One header the template states for the app's page, its variables resolved. */
export interface ExpectedHeader {
  readonly name: string;
  readonly value: string;
}

/** The headers nginx adds to `/` as the image renders the template with this issuer, or why they cannot be said. */
export declare function expectedAppHeaders(
  template: string,
  issuer: string,
): { readonly headers: readonly ExpectedHeader[]; readonly errors: readonly string[] };

/** One finding a header, naming it and never the value that arrived; empty when all arrived as stated. */
export declare function headerFindings(
  expected: readonly ExpectedHeader[],
  received: ReadonlyArray<readonly [string, string]>,
): string[];

/** curl's `-D` output as `[name, value]` pairs, from its last block. */
export declare function parseHeaderBlock(text: string): Array<[string, string]>;
