// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Google Drive as a file source — the first slice (workplan 0042).
 *
 * MODELLED ON WEBDAV, NOT ON GRAPH, and that is the central decision.
 *
 * `graph-drive-source.ts` is the closest connector by shape, but copying it
 * would have dragged in the two things about Drive that can lose customer data:
 *
 *  - **Delta.** `FileSource.listSince` is per FOLDER and the sync loop stores one
 *    cursor per folder (`uk_cursor_tenant_mapping_folder`). Graph fits because
 *    its delta can be scoped by folder path. Drive's `changes.list` reports the
 *    WHOLE drive, so calling it per folder and filtering reproduces — in a
 *    connector written after the lesson — the defect 0026 T1 already paid for:
 *    every folder's poll processing every item on the drive.
 *
 *    So this slice does not use `changes.list` at all. It enumerates the folder,
 *    exactly as `WebdavFileSource` does, and lets the natural key plus the ledger
 *    provide idempotency. A pass costs a listing per folder and creates zero on
 *    the second run. That is slower than a delta and it is CORRECT, which is the
 *    right order to do them in.
 *
 *  - **`removed`.** Drive sets `removed: true` on a change for events that are
 *    not deletions — losing access, a file leaving a shared drive's scope, a
 *    sharing change. `resolveReportedRemovals` treats that field as the one place
 *    a deletion is KNOWN rather than suspected, and items arriving through it
 *    become owner-actionable destructive evidence under ADR-0024. So this
 *    connector NEVER populates it. WebDAV does not either; the slower
 *    absence-based detector does its corroborated job instead.
 *
 * NATIVE EDITOR FILES. A Google Doc has no bytes. Under the default policy it is
 * not skipped — silently omitting it would tell the owner their Docs "migrated"
 * — but surfaced as a per-item failure carrying a verbatim reason, which lands
 * in the failures queue the owner already reads. That reuses the isolation the
 * sync loop already has rather than inventing a channel.
 *
 * WHAT THIS SLICE DOES NOT DO, deliberately, each recorded in the workplan:
 * incremental delta, deletion reporting, shared-drive scoping, rename-in-place
 * detection, and same-name siblings (which the ledger's unique index on the
 * natural key cannot represent at all).
 */

import {
  permissionsNotDiscoverable,
  type FileSource,
  type FileFolder,
  type FileItem,
  type PermissionGrant,
  type PermissionListing,
  type RawFileItem,
  type SyncCursor,
  type TrashListing,
} from '@openmig/shared';
import {
  DRIVE_FOLDER_MIME,
  GOOGLE_NATIVE_PREFIX,
  NATIVE_EXPORT_TYPES,
  type DriveFile,
  type DriveFileList,
  type DriveTransport,
  type GoogleDriveSourceConfig,
  type NativeFilePolicy,
} from './google-drive-source.types';

const DEFAULT_BASE = 'https://www.googleapis.com/drive/v3';

/** Thrown per item, so one un-migratable file never fails a whole folder. */
export class NativeFileRefused extends Error {
  constructor(name: string, mimeType: string) {
    super(
      `"${name}" is a Google ${mimeType.slice(GOOGLE_NATIVE_PREFIX.length)} and has no file to ` +
        'copy. Migrating it means asking Drive to EXPORT a rendering (.docx, .pdf, …), which is ' +
        'lossy — the original is not recoverable from the result — and is not copied here because ' +
        'this migration is configured with nativeFilePolicy="refuse". Set an export policy on the ' +
        'mapping to migrate these, or move them out of scope.',
    );
    this.name = 'NativeFileRefused';
  }
}

export function isNativeEditorFile(mimeType: string): boolean {
  return mimeType.startsWith(GOOGLE_NATIVE_PREFIX) && mimeType !== DRIVE_FOLDER_MIME;
}

/**
 * Query parameters without which the Drive API PRETENDS a shared drive is
 * empty.
 *
 * `files.list` scoped to a parent inside a shared drive answers 200 with an
 * EMPTY `files` array unless `includeItemsFromAllDrives` and
 * `supportsAllDrives` are both set — not an error, an empty folder. The shape
 * of that failure is the worst one this connector can produce: a
 * `rootFolderId` naming a shared drive (which the setup docs explicitly
 * support) would discover zero files, list zero files, and complete every
 * pass clean, having migrated nothing. `files.get` (metadata and `alt=media`)
 * 404s on shared-drive items without `supportsAllDrives`. `files.export`
 * takes neither parameter — an export is addressed by file id alone — which
 * is why the export URL builder does not use these.
 */
const LIST_ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const GET_ALL_DRIVES = 'supportsAllDrives=true';

export class GoogleDriveSource implements FileSource {
  private readonly baseUrl: string;
  private readonly rootFolderId: string;
  private readonly policy: NativeFilePolicy;
  /**
   * The listing `listSince` just made, held for `listKeys` to answer from.
   *
   * CONSUME-ONCE: `listKeys` clears it before doing anything else, and every
   * `listSince` overwrites it — so the memo never survives two reads and never
   * outlives the next listing. Under the sync loop's actual order (`listSince`,
   * then `listKeys`, same folder) a stale answer is therefore impossible; under
   * any other order the memo misses and `listKeys` lists for itself, costing
   * one extra request. The one residue worth naming: if a future loop ever
   * called `listKeys` FIRST, it could consume the previous pass's listing —
   * one pass old, same folder — which can only ADD keys to the seen-set and
   * so under-reports absences for a pass; it can never invent one. The safe
   * direction, and the end-to-end test in core pins the real order anyway.
   */
  private lastListing?: { readonly path: string; readonly keys: ReadonlyArray<string> };
  /** The ACTUAL id behind a `rootFolderId` of `'root'` — see `actualRootId`. */
  private rootIdResolved?: string;

  constructor(
    private readonly transport: DriveTransport,
    config: GoogleDriveSourceConfig = {},
  ) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.rootFolderId = config.rootFolderId ?? 'root';
    // Defaults to refusing, not exporting. See NativeFilePolicy: of the two ways
    // to be wrong, only "your Docs did not migrate, and here is why" is one an
    // owner can act on.
    this.policy = config.nativeFilePolicy ?? 'refuse';
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.transport(url);
    if (!response.ok) {
      // Verbatim, including the server's own body: a migration that stops must
      // say what the other end said (rule 9).
      throw new Error(`Drive API ${response.status} for ${url}: ${await safeText(response)}`);
    }
    return response.json();
  }

  /**
   * Every folder under the root, depth-first, as root-relative paths.
   *
   * Paths are DERIVED here — a Drive folder has an id and a name, never a path —
   * and the derivation is the natural key's foundation, which is why it is done
   * once, in one place, rather than reconstructed per item.
   */
  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    const out: FileFolder[] = [{ path: '' }];
    const walk = async (folderId: string, prefix: string): Promise<void> => {
      for (const child of await this.listChildren(folderId, true)) {
        const path = prefix ? `${prefix}/${child.name}` : child.name;
        out.push({ path, name: child.name });
        await walk(child.id, path);
      }
    };
    await walk(this.rootFolderId, '');
    return out;
  }

  /**
   * The folder's files, METADATA ONLY — bytes come from `fetch`, one item at a
   * time, inside the sync loop's bounded concurrency. Listing them inline is the
   * mistake `ports.ts` records WebDAV having made: it ignores `concurrency`
   * entirely and holds a whole folder's bytes in memory at once.
   *
   * The cursor is returned for the loop's benefit and is NOT a delta token —
   * see the file header. Every pass sees every file; the ledger makes the second
   * pass create nothing.
   */
  async listSince(
    folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    const folderId = await this.resolveFolderId(folder.path);
    const items: RawFileItem[] = [];

    for (const file of await this.listChildren(folderId, false)) {
      items.push({ item: this.toFileItem(file, this.childPath(folder.path, file.name)) });
    }

    // For `listKeys`, which the loop asks immediately after this for the same
    // folder. Same listing, so the two cannot disagree about what is there.
    this.lastListing = { path: folder.path, keys: items.map((i) => i.item.path) };

    return {
      items,
      // Deliberately not a delta token. A value that LOOKED like one would
      // invite somebody to trust it as a change filter, and nothing here
      // computes one.
      nextCursor: { value: `full-listing:${folder.path}` },
    };
  }

  /**
   * Every file path currently in the folder — the complete key set
   * (`FileSource.listKeys`).
   *
   * THIS METHOD IS WHY DRIVE MOVES ARE DETECTABLE AT ALL, and its absence was
   * a bug that no test saw and an owner would have met as silence. The sync
   * loop treats a listing as complete only when there was no cursor or the
   * source can answer for its whole key set; production always configures
   * cursors, and `listSince` above returns one (a sentinel, but the loop
   * cannot know that). So without this, every pass after the first counted
   * its key set incomplete, `detectPathKeyedMoves` never ran, and a rename, a
   * move or a deletion in Drive surfaced NOWHERE — the ADR-0030 relocation
   * path was unreachable through the one connector that motivated it, while
   * every pass reported clean.
   *
   * Answers from the listing `listSince` just made when it can (consume-once
   * — see `lastListing`), so the detector costs no second `files.list` per
   * folder. Paths are composed by the same `childPath` the items go through,
   * because the loop hashes both sides into the same natural key and two
   * compositions that "should" agree is how a whole corpus reads as moved.
   */
  async listKeys(folder: FileFolder): Promise<ReadonlyArray<string>> {
    const memo = this.lastListing;
    this.lastListing = undefined;
    if (memo && memo.path === folder.path) return memo.keys;

    const folderId = await this.resolveFolderId(folder.path);
    return (await this.listChildren(folderId, false)).map((f) =>
      this.childPath(folder.path, f.name),
    );
  }

  /**
   * One composition for the path-shaped natural key, used by `listSince` and
   * `listKeys` both — the derivation §10 keys the whole ledger on.
   */
  private childPath(folderPath: string, name: string): string {
    return folderPath ? `${folderPath}/${name}` : name;
  }

  /**
   * Original root-relative paths of files in the owner's Drive bin
   * (`FileSource.listTrashedPaths`).
   *
   * THE EVIDENCE THIS BUYS is the point (ADR-0024 gate 3): absence is never
   * enough to remove anything, so until this existed every Drive deletion was
   * `inferred` — reported, but with the apply action permanently withheld. A
   * file in the bin is the owner's own deletion, found where they put it: the
   * same positive `trashed` evidence the Nextcloud source has had all along,
   * and the file domain's Deletions queue works identically for both.
   *
   * `trashed=true` is answered for implicitly-trashed descendants too — trash
   * a folder and Drive marks everything under it trashed, `explicitlyTrashed`
   * only on the folder — so one whole-account listing sees the entire bin.
   * Whole-account is the port's contract: entries the ledger never held
   * resolve to nothing downstream.
   *
   * A trashed file keeps its `parents`, so the ORIGINAL path — the natural
   * key — is recovered by walking parents up to the migration root, folder
   * metadata cached per call. Two honest exclusions, both per-file so one
   * unresolvable entry cannot silence the bin: a chain that tops out without
   * meeting the root was never inside this migration's scope, and a chain
   * broken by a permanently-deleted ancestor has no nameable path — that file
   * stays on absence-counting, which still works and says less.
   */
  /**
   * The shared drives this credential can see (workplan 0049) — `drives.list`,
   * paged, read-only. This is the onboarding question ("which id do I put in
   * rootFolderId?") answered by the API instead of by a walk through the
   * Google admin console. NOT used by any pass: a migration's root is a
   * written-down decision, never an enumeration.
   */
  async listSharedDrives(): Promise<ReadonlyArray<{ id: string; name: string }>> {
    const drives: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined;
    do {
      const url =
        `${this.baseUrl}/drives?pageSize=100&fields=${encodeURIComponent('drives(id,name),nextPageToken')}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const page = (await this.getJson(url)) as {
        drives?: Array<{ id: string; name: string }>;
        nextPageToken?: string;
      };
      drives.push(...(page.drives ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return drives;
  }

  /**
   * The FOLDERS other accounts shared with this one (workplan 0051) — the
   * other half of the browse. "Shared with me" is a view, not a folder: its
   * items carry no parent under any root, so no walk from `rootFolderId` can
   * reach them. The supported move is to root a SEPARATE mapping at the
   * shared folder's own id — the same parent-scoped listing every root uses —
   * and this enumeration answers "which id?" exactly as `listSharedDrives`
   * does for shared drives. Read-only; NOT used by any pass. Loose shared
   * FILES (not inside a folder you root at) remain out of scope, and the
   * feature matrix says so.
   *
   * The owner's address rides along because two people can each share a
   * folder named "Administratie" — a picker showing the bare names would be
   * a coin flip.
   */
  async listSharedWithMeFolders(): Promise<
    ReadonlyArray<{ id: string; name: string; owner?: string }>
  > {
    const q = `sharedWithMe=true and mimeType='${DRIVE_FOLDER_MIME}' and trashed=false`;
    const fields = 'nextPageToken,files(id,name,owners(emailAddress))';
    const found: Array<{ id: string; name: string; owner?: string }> = [];
    let pageToken: string | undefined;
    do {
      const url =
        `${this.baseUrl}/files?q=${encodeURIComponent(q)}&pageSize=100` +
        `&fields=${encodeURIComponent(fields)}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const page = (await this.getJson(url)) as {
        files?: Array<{ id: string; name: string; owners?: Array<{ emailAddress?: string }> }>;
        nextPageToken?: string;
      };
      for (const f of page.files ?? []) {
        const owner = f.owners?.[0]?.emailAddress;
        found.push({ id: f.id, name: f.name, ...(owner ? { owner } : {}) });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return found;
  }

  /**
   * Everything this account OWNS that somebody else can reach (workplan 0029,
   * the Google half) — the outbound-share inventory feeding the §14.2
   * permission report.
   *
   * ONE paged `files.list` over `'me' in owners`, permissions riding along in
   * the fields — Drive populates `permissions` on owned My-Drive files, so
   * this never becomes a per-file crawl the way the Graph scan's second phase
   * is. Scope is exactly that: files the account owns. A shared DRIVE's
   * membership is drive-level and its files are owned by the drive, not the
   * account, so nothing here speaks for shared drives — the report's
   * blind-spot section and the docs say so rather than letting this listing
   * read as the whole picture (hard rule 9).
   *
   * The owner's own permission row is skipped (it is not a share); an
   * `anyone` grant is flagged `viaLink` — "anyone with the link" is the
   * finding an owner most often does not know about. `raw` keeps Drive's own
   * fields verbatim, exactly as the Graph scan keeps Graph's.
   *
   * Capped like the Graph scan, and a hit cap answers `not_discoverable`,
   * never a short list dressed as the whole one.
   */
  async listOwnedShareGrants(options?: { maxSharedItems?: number }): Promise<PermissionListing> {
    const maxItems = options?.maxSharedItems ?? 500;
    const q = `'me' in owners and trashed=false`;
    const fields =
      'nextPageToken,files(id,name,shared,permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery))';

    const grants: PermissionGrant[] = [];
    let sharedItems = 0;
    let pageToken: string | undefined;
    let pages = 0;
    try {
      do {
        if (++pages > 100) {
          return {
            kind: 'not_discoverable',
            reason: permissionsNotDiscoverable(
              'the Drive listing did not stop paging after 100 pages — refusing to report a ' +
                'partial set as complete',
            ),
          };
        }
        const url =
          `${this.baseUrl}/files?q=${encodeURIComponent(q)}&pageSize=100` +
          `&fields=${encodeURIComponent(fields)}` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const page = (await this.getJson(url)) as {
          files?: Array<{
            id: string;
            name: string;
            shared?: boolean;
            permissions?: Array<{
              type?: string;
              role?: string;
              emailAddress?: string;
              domain?: string;
              displayName?: string;
              allowFileDiscovery?: boolean;
            }>;
          }>;
          nextPageToken?: string;
        };
        for (const file of page.files ?? []) {
          const shares = (file.permissions ?? []).filter((p) => p.role !== 'owner');
          if (shares.length === 0) continue;
          if (++sharedItems > maxItems) {
            return {
              kind: 'not_discoverable',
              reason: permissionsNotDiscoverable(
                `more than ${maxItems} owned items are shared, which is more than this report ` +
                  'can inventory. The list would be partial, and a partial list read as ' +
                  'complete is how a share nobody knew about survives a cutover',
              ),
            };
          }
          for (const perm of shares) {
            const grantee =
              perm.emailAddress ??
              perm.domain ??
              (perm.type === 'anyone' ? undefined : perm.displayName);
            grants.push({
              subject: 'drive_item',
              on: file.name,
              role: perm.role ?? 'unknown',
              ...(grantee ? { grantee } : {}),
              ...(perm.type === 'anyone' ? { viaLink: true } : {}),
              raw: JSON.stringify({ fileId: file.id, ...perm }),
            });
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err) {
      return {
        kind: 'not_discoverable',
        reason: permissionsNotDiscoverable(err instanceof Error ? err.message : String(err)),
      };
    }
    return { kind: 'listed', grants };
  }

  async listTrashedPaths(): Promise<TrashListing> {
    const q = `trashed=true and mimeType!='${DRIVE_FOLDER_MIME}'`;
    const fields = 'nextPageToken,files(id,name,parents)';

    const binned: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url =
        `${this.baseUrl}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}` +
        `&${LIST_ALL_DRIVES}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const page = (await this.getJson(url)) as DriveFileList;
      binned.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    if (binned.length === 0) return { paths: [], unnameable: 0 };

    const rootId = await this.actualRootId();
    // Folder metadata, cached: bins hold cohorts (a folder trashed whole), and
    // re-walking the shared ancestry per file would ask Drive the same
    // questions N times.
    const folders = new Map<string, { name: string; parent?: string }>();
    const out = new Set<string>();
    let unnameable = 0;

    for (const file of binned) {
      const resolved = await this.originalPathOf(file, rootId, folders);
      if (resolved.path !== undefined) out.add(resolved.path);
      else if (resolved.why === 'unnameable') unnameable += 1;
    }
    return {
      paths: [...out],
      unnameable,
      ...(unnameable > 0
        ? {
            reason:
              `${unnameable} file(s) in the Drive bin have an ancestor folder that was ` +
              'permanently deleted (or a parent Drive would not name), so the path they used ' +
              'to have cannot be reconstructed. Those deletions stay on absence-counting and ' +
              'cannot be applied.',
          }
        : {}),
    };
  }

  /**
   * Walk `file`'s parents up to the root.
   *
   * When there is no path to report, WHICH kind of nothing matters (see
   * `TrashListing`): a chain that tops out somewhere else means the file was
   * never in this migration — arithmetic, silent — while a chain we cannot
   * follow means it probably WAS and we cannot say where, which is a blind
   * spot worth counting.
   */
  private async originalPathOf(
    file: DriveFile,
    rootId: string,
    folders: Map<string, { name: string; parent?: string }>,
  ): Promise<{ path?: string; why?: 'out_of_scope' | 'unnameable' }> {
    const segments: string[] = [];
    let current = file.parents?.[0];
    // Drive named no parent at all, so nothing places this file — including
    // whether it was ours. Not the same as a chain that ends elsewhere.
    if (current === undefined) return { why: 'unnameable' };
    // A parent chain deeper than this is a cycle, not a Drive.
    for (let depth = 0; depth < 64; depth += 1) {
      if (current === undefined) return { why: 'out_of_scope' }; // topped out ≠ our root
      if (current === rootId) {
        // Pushed child-upward; the path reads root-downward.
        return { path: this.childPath([...segments].reverse().join('/'), file.name) };
      }
      let meta = folders.get(current);
      if (!meta) {
        try {
          const got = (await this.getJson(
            `${this.baseUrl}/files/${encodeURIComponent(current)}?fields=id,name,parents&${GET_ALL_DRIVES}`,
          )) as DriveFile;
          meta = { name: got.name, ...(got.parents?.[0] ? { parent: got.parents[0] } : {}) };
          folders.set(current, meta);
        } catch {
          // A permanently-deleted ancestor: this file's original path cannot
          // be named, so it cannot be reported — absence-counting covers it,
          // and the count says the apply action was lost for a reason.
          return { why: 'unnameable' };
        }
      }
      segments.push(meta.name);
      current = meta.parent;
    }
    return { why: 'unnameable' };
  }

  /**
   * The real id behind the configured root. `'root'` is an API alias the
   * caller may configure, but a trashed file's `parents` carry the ACTUAL id,
   * so comparing against the alias would walk past the root and read every
   * in-scope file as out of scope — the whole bin, silently ignored.
   */
  private async actualRootId(): Promise<string> {
    if (this.rootFolderId !== 'root') return this.rootFolderId;
    if (this.rootIdResolved === undefined) {
      const got = (await this.getJson(
        `${this.baseUrl}/files/root?fields=id&${GET_ALL_DRIVES}`,
      )) as DriveFile;
      this.rootIdResolved = got.id;
    }
    return this.rootIdResolved;
  }

  /**
   * One file's bytes.
   *
   * A native editor file throws here rather than earlier, on purpose: the throw
   * happens inside the sync loop's per-item boundary, so it is recorded as that
   * item's failure with the reason verbatim and the rest of the folder migrates.
   * Refusing during the listing would have cost the whole folder.
   */
  async fetch(item: FileItem): Promise<RawFileItem> {
    const fileId = item.sourceRef;
    if (!fileId) {
      throw new Error(`No Drive file id recorded for "${item.path}" — cannot fetch it.`);
    }

    // The mime type is re-read rather than carried on the item, because
    // `FileItem` has no field for it and inventing one by cast would put a
    // field in the type that is not in the type. One extra metadata call per
    // file is the honest cost; a heuristic ("no checksum, so probably native")
    // in a path that decides whether customer data is copied is not.
    const meta = (await this.getJson(
      `${this.baseUrl}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&${GET_ALL_DRIVES}`,
    )) as DriveFile;

    const refusal = this.refusalFor(meta);
    if (refusal) {
      // Thrown INSIDE the sync loop's per-item boundary, so it is recorded as
      // this item's failure with the reason verbatim and the rest of the folder
      // still migrates. Refusing during the listing would have cost the folder.
      throw refusal;
    }

    const url =
      this.exportUrlFor(meta) ??
      `${this.baseUrl}/files/${encodeURIComponent(fileId)}?alt=media&${GET_ALL_DRIVES}`;

    const response = await this.transport(url);
    if (!response.ok) {
      throw new Error(
        `Drive refused the download of "${item.path}" (${response.status}): ` +
          `${await safeText(response)}`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return { item: { ...item, size: bytes.byteLength }, content: bytes };
  }

  /** Children of a folder: either the sub-folders, or everything that is not one. */
  private async listChildren(folderId: string, foldersOnly: boolean): Promise<DriveFile[]> {
    const clause = foldersOnly
      ? `mimeType='${DRIVE_FOLDER_MIME}'`
      : `mimeType!='${DRIVE_FOLDER_MIME}'`;
    // `trashed=false` matters: a trashed file is still listed otherwise, and
    // copying somebody's bin into their new system is not a migration.
    const q = `'${folderId}' in parents and trashed=false and ${clause}`;
    const fields = 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,createdTime)';

    const found: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url =
        `${this.baseUrl}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}` +
        `&${LIST_ALL_DRIVES}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const page = (await this.getJson(url)) as DriveFileList;
      found.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return found;
  }

  /** Walk the derived path back to the id it names. */
  private async resolveFolderId(path: string): Promise<string> {
    if (!path) return this.rootFolderId;
    let current = this.rootFolderId;
    for (const segment of path.split('/')) {
      const children = await this.listChildren(current, true);
      const match = children.find((c) => c.name === segment);
      if (!match) {
        throw new Error(`No folder "${segment}" under "${path}" in this Drive.`);
      }
      current = match.id;
    }
    return current;
  }

  private toFileItem(file: DriveFile, path: string): FileItem {
    return {
      path,
      name: file.name,
      isDirectory: false,
      size: Number.parseInt(file.size ?? '0', 10) || 0,
      // Drive's md5 for binary files. Absent on native files, which is one more
      // reason they cannot ride the ordinary path: with no checksum there is
      // nothing to compare and every pass would look like a change.
      ...(file.md5Checksum ? { contentHash: file.md5Checksum } : {}),
      modifiedAt: file.modifiedTime ?? new Date(0).toISOString(),
      ...(file.createdTime ? { createdAt: file.createdTime } : {}),
      // `sourceRef` is the port's field for the source's OWN handle, and the
      // Drive id is exactly that. It is NOT the natural key — the key is the
      // path (§10, ADR-0020) — it is how `fetch` finds the bytes again, and it
      // is stable across renames and moves in a way the path is not.
      sourceRef: file.id,
    };
  }

  /**
   * The export URL for a native file under an export policy, or undefined when
   * the file is ordinary and its bytes can simply be downloaded.
   */
  private exportUrlFor(file: DriveFile): string | undefined {
    if (this.policy === 'refuse' || !isNativeEditorFile(file.mimeType)) return undefined;
    const target = NATIVE_EXPORT_TYPES[this.policy][file.mimeType];
    if (!target) return undefined;
    return (
      `${this.baseUrl}/files/${encodeURIComponent(file.id)}/export` +
      `?mimeType=${encodeURIComponent(target)}`
    );
  }

  /** Whether this item would be refused, and why — exposed so callers can ask. */
  refusalFor(file: DriveFile): NativeFileRefused | undefined {
    if (!isNativeEditorFile(file.mimeType)) return undefined;
    if (this.policy === 'refuse') return new NativeFileRefused(file.name, file.mimeType);
    const map = NATIVE_EXPORT_TYPES[this.policy];
    return map[file.mimeType] ? undefined : new NativeFileRefused(file.name, file.mimeType);
  }
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}
