// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the outside probe's port list, so its guard can import it.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: the probe
 * runs in a CI step on a bare checkout and needs no type stripping.
 */

/** One port the probe tries, and every place that publishes it (`managed.yml:web`). */
export interface ProbePort {
  readonly port: number;
  readonly where: readonly string[];
}

/** A list, and every entry the reader could not turn into a port. */
export interface DerivedPorts {
  readonly ports: readonly ProbePort[];
  readonly problems: readonly string[];
}

/** The three files the list is derived from, relative to the repository root. */
export declare const SOURCES: { readonly managed: string; readonly www: string; readonly demo: string };

/** Every host port one compose file publishes, with where. */
export declare function composePublishes(
  file: string,
  text: string,
): { readonly publishes: ReadonlyArray<{ readonly port: number; readonly where: string }>; readonly problems: readonly string[] };

/** Every `${…PORT…:-n}` default a shell script's code lines hand on. */
export declare function scriptPublishes(
  file: string,
  text: string,
): { readonly publishes: ReadonlyArray<{ readonly port: number; readonly where: string }>; readonly problems: readonly string[] };

/** The list from the three files' text. */
export declare function derivePorts(files: { readonly managed: string; readonly www: string; readonly demo: string }): DerivedPorts;

/** The list from the files in a checkout (default: this one). */
export declare function readPorts(root?: string): DerivedPorts;
