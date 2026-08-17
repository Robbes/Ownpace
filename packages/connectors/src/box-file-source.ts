// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
 *  - **`removed` is never populated.** Absence-counting provides deletion
 *    detection; a trash read (`GET /folders/trash/items`) that recovers
 *    ORIGINAL paths is its own later slice — recorded in the workplan, not
 *    implied away.
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

import type { FileFolder, FileItem, FileSource, RawFileItem, SyncCursor, TokenProvider } from '@openmig/shared';
import type { BoxFileSourceConfig, BoxItem, BoxItemList, BoxTransport } from './box-file-source.types';

const DEFAULT_BASE = 'https://api.box.com/2.0';
/** Box's spelling of the account root ("All Files"). */
const BOX_ROOT = '0';
const ITEM_FIELDS = 'id,type,name,size,sha1,modified_at,created_at';

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

  constructor(
    private readonly transport: BoxTransport,
    config: BoxFileSourceConfig = {},
  ) {
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
