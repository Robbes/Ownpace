// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Shapes for the Google Drive source (workplan 0042, first slice).
 *
 * Kept beside the connector rather than in `@openmig/shared` for the same
 * reason `graph-drive-source.types.ts` is: these describe Google's wire format,
 * which is Google's business and nobody else's. The one exception is
 * `NativeFilePolicy`, which is a product decision an owner writes in a mapping —
 * see its comment below.
 */

import type { GoogleNativeFilePolicy } from '@openmig/shared';

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
 * ONE definition, in `@openmig/shared` — see `GoogleNativeFilePolicy` there for
 * why the default is `refuse` and what an export policy still leaves unproven.
 * It lives there rather than here because it is a product decision that appears
 * in a mapping file, unlike everything else in this file, which is Google's wire
 * format. Two copies of three string literals is exactly how a config value comes
 * to mean one thing to the parser and another to the connector.
 */
export type NativeFilePolicy = GoogleNativeFilePolicy;

/**
 * Export MIME types, for when the policy is not `refuse`.
 *
 * Drive renders these server-side (`files.export`) — no converter of ours is
 * involved, which is why three output families cost no dependency.
 *
 * A DRAWING IS THE ODD ONE. Drive exports Docs, Sheets and Slides into the
 * matching member of each family, but a Drawing has no ODF or Office
 * equivalent on offer: `files.export` gives a Drawing only PNG, JPEG, SVG and
 * PDF. So SVG is what both document families get — it is the only VECTOR form
 * available, it opens in LibreOffice Draw and in Word, and a Drawing rendered
 * to PNG would be a diagram nobody can edit again. Do not "correct" these two
 * entries to ODG or VSDX: Drive answers 400 for both.
 */
export const NATIVE_EXPORT_TYPES: Readonly<
  Record<Exclude<NativeFilePolicy, 'refuse'>, Readonly<Record<string, string>>>
> = {
  'export-odf': {
    'application/vnd.google-apps.document': 'application/vnd.oasis.opendocument.text',
    // `x-vnd`, NOT `vnd`. Google's export table spells the Sheets ODS type
    // with the `x-` prefix and rejects the unprefixed one. It reads like a
    // typo and has been "fixed" into a 400 before; it is Google's spelling.
    'application/vnd.google-apps.spreadsheet': 'application/x-vnd.oasis.opendocument.spreadsheet',
    'application/vnd.google-apps.presentation': 'application/vnd.oasis.opendocument.presentation',
    'application/vnd.google-apps.drawing': 'image/svg+xml',
  },
  'export-office': {
    'application/vnd.google-apps.document':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.google-apps.spreadsheet':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.presentation':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.google-apps.drawing': 'image/svg+xml',
  },
  'export-pdf': {
    'application/vnd.google-apps.document': 'application/pdf',
    'application/vnd.google-apps.spreadsheet': 'application/pdf',
    'application/vnd.google-apps.presentation': 'application/pdf',
    'application/vnd.google-apps.drawing': 'application/pdf',
  },
};

/**
 * The file extension each export MIME type lands under.
 *
 * A Google Doc's `name` carries no extension — there is no file, so there is
 * nothing for one to describe. Copy the export out under that bare name and
 * the result is a file called "Aanbiedingstekst" holding DOCX bytes: Nextcloud
 * shows it as unknown, the desktop offers no application, and the owner's
 * document has arrived in a form they cannot open. The extension is not
 * decoration here; it is the difference between exported and usable.
 *
 * Keyed by the EXPORT type rather than the Google type, so a policy and its
 * suffix cannot disagree — every value in `NATIVE_EXPORT_TYPES` must appear
 * here, and a guard test asserts exactly that.
 */
export const NATIVE_EXPORT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/x-vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
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
) => Promise<DriveResponse>;

/**
 * What a transport hands back. Structurally satisfied by a `fetch` `Response`,
 * which is how the real one is built without the connector importing anything.
 */
export interface DriveResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  /**
   * The response's bytes, unread, when the transport can offer them
   * (workplan 0120 T5).
   *
   * OPTIONAL, and that is the safe way round: a transport that cannot stream
   * simply omits it, and the streamed path refuses the item by name rather
   * than returning an empty stream — which would write an empty file and
   * record it as a copy. Requiring it would have made every existing double a
   * compile error and taught nothing.
   */
  readonly body?: ReadableStream<Uint8Array> | null;
}

/** Google's own name for the native-editor family, used to detect them. */
export const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
