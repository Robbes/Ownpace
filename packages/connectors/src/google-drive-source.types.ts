// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Shapes for the Google Drive source (workplan 0042, first slice).
 *
 * Kept beside the connector rather than in `@openmig/shared` for the same
 * reason `graph-drive-source.types.ts` is: these describe Google's wire format,
 * which is Google's business and nobody else's.
 */

/** What a Drive file looks like on the wire, reduced to the fields used. */
export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** Absent on native editor files — they have no bytes and therefore no size. */
  readonly size?: string;
  /** Absent on native editor files, and on some shortcuts. */
  readonly md5Checksum?: string;
  readonly modifiedTime?: string;
  readonly createdTime?: string;
  readonly parents?: readonly string[];
  readonly trashed?: boolean;
}

export interface DriveFileList {
  readonly files?: readonly DriveFile[];
  readonly nextPageToken?: string;
}

/**
 * What to do with a Google Doc, Sheet or Slide.
 *
 * Native editor files are not files: they have no bytes, and reaching them means
 * asking Drive to EXPORT a rendering in a format somebody chose. That is lossy —
 * the original is not recoverable from a `.docx` — and, critically, it may not be
 * byte-stable across calls. If it is not, `contentHash` sees a change on every
 * pass and the migration rewrites every document forever.
 *
 * The owner chose per-migration choice (0042 T0 Q3). The DEFAULT is `refuse`
 * until byte-stability has actually been measured against a real tenant, because
 * of the two failure modes available here — "your Docs did not migrate, and here
 * is why" and "your Docs are silently re-copied nightly, and their formatting
 * changed" — only the first is one an owner can act on.
 */
export type NativeFilePolicy = 'refuse' | 'export-office' | 'export-pdf';

/** Export MIME types, for when the policy is not `refuse`. */
export const NATIVE_EXPORT_TYPES: Readonly<
  Record<Exclude<NativeFilePolicy, 'refuse'>, Readonly<Record<string, string>>>
> = {
  'export-office': {
    'application/vnd.google-apps.document':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.google-apps.spreadsheet':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.presentation':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  'export-pdf': {
    'application/vnd.google-apps.document': 'application/pdf',
    'application/vnd.google-apps.spreadsheet': 'application/pdf',
    'application/vnd.google-apps.presentation': 'application/pdf',
  },
};

export interface GoogleDriveSourceConfig {
  /** Base URL, overridable so tests never reach Google. */
  readonly baseUrl?: string;
  /** The folder id the migration is rooted at. `'root'` is My Drive. */
  readonly rootFolderId?: string;
  /** See {@link NativeFilePolicy}. Defaults to `refuse`. */
  readonly nativeFilePolicy?: NativeFilePolicy;
}

/**
 * The one seam this connector talks to the world through.
 *
 * A function rather than a class so a unit test can be a literal, and so the
 * connector carries no opinion about how a token is obtained — the caller has
 * already resolved that, exactly as `smtpTransport` takes resolved settings.
 */
export type DriveTransport = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

/** Google's own name for the native-editor family, used to detect them. */
export const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
