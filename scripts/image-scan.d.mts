// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the weekly image scan's list and report (workplan 0146 T8, the
 * scan half), so its guard can run them with a stubbed network and a fake
 * `gh`.
 *
 * `.mjs` beside this for the reason `idp-pin-watch.d.mts` gives: it runs in a
 * CI step on a bare checkout and needs no type stripping.
 */

import type { Net, Repo, Row } from './idp-pin-watch.mjs';

export declare const SCAN_FILES: string[];
export declare const SCRIPT_DIRS: string[];
export declare const STACKS: Record<string, string>;
export declare const OWNPACE_REGISTRY: string;
export declare const OWNPACE_IMAGES: string[];
export declare const ISSUE_PREFIX: string;
export declare const TASK_IMAGE: string;
export declare const TASK_CONFIG: string;
/** The only ref whose run keeps the issues: `refs/heads/main`. */
export declare const ISSUES_REF: string;
export declare const BUILT_HERE: string;
export declare const API_DOCKERFILE: string;

/** Where an image runs (the owner, 2026-11-03): the report's order, production first. */
export type Tier = 'production-public' | 'production-internal' | 'shipped' | 'test-only';
export declare const TIERS: Tier[];
/** What each tier means, as the report's headline says it. */
export declare const TIER_MEANS: Record<Tier, string>;
/** Every listed image's tier, by the name the list gives it. */
export declare const IMAGE_TIERS: Record<string, Tier>;
/** The tier of the image the list names so; an error for a name with none. */
export declare function tierOf(name: string): Tier;

/** One image to scan: one matrix leg, one SARIF category, one artifact, one issue title. */
export interface ScanImage {
  name: string;
  /** Where it runs: the report's headline and order, and whether its SARIF goes to code scanning (not for test-only). */
  tier: Tier;
  ref: string;
  where: string;
  floating: boolean;
  /** Set for an image the leg builds before it scans it: the local tag it builds under (workplan 0146 T10). */
  build?: string;
  /** Set when no registry serves the image: the directory its leg builds it from (`deploy/compose/goaccess`, `deploy/compose/postgres`). */
  context?: string;
}

/** What one Trivy JSON report says. */
export interface ImageReport {
  os: string | null;
  eosl: boolean;
  critical: number;
  high: number;
  fixable: number;
  /** Each critical finding: its id, package, versions, and where it sits. */
  criticals: Array<{ id: string; pkg: string; installed: string; fixed: string; where: string }>;
  /** The critical and high findings with a fix, by package where it sits, worst first (2026-11-03). */
  withFix: PackageFindings[];
  /** The critical and high findings with none, by package where it sits, worst first. */
  withoutFix: PackageFindings[];
}

/** One package where it sits, and its findings of one kind: with a fix, or without. */
export interface PackageFindings {
  /** The operating system for its packages, the package's directory or file, or the result's target (`usr/local/bin/goose`). */
  target: string;
  pkg: string;
  installed: string;
  /** The worst of its findings. */
  severity: 'CRITICAL' | 'HIGH';
  /** Each id once, the worst first. */
  ids: string[];
  /** Set where they have a fix: the version that clears them all. */
  fix?: string;
}

export interface Summary {
  lines: string[];
  annotations: string[];
  missing: Array<{ image: ScanImage; why: string }>;
  read: Array<{ image: ScanImage; report: ImageReport }>;
}

export declare function stackOf(file: string): string;
export declare function isFloating(image: { tag: string; digest: string }): boolean;
export declare function newestReleaseTag(lsRemote: string): string;
export declare function imagesToScan(repo: Repo, net: Net, options?: { upstream?: string }): Promise<ScanImage[]>;
export declare function readReport(text: string): ImageReport;
/** Two versions in dpkg's order, with Go's `v` and a pre-release's `-rc` read as such. */
export declare function compareVersions(a: string, b: string): number;
/** The version that clears every finding of one package at once, read per line where a fix is one per line. */
export declare function neededFix(installed: string, fixedVersions: string[]): string;
/** At most this many lines of each list per image in the inventory; the rest are counted. */
export declare const INVENTORY_LINES: number;
/** The inventory's lines: per image, the packages with a fix and those without. */
export declare function inventoryLines(read: Summary['read']): string[];
export declare function eoslIssue(image: ScanImage, report: ImageReport): Row;
export declare function summarize(images: ScanImage[], readFile: (name: string) => string | null): Summary;
export declare function keepIssues(images: ScanImage[], summary: Summary, gh: (args: string[]) => string): string[];
export declare function imagesFromEnv(text: string | undefined): ScanImage[];

/** The parts of a Trigger.dev deploy config the tasks' base stage is built from: its build extensions, run as the CLI runs them. */
export interface TaskConfig {
  build?: {
    extensions?: Array<{
      name: string;
      onBuildStart?: (context: never) => unknown;
      onBuildComplete?: (context: never, manifest: never) => unknown;
    }>;
  };
}
/** The local tag the tasks' leg builds under: the base's repository, so its alerts keep their SARIF location. */
export declare function taskBuildTag(base: string): string;
export declare function taskBaseStage(config: TaskConfig, options: { base: string; workingDir: string }): Promise<string>;
