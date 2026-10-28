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

/** One image to scan: one matrix leg, one SARIF category, one artifact, one issue title. */
export interface ScanImage {
  name: string;
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
