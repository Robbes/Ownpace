// Copyright 2026 The Ownpace authors (Apache-2.0)

/** Types for the Dropbox file source (workplan 0055). */

import type {
  DropboxNativeFilePolicies,
  DropboxPaperFormat,
  DropboxPaperPolicy,
  FileItem,
  TokenProvider,
} from '@openmig/shared';

/** The Paper policy's types live in `shared`, where both editions' parser reads them (0150 T3 (c)). */
export type { DropboxPaperFormat, DropboxPaperPolicy };

/**
 * The one seam to the world — a fetch-shaped function, so a unit test can be
 * a literal (the same shape `DriveTransport` uses).
 */
export type DropboxTransport = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<{
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
   * record it as a copy. Requiring it would have made every existing double
   * a compile error and taught nothing.
   */
  readonly body?: ReadableStream<Uint8Array> | null;
}>;

export interface DropboxFileSourceConfig {
  /**
   * Where the migration is rooted. Unset or '' is the whole Dropbox; a path
   * ('/Administratie') scopes to that folder — the natural keys are RELATIVE
   * to it, so the same tree lands the same way whichever root carried it.
   *
   * 'Dropbox' (any case, with or without a leading slash) also means the
   * whole account: the folder the web view and the desktop client call
   * "Dropbox" IS the API root, not a folder inside it, so '/Dropbox' as a
   * literal path 409s with path/not_found on every listing.
   */
  readonly rootPath?: string;
  /** RPC endpoint base. Overridable for a test; unset means Dropbox's. */
  readonly apiBaseUrl?: string;
  /** Content (download) endpoint base. Separate host, per Dropbox's API. */
  readonly contentBaseUrl?: string;
  /**
   * The format a Paper doc arrives in (workplan 0150 T3; D7: the key Drive's
   * setting uses, with a `paper` kind). It covers Paper docs and Paper
   * templates. Unset, or `refuse`, refuses each one by name (D1).
   */
  readonly nativeFilePolicies?: DropboxNativeFilePolicies;
}

/** One entry as `files/list_folder` returns it, reduced to the fields used. */
export interface DropboxEntry {
  readonly '.tag': 'file' | 'folder' | 'deleted';
  readonly id?: string;
  readonly name: string;
  /** Display-cased path — the one the natural key is derived from. */
  readonly path_display?: string;
  readonly size?: number;
  readonly server_modified?: string;
  readonly client_modified?: string;
  /** Dropbox's own block hash — stable per content, the cheap change signal. */
  readonly content_hash?: string;
  /**
   * False for a file `files/download` will not hand over (workplan 0150 T5).
   * Dropbox's spec: *"If true, file can be downloaded directly; else the file
   * must be exported."* A Paper doc is one. Absent reads as downloadable, as
   * every file was treated before this was read.
   */
  readonly is_downloadable?: boolean;
  /**
   * How such a file can be exported. The spec says it *"must be set if
   * is_downloadable is set to false"*: `export_as` is the default format and
   * `export_options` the others.
   */
  readonly export_info?: {
    readonly export_as?: string;
    readonly export_options?: ReadonlyArray<string>;
  };
}

/**
 * What the listing learnt about a file Dropbox hands over only as an export
 * (workplan 0150 T5), carried on the listed item so `fetch` can refuse it
 * before a download is asked for.
 */
export interface DropboxExportOnly {
  /** The name's extension, lower-cased, without the dot: the kind's label (`paper`). */
  readonly kind: string;
  /** The formats Dropbox offers to export it in, `export_as` first; empty when it offers none. */
  readonly formats: ReadonlyArray<string>;
  /**
   * The format it is exported in (0150 T3, T4): the migration's choice for
   * its kind, when Dropbox offers that format for this file. Absent, it is
   * refused.
   */
  readonly exportAs?: DropboxPaperFormat;
  /** The migration's choice for its kind, when Dropbox does not offer it for this file. */
  readonly notOffered?: DropboxPaperFormat;
}

/** A listed Dropbox file: a `FileItem`, marked when Dropbox hands it over only as an export. */
export type DropboxFileItem = FileItem & { readonly exportOnly?: DropboxExportOnly };

export interface DropboxListFolderResponse {
  readonly entries: ReadonlyArray<DropboxEntry>;
  readonly cursor: string;
  readonly has_more: boolean;
}

/** What the source needs at construction: a way to mint Bearer tokens. */
export interface DropboxDeps {
  readonly tokenProvider: TokenProvider;
}
