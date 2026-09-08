// Copyright 2026 The Ownpace authors (Apache-2.0)

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
