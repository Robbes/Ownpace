// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the probe's two pure counters, so its guard can import them.
 *
 * The probe stays `.mjs` deliberately: it is a diagnostic somebody runs on a
 * box under pressure, and `node scripts/dav-target-probe.mjs` works on every
 * Node this project has ever used. A `.ts` would need type stripping, which is
 * default only from Node 24 — a footgun for the one tool whose whole job is to
 * work when something else is broken.
 */

/** How the server answered a listing REPORT, stage by stage. */
export declare function measure(
  xml: string,
  dataLocalName: string,
): { responses: number; withData: number; uids: number };

/**
 * Ground truth: how many MEMBERS a Depth:1 PROPFIND found under
 * `collectionPath`. By path, not by file extension — see the probe's own note.
 */
export declare function propfindMembers(xml: string, collectionPath: string): number;

/** The last assignment of `key` in a compose .env, unquoted. */
export declare function envValue(key: string, file?: string): string | undefined;

/**
 * What a non-207 answer means, per status class.
 *
 * Every refusal used to read "the filter body is rejected outright" — true of a
 * 400 and a confident lie about a 401 or a 404, both of which were met on the
 * real thing. The unrecognised case names its status rather than guessing.
 */
export declare function refusal(status: number): string;
