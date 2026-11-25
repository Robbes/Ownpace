// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FILES INTO CIRRUX DRIVE (workplan 0160 T5).
 *
 * The file face of a `cirrux` account, written through Cirrux's Drive API
 * (`https://cirrux.co/help/api/drive`, read 2026-11-19) with the person's OAuth
 * sign-in, refreshed by `CirruxTokenProvider` and written back after every
 * refresh (ADR-0052). Every rule below is one the page states; where it says
 * nothing, workplan 0160 §6 says what this file assumed and how the assumption
 * fails loudly if it is wrong.
 *
 * ## What it does
 *
 * - **Folders are found or created by NAME**, under Cirrux's rule: names are
 *   unique among live siblings ignoring case and Unicode form, and surrounding
 *   whitespace is trimmed. A source folder `Photos` lands in an existing
 *   `photos`, because Cirrux would refuse a second one.
 * - **A new file up to 100 MB is a simple upload**, the bytes inside the JSON
 *   as base64, streamed (`CirruxDriveApi.uploadSimple`), with the source's
 *   modification time as `content_modified_at`. **A larger one, up to 2 GiB,
 *   is the chunked upload**: `POST /drive/uploads`, then each part encrypted
 *   here in Cirrux's `CXDRV2` format and PUT to its presigned URL as the
 *   plaintext arrives, never the whole file in memory, then complete. A
 *   simple upload Cirrux answers `413` goes the chunked way instead.
 * - **A file the source changed is REPLACED, never re-created**, under
 *   `base_ctag`: the content version this product last wrote. A copy somebody
 *   edited in Cirrux since has a newer `ctag`, Cirrux answers `409
 *   version_conflict`, nothing is staged, and the copy is the person's from
 *   then on (`conflicted`, hard rule 2). A replace is Cirrux's chunked flow at
 *   every size, encrypted here in Cirrux's `CXDRV2` format
 *   (`cirrux-drive-format.ts`), because the page offers no other way to put
 *   new bytes in an existing file.
 * - **A removal the person approved moves the copy to Cirrux's trash**,
 *   restorable for 30 days (`binned`), and only while its `ctag` is the one we
 *   wrote. Never a permanent delete: this file has no code that sends one.
 * - **The workspace's storage pool is read before the first upload of a pass**,
 *   and a file that would not fit is refused by sentence before a byte is
 *   read; Cirrux's own `422 storage_limit_exceeded` says the same afterwards.
 * - **`429` is waited out** for its `Retry-After` (`cirrux-drive-api.ts`).
 *
 * ## The parts
 *
 * One chunk a part, the 16-byte header in front of the first (workplan 0160
 * §6, the readings). Part URLs are asked for ten at a time, again once a
 * batch is fifty minutes old (they are valid for an hour), and again once
 * for a part whose PUT storage answered `403`. Any failure aborts the staged
 * upload or replace, so nothing half-sent lingers in front of a file.
 *
 * ## The version this writer records
 *
 * `cirrux:<ctag>:<file uuid>`. The `ctag` is Cirrux's content version, the
 * thing `base_ctag` and a removal compare; the UUID is the file itself, which
 * keeps it across a rename or a move in Cirrux, so a replace or a removal
 * reaches the file and not whatever now sits at the old path.
 */

import {
  CIRRUX_LARGEST_FILE_BYTES,
  CIRRUX_SIMPLE_UPLOAD_MAX_BYTES,
  applyTargetFolderPrefix,
  bodyOfBytes,
  fileContentHash,
  log,
  markNeedsDecision,
  streamingFileContentHash,
  withFailureCategory,
  type FileBody,
  type FileFolder,
  type FileItem,
  type FileTargetWriter,
  type RawFileItem,
  type RemovalResult,
  type TargetEntry,
  type TargetHashScheme,
  type TargetPresenceCheck,
  type TargetReindexer,
  type TargetRemover,
  type UpsertOptions,
  type UpsertResult,
} from '@openmig/shared';
import {
  CirruxApiError,
  CirruxPartRefused,
  type CirruxDriveApi,
  type CirruxDriveFile,
  type CirruxDriveFolder,
  type CirruxFolderListing,
} from './cirrux-drive-api.ts';
import { capacityFromCirruxStorage, type DestinationCapacity } from '@openmig/shared';
import { dataKeyBytes, encryptedParts, expectedCiphertextBytes, cxdrv2ChunkCount } from './cirrux-drive-format.ts';

/** Cirrux's own name for the Drive in a sentence. */
const DRIVE = 'Cirrux Drive';
/** How many presigned part URLs are asked for at once. They last an hour (the page). */
const PART_URL_BATCH = 10;
/** A batch of part URLs older than this is asked for again before its next PUT. */
const PART_URL_FRESH_MS = 50 * 60_000;

/** The three calls of one chunked flow: an upload of a new file, or a replace. */
interface ChunkedFlow {
  readonly what: 'upload' | 'replace';
  partUrls(partNumbers: ReadonlyArray<number>): Promise<ReadonlyArray<{ part_number: number; url: string }>>;
  complete(parts: ReadonlyArray<{ part_number: number; etag: string }>): Promise<CirruxDriveFile>;
  abort(): Promise<void>;
}

export interface CirruxDriveTargetOptions {
  readonly api: CirruxDriveApi;
  /** The mapping's `targetFolderPrefix`, applied to folders and files alike (`ownsTargetFolderPrefix`). */
  readonly targetFolderPrefix?: string;
  /** Overridable for tests; Cirrux's own cap otherwise. */
  readonly simpleUploadMaxBytes?: number;
  /** The clock a batch of part URLs is aged by; `Date.now` unless a test says otherwise. */
  readonly now?: () => number;
}

/** A folder's children as this pass knows them, keyed the way Cirrux compares names. */
interface Children {
  readonly folders: Map<string, CirruxDriveFolder>;
  readonly files: Map<string, CirruxDriveFile>;
}

/**
 * The key Cirrux compares names by: surrounding whitespace trimmed, Unicode
 * composed, capitals not counted. *"café typed composed or decomposed, and
 * Café and CAFÉ, are one name"* (the page). Which case folding Cirrux applies
 * past that (`ß`, a dotless `ı`) it does not say; this is JavaScript's
 * locale-free lower case, and a name it keys differently from Cirrux is met by
 * `422 name_taken` and refused by sentence, never adopted as somebody else's.
 */
export function cirruxNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/** The same NAME, letter for letter, in either Unicode form: what makes an existing file this one. */
function sameName(a: string, b: string): boolean {
  return a.trim().normalize('NFC') === b.trim().normalize('NFC');
}

/** Why Cirrux would refuse this name, or undefined: at most 255 characters, no control character, not `.` or `..`. */
export function cirruxNameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'is empty once its surrounding spaces are taken off';
  if (trimmed === '.' || trimmed === '..') return `is “${trimmed}”, which Cirrux does not take as a name`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'holds a line break, a tab or another control character';
  if ([...trimmed].length > 255) return `is ${[...trimmed].length} characters long, and Cirrux takes 255`;
  return undefined;
}

/** `Documents/report.pdf`, with no leading or trailing slash: the shape every file writer keys on. */
function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** The version this writer records: `cirrux:<ctag>:<uuid>`. */
export function cirruxTargetVersion(file: Pick<CirruxDriveFile, 'uuid' | 'ctag'>): string | undefined {
  return typeof file.ctag === 'number' && Number.isInteger(file.ctag) ? `cirrux:${file.ctag}:${file.uuid}` : undefined;
}

/** A recorded version, read back; undefined when it is not one of ours. */
export function parseCirruxTargetVersion(version: string | undefined): { ctag: number; uuid: string } | undefined {
  const m = /^cirrux:(\d+):([0-9a-fA-F-]{36})$/.exec(version ?? '');
  return m ? { ctag: Number(m[1]), uuid: m[2]! } : undefined;
}

/** A size as a file manager writes it. */
function sizeText(bytes: number): string {
  const MB = 1000 * 1000;
  const GB = 1000 * MB;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

/** Over Cirrux's own limit for one file, at every size path: not moved, with the reason. */
export function overCirruxLimit(path: string, sizeBytes: number): Error {
  const error = new Error(
    `${path} is ${sizeText(sizeBytes)}, and ${DRIVE} takes files up to 2 GB each (2 GiB), however ` +
      'they are sent. It was not moved. Nothing was copied and nothing was changed; every other file ' +
      'continues. Split it, or keep it elsewhere.',
  );
  markNeedsDecision(error);
  return withFailureCategory('too_large', error);
}

export class CirruxDriveTarget implements FileTargetWriter, TargetRemover, TargetPresenceCheck, TargetReindexer {
  /**
   * The prefix is applied HERE, to folders and files alike, so the loop does
   * not apply it to folders a second time (`dav-sync.ts`'s `ownsPrefix`).
   */
  readonly ownsTargetFolderPrefix = true;

  private readonly api: CirruxDriveApi;
  private readonly prefix: string | undefined;
  private readonly simpleMax: number;
  private readonly now: () => number;
  /** Folder path (prefixed) to its uuid, `null` for the Drive root; single-flight per path. */
  private readonly folderByPath = new Map<string, Promise<string | null>>();
  /** A folder's children, read once a pass; `''` is the root. */
  private readonly childrenOf = new Map<string, Promise<Children>>();
  /** The pool's free bytes as read once a pass, less what this pass has added since. */
  private storage: Promise<{ readonly free: number } | undefined> | null = null;
  private addedThisPass = 0;

  constructor(options: CirruxDriveTargetOptions) {
    this.api = options.api;
    this.prefix = options.targetFolderPrefix ? normalizeRelativePath(options.targetFolderPrefix) : undefined;
    this.simpleMax = options.simpleUploadMaxBytes ?? CIRRUX_SIMPLE_UPLOAD_MAX_BYTES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Refused before the source is asked for a byte (`FileTargetWriter`'s
   * optional hook, read by `runFileSync`): a file over Cirrux's own limit of
   * 2 GiB, however it would be sent.
   */
  refuseBeforeRead(item: FileItem): Error | undefined {
    if (item.isDirectory || typeof item.size !== 'number') return undefined;
    if (item.size > CIRRUX_LARGEST_FILE_BYTES) return overCirruxLimit(item.path, item.size);
    return undefined;
  }

  // ---------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------

  async ensureDirectory(folder: FileFolder): Promise<string> {
    const uuid = await this.folderAt(this.prefixed(normalizeRelativePath(folder.path)));
    return uuid ?? '';
  }

  private prefixed(path: string): string {
    return applyTargetFolderPrefix(this.prefix, path);
  }

  /** The folder at a (prefixed) path, created segment by segment where missing; `null` is the root. */
  private folderAt(path: string): Promise<string | null> {
    if (path === '') return Promise.resolve(null);
    const known = this.folderByPath.get(path);
    if (known) return known;
    const made = (async () => {
      const segments = splitPath(path);
      const name = segments[segments.length - 1]!;
      const parent = await this.folderAt(segments.slice(0, -1).join('/'));
      return this.findOrCreateFolder(parent, name, path);
    })();
    // A failure is not remembered: the next item asks again.
    made.catch(() => this.folderByPath.delete(path));
    this.folderByPath.set(path, made);
    return made;
  }

  private async findOrCreateFolder(parent: string | null, name: string, path: string): Promise<string> {
    const problem = cirruxNameProblem(name);
    if (problem) {
      throw this.refusedName('folder', path, name, problem);
    }
    const existing = (await this.children(parent)).folders.get(cirruxNameKey(name));
    if (existing) return existing.uuid;
    try {
      const created = await this.api.createFolder(name, parent);
      (await this.children(parent)).folders.set(cirruxNameKey(created.name ?? name), created);
      return created.uuid;
    } catch (err) {
      if (err instanceof CirruxApiError && err.code === 'name_taken') {
        // Somebody (another item of this pass, or the person) made it since the
        // listing: read the folder again and use theirs, by Cirrux's own rule.
        this.childrenOf.delete(parent ?? '');
        const again = (await this.children(parent)).folders.get(cirruxNameKey(name));
        if (again) return again.uuid;
        throw withFailureCategory(
          'format_refused',
          markNeedsDecision(
            new Error(
              `${DRIVE} refused to create the folder ${path}: it says the name is taken, and no folder ` +
                'of that name is in its listing. A file may hold the name. Nothing was copied into it; ' +
                'rename one of the two.',
            ),
          ),
        );
      }
      throw err;
    }
  }

  /** A folder's live children, read once a pass. */
  private children(folder: string | null): Promise<Children> {
    const key = folder ?? '';
    const known = this.childrenOf.get(key);
    if (known) return known;
    const read = this.api.listFolder(folder).then((listing: CirruxFolderListing) => {
      const folders = new Map<string, CirruxDriveFolder>();
      for (const f of listing.folders) if (!f.trashed) folders.set(cirruxNameKey(f.name), f);
      const files = new Map<string, CirruxDriveFile>();
      for (const f of listing.files) if (!f.trashed) files.set(cirruxNameKey(f.name), f);
      return { folders, files };
    });
    read.catch(() => this.childrenOf.delete(key));
    this.childrenOf.set(key, read);
    return read;
  }

  // ---------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------

  async upsertFile(_parentId: string, raw: RawFileItem, options?: UpsertOptions): Promise<UpsertResult> {
    const naturalKey = normalizeRelativePath(raw.item.path);
    if (naturalKey === '') throw new Error('Refusing to write a file with an empty path: it has no natural key.');
    const segments = splitPath(this.prefixed(naturalKey));
    const name = segments[segments.length - 1]!;
    const parentPath = segments.slice(0, -1).join('/');
    const problem = cirruxNameProblem(name);
    if (problem) throw this.refusedName('file', naturalKey, name, problem);
    if (!raw.content && !raw.body) {
      throw new Error(`No content for ${naturalKey}; refusing to create an empty file in its place.`);
    }
    const sizeBytes = raw.content?.byteLength ?? raw.body!.sizeBytes;
    if (sizeBytes > CIRRUX_LARGEST_FILE_BYTES) throw overCirruxLimit(naturalKey, sizeBytes);

    if (options?.overwrite) return this.replace(naturalKey, name, parentPath, raw, sizeBytes, options.expectedTargetVersion);

    const parent = await this.folderAt(parentPath);
    const there = (await this.children(parent)).files.get(cirruxNameKey(name));
    if (there) return this.alreadyThere(there, name, naturalKey, raw);

    await this.refuseOverThePool(naturalKey, sizeBytes);
    if (sizeBytes > this.simpleMax) return this.uploadChunked(naturalKey, name, parent, raw, sizeBytes);

    const body = raw.content ? bodyOfBytes(raw.content) : raw.body!;
    let hasher = streamingFileContentHash();
    let created: CirruxDriveFile;
    try {
      created = await this.api.uploadSimple({
        name,
        contentType: raw.item.mimeType || 'application/octet-stream',
        folderUuid: parent,
        ...modifiedAt(raw.item),
        body: hashing(body, () => (hasher = streamingFileContentHash())),
        path: naturalKey,
      });
    } catch (err) {
      if (err instanceof CirruxApiError) {
        if (err.code === 'name_taken') {
          // Made since the listing. The server, not the listing, is what
          // guarantees no second copy here.
          this.childrenOf.delete(parent ?? '');
          const now = (await this.children(parent)).files.get(cirruxNameKey(name));
          if (now) return this.alreadyThere(now, name, naturalKey, raw);
        }
        if (err.code === 'storage_limit_exceeded') throw this.poolFull(naturalKey, sizeBytes, err);
        // Cirrux counts its cap another way than this service read it: the
        // chunked route takes the same file, and nothing was stored.
        if (err.code === 'file_too_large' || err.status === 413) return this.uploadChunked(naturalKey, name, parent, raw, sizeBytes);
        if (err.code === 'parent_trashed') throw this.parentTrashed(naturalKey);
      }
      throw err;
    }

    this.addedThisPass += sizeBytes;
    (await this.children(parent)).files.set(cirruxNameKey(created.name ?? name), created);
    const targetVersion = cirruxTargetVersion(created);
    return {
      targetId: created.uuid,
      created: true,
      ...(targetVersion ? { targetVersion } : {}),
      contentHash: raw.content ? fileContentHash(raw.content) : hasher.digest(),
    };
  }

  /**
   * A NEW file over the simple upload's cap, up to 2 GiB: Cirrux's chunked
   * upload, every part encrypted here in `CXDRV2` as the plaintext arrives.
   * A name taken since the listing is the same answer as the simple upload's.
   */
  private async uploadChunked(
    naturalKey: string,
    name: string,
    parent: string | null,
    raw: RawFileItem,
    sizeBytes: number,
  ): Promise<UpsertResult> {
    let init: Awaited<ReturnType<CirruxDriveApi['uploadInit']>>;
    try {
      init = await this.api.uploadInit({
        name,
        contentType: raw.item.mimeType || 'application/octet-stream',
        folderUuid: parent,
        plaintextSizeBytes: sizeBytes,
        ...modifiedAt(raw.item),
      });
    } catch (err) {
      if (err instanceof CirruxApiError) {
        if (err.code === 'name_taken') {
          this.childrenOf.delete(parent ?? '');
          const now = (await this.children(parent)).files.get(cirruxNameKey(name));
          if (now) return this.alreadyThere(now, name, naturalKey, raw);
        }
        if (err.code === 'storage_limit_exceeded') throw this.poolFull(naturalKey, sizeBytes, err);
        if (err.code === 'file_too_large' || err.status === 413) throw overCirruxLimit(naturalKey, sizeBytes);
        if (err.code === 'parent_trashed') throw this.parentTrashed(naturalKey);
      }
      throw err;
    }
    const fileUuid = init.file_uuid;
    if (typeof fileUuid !== 'string' || fileUuid === '') {
      throw new Error(`Cirrux started the upload of ${naturalKey} without naming the file, so nothing was sent.`);
    }
    const sent = await this.sendEncrypted(fileUuid, init, raw, sizeBytes, naturalKey, {
      what: 'upload',
      partUrls: (numbers) => this.api.uploadPartUrls(fileUuid, numbers),
      complete: (parts) => this.api.uploadComplete(fileUuid, parts),
      abort: () => this.api.uploadAbort(fileUuid),
    });
    this.addedThisPass += sizeBytes;
    (await this.children(parent)).files.set(cirruxNameKey(sent.file.name ?? name), sent.file);
    const targetVersion = cirruxTargetVersion(sent.file);
    return {
      targetId: sent.file.uuid,
      created: true,
      ...(targetVersion ? { targetVersion } : {}),
      contentHash: sent.contentHash,
    };
  }

  /**
   * A file of this name is in the folder already. The same name is the same
   * item, ADOPTED and never written; the same name to Cirrux only (capitals,
   * Unicode form) is another file holding this one's place, refused.
   */
  private async alreadyThere(
    there: CirruxDriveFile,
    name: string,
    naturalKey: string,
    raw: RawFileItem,
  ): Promise<UpsertResult> {
    if (!sameName(there.name, name)) {
      // `format_refused`, a name the destination will not store (workplan
      // 0160, T2b): `target_refused`'s sentence named no space, an upload
      // limit and permissions, none of them the cause. The page says it in
      // Cirrux's own terms (`failure.formatRefused.cirrux`).
      throw withFailureCategory(
        'format_refused',
        markNeedsDecision(
          new Error(
            `${DRIVE} already holds “${there.name}” where ${naturalKey} goes, and Cirrux treats the two ` +
              'names as one: capitals and accents written another way do not count there. Nothing was ' +
              'copied and the file in Cirrux was not changed; rename one of the two.',
          ),
        ),
      );
    }
    if (there.upload_status === 'uploading') {
      // Cirrux lists a file whose chunked upload is still under way, and it is
      // not downloadable yet: not a copy to take as this one. Asked again next
      // pass; the upload completes within 24 hours or is discarded.
      throw new Error(
        `${DRIVE} holds “${there.name}” where ${naturalKey} goes, still being uploaded, so it was not ` +
          'taken as the copy and nothing was written. The next pass looks again.',
      );
    }
    return {
      targetId: there.uuid,
      created: false,
      adopted: true,
      contentHash: await contentHashOf(raw),
    };
  }

  /**
   * A file the source changed, REPLACED under `base_ctag` (see the header).
   */
  private async replace(
    naturalKey: string,
    name: string,
    parentPath: string,
    raw: RawFileItem,
    sizeBytes: number,
    expectedTargetVersion: string | undefined,
  ): Promise<UpsertResult> {
    const recorded = parseCirruxTargetVersion(expectedTargetVersion);
    // The file by the UUID we recorded, so a rename in Cirrux does not lose it;
    // by its path only for a row with no version of ours.
    const uuid = recorded?.uuid ?? (await this.fileAtPath(parentPath, name))?.uuid;
    if (!uuid) {
      throw new Error(
        `Asked to replace ${naturalKey}, but no file of that name is in ${DRIVE}. Refusing to create one ` +
          'instead: this item is believed copied, and quietly disagreeing would hide whatever made that false.',
      );
    }
    let current: CirruxDriveFile;
    try {
      current = await this.api.getFile(uuid);
    } catch (err) {
      if (err instanceof CirruxApiError && err.status === 404) {
        // DELETED IN CIRRUX, AND EMPTIED FROM ITS TRASH (workplan 0160, T2b):
        // the person's decision, as a copy in the trash is, and not undone.
        // Said as `goneFromTarget` (0168 B2), never thrown: a thrown one made
        // the copied row a failed one, so *Live progress* stopped counting
        // the copy and counted a failure, and its retry took the create path
        // and made the copy again. The row is left as it was.
        return { targetId: uuid, created: false, goneFromTarget: true };
      }
      throw err;
    }
    if (current.trashed) {
      // Thrown away in Cirrux since we wrote it: the person's decision, and not
      // reversed by a replace. Theirs from now on.
      return { targetId: uuid, created: false, conflicted: true };
    }
    // ALWAYS under a `base_ctag`: the one this product wrote, or, for a copy
    // it adopted and never wrote, the one just read, so an edit in Cirrux in
    // between is never written over either. With neither, nothing is sent.
    const baseCtag = recorded?.ctag ?? current.ctag;
    if (typeof baseCtag !== 'number') {
      throw new Error(
        `${naturalKey} changed at the source, and ${DRIVE} did not say which version its copy is at, so ` +
          'it was not replaced: a replace without one could write over an edit made in Cirrux.',
      );
    }
    const init = await this.replaceInitOrConflict(uuid, raw, sizeBytes, baseCtag);
    if (init === 'conflicted') return { targetId: uuid, created: false, conflicted: true };

    // A 0-byte replace is finished on the spot: no parts, no complete.
    const replaced =
      init.upload_status === 'completed'
        ? { file: await this.api.getFile(uuid), contentHash: fileContentHash(new Uint8Array(0)) }
        : await this.sendEncrypted(uuid, init, raw, sizeBytes, naturalKey, {
            what: 'replace',
            partUrls: (numbers) => this.api.replacePartUrls(uuid, numbers),
            complete: (parts) => this.api.replaceComplete(uuid, parts),
            abort: () => this.api.replaceAbort(uuid),
          });
    const targetVersion = cirruxTargetVersion(replaced.file);
    return {
      targetId: uuid,
      created: false,
      updated: true,
      ...(targetVersion ? { targetVersion } : {}),
      contentHash: replaced.contentHash,
    };
  }

  private async replaceInitOrConflict(
    uuid: string,
    raw: RawFileItem,
    sizeBytes: number,
    baseCtag: number,
  ): Promise<Awaited<ReturnType<CirruxDriveApi['replaceInit']>> | 'conflicted'> {
    try {
      return await this.api.replaceInit(uuid, {
        plaintextSizeBytes: sizeBytes,
        ...(raw.item.mimeType ? { contentType: raw.item.mimeType } : {}),
        ...modifiedAt(raw.item),
        baseCtag,
      });
    } catch (err) {
      // Somebody wrote new content in Cirrux since: nothing was staged, and
      // the copy is theirs (hard rule 2).
      if (err instanceof CirruxApiError && err.code === 'version_conflict') return 'conflicted';
      throw err;
    }
  }

  /**
   * The chunked flow's middle, for an upload and a replace alike: part URLs a
   * batch at a time, each part encrypted and PUT as the plaintext arrives,
   * then complete. The plaintext is read one chunk ahead of the PUT and never
   * held whole. Any failure aborts the staged upload or replace, so nothing
   * half-sent lingers in front of the file for 24 hours.
   */
  private async sendEncrypted(
    uuid: string,
    init: Awaited<ReturnType<CirruxDriveApi['replaceInit']>>,
    raw: RawFileItem,
    sizeBytes: number,
    naturalKey: string,
    flow: ChunkedFlow,
  ): Promise<{ readonly file: CirruxDriveFile; readonly contentHash: string }> {
    const chunkSize = init.chunk_size_bytes;
    if (typeof chunkSize !== 'number' || !Number.isInteger(chunkSize) || chunkSize <= 0) {
      await this.abortQuietly(flow, naturalKey);
      throw new Error(`Cirrux started the ${flow.what} of ${naturalKey} without a chunk size, so nothing was sent.`);
    }
    const count = cxdrv2ChunkCount(sizeBytes, chunkSize);
    const expected = expectedCiphertextBytes(sizeBytes, chunkSize);
    if (init.chunk_count !== count || init.ciphertext_size_bytes !== expected || (init.file_uuid && init.file_uuid !== uuid)) {
      await this.abortQuietly(flow, naturalKey);
      throw new Error(
        `Cirrux started the ${flow.what} of ${naturalKey} with ${String(init.chunk_count)} chunks and ` +
          `${String(init.ciphertext_size_bytes)} encrypted bytes; this service's reading of Cirrux's format ` +
          `makes it ${count} and ${expected}. Nothing was sent, and nothing in Cirrux was changed.`,
      );
    }
    try {
      const key = dataKeyBytes(init.data_key ?? '');
      const hasher = streamingFileContentHash();
      const body = raw.content ? bodyOfBytes(raw.content) : raw.body!;
      const plaintext = (await body.open()).pipeThrough(hasher.through);
      const done: Array<{ part_number: number; etag: string }> = [];
      let urls = new Map<number, string>();
      let urlsAt = 0;
      const askUrls = async (from: number) => {
        const batch = Array.from({ length: Math.min(PART_URL_BATCH, count - from + 1) }, (_, i) => from + i);
        urls = new Map((await flow.partUrls(batch)).map((u) => [u.part_number, u.url]));
        urlsAt = this.now();
        if (!urls.has(from)) throw new Error(`Cirrux answered no URL for part ${from} of ${naturalKey}.`);
      };
      for await (const part of encryptedParts({
        plaintext,
        plaintextSizeBytes: sizeBytes,
        chunkSizeBytes: chunkSize,
        key,
        fileUuid: uuid,
        path: naturalKey,
      })) {
        if (!urls.has(part.partNumber) || this.now() - urlsAt > PART_URL_FRESH_MS) await askUrls(part.partNumber);
        let etag: string;
        try {
          etag = await this.api.putPart(urls.get(part.partNumber)!, part.bytes, naturalKey);
        } catch (err) {
          // A URL past its hour answers 403: asked for again once, the part
          // sent again from the bytes in hand.
          if (!(err instanceof CirruxPartRefused) || err.status !== 403) throw err;
          await askUrls(part.partNumber);
          etag = await this.api.putPart(urls.get(part.partNumber)!, part.bytes, naturalKey);
        }
        done.push({ part_number: part.partNumber, etag });
      }
      const file = await flow.complete(done);
      return { file, contentHash: raw.content ? fileContentHash(raw.content) : hasher.digest() };
    } catch (err) {
      await this.abortQuietly(flow, naturalKey);
      if (err instanceof CirruxApiError && err.code === 'undecryptable_content') {
        throw new Error(
          `Cirrux could not decrypt the first part of ${naturalKey} and discarded the ${flow.what}; ` +
            `nothing in ${DRIVE} was changed. This service and Cirrux read Cirrux's encryption format ` +
            'differently (workplan 0160 §6 names the readings that could differ).',
          { cause: err },
        );
      }
      throw err;
    }
  }

  private async abortQuietly(flow: ChunkedFlow, naturalKey: string): Promise<void> {
    try {
      await flow.abort();
    } catch (err) {
      // Said, not swallowed: an upload or replace that was not aborted expires
      // after 24 hours by itself, and until then holds the file.
      log.warn(
        `[cirrux-drive] could not abort the staged ${flow.what} of ${naturalKey} ` +
          `(${err instanceof Error ? err.message : String(err)}); Cirrux discards it after 24 hours`,
      );
    }
  }

  private async fileAtPath(parentPath: string, name: string): Promise<CirruxDriveFile | undefined> {
    const parent = await this.folderAt(parentPath);
    const there = (await this.children(parent)).files.get(cirruxNameKey(name));
    return there && sameName(there.name, name) ? there : undefined;
  }

  async findFileByNaturalKey(_parentId: string, naturalKey: string): Promise<string | undefined> {
    const segments = splitPath(this.prefixed(normalizeRelativePath(naturalKey)));
    const name = segments.pop();
    if (!name) return undefined;
    return (await this.fileAtPath(segments.join('/'), name))?.uuid;
  }

  // ---------------------------------------------------------------------
  // The pool
  // ---------------------------------------------------------------------

  /**
   * The workspace's free space, for *Review and start* (workplan 0171 T9):
   * the same `GET /workspace/storage` the pass reads, read once more here
   * and not kept, so the pass still reads its own at its first upload. The
   * pool is the workspace, from the profile: mail, Drive and documents share
   * it. A read that fails throws, and the route says it was not answered.
   */
  async capacity(): Promise<DestinationCapacity> {
    const [profile, storage] = await Promise.all([this.api.profile(), this.api.storage()]);
    return capacityFromCirruxStorage(storage, `cirrux:${profile.workspace?.uuid ?? 'workspace'}`);
  }

  /**
   * A file that would not fit in the workspace's storage pool is refused
   * before a byte is read. The pool is read once a pass and what this pass has
   * added since is counted against it; Cirrux's own `422
   * storage_limit_exceeded` is the check that holds if anything else filled it.
   */
  private async refuseOverThePool(naturalKey: string, sizeBytes: number): Promise<void> {
    this.storage ??= this.api.storage().then(
      (s) =>
        typeof s.pool_bytes === 'number' && typeof s.used_bytes === 'number'
          ? { free: s.pool_bytes - s.used_bytes }
          : undefined,
      (err: unknown) => {
        // Said, and left to Cirrux's own refusal: an upload that does not fit
        // is still refused by name, after the bytes rather than before them.
        log.warn(
          `[cirrux-drive] the workspace's storage pool could not be read (${err instanceof Error ? err.message : String(err)}); ` +
            'uploads go ahead and Cirrux refuses one that does not fit',
        );
        return undefined;
      },
    );
    const pool = await this.storage;
    if (pool && sizeBytes > pool.free - this.addedThisPass) throw this.poolFull(naturalKey, sizeBytes);
  }

  private poolFull(naturalKey: string, sizeBytes: number, cause?: unknown): Error {
    return withFailureCategory(
      'target_refused',
      markNeedsDecision(
        new Error(
          `${naturalKey} is ${sizeText(sizeBytes)}, and the Cirrux workspace's storage has no room for it: ` +
            'mail, Drive and documents share one pool. Nothing was copied. Make room in Cirrux, or move the ' +
            'workspace to a larger storage tier (Cirrux, Billing), then press Try again on this file.',
          cause === undefined ? undefined : { cause },
        ),
      ),
    );
  }

  private parentTrashed(naturalKey: string): Error {
    this.folderByPath.clear();
    this.childrenOf.clear();
    return withFailureCategory(
      'target_refused',
      new Error(
        `The folder ${naturalKey} goes into was moved to the trash in ${DRIVE} while this pass ran, so the ` +
          'file was not put in it. The next pass looks again.',
      ),
    );
  }

  private refusedName(what: 'file' | 'folder', path: string, name: string, problem: string): Error {
    return withFailureCategory(
      'format_refused',
      markNeedsDecision(
        new Error(
          `The ${what} name “${name}” in ${path} ${problem}, so ${DRIVE} would refuse it. Nothing was ` +
            'copied; rename it at the source.',
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Removal: the trash, and nothing else
  // ---------------------------------------------------------------------

  /**
   * Move a copy this writer wrote to Cirrux's trash (`TargetRemover`), reached
   * only through an approved deletion (`applyDeletion`'s gates).
   *
   * The version is compared by reading the file first: Cirrux's trash route
   * takes no `base_ctag`, so between the read and the trash there is a gap the
   * size of one request, stated rather than hidden. `binned`, because the
   * trash keeps it for 30 days. There is no permanent delete here.
   */
  async removeItem(targetId: string, options?: { readonly expectedTargetVersion?: string }): Promise<RemovalResult> {
    const recorded = parseCirruxTargetVersion(options?.expectedTargetVersion);
    if (!recorded) return { unversioned: true };
    let current: CirruxDriveFile;
    try {
      current = await this.api.getFile(targetId);
    } catch (err) {
      // Already gone for good: what was asked for is true, and the row says so.
      if (err instanceof CirruxApiError && err.status === 404) return { kind: 'deleted' };
      throw new Error(
        `Could not read ${targetId} in ${DRIVE} to compare it with the version we recorded, so it was not ` +
          `moved to the trash: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (current.trashed) return { kind: 'binned' };
    if (current.ctag !== recorded.ctag) return { conflicted: true };
    const trashed = await this.api.trashFile(targetId);
    if (trashed.trashed !== true) {
      throw new Error(`${DRIVE} answered the trash of ${targetId} without saying it is in the trash; nothing is recorded.`);
    }
    this.childrenOf.clear();
    return { kind: 'binned' };
  }

  /** Is the copy there, live and not in the trash? (ADR-0030.) A read that fails throws. */
  async hasItem(targetId: string): Promise<boolean> {
    try {
      const file = await this.api.getFile(targetId);
      return file.trashed !== true;
    } catch (err) {
      if (err instanceof CirruxApiError && err.status === 404) return false;
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Reading back, for verification (§20)
  // ---------------------------------------------------------------------

  /** Every live file under this mapping's folder, keyed the way the ledger keys it. */
  async *listEntries(): AsyncIterable<TargetEntry> {
    const rootPath = this.prefix ?? '';
    const root = rootPath === '' ? null : await this.existingFolderAt(rootPath);
    if (rootPath !== '' && root === undefined) return;
    const queue: Array<{ uuid: string | null; path: string }> = [{ uuid: root ?? null, path: '' }];
    while (queue.length > 0) {
      const { uuid, path } = queue.shift()!;
      const listing = await this.api.listFolder(uuid);
      for (const folder of listing.folders) {
        if (!folder.trashed) queue.push({ uuid: folder.uuid, path: path ? `${path}/${folder.name}` : folder.name });
      }
      for (const file of listing.files) {
        if (file.trashed || file.upload_status === 'uploading') continue;
        yield {
          naturalKey: path ? `${path}/${file.name}` : file.name,
          targetId: file.uuid,
          mailboxId: uuid ?? '',
          ...(typeof file.file_size_bytes === 'number' ? { sizeBytes: file.file_size_bytes } : {}),
        };
      }
    }
  }

  /** The folder at a path, without creating it; undefined when it is not there. */
  private async existingFolderAt(path: string): Promise<string | null | undefined> {
    let parent: string | null = null;
    for (const segment of splitPath(path)) {
      const found = (await this.children(parent)).folders.get(cirruxNameKey(segment));
      if (!found) return undefined;
      parent = found.uuid;
    }
    return parent;
  }

  /**
   * A sampled file's hash as Cirrux stores it: the simple download, which
   * decrypts on Cirrux's side, up to 100 MB. Above that it is not measured
   * here (`undefined`), never guessed.
   */
  async contentHashFor(entry: TargetEntry, scheme?: TargetHashScheme): Promise<string | undefined> {
    if (scheme !== undefined && scheme !== 'bytes') return undefined;
    if (entry.sizeBytes !== undefined && entry.sizeBytes > CIRRUX_SIMPLE_UPLOAD_MAX_BYTES) return undefined;
    try {
      return fileContentHash(await this.api.download(entry.targetId));
    } catch (err) {
      log.warn(
        `[cirrux-drive] could not download ${entry.targetId} to verify it ` +
          `(${err instanceof Error ? err.message : String(err)}); counted as not measured`,
      );
      return undefined;
    }
  }
}

/** The source's modification time as Cirrux takes it: ISO 8601 with a zone, or nothing. */
function modifiedAt(item: FileItem): { contentModifiedAt?: string } {
  const at = new Date(item.modifiedAt);
  return Number.isNaN(at.getTime()) ? {} : { contentModifiedAt: at.toISOString() };
}

/** A body that hashes what it hands over, with a fresh hasher for each read. */
function hashing(body: FileBody, fresh: () => ReturnType<typeof streamingFileContentHash>): FileBody {
  return {
    sizeBytes: body.sizeBytes,
    open: async () => (await body.open()).pipeThrough(fresh().through),
  };
}

/** The content hash of an item this writer did not write: read through, held never. */
async function contentHashOf(raw: RawFileItem): Promise<string> {
  if (raw.content) return fileContentHash(raw.content);
  const hasher = streamingFileContentHash();
  await (await raw.body!.open()).pipeThrough(hasher.through).pipeTo(new WritableStream<Uint8Array>({ write() {} }));
  return hasher.digest();
}
