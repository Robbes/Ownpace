// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for what the Release workflow's verify reads, so its guard can judge
 * the real releases and a complete one.
 */

import type { Line } from './release-github.mjs';

export interface Asset {
  name: string;
  size: number;
  state: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  name?: string;
  draft: boolean;
  prerelease: boolean;
  immutable?: boolean;
  body: string | null;
  assets: Asset[];
}

export declare const IMAGES: string[];
export declare const REGISTRY: string;
export declare const ISSUER: string;
export declare const IDENTITY_REGEXP: string;

export declare function zipName(version: string): string;
export declare function generatedBlocks(body: string | null | undefined, version: string): number;
export declare function checkRelease(release: Release | null, version: string): Line[];
export declare function checkBom(bom: unknown, version: string): Line;
export declare function verifySums(sums: string, hashOf: (file: string) => string | null): Line;
export declare function checkIndex(index: unknown, options: { image: string; tag: string }): Line;
export declare function checkRevision(config: unknown, options: { image: string; commit: string }): Line;
export declare function latestWithheld(options: {
  image: string;
  version: string;
  versionDigest: string;
  latestDigest: string | null;
}): Line;
export declare function cosignCalls(options: { image: string; digest: string; version: string }): string[][];
export declare function versionAnswer(answer: unknown, options: { version: string; commit: string }): Line;
export declare const APPLIANCE_NODES: readonly string[];
export declare function versionExec(name: string, node: string): string[];
export declare function pinnedRuntimeIn(packagerText: string | null, version: string, platform: string): string | null;
export declare function checkRuntime(seen: string | null, pinned: string | null, nodeVersion: string | null): Line;

/** One asset as downloaded: its bytes, or why there are none, as the sentence of a refuse line. */
export type Download = { body: Buffer; reason?: undefined } | { body?: undefined; reason: string };

/** The seams of the downloads, which the guard fills: the fetch, the wait, and where a failed fetch is said. */
export interface DownloadSeams {
  fetchImpl?: (url: string) => Promise<Response>;
  sleep?: (ms: number) => Promise<unknown>;
  say?: (line: Line) => void;
}

/** Up to five fetches of an asset, 5, 15, 45 and 135 seconds apart, for no answer, a file cut short, a 5xx or a 429 only (2026-11-10). */
export declare function downloadAsset(asset: Pick<Asset, 'name' | 'browser_download_url'>, check: string, seams?: DownloadSeams): Promise<Download>;
/** bom.json and the zip, downloaded and each judged by its own check. */
export declare function checkAssets(
  release: Release | null,
  version: string,
  readAt: (path: string) => Promise<string | null>,
  seams?: DownloadSeams,
): Promise<Line[]>;

/** The tasks' prebuilt base, at the digest the tagged commit's `trigger.config.ts` pins (workplan 0119 §3 item 13). */
export interface TaskBasePin {
  ref: string;
  repo: string;
  tag: string;
  digest: string;
  /** The seven hex digits its `sha-` tag names. */
  commit: string;
}
export declare const TASK_BASE_IMAGE: string;
/** The identity of `images.yml` on `refs/heads/main`, the only ref that publishes the tasks' base. */
export declare const MAIN_IDENTITY: string;
export declare function taskBasePinIn(configText: string | null): TaskBasePin | null;
export declare function checkTaskBaseIndex(index: unknown, pin: TaskBasePin): Line;
export declare function taskBaseRevision(config: unknown, pin: TaskBasePin): string | null;
export declare function checkTaskBaseAncestry(compare: unknown, options: { revision: string; commit: string }): Line;
export declare function taskBaseCosignCall(digest: string): string[];
