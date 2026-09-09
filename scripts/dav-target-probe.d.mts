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

/** Ground truth: how many resources with `suffix` a Depth:1 PROPFIND found. */
export declare function propfindResources(xml: string, suffix: string): number;
