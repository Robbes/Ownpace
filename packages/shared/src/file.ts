// Copyright 2026 The Ownpace authors (Apache-2.0)
/** WebDAV file model for migration. */

import type { FileBody } from './file-body.ts';

/** File permissions (simplified). */
export interface FilePermissions {
  readonly read: boolean;
  readonly write: boolean;
  readonly execute?: boolean;
}

/**
 * Normalized file/folder item.
 * The `path` is the natural key (idempotency anchor); content is hashed from file content.
 */
export interface FileItem {
  /** Relative path within the sync root - the natural key. */
  readonly path: string;
  /** File name (basename), if available. */
  readonly name?: string;
  /** Whether this is a directory. */
  readonly isDirectory: boolean;
  /** File size in bytes (0 for directories). */
  readonly size: number;
  /** Content hash (SHA-256) - empty for directories. */
  readonly contentHash?: string;
  /** Last modified time (ISO 8601). */
  readonly modifiedAt: string;
  /** Created time (ISO 8601), if available. */
  readonly createdAt?: string;
  /** ETag, if available. */
  readonly etag?: string;
  /** MIME type (for files). */
  readonly mimeType?: string;
  /** Permissions (if available). */
  readonly permissions?: FilePermissions;
  /** Owner information (if available). */
  readonly owner?: string;
  /** Group information (if available). */
  readonly group?: string;
  /** Source reference (opaque handle for fetching). */
  readonly sourceRef: string;
}

/** File/folder with raw content. */
export interface RawFileItem {
  readonly item: FileItem;
  readonly content?: Uint8Array; // Only present for files, not directories
  /**
   * The bytes WITHOUT holding them — a size and a way to read (see
   * `FileBody`).
   *
   * Beside `content` rather than instead of it, and a source supplies one or
   * the other. Small files stay buffered, which is simpler and is what almost
   * every file is; a large one arrives as a body, and then nothing between the
   * source and the target ever holds the whole of it. The ceiling this removes
   * is the runner's RAM, which is not a property of the file, the customer or
   * the provider — and crossing it killed the process rather than failing the
   * item.
   *
   * A consumer that reads `content` alone still works on every source that has
   * not moved; one that must handle both reads `content ?? body`, and a target
   * that cannot stream refuses above `MAX_BUFFERED_FILE_BYTES` rather than
   * trying.
   */
  readonly body?: FileBody;
}

/** File folder/collection. */
export interface FileFolder {
  /** Folder path. */
  readonly path: string;
  /** Human-readable name. */
  readonly name?: string;
  /** Folder description. */
  readonly description?: string;
  /** Quota information (if available). */
  readonly quota?: {
    readonly used: number;
    readonly available?: number;
  };
}

/** Sync result for a file. */
export interface FileSyncResult {
  readonly path: string;
  readonly action: 'created' | 'updated' | 'skipped' | 'error';
  readonly targetPath?: string;
  readonly error?: string;
}
