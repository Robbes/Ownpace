// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Dropbox as a file source (workplan 0055).
 *
 * MODELLED ON THE GOOGLE DRIVE SOURCE, deliberately — the decisions that
 * connector wrote down apply unchanged, and diverging from them silently is
 * how two file sources come to mean different things by "migrated":
 *
 *  - **No delta.** Dropbox's `list_folder/continue` cursor reports the WHOLE
 *    subtree's changes, and `FileSource.listSince` is per folder with one
 *    cursor per folder — the same mismatch that made Drive's `changes.list`
 *    wrong to use (0026 T1's lesson). So every pass lists the folder, the
 *    natural key plus the ledger provide idempotency, and the second pass
 *    creates nothing. Slower than a delta and CORRECT, in that order.
 *  - **`removed` is never populated**, but the tombstones ARE read: Dropbox
 *    states a path's deleted state outright (`include_deleted`), and
 *    `listTrashedPaths` below turns that into the `trashed` evidence class —
 *    the same bin read Drive and WebDAV have. Absence-counting still covers
 *    what the tombstones cannot say, and a tombstone that cannot be NAMED is
 *    counted rather than dropped (see `TrashListing`).
 *  - **The path is the natural key**, display-cased (`path_display`), RELATIVE
 *    to the configured root — the same tree lands the same way whichever root
 *    carried it. `sourceRef` is Dropbox's own `id`, stable across renames,
 *    which is how `fetch` finds the bytes and how relocations correlate.
 *
 * `content_hash` is Dropbox's block hash — stable per content, compared only
 * against itself across passes (the same contract Drive's md5 has): unchanged
 * files are never re-sent, changed ones are updated.
 */

import type {
  FileFolder,
  FileItem,
  FileSource,
  RawFileItem,
  SyncCursor,
  TokenProvider,
  TrashListing,
} from '@openmig/shared';
import type {
  DropboxEntry,
  DropboxFileSourceConfig,
  DropboxListFolderResponse,
  DropboxTransport,
} from './dropbox-file-source.types';

const DEFAULT_API_BASE = 'https://api.dropboxapi.com/2';
const DEFAULT_CONTENT_BASE = 'https://content.dropboxapi.com/2';

/** A transport that stamps each request with a freshly minted Bearer token. */
export function dropboxTransport(tokens: TokenProvider): DropboxTransport {
  return async (url, init) => {
    const token = await tokens.getToken();
    return fetch(url, {
      method: init.method,
      headers: { ...init.headers, Authorization: `Bearer ${token.accessToken}` },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  };
}

export class DropboxFileSource implements FileSource {
  private readonly apiBase: string;
  private readonly contentBase: string;
  /** '' (whole Dropbox) or a normalised '/Folder' path. */
  private readonly rootPath: string;
  /** Consume-once memo for `listKeys`, exactly like the Drive source's. */
  private lastListing?: { readonly path: string; readonly keys: ReadonlyArray<string> };

  constructor(
    private readonly transport: DropboxTransport,
    config: DropboxFileSourceConfig = {},
  ) {
    this.apiBase = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '');
    this.contentBase = (config.contentBaseUrl ?? DEFAULT_CONTENT_BASE).replace(/\/$/, '');
    // Dropbox's API spells the root '' and everything else '/x/y' — normalise
    // once here so a config saying 'Team' or '/Team/' means the same folder.
    const raw = (config.rootPath ?? '').trim().replace(/\/+$/, '');
    this.rootPath = raw === '' || raw === '/' ? '' : raw.startsWith('/') ? raw : `/${raw}`;
  }

  private async rpc(path: string, arg: unknown): Promise<unknown> {
    const response = await this.transport(`${this.apiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arg),
    });
    if (!response.ok) {
      // Dropbox's own words, verbatim and truncated — its error bodies name
      // the exact `.tag` path that failed, which is the actionable part.
      const text = await response.text().catch(() => '(no body)');
      throw new Error(`Dropbox answered ${response.status} on ${path}: ${text.slice(0, 300)}`);
    }
    return response.json();
  }

  /** The whole tree under one listing: `list_folder` recursive + continue. */
  private async listAll(
    path: string,
    recursive: boolean,
    includeDeleted = false,
  ): Promise<DropboxEntry[]> {
    const entries: DropboxEntry[] = [];
    let page = (await this.rpc('files/list_folder', {
      path,
      recursive,
      limit: 1000,
      ...(includeDeleted ? { include_deleted: true } : {}),
    })) as DropboxListFolderResponse;
    entries.push(...page.entries);
    let hops = 0;
    while (page.has_more) {
      if (++hops > 1000) {
        throw new Error(
          'Dropbox listing did not stop paging after 1000 continues — refusing to treat a ' +
            'partial listing as the folder.',
        );
      }
      page = (await this.rpc('files/list_folder/continue', {
        cursor: page.cursor,
      })) as DropboxListFolderResponse;
      entries.push(...page.entries);
    }
    return entries;
  }

  /** Display path → root-relative natural-key path. */
  private relativePath(entry: DropboxEntry): string | undefined {
    const display = entry.path_display;
    if (!display) return undefined;
    const relative = this.rootPath === '' ? display : display.slice(this.rootPath.length);
    return relative.replace(/^\//, '');
  }

  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    const out: FileFolder[] = [{ path: '' }];
    for (const entry of await this.listAll(this.rootPath, true)) {
      if (entry['.tag'] !== 'folder') continue;
      const path = this.relativePath(entry);
      if (path) out.push({ path, name: entry.name });
    }
    return out;
  }

  async listSince(
    folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    const apiPath = folder.path === '' ? this.rootPath : `${this.rootPath}/${folder.path}`;
    const items: RawFileItem[] = [];
    for (const entry of await this.listAll(apiPath, false)) {
      if (entry['.tag'] !== 'file') continue;
      const item = this.toFileItem(entry);
      if (item) items.push({ item });
    }
    // For `listKeys`, asked immediately after for the same folder — same
    // listing, so the two cannot disagree about what is there.
    this.lastListing = { path: folder.path, keys: items.map((i) => i.item.path) };
    return {
      items,
      // Deliberately not a delta token (see the module comment).
      nextCursor: { value: `full-listing:${folder.path}` },
    };
  }

  /** The complete key set — what makes moves detectable at all (ADR-0030). */
  async listKeys(folder: FileFolder): Promise<ReadonlyArray<string>> {
    const memo = this.lastListing;
    this.lastListing = undefined;
    if (memo && memo.path === folder.path) return memo.keys;
    const listed = await this.listSince(folder);
    this.lastListing = undefined;
    return listed.items.map((i) => i.item.path);
  }

  /**
   * Root-relative paths of Dropbox's TOMBSTONES (`FileSource.listTrashedPaths`)
   * — positive deletion evidence, added after the first slice deliberately
   * left it out (workplan 0055 T3b, built as this follow-up).
   *
   * `list_folder` with `include_deleted` answers a `.tag: "deleted"` entry
   * for a path whose latest state is deleted — Dropbox's equivalent of a
   * recycle bin (deleted files stay restorable for the account's retention
   * window, and the tombstone lists exactly that window). A path that was
   * deleted and re-created answers as its live file, not a tombstone, so
   * this never contradicts the listing.
   *
   * The evidence class this feeds is `trashed` (the owner threw it away and
   * could still restore it), the same class as Drive's bin read — NOT
   * `reported`: a tombstone is a bin state, not a sync answer. Folder
   * tombstones ride along; a directory path no ledger file row holds
   * resolves to nothing downstream, exactly like Drive's out-of-scope
   * entries.
   */
  async listTrashedPaths(): Promise<TrashListing> {
    const out = new Set<string>();
    let unnameable = 0;
    for (const entry of await this.listAll(this.rootPath, true, true)) {
      if (entry['.tag'] !== 'deleted') continue;
      // The listing is already rooted, so an entry Dropbox gave no
      // `path_display` for is not out of scope — it is one we cannot name
      // (see `TrashListing`). Counted, not dropped.
      if (!entry.path_display) {
        unnameable += 1;
        continue;
      }
      const path = this.relativePath(entry);
      if (path) out.add(path);
    }
    return {
      paths: [...out],
      unnameable,
      ...(unnameable > 0
        ? {
            reason:
              `Dropbox listed ${unnameable} tombstone(s) with no path_display, so where they ` +
              'used to live cannot be named. Those deletions stay on absence-counting and ' +
              'cannot be applied.',
          }
        : {}),
    };
  }

  /**
   * The shared folders this account can see (the 0049/0051 browse, Dropbox's
   * turn) — `sharing/list_folders`, paged, read-only, NEVER used by a pass: a
   * migration's root is a written-down decision. A MOUNTED shared folder
   * lives in the account's tree (its `path_lower` says where) and migrates as
   * ordinary content already; the browse answers "which path do I put in
   * rootPath?" without archaeology. An unmounted one is listed with no path —
   * shown so the owner knows it exists, mountable only from Dropbox itself.
   *
   * Needs the `sharing.read` scope beside the two files scopes; an app
   * created without it gets Dropbox's own refusal verbatim, naming the scope.
   */
  async listSharedFolders(): Promise<
    ReadonlyArray<{ id: string; name: string; path?: string }>
  > {
    const out: Array<{ id: string; name: string; path?: string }> = [];
    let page = (await this.rpc('sharing/list_folders', { limit: 100 })) as {
      entries: ReadonlyArray<{ shared_folder_id: string; name: string; path_lower?: string }>;
      cursor?: string;
    };
    for (;;) {
      for (const e of page.entries) {
        out.push({
          id: e.shared_folder_id,
          name: e.name,
          ...(e.path_lower ? { path: e.path_lower } : {}),
        });
      }
      if (!page.cursor) break;
      page = (await this.rpc('sharing/list_folders/continue', { cursor: page.cursor })) as typeof page;
    }
    return out;
  }

  async fetch(item: FileItem): Promise<RawFileItem> {
    const ref = item.sourceRef;
    if (!ref) {
      throw new Error(`No Dropbox file id recorded for "${item.path}" — cannot fetch it.`);
    }
    const response = await this.transport(`${this.contentBase}/files/download`, {
      method: 'POST',
      headers: {
        // The download endpoint takes its argument in a HEADER; a body would
        // be rejected. The id form is used because it survives renames.
        'Dropbox-API-Arg': JSON.stringify({ path: ref }),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      throw new Error(
        `Dropbox refused the download of "${item.path}" (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return { item, content: new Uint8Array(await response.arrayBuffer()) };
  }

  private toFileItem(entry: DropboxEntry): FileItem | undefined {
    const path = this.relativePath(entry);
    if (!path || !entry.id) return undefined;
    return {
      path,
      name: entry.name,
      isDirectory: false,
      size: entry.size ?? 0,
      // Dropbox's block hash: stable per content, compared against itself
      // across passes — the same contract Drive's md5 carries.
      ...(entry.content_hash ? { contentHash: entry.content_hash } : {}),
      modifiedAt: entry.server_modified ?? entry.client_modified ?? new Date(0).toISOString(),
      // The source's own handle — stable across renames, unlike the path.
      sourceRef: entry.id,
    };
  }
}
