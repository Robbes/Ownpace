// Copyright 2026 The Ownpace authors (Apache-2.0)

/** Types for the Dropbox file source (workplan 0055). */

import type { TokenProvider } from '@openmig/shared';

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
}>;

export interface DropboxFileSourceConfig {
  /**
   * Where the migration is rooted. Unset or '' is the whole Dropbox; a path
   * ('/Administratie') scopes to that folder — the natural keys are RELATIVE
   * to it, so the same tree lands the same way whichever root carried it.
   */
  readonly rootPath?: string;
  /** RPC endpoint base. Overridable for a test; unset means Dropbox's. */
  readonly apiBaseUrl?: string;
  /** Content (download) endpoint base. Separate host, per Dropbox's API. */
  readonly contentBaseUrl?: string;
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
}

export interface DropboxListFolderResponse {
  readonly entries: ReadonlyArray<DropboxEntry>;
  readonly cursor: string;
  readonly has_more: boolean;
}

/** What the source needs at construction: a way to mint Bearer tokens. */
export interface DropboxDeps {
  readonly tokenProvider: TokenProvider;
}
