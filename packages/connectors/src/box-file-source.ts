// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Box as a file source (workplan 0056) — the fourth file provider, MODELLED
 * ON THE DRIVE SOURCE because Box's API has Drive's shape: folders and files
 * are addressed by ID, a folder has a name but never a path, and the
 * migration is rooted at a configured folder id. The decisions Drive wrote
 * down apply unchanged:
 *
 *  - **No delta.** Box's events stream (`/events`) reports the whole account,
 *    and `FileSource.listSince` is per folder with one cursor per folder —
 *    the same mismatch that made Drive's `changes.list` wrong to use (0026
 *    T1's lesson). Every pass lists the folder; the natural key plus the
 *    ledger provide idempotency. Slower than a delta and CORRECT, in that
 *    order.
 *  - **`removed` is never populated**, but the bin IS read: `listTrashedPaths`
 *    below turns `GET /folders/trash/items` into the `trashed` evidence class
 *    — the same bin read Drive, Dropbox and Nextcloud have, and the reason a
 *    Box deletion can be APPLIED rather than only reported (ADR-0024 gate 3
 *    refuses `inferred` however many passes it survives). Absence-counting
 *    still covers what the bin cannot say, and what the bin could not NAME
 *    is counted rather than dropped — see `TrashListing`.
 *  - **The path is the natural key**, DERIVED root-relative by the folder
 *    walk (a Box item has no path of its own), composed by one function for
 *    listings and keys both. `sourceRef` is Box's own `id` — stable across
 *    renames, how `fetch` finds the bytes, how relocations correlate.
 *
 * `sha1` is Box's per-content hash — compared only against itself across
 * passes (the same contract Drive's md5 and Dropbox's content_hash carry).
 *
 * **Web links** (Box bookmarks) are pointers, not files: they are not
 * enumerated, and the feature matrix says so — a bookmark cannot arrive as
 * bytes on any target this product writes.
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
import type { BoxFileSourceConfig, BoxItem, BoxItemList, BoxTransport } from './box-file-source.types.ts';

const DEFAULT_BASE = 'https://api.box.com/2.0';
/** Box's spelling of the account root ("All Files"). */
const BOX_ROOT = '0';
const ITEM_FIELDS = 'id,type,name,size,sha1,modified_at,created_at';
/** The bin read needs the ancestor chain; the ordinary listing never asks for it. */
const TRASH_FIELDS = 'id,type,name,path_collection';

/** A transport that stamps each request with a freshly minted Bearer token. */
export function boxTransport(tokens: TokenProvider): BoxTransport {
  return async (url, init) => {
    const token = await tokens.getToken();
    return fetch(url, {
      method: init.method,
      headers: { ...init.headers, Authorization: `Bearer ${token.accessToken}` },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  };
}

export class BoxFileSource implements FileSource {
  private readonly baseUrl: string;
  private readonly rootFolderId: string;
  /** Consume-once memo for `listKeys`, exactly like the Drive source's. */
  private lastListing?: { readonly path: string; readonly keys: ReadonlyArray<string> };

  private readonly transport: BoxTransport;
  constructor(
    transport: BoxTransport,
    config: BoxFileSourceConfig = {},
  ) {
    this.transport = transport;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.rootFolderId = config.rootFolderId ?? BOX_ROOT;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.transport(url, { method: 'GET', headers: {} });
    if (!response.ok) {
      // Verbatim, including the server's own body: a migration that stops must
      // say what the other end said (rule 9).
      throw new Error(`Box API ${response.status} for ${url}: ${await safeText(response)}`);
    }
    return response.json();
  }

  /**
   * Every folder under the root, depth-first, as root-relative paths — the
   * derivation the natural key stands on, done once, in one place.
   */
  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    const out: FileFolder[] = [{ path: '' }];
    const walk = async (folderId: string, prefix: string): Promise<void> => {
      for (const child of await this.listChildren(folderId, 'folder')) {
        const path = prefix ? `${prefix}/${child.name}` : child.name;
        out.push({ path, name: child.name });
        await walk(child.id, path);
      }
    };
    await walk(this.rootFolderId, '');
    return out;
  }

  /**
   * The folder's files, METADATA ONLY — bytes come from `fetch`, one item at
   * a time, inside the sync loop's bounded concurrency. The cursor is NOT a
   * delta token (see the module header): every pass sees every file, and the
   * ledger makes the second pass create nothing.
   */
  async listSince(
    folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    const folderId = await this.resolveFolderId(folder.path);
    const items: RawFileItem[] = [];
    for (const file of await this.listChildren(folderId, 'file')) {
      items.push({ item: this.toFileItem(file, this.childPath(folder.path, file.name)) });
    }
    // For `listKeys`, asked immediately after for the same folder — same
    // listing, so the two cannot disagree about what is there.
    this.lastListing = { path: folder.path, keys: items.map((i) => i.item.path) };
    return {
      items,
      // Deliberately not a delta token (see the module header).
      nextCursor: { value: `full-listing:${folder.path}` },
    };
  }

  /** The complete key set — what makes moves detectable at all (ADR-0030). */
  async listKeys(folder: FileFolder): Promise<ReadonlyArray<string>> {
    const memo = this.lastListing;
    this.lastListing = undefined;
    if (memo && memo.path === folder.path) return memo.keys;
    const folderId = await this.resolveFolderId(folder.path);
    return (await this.listChildren(folderId, 'file')).map((f) =>
      this.childPath(folder.path, f.name),
    );
  }

  /** One composition for the path-shaped natural key — listings and keys both. */
  private childPath(folderPath: string, name: string): string {
    return folderPath ? `${folderPath}/${name}` : name;
  }

  /**
   * Original root-relative paths of items in the account's TRASH
   * (`FileSource.listTrashedPaths`) — Box's turn at the bin read.
   *
   * THE EVIDENCE THIS BUYS is the whole point (ADR-0024 gate 3): absence
   * alone is `inferred`, which is reported to the owner but may never gate a
   * destructive action, so before this the Box Deletions queue was a to-do
   * list with the apply action permanently withheld. An item in the trash is
   * the owner's own deletion, found where they put it — positive `trashed`
   * evidence, the same class Drive, Dropbox and Nextcloud already answer.
   *
   * ONE listing, not Drive's per-file parent walk: Box answers
   * `path_collection` — the ordered ancestor chain, id and name per level —
   * on each entry, so the original path is composed from what the listing
   * already carried. Folders ride along; a directory path no ledger file row
   * holds resolves to nothing downstream, exactly like Dropbox's folder
   * tombstones.
   *
   * TWO KINDS OF SKIP, reported differently on purpose (see `TrashListing`):
   * an entry whose ancestor chain never passes the configured root was not in
   * this migration and is skipped silently, while an entry Box gave no usable
   * chain for probably WAS in scope and is counted as `unnameable` — those
   * deletions fall back to absence-counting, which costs the owner the apply
   * action, and a count is what lets anyone say why.
   *
   * Descendants of a trashed FOLDER may not be listed individually by Box
   * (unlike Drive, which marks every descendant trashed). Where they are not,
   * those files stay on absence-counting — this read never claims to cover
   * what it did not see.
   */
  async listTrashedPaths(): Promise<TrashListing> {
    const entries = await this.listTrashItems();
    if (entries.length === 0) return { paths: [], unnameable: 0 };

    const out = new Set<string>();
    let unnameable = 0;
    for (const entry of entries) {
      const resolved = this.originalPathOf(entry);
      if (resolved.path !== undefined) out.add(resolved.path);
      else if (resolved.why === 'unnameable') unnameable += 1;
    }

    return {
      paths: [...out],
      unnameable,
      ...(unnameable > 0
        ? {
            reason:
              `Box listed ${unnameable} trashed item(s) without a usable path_collection, so ` +
              'where they used to live cannot be named. If this is EVERY item in the bin, Box ' +
              'is answering the ancestor chain for trashed items differently than this read ' +
              'expects — either way those deletions stay on absence-counting and cannot be ' +
              'applied.',
          }
        : {}),
    };
  }

  /** The trash, marker-paged, asking for the ancestor chain up front. */
  private async listTrashItems(): Promise<BoxItem[]> {
    const found: BoxItem[] = [];
    let marker: string | undefined;
    let hops = 0;
    do {
      if (++hops > 1000) {
        throw new Error(
          'Box trash listing did not stop paging after 1000 markers — refusing to treat a ' +
            'partial listing as the bin.',
        );
      }
      const url =
        `${this.baseUrl}/folders/trash/items` +
        `?limit=1000&usemarker=true&fields=${encodeURIComponent(TRASH_FIELDS)}` +
        (marker ? `&marker=${encodeURIComponent(marker)}` : '');
      const page = (await this.getJson(url)) as BoxItemList;
      found.push(...(page.entries ?? []).filter((e) => e.type !== 'web_link'));
      marker = page.next_marker;
    } while (marker);
    return found;
  }

  /**
   * The path an item HAD, from the ancestor chain the listing carried — and
   * when there is none, WHICH kind of nothing it is. The two are different
   * answers: `out_of_scope` is arithmetic (the item was never in this
   * migration), `unnameable` is a blind spot worth counting.
   */
  private originalPathOf(entry: BoxItem): {
    path?: string;
    why?: 'out_of_scope' | 'unnameable';
  } {
    const chain = entry.path_collection?.entries;
    // Box answered no ancestors at all: this item may well have been in scope
    // and there is no way to say where it lived.
    if (!chain || chain.length === 0) return { why: 'unnameable' };
    // The chain runs root-first. Everything BELOW the configured root is the
    // path; a chain that never passes through it was never ours to report.
    const rootAt = chain.findIndex((ancestor) => ancestor.id === this.rootFolderId);
    if (rootAt === -1) return { why: 'out_of_scope' };
    const segments = chain.slice(rootAt + 1).map((ancestor) => ancestor.name);
    return { path: this.childPath(segments.join('/'), entry.name) };
  }

  /**
   * One file's bytes. Box answers `GET /files/{id}/content` with a redirect
   * to a signed download URL; fetch follows it (the signed URL needs no
   * Authorization header, which is also why losing the header across the
   * cross-origin hop is fine).
   */
  async fetch(item: FileItem): Promise<RawFileItem> {
    const ref = item.sourceRef;
    if (!ref) {
      throw new Error(`No Box file id recorded for "${item.path}" — cannot fetch it.`);
    }
    const response = await this.transport(
      `${this.baseUrl}/files/${encodeURIComponent(ref)}/content`,
      { method: 'GET', headers: {} },
    );
    if (!response.ok) {
      throw new Error(
        `Box refused the download of "${item.path}" (${response.status}): ${await safeText(response)}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { item: { ...item, size: bytes.byteLength }, content: bytes };
  }

  /** Children of a folder, one type at a time, marker-paged to the end. */
  private async listChildren(folderId: string, type: 'file' | 'folder'): Promise<BoxItem[]> {
    const found: BoxItem[] = [];
    let marker: string | undefined;
    let hops = 0;
    do {
      if (++hops > 1000) {
        throw new Error(
          'Box listing did not stop paging after 1000 markers — refusing to treat a partial ' +
            'listing as the folder.',
        );
      }
      const url =
        `${this.baseUrl}/folders/${encodeURIComponent(folderId)}/items` +
        `?limit=1000&usemarker=true&fields=${encodeURIComponent(ITEM_FIELDS)}` +
        (marker ? `&marker=${encodeURIComponent(marker)}` : '');
      const page = (await this.getJson(url)) as BoxItemList;
      found.push(...(page.entries ?? []).filter((e) => e.type === type));
      marker = page.next_marker;
    } while (marker);
    return found;
  }

  /** Walk the derived path back to the id it names. */
  private async resolveFolderId(path: string): Promise<string> {
    if (!path) return this.rootFolderId;
    let current = this.rootFolderId;
    for (const segment of path.split('/')) {
      const children = await this.listChildren(current, 'folder');
      const match = children.find((c) => c.name === segment);
      if (!match) {
        throw new Error(`No folder "${segment}" under "${path}" in this Box.`);
      }
      current = match.id;
    }
    return current;
  }

  private toFileItem(file: BoxItem, path: string): FileItem {
    return {
      path,
      name: file.name,
      isDirectory: false,
      size: file.size ?? 0,
      // Box's sha1: stable per content, compared against itself across
      // passes — the same contract Drive's md5 carries.
      ...(file.sha1 ? { contentHash: file.sha1 } : {}),
      modifiedAt: file.modified_at ?? new Date(0).toISOString(),
      ...(file.created_at ? { createdAt: file.created_at } : {}),
      // The source's own handle — stable across renames, unlike the path.
      sourceRef: file.id,
    };
  }
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}
