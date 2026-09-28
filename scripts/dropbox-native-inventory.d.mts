// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Dropbox native-format inventory (workplan 0150 T2), so its
 * guard can run it against a fake Dropbox.
 *
 * `.mjs` beside this for the reason `audit-advisories.d.mts` gives: it runs on
 * a bare checkout and needs no type stripping.
 */

/** The part of `fetch` the inventory uses. */
export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface Kind {
  files: number;
  exportAs: Set<string>;
  options: Set<string>;
  noExport: number;
  minSize: number;
  maxSize: number;
  has: { content_hash: number; rev: number; server_modified: number };
  sample: unknown;
}

export interface Probe {
  kind: string;
  format: string;
  status: number;
  refusal?: string;
  bytes?: number;
  suffix?: string;
  exportHash?: boolean;
  paperRevision?: boolean;
}

export interface Inventory {
  files: number;
  folders: number;
  pages: number;
  kinds: Map<string, Kind>;
  probes: Probe[];
}

export declare const API: string;
export declare const CONTENT: string;
export declare const TOKEN_URL: string;
export declare const READS: readonly string[];

export declare function kindOf(name: unknown): string;
export declare function labelOf(id: unknown): string;
export declare function formatsOf(entry: { export_info?: { export_as?: string; export_options?: string[] } }): string[];
export declare function inventory(options: {
  fetch: Fetch;
  token: string;
  root?: string;
  probe?: boolean;
  sleep?: (ms: number) => Promise<void>;
}): Promise<Inventory>;
export declare function render(result: Inventory, options?: { probed?: boolean }): string[];
export declare function versions(options: {
  fetch: Fetch;
  token: string;
  root?: string;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string[]>;
export declare function tokenFrom(env: Record<string, string | undefined>, fetch: Fetch): Promise<string>;
export declare function optionsFrom(argv: string[]): { root: string; probe: boolean; versions: boolean };
