// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WebDAV Target Writer Implementation
 * 
 * Implements FileTargetWriter interface for WebDAV file synchronization.
 * Talks WebDAV directly over HTTP — no rclone or other external binary (ADR-0019).
 * Follows the idempotency pattern with ledger fast-path and target-side existence checks.
 */

import type {
  FileTargetWriter,
  FileFolder,
  RawFileItem,
  UpsertResult,
  UpsertOptions,
  Ledger,
  TenantId,
  MappingId,
  TargetReindexer,
  TargetPresenceCheck,
  TargetEntry,
  TargetHashScheme,
  RemovalResult,
} from '@openmig/shared';
import {
  fileNaturalKeyHash,
  containerContentHash,
  fileContentHash,
  streamingFileContentHash,
  isOnTarget,
  applyTargetFolderPrefix,
  TargetFolderMissingError,
  bodyOfBytes,
  markNeedsDecision,
  type FileBody,
} from '@openmig/shared';
import { davRefusalBody, STREAMED_REQUEST_INIT, withFailureCategory } from '@openmig/shared';
import { parseMultiStatus, isCollection, hrefRelativeTo, sizeOf } from './dav-multistatus.ts';
import { requestWithDavRetry } from './dav-retry.ts';
import { readEtag, readVersion, ownershipOf, ifMatchFor } from './dav-target-version.ts';
import { removeDavResource, assertRemovableTargetId } from './dav-remove.ts';
import {
  ChunkSlicer,
  NEXTCLOUD_CHUNK_BYTES,
  NEXTCLOUD_MAX_CHUNKS,
  chunkCount,
  chunkName,
  nextcloudUploadsUrl,
} from './nextcloud-chunked-upload.ts';
import { log } from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import { randomUUID } from 'node:crypto';

/**
 * Configuration for WebDAV target writer
 */
export interface WebDAVTargetConfig {
  /** WebDAV endpoint URL */
  url: string;
  /** Authentication username */
  username: string;
  /** Authentication password or token */
  password: string;
  /**
   * Root path for file storage.
   *
   * NOTE: nothing in this writer reads it — every path is resolved against
   * `url` directly, because the natural keys handed to `upsertFile` are already
   * root-relative to the source connection (see `WebdavFileSource`). Kept for
   * config compatibility; prefixing paths with it would break key alignment
   * with the ledger.
   */
  rootPath?: string;
  /**
   * Put everything this writer creates under this folder on the TARGET.
   *
   * See `MappingConfig.targetFolderPrefix`. It is a wire-side concern and
   * nothing else: the natural keys, the ledger, `rootDirs` and every path this
   * class passes around stay root-relative to the SOURCE, exactly as they were
   * before a prefix existed. `buildUrl` is the one place the two spaces meet.
   */
  targetFolderPrefix?: string;
  /**
   * The size of one piece of a Nextcloud chunked upload, and so the size above
   * which a file goes up in pieces (`NEXTCLOUD_CHUNK_BYTES`, 64 MiB, when
   * absent). Nothing in production sets it; tests do, to cross the line
   * without a 64 MiB fixture.
   *
   * REPLACES `chunkedUploads` and `chunkSize` (workplan 0156). Those switched
   * on a path that PUT the same URL again and again with `Content-Range`,
   * which Sabre refuses on any PUT (RFC 7231 §4.3.4: a server that allows PUT
   * must answer one carrying `Content-Range` with 400), which needed the
   * whole file in memory to slice, and which no caller in either edition ever
   * switched on. A file the size it existed for went up as one request and
   * met the server's request limit instead.
   */
  uploadChunkBytes?: number;
}

/** What one upload did, as `upsertFile` reads it. */
interface UploadOutcome {
  path: string;
  etag?: string;
  conflicted?: boolean;
  contentHash?: string;
  alreadyHeld?: boolean;
}

/**
 * The answers to a MKCOL in the upload area that mean "there is no upload
 * area here for you", and so "send this file as one request instead".
 *
 * 404 and 501 are a server, or a proxy in front of it, without the endpoint;
 * 409 is Nextcloud's own answer for an account it has no upload area for
 * (measured: *"Parent node does not exist"*); 405 is the endpoint refusing the
 * method; 403 is a proxy or a policy that lets files through and not uploads.
 * (A 501 is retried first, as every 5xx is by `dav-retry.ts`, so the first
 * large file pays a few seconds for that answer.) Each is a fact about the
 * server rather than about this file, so it is decided once and remembered.
 * Falling back loses nothing: the single request is what every file used
 * before, and its own answer is what the item then reads.
 */
const UPLOADS_UNAVAILABLE = new Set([403, 404, 405, 409, 501]);

/**
 * WebDAV target writer implementation
 */
export class WebDAVTargetWriter implements FileTargetWriter, TargetReindexer, TargetPresenceCheck {
  private readonly config: WebDAVTargetConfig;
  private readonly ledger: Ledger;
  private readonly tenantId: TenantId;
  private readonly mappingId: MappingId;
  private readonly httpClient: HttpClient;

  /**
   * THIS WRITER APPLIES `targetFolderPrefix` ITSELF, on both sides.
   *
   * Read by `dav-sync`, which then leaves `folder.path` alone. Without the
   * handshake the prefix is applied twice — once to the folder by the caller
   * and once to everything by `buildUrl` — and directories land under
   * `Google/Google`. A writer that does not set this is prefixed the old way,
   * by the caller, on directories only; that is the state `jmap-file-target`
   * is in, and it is a gap NAMED here rather than a silence.
   */
  readonly ownsTargetFolderPrefix = true;
  /**
   * WHAT THE TARGET HOLDS, ONE DIRECTORY AT A TIME, listed when a pass first
   * needs it (2026-09-28), root-relative directory path -> its listing.
   *
   * The existence check was a PROPFIND PER FILE. It became one walk of the
   * whole tree, one PROPFIND per directory, before the first write: far fewer
   * requests for 670 files across a handful of folders. But the walk covered
   * everything under the root, whatever the pass would touch, and it ran again
   * on every pass. On a target that already holds an account's worth of
   * folders, that is the whole account listed, one directory after another,
   * before anything is copied: the owner's Dropbox pass copied nothing for the
   * first 40 of its 50 minutes.
   *
   * Now a directory is listed the first time something in it is asked about,
   * and never twice: an existence check lists the file's directory, and making
   * a folder ready lists its parent. A pass pays for the directories it
   * touches. Concurrent items share one listing. A directory this writer
   * creates starts out known to be empty, so it is never listed at all.
   * `undefined` is a listing that could not be taken, and its files fall back
   * to the per-item PROPFIND, as the walk's did.
   */
  private readonly listings = new Map<string, Promise<DirectoryListing | undefined>>();
  /**
   * Root-relative paths on the target that are COLLECTIONS.
   *
   * Filled in by every listing this writer takes, and by every folder it
   * creates or finds. They matter because a directory sitting where a file has
   * to go is a conflict this writer must not paper over; see `upsertFile`.
   */
  private readonly rootDirs = new Set<string>();
  /** Whether `targetFolderPrefix`'s own chain has been created this session. */
  private prefixRootReady = false;
  /**
   * The account's Nextcloud upload area, or `undefined` when the files URL is
   * not Nextcloud's shape (`nextcloudUploadsUrl`).
   */
  private readonly uploadsUrl: string | undefined;
  /**
   * WHETHER A LARGE FILE CAN GO UP IN PIECES HERE, decided once per writer
   * (workplan 0156). `unknown` until the first large file's MKCOL answers:
   * 201 makes it `supported`, an answer in `UPLOADS_UNAVAILABLE` makes it
   * `unsupported`, and every later large file goes the way the first one
   * learned. A URL that is not Nextcloud's shape starts out `unsupported`.
   */
  private chunking: 'unknown' | 'supported' | 'unsupported';
  /** The log says once, per writer, that large files go up in one request here. */
  private chunkingRefusalLogged = false;

  constructor(
    config: WebDAVTargetConfig,
    deps: {
      ledger: Ledger;
      tenantId: TenantId;
      mappingId: MappingId;
      httpClient?: HttpClient;
    },
  ) {
    this.config = config;
    this.ledger = deps.ledger;
    this.tenantId = deps.tenantId;
    this.mappingId = deps.mappingId;
    this.httpClient = deps.httpClient ?? createDefaultHttpClient();
    this.uploadsUrl = nextcloudUploadsUrl(config.url);
    this.chunking = this.uploadsUrl === undefined ? 'unsupported' : 'unknown';
  }

  /**
   * Ensure a directory exists with the given folder metadata.
   * Returns the directory ID (a path relative to this writer's own root) for use in
   * subsequent operations.
   *
   * `folder.path` is root-relative to the *source's* connection (see
   * `WebdavFileSource.toRelativePath`) -- it is never this writer's own absolute URL, so it can
   * be resolved directly against this writer's own root via `buildUrl`/`directoryExists`
   * without any translation. The empty string denotes the sync root itself (the account's file
   * storage root), which always exists already and needs no PROPFIND/MKCOL round trip.
   */
  async ensureDirectory(folder: FileFolder): Promise<string> {
    const directoryPath = this.normalizeRelativePath(folder.path);
    if (directoryPath === '') {
      return '';
    }
    await this.ensureCollectionPath(directoryPath);
    return directoryPath;
  }

  /**
   * Make sure every collection along `path` exists, creating the missing ones
   * in order, and remember each one in `rootDirs`.
   *
   * This used to be one PROPFIND on the full path followed by one MKCOL whose
   * status was never read. Two things were wrong with that, and a live run
   * against Nextcloud showed both at once: MKCOL is not recursive (RFC 4918
   * §9.3.1 — a missing ancestor is a 409, not a create), and a refused MKCOL
   * was indistinguishable from a successful one, so the next thing the server
   * heard was a PUT into a collection that did not exist. Sabre answers that
   * with 404 `File with name /<parent> could not be located` — the PARENT's
   * name, not the file's — 87 times in a row, until the consecutive-failure
   * tripwire stopped the pass.
   *
   * Walked from the root because the cheapest evidence that `a/b/c` exists is
   * that this writer created it, and the cheapest way to create it is to have
   * already created `a/b`. The cache is the same set `listEntries` fills as it
   * walks, so a directory the target already had costs nothing here.
   *
   * 405 on MKCOL is "already there" (RFC 4918 §9.3.1) and is treated as such:
   * a PROPFIND that answered "absent" a moment ago was simply overtaken, and
   * the collection is what was wanted either way. Every other non-2xx is
   * thrown verbatim — a refusal to create the folder is the reason the files
   * under it will fail, and it must be the sentence the operator reads.
   */
  /**
   * MKCOL the prefix's own chain, once.
   *
   * `ensureCollectionPath` walks the segments of a SOURCE-relative path, and
   * the prefix is in none of them — so without this, the first MKCOL under a
   * `Google` that does not exist yet answers 409 and every file in the
   * migration fails behind it. Built with `buildUrlUnprefixed` because these
   * paths are already wire-relative; putting them through `buildUrl` would
   * prefix the prefix.
   *
   * Not recorded in `rootDirs`: that map is keyed in source-relative space and
   * an entry for `Google` there would match a source folder of that name.
   */
  private async ensurePrefixRoot(): Promise<void> {
    const prefix = this.config.targetFolderPrefix;
    if (!prefix || this.prefixRootReady) return;
    const segments = this.normalizeRelativePath(prefix).split('/').filter(Boolean);
    for (let depth = 1; depth <= segments.length; depth++) {
      const at = segments.slice(0, depth).join('/');
      const url = this.buildUrlUnprefixed(at);
      const response = await this.httpClient.request({
        method: 'MKCOL',
        url,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      // 405 is "it is already there", which is the ordinary answer on every
      // pass after the first and is not a failure.
      if (response.status !== 201 && response.status !== 405) {
        throw new Error(
          `Could not create the target folder ${at} (targetFolderPrefix): ` +
            `MKCOL answered ${response.status}: ${davRefusalBody(response.body)}`,
        );
      }
    }
    this.prefixRootReady = true;
  }

  private async ensureCollectionPath(path: string): Promise<void> {
    await this.ensurePrefixRoot();
    const collection = this.normalizeRelativePath(path);
    if (collection === '') return;
    const segments = collection.split('/');
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth).join('/');
      if (this.rootDirs.has(prefix)) continue;
      // Asked of the parent's listing, which fills `rootDirs` with its
      // siblings too, so a folder's neighbours cost nothing more. A parent that
      // could not be listed is asked the old way, one PROPFIND.
      const parent = await this.listingOf(this.parentOf(prefix));
      const exists = parent ? parent.dirs.has(prefix) : await this.directoryExists(prefix);
      if (exists) {
        this.rootDirs.add(prefix);
        continue;
      }
      const created = await this.createDirectory(prefix);
      this.rootDirs.add(prefix);
      parent?.dirs.add(prefix);
      // Made by this writer a moment ago, so it holds nothing: nothing in it
      // needs asking about. Not so when the server said it was already there
      // (405), which is a directory this writer knows nothing about.
      if (created) this.listings.set(prefix, Promise.resolve({ files: new Map(), dirs: new Set() }));
    }
  }

  /**
   * Idempotently write a file to the target.
   * Uses ledger fast-path and target-side existence check to ensure idempotency.
   */
  async upsertFile(
    _parentId: string,
    raw: RawFileItem,
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    // The natural key (raw.item.path) is already root-relative and self-contained (see
    // WebdavFileSource.toRelativePath) -- it includes any containing subfolder itself, so it
    // resolves directly against this writer's own root. `parentId` (the source-relative
    // directory path from ensureDirectory) is not needed here: concatenating it with an
    // already-full relative path would double the prefix.
    const naturalKey = raw.item.path;
    const naturalKeyHash = fileNaturalKeyHash(naturalKey);

    // UPDATE PATH: the source file changed after we copied it. See the same
    // branch in caldav-target-writer.ts for why this precedes the fast-path
    // and why it can never touch a file the destination already held.
    //
    // A WebDAV PUT to the same href replaces the body, so the path — the
    // natural key — is unchanged and nothing is deleted.
    if (options?.overwrite) {
      const written = await this.uploadFile(raw, true, options.expectedTargetVersion);
      if (written.conflicted) {
        return { targetId: written.path, created: false, conflicted: true };
      }
      await this.rememberFile(this.normalizeRelativePath(naturalKey), written.path);
      return {
        targetId: written.path,
        created: false,
        updated: true,
        ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
      };
    }

    // LEDGER FAST-PATH: Check if already migrated
    const known = await this.ledger.find(this.tenantId, this.mappingId, 'file', naturalKeyHash);
    // `isOnTarget`, not merely "a row exists". A `failed` row means we tried and
    // did not copy it; short-circuiting on one told the sync loop the retry had
    // succeeded, and the loop then recorded the row as 'updated' — clearing the
    // failure, counting the item as synced, and never writing anything. The
    // E2E caught it: the planted unmigratable item failed on the first pass,
    // was silently "migrated" on the second, and vanished from the queue.
    if (known && isOnTarget(known.status)) {
      return { targetId: known.targetId, created: false };
    }

    /**
     * The content hash, computed WHEN it is needed and from whichever shape
     * the source produced (workplan 0120).
     *
     * It used to be `fileContentHash(raw.content)`, unconditionally, at the
     * top — which requires the whole file in memory before anything else can
     * happen, and is one of the three places a large file had to be buffered.
     *
     * On the write path the digest comes back FROM the upload: the bytes are
     * hashed as they pass on their way to the target, so a 40 GB file is read
     * once and held never. On the adopt path there is no upload to ride, so
     * the body is drained through the hasher and discarded — one read, the
     * same one the buffered path always paid, with the memory bounded.
     */
    let contentHashValue: string | undefined;
    const hashOfContent = async (): Promise<string> => {
      if (contentHashValue !== undefined) return contentHashValue;
      if (!raw.body) {
        contentHashValue = fileContentHash(raw.content ?? new Uint8Array(0));
        return contentHashValue;
      }
      const hasher = streamingFileContentHash();
      await (await raw.body.open())
        .pipeThrough(hasher.through)
        .pipeTo(new WritableStream<Uint8Array>({ write() {} }));
      contentHashValue = hasher.digest();
      return contentHashValue;
    };

    // The byte count goes in the SAME record. `recordIfAbsent` means whichever
    // layer writes first wins, and this one always does — so the sized record
    // the sync loop makes afterwards was a no-op and `totalBytesSource` came
    // back 0 for every domain, leaving §20's total-size comparison structurally
    // unable to measure anything.
    const sizeBytes = raw.body?.sizeBytes ?? raw.content?.byteLength ?? 0;

    // A COLLECTION where this file has to go is a conflict, not a hit.
    //
    // Both existence checks answer "is something at this path" and neither
    // asked "is it a FILE": the snapshot only ever holds files, so a directory
    // reads as absent and we would PUT straight over it; the per-item fallback
    // returns the path on any 207, so a directory reads as an existing file and
    // the item is ADOPTED — recorded as migrated with its content never
    // written. One risks destroying a directory the customer already had; the
    // other is a silent false success. Neither is acceptable, and there is no
    // third answer this writer can give on its own.
    //
    // So it fails the item, verbatim, and the operator decides: rename the
    // source file and retry, or accept leaving it behind. Exactly the shape
    // per-item failure isolation exists for.
    //
    // The file's directory has to be listed FIRST: `rootDirs` is filled in by
    // that listing, so consulting it beforehand reads a set without this
    // directory's children. (The walk it replaced had the same order, and the
    // unit test below caught it once.) The listing is memoised, so this costs
    // nothing more: `existingTargetId` awaits the very same promise.
    await this.listingOf(this.parentOf(this.normalizeRelativePath(naturalKey)));
    if (this.rootDirs.has(this.normalizeRelativePath(naturalKey))) {
      throw new Error(
        `Cannot write ${naturalKey}: the target already holds a DIRECTORY at that path. ` +
          'Writing the file would destroy it, and adopting the directory would record an ' +
          'item that was never copied. Rename the source file and retry, or accept leaving ' +
          'it behind.',
      );
    }

    // ONE RECORDING, TWO WAYS OF ARRIVING AT IT: the existence check below
    // finds the file, or the create is refused with 412 and the server says a
    // file is there (`heldAtPath`, workplan 0149 T1). The same fact, and it has
    // to be recorded the same way or the two paths disagree about what the
    // row means.
    const adopt = async (targetId: string): Promise<UpsertResult> => {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: 'file',
        mappingId: this.mappingId,
        naturalKeyHash,
        contentHash: await hashOfContent(),
        targetId,
        createdAt: new Date().toISOString(),
        sizeBytes,
        // ADOPTED, explicitly. Omitting it let PgLedger apply its 'copied'
        // default, so every item this writer adopted was recorded as one we
        // had written — and the loop's own `recordIfAbsent`, which does pass
        // 'adopted', no-ops on the row this one already inserted.
        //
        // That was merely a reporting gap until update propagation: the
        // rewrite rule keys off exactly this status to decide whether the
        // bytes on the target are ours to replace. Mislabelled, the
        // customer's own data becomes eligible for overwrite, which hard
        // rule 2 forbids outright.
        status: 'adopted',
        // Carried from the sync loop, not derived here: the loop owns the
        // comparison and this writer merely persists what it was told.
        ...(options?.sourceVersion !== undefined
          ? { sourceVersion: options.sourceVersion }
          : {}),
        // Same reason as `sourceVersion`: the loop knows which source
        // collection the item came from, this writer wins the
        // `recordIfAbsent` race, so a collection recorded only by the loop
        // would be thrown away. Without it every row keeps the `''` it has
        // carried since 0001 and a move stays undetectable.
        ...(options?.collection !== undefined ? { collection: options.collection } : {}),
        // Same race, same reason as `collection` above: the writer wins
        // `recordIfAbsent`, so the source's own handle is recorded here or
        // not at all. Without it a removal report has no way back to the item.
        ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        // The root-relative path, unhashed, so the confirmed list can name this
        // file. Recorded here as well as by the loop for the same race as above.
        naturalKey,
      });
      return { targetId, created: false, adopted: true };
    };

    // Check if file already exists on target
    const existingId = await this.existingTargetId(_parentId, naturalKey);
    if (existingId) return adopt(existingId);

    // Upload the file to the target
    const written = await this.uploadFile(raw);
    // THE PATH WAS TAKEN AFTER ALL: the check above missed it, and the create
    // was refused. Nothing was written, so none of the create-path recording
    // below is true of it. The snapshot is kept current, as the create path
    // keeps it.
    if (written.alreadyHeld) {
      await this.rememberFile(this.normalizeRelativePath(naturalKey), written.path);
      return adopt(written.path);
    }
    // The digest the upload made on its way past, when it streamed. Falls back
    // to the buffered hash, which is what every non-streaming source produces.
    if (written.contentHash !== undefined) contentHashValue = written.contentHash;
    const fileId = written.path;
    await this.rememberFile(this.normalizeRelativePath(naturalKey), fileId);

    // RECORD IN LEDGER
    await this.ledger.recordIfAbsent({
      tenantId: this.tenantId,
        itemType: 'file',
      mappingId: this.mappingId,
      naturalKeyHash,
      contentHash: await hashOfContent(),
      targetId: fileId,
      createdAt: new Date().toISOString(),
      sizeBytes,
      // Carried from the sync loop, not derived here: the loop owns the
      // comparison and this writer merely persists what it was told.
      ...(options?.sourceVersion !== undefined
        ? { sourceVersion: options.sourceVersion }
        : {}),
      // Same reason as `sourceVersion`: the loop knows which source
      // collection the item came from, this writer wins the
      // `recordIfAbsent` race, so a collection recorded only by the loop
      // would be thrown away. Without it every row keeps the `''` it has
      // carried since 0001 and a move stays undetectable.
      ...(options?.collection !== undefined ? { collection: options.collection } : {}),
      // Same race, same reason as `collection` above: the writer wins
      // `recordIfAbsent`, so the source's own handle is recorded here or
      // not at all. Without it a removal report has no way back to the item.
      ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
      // The root-relative path, unhashed, so the confirmed list can name this
      // file. Recorded here as well as by the loop for the same race as above.
      naturalKey,
      // NOT from the loop: only this writer saw the server's answer to the PUT.
      ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
    });

    return {
      targetId: fileId,
      created: true,
      ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
    };
  }

  /**
   * What one directory on the target holds, listed the first time it is asked
   * about and never again (see `listings`). `undefined` when it could not be
   * listed, and the caller falls back to the per-item PROPFIND: a target we
   * cannot enumerate must still be migratable.
   */
  private listingOf(dir: string): Promise<DirectoryListing | undefined> {
    const key = this.normalizeRelativePath(dir);
    let listing = this.listings.get(key);
    if (!listing) {
      listing = (async () => {
        try {
          const listed: DirectoryListing = { files: new Map(), dirs: new Set() };
          for (const child of await this.propfindChildren(key)) {
            if (child.isDirectory) {
              listed.dirs.add(child.path);
              this.rootDirs.add(child.path);
            } else {
              listed.files.set(child.path, child.path);
            }
          }
          return listed;
        } catch (err) {
          log.warn(
            `[webdav] could not list ${key || '/'} on the target, falling back to a per-item ` +
              `existence check for what is in it: ${err instanceof Error ? err.message : String(err)}`,
          );
          return undefined;
        }
      })();
      this.listings.set(key, listing);
    }
    return listing;
  }

  /**
   * A file this writer put on the target, kept in its directory's listing when
   * that listing has been taken. One not taken yet is left alone: when it is
   * taken, the file is in it.
   */
  private async rememberFile(path: string, href: string): Promise<void> {
    (await this.listings.get(this.parentOf(path)))?.files.set(path, href);
  }

  /** Is this file already on the target? Its directory's listing first, per-item PROPFIND as fallback. */
  private async existingTargetId(
    parentId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    const path = this.normalizeRelativePath(naturalKey);
    const listing = await this.listingOf(this.parentOf(path));
    if (listing) return listing.files.get(path);
    return this.findFileByNaturalKey(parentId, naturalKey);
  }

  /**
   * Find a file by its natural key (path).
   * Returns the file ID if found, undefined when the server says nothing is
   * there, and throws when the server gave no answer (workplan 0149 T2).
   */
  async findFileByNaturalKey(
    _parentId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    // naturalKey is already root-relative and self-contained; resolve it directly (see upsertFile).
    const filePath = this.normalizeRelativePath(naturalKey);

    // Retried as the writes are, and NOT caught (workplan 0149 T2).
    //
    // This caught every error as "File doesn't exist", and read every status
    // but 207 and 200 the same way. A busy Nextcloud's 500, an expired login
    // and a dropped connection all said "not on the target", which is the
    // answer that decides whether to write and, since a 412 is asked about
    // here, whether to adopt.
    const response = await this.requestWithRetry({
      method: 'PROPFIND',
      url: this.buildUrl(filePath),
      headers: {
        Depth: '0',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status === 207 || response.status === 200) {
      // A 207 says something is there, not that it is a FILE. Returning the
      // path for a collection made the caller adopt it — an item recorded as
      // migrated whose bytes were never written.
      const [item] = parseMultiStatus(response.body as string);
      if (item && isCollection(item.xml)) {
        throw new Error(
          `Cannot write ${filePath}: the target already holds a DIRECTORY at that path.`,
        );
      }
      return filePath;
    }

    // 404: nothing is there.
    if (response.status === 404) return undefined;

    // Any other answer is no answer: see the same throw in
    // caldav-target-writer.ts (workplan 0149 T2, hard rule 9).
    throw new Error(
      `PROPFIND on ${filePath} failed; refusing to treat this as "not present", because a write ` +
        'or an adoption would then rest on an answer the server never gave. ' +
        `Cause: status ${response.status}: ${davRefusalBody(response.body)}`,
    );
  }

  /**
   * Stream every file on this target, keyed the way the ledger keys them.
   *
   * `naturalKey` is the root-relative path — the same shape `upsertFile` hashes
   * with `fileNaturalKeyHash`, which takes it straight from
   * `WebdavFileSource.toRelativePath`. Both sides therefore agree on
   * "Documents/report.pdf" with no leading slash, percent-decoded.
   *
   * Walks the tree with repeated `Depth: 1` PROPFINDs rather than one
   * `Depth: infinity`: infinite depth is optional in RFC 4918 §9.1 and is
   * disabled by default on several servers (Nextcloud among them), where it
   * answers 403 — which, silently swallowed, would report an empty target.
   *
   * @param mailboxId Restrict the walk to one directory. Omitted, it starts at
   *   the configured root.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    // Start at the endpoint root, NOT `config.rootPath`. Every other method
    // here addresses paths directly against `config.url` via `buildUrl` — and
    // `upsertFile` keys items by the bare `raw.item.path` — so listing from
    // `rootPath` would yield "<rootPath>/<path>" keys that match nothing the
    // ledger holds. (`rootPath` is in fact read nowhere else in this class; see
    // the note on the config field.)
    const start = this.normalizeRelativePath(mailboxId ?? '');
    const queue: string[] = [start];
    const seen = new Set<string>([start]);

    while (queue.length > 0) {
      const dir = queue.shift()!;
      for (const entry of await this.propfindChildren(dir)) {
        if (entry.isDirectory) {
          // Remembered, not just traversed. `upsertFile` needs to know a path
          // is a collection before it PUTs over it.
          this.rootDirs.add(this.normalizeRelativePath(entry.path));
          if (!seen.has(entry.path)) {
            seen.add(entry.path);
            queue.push(entry.path);
          }
          continue;
        }
        yield {
          naturalKey: entry.path,
          targetId: entry.path,
          mailboxId: dir,
          ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
        };
      }
    }
  }

  /** One Depth:1 PROPFIND, as root-relative children (the directory itself excluded). */
  private async propfindChildren(
    dir: string,
  ): Promise<Array<{ path: string; isDirectory: boolean; sizeBytes?: number }>> {
    const response = await this.httpClient.request({
      method: 'PROPFIND',
      url: this.buildUrl(dir),
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/></D:prop></D:propfind>`,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status !== 207) {
      // Never degrade to an empty listing. A target that cannot be enumerated
      // looks identical to an empty one, and verification would report that as
      // total data loss (hard rule 9).
      const refused = `PROPFIND on ${dir || '/'} failed with status ${response.status}: ${davRefusalBody(response.body)}`;
      if (response.status === 404 && this.normalizeRelativePath(dir) === '') {
        // THE FOLDER ITSELF IS GONE (workplan 0156 T2): the owner deleted
        // `/Microsoft-Rhb` and the verification ended for every data type on
        // "PROPFIND on / failed with status 404". A 404 here is a definite
        // answer, not a failure to read, so it is said as one, naming the
        // folder as the server knows it rather than as `/`. Still thrown: a
        // reader that does not know this error fails as loudly as before.
        const prefix = this.config.targetFolderPrefix?.replace(/^\/+|\/+$/g, '') ?? '';
        throw new TargetFolderMissingError(`/${prefix}`, refused);
      }
      throw new Error(refused);
    }

    const self = this.normalizeRelativePath(dir);
    const children: Array<{ path: string; isDirectory: boolean; sizeBytes?: number }> = [];
    for (const item of parseMultiStatus(response.body)) {
      const relative = hrefRelativeTo(item.href, this.buildUrl(''));
      if (relative === undefined) continue; // points outside this endpoint
      const path = this.normalizeRelativePath(relative);
      if (path === self) continue; // Depth:1 returns the collection itself
      children.push({ path, isDirectory: isCollection(item.xml), ...sizeOf(item.xml) });
    }
    return children;
  }

  /**
   * Hash a sampled file as it is stored on the target (§20 checksum leg).
   *
   * Files are the clean case: WebDAV serves back exactly the bytes that were
   * PUT, so `fileContentHash` over a GET is directly comparable to the source
   * hash the ledger recorded. (CalDAV/CardDAV deliberately do not implement
   * this — those servers re-serialize what they store.)
   *
   * Called for sampled items only. Returns undefined when the file cannot be
   * read: the sample is then counted as unavailable, never as a mismatch.
   */
  async contentHashFor(
    entry: TargetEntry,
    scheme: TargetHashScheme = 'bytes',
  ): Promise<string | undefined> {
    const filePath = this.normalizeRelativePath(entry.naturalKey);
    /**
     * A WHOLE-FILE HASH IS TAKEN AS THE FILE ARRIVES (workplan 0150 T1).
     *
     * The GET used to be read whole into memory, like every other response,
     * and then hashed. A sample is any file a migration copied, so a sampled
     * video on a pass machine of half a gigabyte was a verification killed for
     * memory, the way the owner's Dropbox passes were killed by their uploads.
     * Streamed, it holds a chunk at a time. `container-parts` still reads the
     * bytes whole: a container is opened to be hashed, and it is a rendering
     * this product asked for, never a stored file of any size.
     */
    const streamed = scheme !== 'container-parts';
    let response: HttpResponse;
    try {
      response = await this.httpClient.request({
        method: 'GET',
        url: this.buildUrl(filePath),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
        ...(streamed ? { stream: true } : {}),
      });
    } catch (err) {
      // The same shape the CalDAV writer already had: the result is honest
      // either way (counted as unavailable, never as a mismatch), but the
      // REASON has to be recoverable from the log.
      log.warn(
        `[webdav] GET ${filePath} failed: ${err instanceof Error ? err.message : String(err)}; ` +
          'content not sampled',
      );
      return undefined;
    }

    if (response.status !== 200) {
      // Nothing to read, and a stream left open would hold its connection.
      await response.bodyStream?.cancel().catch(() => undefined);
      return undefined;
    }
    if (streamed && response.bodyStream) {
      const hasher = streamingFileContentHash();
      try {
        await response.bodyStream
          .pipeThrough(hasher.through)
          .pipeTo(new WritableStream<Uint8Array>({ write() {} }));
      } catch (err) {
        log.warn(
          `[webdav] GET ${filePath} broke off while it was read: ` +
            `${err instanceof Error ? err.message : String(err)}; content not sampled`,
        );
        return undefined;
      }
      return hasher.digest();
    }
    // Bytes only. Hashing the UTF-8 decoded `body` would differ from the source
    // hash for every non-ASCII binary file — reporting healthy files as corrupt.
    if (!response.bodyBytes) return undefined;
    if (scheme === 'container-parts') {
      // THE SAME QUESTION THE LEDGER'S ROW ANSWERED (ADR-0046, 0042 T7). This
      // row holds a rendering we asked Drive to export; it was stored as a hash
      // over the container's parts, so a whole-file sha256 taken here would be
      // a different measurement wearing the same shape — and every migrated
      // document would read as changed on the page somebody deletes their
      // originals from.
      //
      // `undefined` when the bytes will not canonicalise, which is this
      // method's existing answer for anything it cannot read. NEVER a
      // whole-file hash as a consolation: the caller would compare two
      // different questions, and `sameFingerprintVersion` would then have to
      // rescue a mistake this line could simply not make.
      return containerContentHash(response.bodyBytes) ?? undefined;
    }
    return fileContentHash(response.bodyBytes);
  }

  // Private helper methods

  /** Normalize a root-relative path: no leading/trailing slashes, forward slashes only. */
  private normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  private async directoryExists(path: string): Promise<boolean> {
    try {
      const response = await this.httpClient.request({
        method: 'PROPFIND',
        url: this.buildUrl(path),
        headers: {
          Depth: '0',
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      return response.status === 207 || response.status === 200;
    } catch (err) {
      // "I could not check" returned as "it does not exist", which sends the
      // caller on to create it. Not destructive — MKCOL on an existing
      // collection is refused by the server, never a replacement — but the
      // operator then sees a confusing create failure instead of the
      // connectivity problem that actually happened.
      log.warn(
        `[webdav] could not check whether ${path} exists: ` +
          `${err instanceof Error ? err.message : String(err)}; treating it as absent`,
      );
      return false;
    }
  }

  /** `true` when this call made the directory (201), `false` when it was already there (405). */
  private async createDirectory(path: string): Promise<boolean> {
    const response = await this.requestWithRetry({
      method: 'MKCOL',
      url: this.buildUrl(path),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });
    // 201 is the create; 405 is "a resource is already here" (RFC 4918
    // §9.3.1), which for a collection-creating call is the state wanted.
    // Anything else was never a create, and until this check existed the
    // caller could not tell — a 409 from a missing ancestor, a 403 from a
    // read-only share, a 401 — so the failure surfaced only later, on the
    // PUT of every file underneath, as a 404 naming this path.
    if (response.status === 405) return false;
    if (response.status >= 200 && response.status < 300) return true;
    throw new Error(
      `MKCOL failed for ${path} with status ${response.status}: ${davRefusalBody(response.body)}`,
    );
  }

  /**
   * The collection a root-relative file path sits in: `''` for the root.
   */
  private parentOf(filePath: string): string {
    const slash = filePath.lastIndexOf('/');
    return slash < 0 ? '' : filePath.slice(0, slash);
  }

  /**
   * Retry a write request a few times on a transient 5xx before giving up. Needed for the
   * demo/self-host Nextcloud backend, which uses SQLite by default -- a single-writer database
   * that genuinely returns "SQLSTATE[HY000]: General error: 5 database is locked" under
   * concurrent domain writes (confirmed live for the sibling CalDAV/CardDAV target writers,
   * same server). The lock is transient by nature, so a short backoff is the standard mitigation
   * rather than requiring every demo deployment to run a concurrent-safe database.
   */
  private async requestWithRetry(
    options: HttpRequestOptions,
  ): Promise<HttpResponse> {
    // Shared with the other DAV writers and with the seed script's proven
    // parameters — see dav-retry.ts for why 5 attempts with jitter, and why
    // 423/429 count as transient alongside 5xx.
    //
    // Safe for every body shape this overload takes — a string, a Buffer, a
    // Uint8Array — because all of them can be sent twice. A STREAM cannot, and
    // must go through `requestRebuilding` below instead.
    return requestWithDavRetry(() => this.httpClient.request(options));
  }

  /**
   * Retry a request whose body CANNOT BE SENT TWICE.
   *
   * A `ReadableStream` is consumed by the first send. Handing the same options
   * object to a retry therefore does not retry the request — it fails it, with
   *
   *   TypeError: Response body object should not be disturbed or locked
   *
   * which is not a sentence about the customer's file, the target, or anything
   * an operator can act on. Live 2026-09-12: five photo uploads to Nextcloud
   * failed with exactly that, each after ONE attempt, and what actually
   * happened to them — the transient status that triggered the retry — was
   * destroyed on the way out. The retry that exists to survive Nextcloud's
   * single-writer lock was the thing turning a lock into a failure.
   *
   * So the caller hands over a FACTORY, and each attempt gets its own body.
   * That is what `FileBody.open()` is for: "a body must be re-openable: a retry
   * after a half-written upload starts from the beginning, and a stream that
   * has been consumed cannot" (webdav-source.ts). Every streaming source in
   * this product already honours it; only this call site was spending the
   * first open on all five attempts.
   */
  private async requestRebuilding(
    build: () => Promise<HttpRequestOptions>,
  ): Promise<HttpResponse> {
    return requestWithDavRetry(async () => this.httpClient.request(await build()));
  }

  /** See the same method in caldav-target-writer.ts. */
  private async currentEtag(path: string): Promise<string | undefined> {
    const response = await this.requestWithRetry({
      method: 'HEAD',
      url: this.buildUrl(path),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });
    if (response.status < 200 || response.status >= 300) return undefined;
    return readEtag(response);
  }

  /**
   * A CREATE REFUSED WITH 412: something is already at this path, and it is
   * not ours to claim as a copy (workplan 0149 T1).
   *
   * Both PUTs returned the bare path here, which the caller took for a write:
   * the row was recorded `copied`, so a source change later overwrote the file
   * and *apply deletions* would remove it — a file the customer already had,
   * treated as one we wrote. Nothing in a 412 says whose the file is. It may
   * have appeared since the snapshot, a failed lookup may have hidden it, or
   * our own PUT may have landed behind a 5xx its retry never saw.
   *
   * The path is this file's natural key, so what is there is adopted AT it —
   * never rewritten and never removed as ours, including, at worst, our own
   * landed copy. But only once asked what it is: a 412 answers for a
   * DIRECTORY at the path too, and adopting one records an item whose bytes
   * were never written, the defect `findFileByNaturalKey` already refuses.
   */
  private async heldAtPath(
    filePath: string,
    /** The request the 412 answered: the PUT, or the MOVE that ends a chunked upload. */
    refused: 'PUT' | 'MOVE' = 'PUT',
  ): Promise<{ path: string; alreadyHeld: true }> {
    const held = await this.findFileByNaturalKey('', filePath);
    if (held === undefined) {
      throw withFailureCategory(
        'target_refused',
        new Error(
          `${refused} for ${filePath} was refused with 412, and the target then answered that nothing ` +
            'is at that path. Nothing was written, and nothing was recorded; the next pass tries ' +
            'again.',
        ),
      );
    }
    return { path: held, alreadyHeld: true };
  }

  private async uploadFile(
    raw: RawFileItem,
    overwrite = false,
    expectedTargetVersion?: string,
  ): Promise<UploadOutcome> {
    // raw.item.path is root-relative and self-contained (see WebdavFileSource.toRelativePath);
    // resolve it directly instead of re-deriving it from a parent directory id.
    const filePath = this.normalizeRelativePath(raw.item.path);

    // Ownership, checked by the server in the write itself when our version
    // is strong, and by a read and a comparison when it is weak (workplan 0149
    // T3). See the same guard in caldav-target-writer.ts. It covers a file
    // that goes up in pieces too: a large file the owner has edited in the
    // new system is no more ours to replace than a small one. There the
    // strong version rides on the MOVE that assembles the pieces, as RFC
    // 4918's tagged `If` (`uploadChunked`), since `If-Match` on that MOVE is
    // checked against the pieces rather than the file.
    const ifMatch = overwrite ? ifMatchFor(expectedTargetVersion) : undefined;
    if (overwrite && expectedTargetVersion !== undefined && ifMatch === undefined) {
      const verdict = ownershipOf(expectedTargetVersion, await this.currentEtag(filePath));
      if (verdict === 'changed') {
        return { path: filePath, conflicted: true };
      }
    }

    // THE PARENT COLLECTION EXISTS BEFORE THE FIRST BYTE IS SENT.
    //
    // The sync loop calls `ensureDirectory` for a folder before the files in
    // it, so in the ordinary case this is a set lookup and nothing else. It is
    // here as well because the loop's promise is per FOLDER and a PUT's need
    // is per FILE: a folder whose MKCOL was refused, a source that lists a
    // file under a path it never listed as a folder, or a target whose
    // ancestor was removed between passes all reach this line with no
    // collection to write into, and the server's answer to that — 404 naming
    // the parent — reads as a missing file to everyone who has not seen it
    // before. Making the collection is cheap; diagnosing its absence from 87
    // identical PUT failures was not.
    //
    // Not on the overwrite path: a file being rewritten exists, so its
    // collection does too.
    if (!overwrite) {
      const parent = this.parentOf(filePath);
      if (parent !== '') await this.ensureCollectionPath(parent);
    }

    /**
     * A FILE LARGER THAN ONE PIECE GOES UP IN PIECES, where the target takes
     * them (workplan 0156; `nextcloud-chunked-upload.ts`).
     *
     * Whichever shape the source handed over: a buffered file larger than a
     * piece is read through the same pieces, as a stream over the bytes
     * already held, so the size a file can be on the target does not depend
     * on how the source read it. `undefined` back means this target has no
     * upload area, and the file goes the way every file went before.
     */
    const sizeBytes = raw.body?.sizeBytes ?? raw.content?.byteLength ?? 0;
    if (sizeBytes > this.chunkBytes() && (raw.body || raw.content)) {
      const body = raw.body ?? bodyOfBytes(raw.content!);
      const chunked = await this.uploadChunked(filePath, raw, body, overwrite, ifMatch);
      if (chunked !== undefined) return chunked;
    }

    /**
     * A STREAMED BODY GOES STRAIGHT OUT, hashed on the way past.
     *
     * This is the half of the memory ceiling that lives at the target: even
     * with a source that streams, a `PUT` whose body is a `Uint8Array` needs
     * the whole file in memory to build. A stream body needs one chunk.
     *
     * The hash rides ALONG rather than being computed in a pass of its own: a
     * second read would double the transfer, and on a metered source (0090's
     * daily ceiling) would double what the customer spends against their own
     * provider's limit for one file.
     */
    if (raw.body) {
      return this.uploadStreamed(filePath, raw, overwrite, ifMatch);
    }

    // Simple PUT for small files - only if content exists
    if (raw.content) {
      const response = await this.requestWithRetry({
        method: 'PUT',
        url: this.buildUrl(filePath),
        body: raw.content,
        headers: {
          'Content-Type': raw.item.mimeType || 'application/octet-stream',
          // Create-only, atomically (RFC 4918 §10.4.2 / RFC 9110 §13.1.2),
          // UNLESS this is a deliberate rewrite.
          //
          // The existence check and this write are separate requests, so on its
          // own that pairing is check-then-act and anything appearing at this
          // href in between would be silently REPLACED — which file writers are
          // specified never to do (hard rule 2). A file that goes up in pieces
          // carries the same rule on the MOVE that assembles it, as
          // `Overwrite: F` (`uploadChunked`).
          //
          // On the update path replacing IS the intent, and the ownership
          // decision was made upstream against the ledger. Sending the
          // precondition anyway made the server answer 412, which the branch
          // below then reported as success — the rewrite silently did nothing
          // while the pass counted `updated: 1`. The update path's
          // precondition is `If-Match` with our version, when it is strong.
          ...(overwrite ? (ifMatch !== undefined ? { 'If-Match': ifMatch } : {}) : { 'If-None-Match': '*' }),
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      // 412: something is already at this path, and it is not ours
      // (`heldAtPath`, workplan 0149 T1). On the overwrite path it is
      // `If-Match` refusing (T3): the file is no longer the one we wrote, so
      // nothing was written and it is the owner's now. A refusal with no
      // precondition sent is answered the same.
      if (response.status === 412) {
        if (overwrite) return { path: filePath, conflicted: true };
        return this.heldAtPath(filePath);
      }
      if (response.status === 413) {
        throw this.tooLargeForOneRequest(filePath, raw.content.byteLength, response);
      }
      // RFC 4918 §9.7.1: PUT returns 201 (created) or 204 (existing resource replaced). Without
      // this check a failed write (e.g. the parent collection doesn't actually exist) was
      // silently treated as success, and the ledger recorded a false "copied" status that then
      // permanently blocked retries via its own fast-path (confirmed live).
      if (response.status !== 201 && response.status !== 204) {
        throw new Error(`PUT failed for ${filePath} with status ${response.status}: ${davRefusalBody(response.body)}`);
      }
      // `readVersion`, not `readEtag`: a weak ETag is recorded as weak (0149 T3).
      const version = readVersion(response);
      return { path: filePath, ...(version !== undefined ? { etag: version } : {}) };
    }

    return { path: filePath };
  }

  /**
   * PUT a file whose bytes nobody is holding.
   *
   * One request with a streaming body, which is what makes a file larger than
   * this process possible at all. A file larger than one piece goes up in
   * pieces instead where the target offers that (`uploadChunked`); this is
   * every other file, and a large one on a target that does not.
   */
  private async uploadStreamed(
    filePath: string,
    raw: RawFileItem,
    overwrite: boolean,
    /** Our version as `If-Match`, when this is a rewrite and it is strong (0149 T3). */
    ifMatch?: string,
  ): Promise<UploadOutcome> {
    const body = raw.body!;
    // ONE HASHER PER ATTEMPT, for the same reason as one stream per attempt:
    // a digest is a fact about the bytes that went out on the request the
    // server accepted. Hashing across a failed attempt and a successful one
    // produces a value that describes neither, and that value is what the
    // ledger stores and §20 compares.
    let hasher = streamingFileContentHash();
    const response = await this.requestRebuilding(async () => {
      hasher = streamingFileContentHash();
      return {
        method: 'PUT',
        url: this.buildUrl(filePath),
        body: (await body.open()).pipeThrough(hasher.through),
        headers: {
          'Content-Type': raw.item.mimeType || 'application/octet-stream',
          // The length the source promised. Without it the request is chunked
          // transfer-encoded, which some DAV servers refuse outright and others
          // accept while reporting a size of zero afterwards.
          'Content-Length': String(body.sizeBytes),
          ...(overwrite ? (ifMatch !== undefined ? { 'If-Match': ifMatch } : {}) : { 'If-None-Match': '*' }),
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      };
    });
    if (response.status === 412) {
      // The same answers as the buffered PUT's: a rewrite refused by
      // `If-Match` is the owner's file now (0149 T3), and a create is asked
      // about. No digest: the server refused the bytes, so the hasher saw a
      // body the target does not hold, and the adoption hashes the source.
      if (overwrite) return { path: filePath, conflicted: true };
      return this.heldAtPath(filePath);
    }
    if (response.status === 413) {
      throw this.tooLargeForOneRequest(filePath, body.sizeBytes, response);
    }
    if (response.status !== 201 && response.status !== 204) {
      throw new Error(
        `PUT failed for ${filePath} with status ${response.status}: ${davRefusalBody(response.body)}`,
      );
    }
    // Only after the stream has ended, which is when the digest is a fact
    // about the file rather than about a prefix (see streamingFileContentHash).
    return {
      path: filePath,
      contentHash: hasher.digest(),
      ...(readVersion(response) !== undefined ? { etag: readVersion(response) } : {}),
    };
  }

  /** The size of one piece of a chunked upload (`WebDAVTargetConfig.uploadChunkBytes`). */
  private chunkBytes(): number {
    return this.config.uploadChunkBytes ?? NEXTCLOUD_CHUNK_BYTES;
  }

  /**
   * A FILE LARGER THAN ONE PIECE, SENT AS SEVERAL (workplan 0156; the
   * protocol, and what was measured of it, is in `nextcloud-chunked-upload.ts`).
   *
   * `undefined` when this target has no upload area — the files URL is not
   * Nextcloud's shape, or the area refused the MKCOL that opens an upload (see
   * `UPLOADS_UNAVAILABLE`) — and the caller sends the file as one request, as
   * every file went before. Decided by the first large file and remembered for
   * the rest (`chunking`).
   *
   * THE SAME ANSWERS AS THE SINGLE PUT, request for request:
   *
   *  - CREATE-ONLY on a new file. Nothing is at the destination until the
   *    MOVE, and the MOVE carries `Overwrite: F`, so a path taken in the
   *    meantime is refused with 412 exactly as `If-None-Match: *` refuses the
   *    PUT, and asked about the same way (`heldAtPath`): adopted where it is a
   *    file, refused where it is a directory. Measured: the 412 writes nothing.
   *  - THE VERSION CHECK on a rewrite, by the server, in the MOVE: RFC 4918
   *    §10.4's tagged `If: <destination> (["etag"])`. `If-Match` cannot carry
   *    it, because Sabre checks `If-Match` against the request URL, which here
   *    is `.file`: measured, the destination's own current ETag was refused
   *    with 412. A weak or absent version keeps the read and the comparison
   *    the caller already made, and the MOVE then carries no precondition, as
   *    the PUT carries none.
   *  - THE ETAG the MOVE answers with is recorded, as the PUT's is: Nextcloud
   *    sends `ETag` and `OC-ETag` on the assembly (measured).
   *  - THE HASH is the whole file's: one read of the source, through one
   *    hasher, cut into pieces as it passes (`ChunkSlicer`).
   *
   * NO PARTIAL FILE, EVER (hard rule 1). A failure before the MOVE leaves
   * pieces in the account's upload area and nothing among its files; the
   * upload folder is then DELETEd on a best-effort basis, and the error that
   * stopped the upload is the one thrown, verbatim (hard rule 9). A re-run
   * starts a new upload under a new name, and the destination either is still
   * free or is adopted.
   *
   * RETRIED AS THE SINGLE PUT IS (`dav-retry.ts`). The MKCOL, the MOVE and
   * the cleanup are retried as they stand. A piece cannot be: its body is a
   * window onto a stream that has moved on. So a transient answer to any
   * piece retries the whole SEND — the source opened again, a fresh hasher,
   * every piece PUT again into the same upload folder, where a piece of the
   * same number is replaced — which is what `requestRebuilding` does for the
   * one request. Never only the failed piece: a second read of a source that
   * changed in between would assemble a file from two versions under a hash
   * of one.
   *
   * WHAT IS NOT SENT: `X-OC-Mtime`. Nextcloud honours it on the MOVE
   * (measured), but the single PUT does not send one, and a file's properties
   * on the target must not depend on its size (`a-type-the-big-files-lost`).
   * Setting the time is a decision for both paths or neither.
   */
  private async uploadChunked(
    filePath: string,
    raw: RawFileItem,
    body: FileBody,
    overwrite: boolean,
    /** Our version, quoted, when this is a rewrite and it is strong (0149 T3). */
    ifMatch: string | undefined,
  ): Promise<UploadOutcome | undefined> {
    const uploads = this.uploadsUrl;
    if (uploads === undefined) {
      this.noteNoChunking(
        "its files URL is not Nextcloud's …/dav/files/<user>/ shape, so it has no upload area " +
          'this writer can find',
      );
      return undefined;
    }
    if (this.chunking === 'unsupported') return undefined;

    // Nextcloud numbers pieces 1 to 10000, so a file beyond 10000 pieces gets
    // larger ones (from 625 GiB up, at 64 MiB).
    const pieceBytes = Math.max(this.chunkBytes(), Math.ceil(body.sizeBytes / NEXTCLOUD_MAX_CHUNKS));
    const pieces = chunkCount(body.sizeBytes, pieceBytes);
    const destination = this.buildUrl(filePath);
    const authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
    const totalLength = String(body.sizeBytes);
    // A NEW NAME FOR EVERY UPLOAD, never one derived from the file: two
    // uploads of one path (a re-run beside a pass still going, an owner's own
    // client) must never write pieces into each other's folder.
    const transfer = `${uploads}ownpace-${randomUUID()}`;

    const opened = await this.requestWithRetry({
      method: 'MKCOL',
      url: transfer,
      headers: { Destination: destination, Authorization: authorization },
    });
    const ownEarlierAttempt = opened.status === 405 && this.chunking === 'supported';
    if (!ownEarlierAttempt && (opened.status < 200 || opened.status >= 300)) {
      if (this.chunking === 'unknown' && UPLOADS_UNAVAILABLE.has(opened.status)) {
        this.chunking = 'unsupported';
        this.noteNoChunking(
          `its upload area answered MKCOL with ${opened.status}: ${davRefusalBody(opened.body)}`,
        );
        return undefined;
      }
      throw new Error(
        `Could not begin the upload of ${filePath} in pieces: MKCOL of the upload folder answered ` +
          `${opened.status}: ${davRefusalBody(opened.body)}`,
      );
    }
    // A 405 once the area is known to work is this same MKCOL's own earlier
    // attempt, which landed behind a transient answer: the name is new to
    // this upload, so nothing else could have made it.
    this.chunking = 'supported';

    let assembled = false;
    try {
      // ONE HASHER PER SEND, as one per attempt in `uploadStreamed`.
      let hasher = streamingFileContentHash();
      const sent = await requestWithDavRetry(async (): Promise<PieceAnswer> => {
        hasher = streamingFileContentHash();
        const slicer = new ChunkSlicer((await body.open()).pipeThrough(hasher.through), filePath);
        try {
          for (let n = 1; n <= pieces; n++) {
            const bytes = Math.min(pieceBytes, body.sizeBytes - (n - 1) * pieceBytes);
            let answer: HttpResponse;
            try {
              answer = await this.httpClient.request({
                method: 'PUT',
                url: `${transfer}/${chunkName(n)}`,
                body: slicer.next(bytes),
                headers: {
                  // The source's own type, as every PUT here sends it. Nextcloud
                  // types the assembled file by its name; what matters is that
                  // nothing on the wire depends on the file's size.
                  'Content-Type': raw.item.mimeType || 'application/octet-stream',
                  // Each piece declares its own length, for the reason the
                  // single PUT declares the file's.
                  'Content-Length': String(bytes),
                  // Required on every request of a v2 upload; v1 ignores it.
                  Destination: destination,
                  // Lets Nextcloud refuse a file its quota cannot hold before
                  // the pieces are spent on it (507).
                  'OC-Total-Length': totalLength,
                  Authorization: authorization,
                },
              });
            } catch (err) {
              // A body that broke off reads, from fetch, as a failed request.
              // When the SOURCE is why, its sentence is the one to keep.
              throw slicer.failure ?? err;
            }
            if (answer.status < 200 || answer.status >= 300) {
              return { status: answer.status, answer, piece: n, bytes };
            }
          }
          // Read to the end: a longer source is refused here, before the
          // assembly, and the hasher finishes.
          await slicer.assertEnded(body.sizeBytes);
          return { status: 201, piece: pieces, bytes: 0 };
        } finally {
          // Let go of the source, whichever way this send ended.
          await slicer.cancel();
        }
      });
      const refusal = sent.answer;
      if (refusal !== undefined) {
        if (refusal.status === 413) {
          throw this.tooLargeForOneRequest(filePath, body.sizeBytes, refusal, {
            piece: sent.piece,
            of: pieces,
            bytes: sent.bytes,
          });
        }
        throw new Error(
          `PUT failed for ${filePath} (piece ${sent.piece} of ${pieces}, ${sent.bytes} bytes, Nextcloud ` +
            `chunked upload) with status ${refusal.status}: ${davRefusalBody(refusal.body)}`,
        );
      }

      const moved = await this.requestWithRetry({
        method: 'MOVE',
        url: `${transfer}/.file`,
        headers: {
          Destination: destination,
          // Checked against what arrived: pieces that do not add up are
          // refused, and nothing is written (measured, 400).
          'OC-Total-Length': totalLength,
          ...(overwrite
            ? ifMatch !== undefined
              ? { If: `<${destination}> ([${ifMatch}])` }
              : {}
            : { Overwrite: 'F' }),
          Authorization: authorization,
        },
      });
      if (moved.status === 201 || moved.status === 204) {
        // Nextcloud removes the upload folder itself once it has assembled it.
        assembled = true;
        const version = readVersion(moved);
        return {
          path: filePath,
          contentHash: hasher.digest(),
          ...(version !== undefined ? { etag: version } : {}),
        };
      }
      // The answers the single PUT gives to the same refusals. No digest: the
      // file was not assembled, and an adoption hashes the source.
      if (moved.status === 412) {
        if (overwrite) return { path: filePath, conflicted: true };
        return await this.heldAtPath(filePath, 'MOVE');
      }
      // A tagged `If` on a destination that is not there answers 404 naming
      // it, where `If-Match` on the PUT answers 412: the file we wrote is gone,
      // which is the owner's doing as much as an edit is (0149 T3).
      if (moved.status === 404 && overwrite && ifMatch !== undefined && (await this.isGone(filePath))) {
        return { path: filePath, conflicted: true };
      }
      throw new Error(
        `MOVE failed for ${filePath} (assembling ${pieces} pieces, Nextcloud chunked upload) with ` +
          `status ${moved.status}: ${davRefusalBody(moved.body)}`,
      );
    } finally {
      if (!assembled) await this.discardUpload(transfer, filePath, authorization);
    }
  }

  /**
   * Is the file at this path gone? Only a confident 404 says yes; anything
   * that cannot answer says no, and the caller then throws what it had.
   */
  private async isGone(filePath: string): Promise<boolean> {
    try {
      return !(await this.hasItem(filePath));
    } catch {
      return false;
    }
  }

  /**
   * Remove an upload folder that will never be assembled, BEST EFFORT.
   *
   * Never throws and never replaces the error that brought the upload here:
   * that error is the item's reason, and a cleanup that failed is not. It is
   * logged instead, and Nextcloud removes a folder left behind after 24 hours
   * anyway. A 404 is a folder already gone, which is the state wanted.
   */
  private async discardUpload(transfer: string, filePath: string, authorization: string): Promise<void> {
    try {
      const response = await this.requestWithRetry({
        method: 'DELETE',
        url: transfer,
        headers: { Authorization: authorization },
      });
      if (response.status === 404 || (response.status >= 200 && response.status < 300)) return;
      log.warn(
        `[webdav] the unfinished upload of ${filePath} could not be removed from the upload area ` +
          `(DELETE answered ${response.status}: ${davRefusalBody(response.body)}); Nextcloud ` +
          'removes it by itself after 24 hours',
      );
    } catch (err) {
      log.warn(
        `[webdav] the unfinished upload of ${filePath} could not be removed from the upload area ` +
          `(${err instanceof Error ? err.message : String(err)}); Nextcloud removes it by itself ` +
          'after 24 hours',
      );
    }
  }

  /** Say once, per writer, why large files go up in one request here. */
  private noteNoChunking(reason: string): void {
    if (this.chunkingRefusalLogged) return;
    this.chunkingRefusalLogged = true;
    let host = this.config.url;
    try {
      host = new URL(this.config.url).host;
    } catch {
      // The URL as configured, then.
    }
    log.warn(
      `[webdav] files larger than ${sizeText(this.chunkBytes())} go up to ${host} in one request ` +
        `each, not in pieces: ${reason}. A server or proxy that limits the size of one request ` +
        'refuses such a file with 413.',
    );
  }

  /**
   * A 413, SAID AS WHAT IT IS (workplan 0156).
   *
   * Read as `unknown` until now — the classifier knew no 413 — so the owner's
   * four largest files sat under *"We could not classify this one"* with
   * Sabre's sentence about having read 0 bytes, which is true and names
   * nothing anybody can change. The cause is a limit on the size of ONE
   * REQUEST, set by the server or by something in front of it, and the
   * remedy is that limit.
   *
   * The target's answer (`target_refused`), and the same answer on every
   * pass until somebody changes the limit, so it waits for a person rather
   * than being tried four more times (`markNeedsDecision`), as
   * `tooLargeForThisJmapServer` does for the JMAP target's stated limit.
   */
  private tooLargeForOneRequest(
    filePath: string,
    fileBytes: number,
    response: HttpResponse,
    piece?: { readonly piece: number; readonly of: number; readonly bytes: number },
  ): Error {
    const refused =
      piece === undefined
        ? `this ${sizeText(fileBytes)} file (${fileBytes} bytes) in one request`
        : `one ${sizeText(piece.bytes)} piece of this ${sizeText(fileBytes)} file`;
    const onePiece =
      piece === undefined && this.chunking === 'unsupported' && fileBytes > this.chunkBytes()
        ? 'This target does not take a file in pieces, so the whole file has to fit in one request. '
        : '';
    const error = new Error(
      `PUT failed for ${filePath}` +
        (piece === undefined ? '' : ` (piece ${piece.piece} of ${piece.of}, Nextcloud chunked upload)`) +
        ` with status 413: the target refused ${refused}. The server, or a proxy in front of it, ` +
        "limits how large one request may be (Apache's LimitRequestBody, which Nextcloud's image " +
        "sets from APACHE_BODY_LIMIT, 1 GiB unless changed; nginx's client_max_body_size; a CDN's " +
        'upload limit), and this is larger. Nothing was copied and nothing was changed; every other ' +
        `file continues. ${onePiece}Raise that limit, then press Try again. The server said: ` +
        serverWords(response.body),
    );
    markNeedsDecision(error);
    return withFailureCategory('target_refused', error);
  }

  /**
   * Remove a file this writer wrote (implements `TargetRemover`).
   *
   * The only destructive operation any writer has, reached solely through an
   * explicit owner decision in `applyDeletion` — see that function for the gates.
   *
   * Reports `binned` against a Nextcloud files endpoint, where a DELETE goes to the
   * account's trashbin and the owner can still get the file back, and `deleted`
   * against a plain WebDAV server, where it does not. That distinction is the whole
   * reason the kind is reported rather than assumed.
   */
  async removeItem(
    targetId: string,
    options?: { readonly expectedTargetVersion?: string },
  ): Promise<RemovalResult> {
    assertRemovableTargetId(targetId, 'this file');
    const path = this.normalizeRelativePath(targetId);
    return removeDavResource({
      url: this.buildUrl(path),
      authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      request: (opts) => this.httpClient.request(opts),
      ...(options?.expectedTargetVersion !== undefined
        ? { expectedTargetVersion: options.expectedTargetVersion }
        : {}),
    });
  }

  /**
   * Is the file still there? (ADR-0030, amended.)
   *
   * A HEAD, because the question is presence and nothing else — a GET would
   * pull the bytes of a file this code has no business reading, and a PROPFIND
   * asks a server for properties nobody wants.
   *
   * 404 is a confident NO. Anything else that is not a success THROWS, because
   * the caller is about to destroy a copy on the strength of this answer and a
   * 503 is not evidence of absence.
   */
  async hasItem(targetId: string): Promise<boolean> {
    const response = await this.httpClient.request({
      url: this.buildUrl(this.normalizeRelativePath(targetId)),
      method: 'HEAD',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });
    if (response.status === 404 || response.status === 410) return false;
    if (response.status >= 200 && response.status < 300) return true;
    throw new Error(
      `The target could not say whether ${targetId} is still there (HTTP ${response.status}). ` +
        'Nothing was removed.',
    );
  }

  /**
   * The URL for a root-relative path, each segment percent-encoded ONCE.
   *
   * Paths here are decoded strings — `hrefRelativeTo` decodes what the server
   * lists and the natural keys come from the source the same way — so this
   * is the one place the encoding happens, and it happens per segment so the
   * slashes between them survive. It used to append the path raw and let
   * `fetch` mend it: Node's URL parser does escape a space, which is why
   * folders with spaces mostly worked, but it reads `#` as a fragment and `?`
   * as a query and leaves `%` alone, so a file called `Q&A #2 (50%).pdf` was
   * PUT to an address the server could not resolve.
   */
  /**
   * THE ONE PLACE A SOURCE-RELATIVE PATH BECOMES A URL, and therefore the one
   * place `targetFolderPrefix` belongs.
   *
   * Until 2026-09-22 the prefix was applied by the CALLER, to the folder only
   * (`dav-sync.ts`), so directories were created under it and files were
   * written beside it. An operator who asked for `Google` got a complete empty
   * tree under `Google/` and a second complete tree, with all the files in it,
   * at the account root — because a PUT to `Wieke/foto.jpg` auto-creates
   * `Wieke/` on the way past.
   *
   * Putting it here fixes the read side for free, which is why it is here and
   * not in `upsertFile`. `listEntries` measures every href with
   * `hrefRelativeTo(href, this.buildUrl(''))`, so moving the base moves the
   * measurement with it: the keys that come back out of a listing are
   * source-relative again, and adoption keeps matching what the ledger holds.
   * That symmetry is the whole design — cross the boundary in two places and
   * the natural keys drift apart from the paths, which is the shape of the bug
   * this replaces.
   */
  private buildUrl(path: string): string {
    return this.buildUrlUnprefixed(
      applyTargetFolderPrefix(this.config.targetFolderPrefix, path.replace(/^\/+/, '')),
      path.replace(/^\/+/, '') === '',
    );
  }

  /**
   * A URL for a path that is ALREADY wire-relative — the prefix's own
   * directories, which no natural key contains and so nothing else would ever
   * create.
   */
  private buildUrlUnprefixed(path: string, asRoot = false): string {
    const baseUrl = this.config.url.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    if (normalizedPath === '') return `${baseUrl}/`;
    const encoded = normalizedPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    // THE ROOT KEEPS ITS TRAILING SLASH. `hrefRelativeTo` measures listings
    // against `buildUrl('')`; without the slash the separator would be left on
    // the front of every path it hands back.
    return asRoot ? `${baseUrl}/${encoded}/` : `${baseUrl}/${encoded}`;
  }
}

/**
 * What one send of a chunked upload's pieces came back with: the first piece
 * the server refused, or none (`answer` absent) when every piece landed.
 */
interface PieceAnswer {
  readonly status: number;
  readonly answer?: HttpResponse;
  readonly piece: number;
  readonly bytes: number;
}

/** A size as a file manager writes it: one decimal, in KB, MB or GB (as `jmap-file-target.ts`). */
function sizeText(bytes: number): string {
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / KB).toFixed(1)} KB`;
}

/**
 * The server's own words for a refusal, as `davRefusalBody` reads them, with
 * one addition: a bare HTML error page is named by its title. A 413 is often
 * answered by Apache or a proxy before the DAV server ever sees the request,
 * and its page is fifty lines of markup around one phrase, *"413 Request
 * Entity Too Large"*. Where Sabre's own document follows the page, as it did
 * on the owner's Nextcloud, `davRefusalBody` already finds Sabre's words.
 */
function serverWords(body: string): string {
  const words = davRefusalBody(body);
  if (!/<html[\s>]/i.test(words)) return words;
  const title = /<title>([^<]*)<\/title>/i.exec(words)?.[1]?.trim();
  return title ? `${title} (an HTML error page)` : words;
}

/**
 * HTTP client interface for WebDAV requests
 */
/** What one directory on the target holds, as `listingOf` keeps it. */
interface DirectoryListing {
  /** Root-relative file path -> href, for the files directly in the directory. */
  readonly files: Map<string, string>;
  /** Root-relative paths of the collections directly in it. */
  readonly dirs: Set<string>;
}

export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

export interface HttpRequestOptions {
  method: string;
  url: string;
  /**
   * A stream is what makes a file larger than this process uploadable at all
   * (see `FileBody`): a `Uint8Array` body has to exist in full before the
   * request can be built, and that is the ceiling.
   */
  body?: string | Buffer | Uint8Array | ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
  /**
   * Hand the response back as a STREAM rather than reading it into memory.
   *
   * Off by default: every response this writer reads but one is small XML.
   * The exception is a file read back for its checksum (`contentHashFor`),
   * which is a whole file, as large as any the migration copied.
   */
  stream?: boolean;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  /**
   * The response's raw bytes, when the client captured them.
   *
   * `body` is UTF-8 decoded text, which is lossy for binary content — a PDF or
   * an image round-tripped through it does not hash to what was uploaded. Any
   * byte-level use (checksum sampling) must read this, and treat its absence as
   * "cannot measure" rather than falling back to the string.
   */
  bodyBytes?: Uint8Array;
  /**
   * The response body as a stream, when `stream: true` was asked for.
   *
   * Present INSTEAD of `bodyBytes`, never beside it: holding both would
   * defeat the point. `body` is empty text on a streamed response.
   */
  bodyStream?: ReadableStream<Uint8Array>;
}

/**
 * Create a default HTTP client using Node.js fetch
 */
function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      /**
       * A stream body goes out with `STREAMED_REQUEST_INIT`: `duplex: 'half'`,
       * which Node's fetch refuses a stream body without, and `redirect:
       * 'error'`, without which fetch keeps every byte of the file in memory
       * until the request is gone (see the constant). It is spread from there,
       * not written out here, so the two cannot be taken apart.
       */
      const streaming = options.body instanceof ReadableStream;
      const response = await tenantFetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body as RequestInit['body'],
        ...(streaming ? STREAMED_REQUEST_INIT : {}),
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // A STREAMED RESPONSE, handed back unread: `arrayBuffer()` below is the
      // ceiling this option removes (see `HttpRequestOptions.stream`).
      if (options.stream) {
        return {
          status: response.status,
          body: '',
          headers,
          ...(response.body ? { bodyStream: response.body } : {}),
        };
      }

      // Read once as bytes. Reading `.text()` alone would leave no way to hash
      // binary file content.
      const bytes = new Uint8Array(await response.arrayBuffer());

      // Decoded on first read, not on every response — see the same getter in
      // WebdavFileSource's client. The reindexer's checksum sampling GETs whole
      // files through here and reads only `bodyBytes`; decoding those to a
      // string nobody looks at is pure allocation.
      let text: string | undefined;
      return {
        status: response.status,
        get body(): string {
          text ??= new TextDecoder().decode(bytes);
          return text;
        },
        headers,
        bodyBytes: bytes,
      };
    },
  };
}
