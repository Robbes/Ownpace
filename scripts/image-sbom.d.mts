// Copyright 2026 The Ownpace authors (Apache-2.0)

/** Types for scripts/image-sbom.mjs, so its guard and release-verify's can read it. */

import type { Line } from './release-github.mjs';

export interface SpdxDocument {
  spdxVersion?: string;
  name?: string;
  comment?: string;
  packages?: Array<{
    SPDXID?: string;
    name?: string;
    versionInfo?: string;
    externalRefs?: Array<{ referenceType?: string; referenceLocator?: string }>;
  }>;
  [key: string]: unknown;
}

/** What `imagetools inspect --format '{{ json .SBOM }}'` prints for an index: one entry per platform. */
export type Inspected = Record<string, { SPDX?: SpdxDocument }>;

export declare const SBOM_REGISTRY: string;
export declare const SBOM_PLATFORMS: readonly string[];
export declare const FIRST_IMAGE_SBOM_RELEASE: string;
export declare const OS_PURL_TYPES: readonly string[];
export declare function sbomFileName(image: string, label: string, platform: string): string;
export declare function sbomDocumentName(image: string, digest: string, platform: string): string;
export declare function packageCounts(doc: SpdxDocument | null | undefined): Record<string, number>;
export declare function osPackages(doc: SpdxDocument | null | undefined): string[];
export declare function describeCounts(counts: Record<string, number>): string;
export declare function sbomFault(doc: SpdxDocument | null | undefined): string | null;
export declare function splitImageSbom(
  inspected: Inspected | null | undefined,
  options: { image: string; digest: string; label: string },
): Array<{ file: string; platform: string; doc: SpdxDocument; counts: Record<string, number> }>;
export declare function checkImageSbom(
  doc: SpdxDocument | null,
  options: { image: string; digest: string; platform: string; file: string },
): Line;
export declare function setFaults(
  expected: ReadonlyArray<{ file: string }>,
  present: readonly string[],
  read: (file: string) => string,
): string[];
