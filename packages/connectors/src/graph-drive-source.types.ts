// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Graph Drive Source Types
 * 
 * Types for Microsoft Graph Drive API implementation (OneDrive/SharePoint).
 * Follows Microsoft Graph API v1.0 for file synchronization.
 */

import type { TokenProvider } from '@openmig/shared';

/**
 * Configuration for Graph Drive source connection.
 */
export interface GraphDriveSourceConfig {
  readonly tokenProvider: TokenProvider;
  readonly tenantId: string;
  readonly baseUrl?: string;
  /**
   * WHOSE drive to read. Unset means the signed-in user (`/me`, delegated) —
   * the default every existing mapping relies on. An address opts in to
   * application permissions and reads `/users/{address}` instead (SAD §14.3,
   * workplan 0027 T0); see `graph-scope.ts` for why it is validated.
   */
  readonly mailbox?: string;
}

/**
 * Microsoft Graph drive item (file or folder).
 */
export interface GraphDriveItem {
  readonly id: string;
  readonly name: string;
  /**
   * WHERE the item lives, as Graph actually reports it.
   *
   * There is no top-level `path` on a driveItem — this type declared one until
   * 2026-08-17 and nothing ever populated it, because no Graph response
   * carries it. `parentReference.path` is the real field, of the form
   * `/drive/root:` at the drive root or `/drive/root:/Documents` below it
   * (`/drives/{driveId}/root:/…` when the drive is addressed by id).
   * `GraphDriveSource.itemPath` derives the natural key from it.
   */
  readonly parentReference?: {
    readonly path?: string;
    readonly id?: string;
    readonly driveId?: string;
  };
  readonly size: number;
  readonly lastModifiedDateTime: string;
  readonly cTag?: string;
  /**
   * NOT a field Graph sends. The real one is `file.hashes.quickXorHash`
   * (below), which is what the version reads. This one stays only for
   * `contentHash` and `getChangeHash`, which nothing on the sync path reads,
   * and for the fixtures written against it; retiring it means rewriting those
   * fixtures in the documented shape (0060's kind of fix).
   */
  readonly quickXorHash?: string;
  readonly file?: {
    mimeType?: string;
    /**
     * Microsoft: *"quickXorHash is the only value that is guaranteed to be
     * available for both OneDrive for work or school and OneDrive for
     * home"* — and it moves only when the content does.
     */
    hashes?: { quickXorHash?: string; sha1Hash?: string; crc32Hash?: string };
  };
  readonly folder?: { childCount?: number };
  readonly deleted?: object;
  /** Present on the drive's root item, which the root delta returns first. */
  readonly root?: object;
  readonly '@odata.deltaLink'?: string;
}

/**
 * Graph API response for delta query.
 */
export interface GraphDriveDeltaResponse {
  readonly value: GraphDriveItem[];
  readonly '@odata.deltaLink'?: string;
  readonly '@odata.nextLink'?: string;
}

/**
 * Delta cursor for Graph Drive sync.
 */
export interface GraphDriveDeltaCursor {
  readonly deltaLink: string;
  readonly folderPath: string;
}

/**
 * Parsed path components for natural key generation.
 */
export interface ParsedPath {
  readonly root: string;
  readonly dir: string;
  readonly base: string;
  readonly ext: string;
  readonly name: string;
}

/**
 * Normalized path options.
 */
export interface NormalizePathOptions {
  readonly collapseSlashes?: boolean;
  readonly resolveDots?: boolean;
  readonly removeTrailingSlash?: boolean;
}
