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
export declare function pinnedRuntimeIn(packagerText: string | null, version: string, platform: string): string | null;
export declare function checkRuntime(seen: string | null, pinned: string | null, nodeVersion: string | null): Line;
