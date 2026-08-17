// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/** Types for the Box file source (workplan 0056). */

/**
 * The one seam to the world — a fetch-shaped function, so a unit test can be
 * a literal (the same shape `DriveTransport` and `DropboxTransport` use).
 */
export type BoxTransport = (
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

export interface BoxFileSourceConfig {
  /**
   * Where the migration is rooted: a Box folder id. Unset means '0' — Box's
   * spelling of the account root ("All Files"). The natural keys are RELATIVE
   * to it, so the same tree lands the same way whichever root carried it.
   */
  readonly rootFolderId?: string;
  /** API base. Overridable for a test; unset means Box's `api.box.com/2.0`. */
  readonly baseUrl?: string;
}

/** One entry as `GET /folders/{id}/items` returns it, reduced to the fields used. */
export interface BoxItem {
  readonly type: 'file' | 'folder' | 'web_link';
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  /** Box's own content hash — stable per content, the cheap change signal. */
  readonly sha1?: string;
  readonly modified_at?: string;
  readonly created_at?: string;
  /**
   * The ordered ANCESTOR CHAIN, root first (`0` = "All Files"). Box answers
   * this per item when asked for, which is what makes the trash read a single
   * listing rather than Drive's per-file parent walk.
   */
  readonly path_collection?: BoxPathCollection;
}

export interface BoxPathCollection {
  readonly total_count?: number;
  readonly entries: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface BoxItemList {
  readonly entries: ReadonlyArray<BoxItem>;
  /** Present while there are more pages (`usemarker=true` paging). */
  readonly next_marker?: string;
}
