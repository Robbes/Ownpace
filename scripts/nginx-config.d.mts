// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for `nginx-config.mjs`, the reading of an nginx config that the
 * guards, the outside probe and `deploy-live.sh` share. `.mjs` beside this for
 * the reason `audit-advisories.d.mts` gives: the probe and the deploy run it on
 * a bare checkout, with no type stripping.
 */

export interface NginxNode {
  readonly name: string;
  readonly args: readonly string[];
  readonly children?: NginxNode[];
}

export interface Location {
  readonly node: NginxNode;
  readonly modifier: '=' | '^~' | '~' | '~*' | '';
  readonly pattern: string;
}

/** One `add_header` as nginx sends it: the name, the value with its variables resolved, and whether `always` is on. */
export interface SentHeader {
  readonly name: string;
  readonly value: string;
  readonly always: boolean;
}

/** An nginx config as its directives and blocks; throws on anything it cannot parse. */
export declare function parseNginx(conf: string, file: string): NginxNode[];

/** A location block's modifier and pattern, written apart or together (`= /x`, `=/x`). A named one is none. */
export declare function locationOf(node: NginxNode): Location | undefined;

/** The location nginx chooses for a URI among one level's blocks, as the path of locations down to it. */
export declare function chooseLocation(
  level: readonly NginxNode[],
  uri: string,
): { path: NginxNode[]; final: boolean } | undefined;

/** The template as the nginx image renders it: `$NAME` and `${NAME}` replaced for the names defined alone. */
export declare function envsubst(template: string, defined: Readonly<Record<string, string>>): string;

/** The headers nginx adds to its answer for a URI, by nginx's rule of inheritance. Undefined when no location is chosen. */
export declare function headersFor(top: readonly NginxNode[], uri: string): SentHeader[] | undefined;
