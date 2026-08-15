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

import type { FileSource, FileFolder, FileItem, RawFileItem, SyncCursor } from '@openmig/shared';
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

export class GoogleDriveSource implements FileSource {
  private readonly baseUrl: string;
  private readonly rootFolderId: string;
  private readonly policy: NativeFilePolicy;

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
      const path = folder.path ? `${folder.path}/${file.name}` : file.name;
      items.push({ item: this.toFileItem(file, path) });
    }

    return {
      items,
      // Deliberately not a delta token. A value that LOOKED like one would
      // invite somebody to trust it as a change filter, and nothing here
      // computes one.
      nextCursor: { value: `full-listing:${folder.path}` },
    };
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
      `${this.baseUrl}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
    )) as DriveFile;

    const refusal = this.refusalFor(meta);
    if (refusal) {
      // Thrown INSIDE the sync loop's per-item boundary, so it is recorded as
      // this item's failure with the reason verbatim and the rest of the folder
      // still migrates. Refusing during the listing would have cost the folder.
      throw refusal;
    }

    const url = this.exportUrlFor(meta) ?? `${this.baseUrl}/files/${encodeURIComponent(fileId)}?alt=media`;

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
