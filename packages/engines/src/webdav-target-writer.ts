// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WebDAV Target Writer Implementation
 * 
 * Implements FileTargetWriter interface for WebDAV file synchronization.
 * Uses rclone for bulk operations and direct WebDAV API calls for individual operations.
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
  RemovalResult,
} from '@openmig/shared';
import {
  fileNaturalKeyHash,
  fileContentHash,
  streamingFileContentHash,
  tooLargeToBuffer,
  isOnTarget,
} from '@openmig/shared';
import { davRefusalBody } from '@openmig/shared';
import { parseMultiStatus, isCollection, hrefRelativeTo, sizeOf } from './dav-multistatus.ts';
import { requestWithDavRetry } from './dav-retry.ts';
import { readEtag, ownershipOf } from './dav-target-version.ts';
import { removeDavResource, assertRemovableTargetId } from './dav-remove.ts';
import { log } from '@openmig/shared';

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
  /** Use chunked uploads for large files */
  chunkedUploads?: boolean;
  /** Chunk size for chunked uploads (in bytes) */
  chunkSize?: number;
}

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
   * One snapshot of everything already under the target root, natural key
   * (root-relative path) -> href.
   *
   * The existence check was a PROPFIND PER FILE. `listEntries()` walks the tree
   * with one PROPFIND per DIRECTORY, and there are far fewer directories than
   * files — 670 files across a handful of folders in a real run. Built lazily
   * and shared, so concurrent items coalesce onto one walk.
   */
  private rootKeys: Promise<Map<string, string> | undefined> | undefined;
  /**
   * Root-relative paths on the target that are COLLECTIONS.
   *
   * Filled in by `listEntries` as it walks, so it costs nothing extra — that
   * walk already descends into every directory, it simply did not keep them.
   * They matter because a directory sitting where a file has to go is a
   * conflict this writer must not paper over; see `upsertFile`.
   */
  private readonly rootDirs = new Set<string>();

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
  private async ensureCollectionPath(path: string): Promise<void> {
    const collection = this.normalizeRelativePath(path);
    if (collection === '') return;
    // The up-front walk fills `rootDirs`; a memoised no-op after the first call.
    await this.keysUnderRoot();
    const segments = collection.split('/');
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth).join('/');
      if (this.rootDirs.has(prefix)) continue;
      if (await this.directoryExists(prefix)) {
        this.rootDirs.add(prefix);
        continue;
      }
      await this.createDirectory(prefix);
      this.rootDirs.add(prefix);
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
      (await this.keysUnderRoot())?.set(this.normalizeRelativePath(naturalKey), written.path);
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
    // The snapshot has to be awaited FIRST: `rootDirs` is filled in by that
    // walk, so consulting it beforehand always reads an empty set. (It did, and
    // the unit test below caught it.) The call is memoised, so this costs
    // nothing — `existingTargetId` awaits the very same promise.
    await this.keysUnderRoot();
    if (this.rootDirs.has(this.normalizeRelativePath(naturalKey))) {
      throw new Error(
        `Cannot write ${naturalKey}: the target already holds a DIRECTORY at that path. ` +
          'Writing the file would destroy it, and adopting the directory would record an ' +
          'item that was never copied. Rename the source file and retry, or accept leaving ' +
          'it behind.',
      );
    }

    // Check if file already exists on target
    const existingId = await this.existingTargetId(_parentId, naturalKey);
    if (existingId) {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: 'file',
        mappingId: this.mappingId,
        naturalKeyHash,
        contentHash: await hashOfContent(),
        targetId: existingId,
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
      return { targetId: existingId, created: false, adopted: true };
    }

    // Upload the file to the target
    const written = await this.uploadFile(raw);
    // The digest the upload made on its way past, when it streamed. Falls back
    // to the buffered hash, which is what every non-streaming source produces.
    if (written.contentHash !== undefined) contentHashValue = written.contentHash;
    const fileId = written.path;
    (await this.keysUnderRoot())?.set(this.normalizeRelativePath(naturalKey), fileId);

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
   * Natural key -> href for everything already under the root; undefined when
   * the target cannot be walked, in which case the caller falls back to the
   * per-item PROPFIND. A target we cannot enumerate must still be migratable.
   */
  private keysUnderRoot(): Promise<Map<string, string> | undefined> {
    if (!this.rootKeys) {
      this.rootKeys = (async () => {
        try {
          const keys = new Map<string, string>();
          for await (const entry of this.listEntries()) {
            keys.set(entry.naturalKey, entry.targetId);
          }
          return keys;
        } catch (err) {
          log.warn(
            `[webdav] could not walk the target root up front, falling back to a per-item ` +
              `existence check: ${err instanceof Error ? err.message : String(err)}`,
          );
          return undefined;
        }
      })();
    }
    return this.rootKeys;
  }

  /** Is this file already on the target? Snapshot first, per-item PROPFIND as fallback. */
  private async existingTargetId(
    parentId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    const keys = await this.keysUnderRoot();
    if (keys) return keys.get(this.normalizeRelativePath(naturalKey));
    return this.findFileByNaturalKey(parentId, naturalKey);
  }

  /**
   * Find a file by its natural key (path).
   * Returns the file ID if found, undefined otherwise.
   */
  async findFileByNaturalKey(
    _parentId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    // naturalKey is already root-relative and self-contained; resolve it directly (see upsertFile).
    const filePath = this.normalizeRelativePath(naturalKey);

    try {
      const response = await this.httpClient.request({
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
    } catch (err) {
      // A conflict is a real answer and must not be swallowed by the
      // "doesn't exist" catch below — that is how it became invisible.
      if (err instanceof Error && err.message.startsWith('Cannot write ')) throw err;
      // File doesn't exist
    }

    return undefined;
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
      throw new Error(
        `PROPFIND on ${dir || '/'} failed with status ${response.status}: ${davRefusalBody(response.body)}`,
      );
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
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    const filePath = this.normalizeRelativePath(entry.naturalKey);
    let response: HttpResponse;
    try {
      response = await this.httpClient.request({
        method: 'GET',
        url: this.buildUrl(filePath),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
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

    if (response.status !== 200) return undefined;
    // Bytes only. Hashing the UTF-8 decoded `body` would differ from the source
    // hash for every non-ASCII binary file — reporting healthy files as corrupt.
    if (!response.bodyBytes) return undefined;
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

  private async createDirectory(path: string): Promise<void> {
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
    if (response.status === 201 || response.status === 405) return;
    if (response.status >= 200 && response.status < 300) return;
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

  private async uploadFile(
    raw: RawFileItem,
    overwrite = false,
    expectedTargetVersion?: string,
  ): Promise<{ path: string; etag?: string; conflicted?: boolean; contentHash?: string }> {
    // raw.item.path is root-relative and self-contained (see WebdavFileSource.toRelativePath);
    // resolve it directly instead of re-deriving it from a parent directory id.
    const filePath = this.normalizeRelativePath(raw.item.path);

    // Ownership, re-checked at the last possible moment. See the same guard in
    // caldav-target-writer.ts. It sits ahead of the chunked branch too: a large
    // file the owner has edited in the new system is no more ours to replace
    // than a small one.
    if (overwrite && expectedTargetVersion !== undefined) {
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
      return this.uploadStreamed(filePath, raw, overwrite);
    }

    // Check if file is large and should use chunked upload
    const useChunked = this.config.chunkedUploads &&
                      raw.content && raw.content.length > (this.config.chunkSize || 10 * 1024 * 1024);

    if (useChunked && raw.content) {
      // No ETag from this path: the last chunk's response describes a chunk,
      // not the assembled file. The item simply has no overwrite protection
      // until something rewrites it in one piece, which is honest — inventing a
      // version here would be worse than admitting we do not have one.
      return { path: await this.uploadFileChunked(filePath, raw.content) };
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
          // specified never to do (hard rule 2). NOT applied to the chunked
          // path below: that PUTs the same href repeatedly with Content-Range,
          // so a create-only precondition would reject every chunk after the
          // first.
          //
          // On the update path replacing IS the intent, and the ownership
          // decision was made upstream against the ledger. Sending the
          // precondition anyway made the server answer 412, which the branch
          // below reports as success — the rewrite silently did nothing while
          // the pass counted `updated: 1`.
          ...(overwrite ? {} : { 'If-None-Match': '*' }),
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      // 412: already there. The snapshot was stale, not the write wrong.
      // Unreachable on the overwrite path, which sends no precondition; if a
      // server returns it anyway that is a refusal to replace, and reporting it
      // as a successful rewrite would record a copy the target does not hold.
      if (response.status === 412) {
        if (overwrite) {
          throw new Error(
            `PUT for ${filePath} was refused with 412 on a deliberate rewrite. ` +
              'The file was NOT replaced.',
          );
        }
        // Something was already there, so its version is not ours to claim.
        return { path: filePath };
      }
      // RFC 4918 §9.7.1: PUT returns 201 (created) or 204 (existing resource replaced). Without
      // this check a failed write (e.g. the parent collection doesn't actually exist) was
      // silently treated as success, and the ledger recorded a false "copied" status that then
      // permanently blocked retries via its own fast-path (confirmed live).
      if (response.status !== 201 && response.status !== 204) {
        throw new Error(`PUT failed for ${filePath} with status ${response.status}: ${davRefusalBody(response.body)}`);
      }
      return {
        path: filePath,
        ...(readEtag(response) !== undefined ? { etag: readEtag(response) } : {}),
      };
    }

    return { path: filePath };
  }

  /**
   * PUT a file whose bytes nobody is holding.
   *
   * One request with a streaming body, which is what makes a file larger than
   * this process possible at all. NOT the chunked path: that exists for
   * servers with a per-request size limit and needs the whole file addressable
   * to divide it, which is the ceiling being removed here. A deployment that
   * needs both — a huge file AND a server that caps request size — is the
   * resumable-upload work, and this refuses rather than pretending.
   */
  private async uploadStreamed(
    filePath: string,
    raw: RawFileItem,
    overwrite: boolean,
  ): Promise<{ path: string; etag?: string; conflicted?: boolean; contentHash?: string }> {
    const body = raw.body!;
    if (this.config.chunkedUploads && body.sizeBytes > (this.config.chunkSize || 10 * 1024 * 1024)) {
      // Saying so beats a request the server will cut off half way, which
      // leaves a partial file at the href and an error that names neither.
      throw tooLargeToBuffer('written to', 'this WebDAV server in one request', raw.item.path, body.sizeBytes);
    }
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
          ...(overwrite ? {} : { 'If-None-Match': '*' }),
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      };
    });
    if (response.status === 412) {
      if (overwrite) {
        throw new Error(
          `PUT for ${filePath} was refused with 412 on a deliberate rewrite. ` +
            'The file was NOT replaced.',
        );
      }
      return { path: filePath };
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
      ...(readEtag(response) !== undefined ? { etag: readEtag(response) } : {}),
    };
  }

  private async uploadFileChunked(
    filePath: string,
    content: Uint8Array,
  ): Promise<string> {
    const chunkSize = this.config.chunkSize || 10 * 1024 * 1024; // 10MB default
    const totalChunks = Math.ceil(content.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, content.length);
      const chunk = content.slice(start, end);

      const range = `bytes=${start}-${end - 1}/${content.length}`;

      const response = await this.requestWithRetry({
        method: 'PUT',
        url: this.buildUrl(filePath),
        body: chunk,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': range,
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
        throw new Error(`Chunked PUT failed for ${filePath} with status ${response.status}: ${davRefusalBody(response.body)}`);
      }
    }

    return filePath;
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
  private buildUrl(path: string): string {
    const baseUrl = this.config.url.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    if (normalizedPath === '') return `${baseUrl}/`;
    const encoded = normalizedPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    return `${baseUrl}/${encoded}`;
  }
}

/**
 * HTTP client interface for WebDAV requests
 */
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
}

/**
 * Create a default HTTP client using Node.js fetch
 */
function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      /**
       * `duplex: 'half'` is not optional for a stream body: Node's fetch
       * refuses one without it, with a TypeError about the RequestInit rather
       * than about the file — so it reads as a bug in the writer. It is absent
       * from the DOM typings, hence the cast, which is here rather than
       * somewhere it would be easy to delete as noise.
       */
      const streaming = options.body instanceof ReadableStream;
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body as RequestInit['body'],
        ...(streaming ? ({ duplex: 'half' } as Record<string, unknown>) : {}),
      });

      // Read once as bytes. Reading `.text()` alone would leave no way to hash
      // binary file content.
      const bytes = new Uint8Array(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

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
