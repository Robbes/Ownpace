// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Files as a JMAP target — workplan 0031 T3.
 *
 * WHY THIS EXISTS AT ALL. Stalwart already serves files over WebDAV and
 * `webdav-target-writer.ts` works. What this buys is the thing the owner
 * decided 0031 for: ONE PROTOCOL PER TARGET — one credential, one failure
 * mode, one set of semantics per migration. WebDAV is not being replaced;
 * Nextcloud and openDesk do not speak JMAP for this domain and their targets
 * stay exactly as they are.
 *
 * ============================================================================
 * THE TWO FINDINGS FROM THE SPIKE THAT THIS FILE IS BUILT AROUND
 * ============================================================================
 *
 * **1. A `FileNode` has no path.** Its identity is `name` + `parentId` — a
 * chain — while `fileNaturalKeyHash()` hashes a normalised PATH. So every
 * natural key here comes out of `reconstructFileNodePath()`
 * (`@openmig/shared`), which walks the chain into the exact shape
 * `webdav-source.ts`'s `toRelativePath` produces and REFUSES rather than
 * guesses. Nothing in this file re-implements path handling, deliberately: if
 * the two producers differed by one byte every file would re-copy on every
 * pass, and every write would succeed while it happened (hard rule 1). Path
 * normalisation has already caused four silent-mismatch bugs in this repo.
 *
 * **2. The blobId you upload is NOT the blobId the node carries.** Stalwart
 * re-issues the handle once the blob is attached to a node — the spike
 * uploaded `eda…udrxi0gbq` and read back `cc2…gaqmai` on 2026-08-06. Any code
 * that keeps the upload's blobId in order to fetch the content later is
 * holding a handle the store does not use. So `contentHashFor` reads the
 * blobId OFF THE NODE, every time. Getting this wrong does not fail at write
 * time; it surfaces as §20 checksum samples quietly returning
 * `checksumUnavailable`, which is a check that looks like it ran.
 *
 * ============================================================================
 * WHAT THIS DOMAIN GETS THAT CONTACTS DOES NOT
 * ============================================================================
 *
 * A `ContactCard` carries no handle back to the source bytes, so
 * `JmapContactTarget` has no §20 content leg at all and says so. A `FileNode`
 * carries `blobId` AND `size`, both proven real by the spike (`size: 27`
 * matching the bytes uploaded, `type: "text/plain"` matching the upload). So
 * files over JMAP are verified exactly as files over WebDAV are: counts, bytes
 * AND content checksums. No narrowing needs stating for this transport.
 *
 * ============================================================================
 * TRANSPORT, SHARED WITH THE OTHER TWO JMAP WRITERS
 * ============================================================================
 *
 * The session's advertised `apiUrl` is `https://0.0.0.0/jmap/` — unroutable —
 * so every URL here is rebuilt from the `baseUrl` we were actually given.
 * Rate limits are waited out rather than turned into failed items. And a
 * METHOD-LEVEL JMAP error arrives as `["error", {...}]` inside an HTTP 200
 * (RFC 8620 §3.6.2): returning it as if it were the result turns a refused
 * query into `{ list: undefined }`, which reads as an EMPTY TARGET and gets
 * reported as total data loss. That bug was fixed in the mail writer and is
 * not being re-introduced here.
 *
 * @see docs/workplans/0031-jmap-full-target.md — T3 and the two spike rungs
 * @see packages/shared/src/jmap-file-path.ts — the path reconstruction
 */

import { loadJmapSession } from './jmap-session.ts';
import type {
  FileTargetWriter,
  FileFolder,
  RawFileItem,
  UpsertResult,
  UpsertOptions,
  TargetReindexer,
  TargetPresenceCheck,
  TargetEntry,
  RemovalResult,
  FileNodeRef,
} from '@openmig/shared';
import {
  parseRetryAfterMs,
  log,
  fileContentHash,
  reconstructFileNodePath,
  fileNodeIndex,
} from '@openmig/shared';
import { createHash } from 'node:crypto';

/** See `jmap-target.ts` — same server, same reasoning, same numbers. */
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_BASE_BACKOFF_MS = 1000;

/**
 * The ONLY property list this file uses for reading nodes.
 *
 * `blobId` is in it for the reason in the header: the stored handle is not the
 * uploaded one, so anything that wants the content has to ask the node. `size`
 * is in it because it is what lets verification report `totalBytesTarget` as a
 * measurement rather than an estimate. `parentId` and `name` are the identity
 * the path is reconstructed from — omit either and every key is wrong.
 */
const NODE_PROPERTIES = ['id', 'parentId', 'name', 'nodeType', 'blobId', 'size', 'type'] as const;

/** The capabilities every request here declares. */
const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:filenode'] as const;

/** Connection details. Same shape as the other two JMAP writers, deliberately. */
export interface JmapFileTargetConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  /** Optional well-known discovery path (default: /.well-known/jmap). */
  readonly wellKnownPath?: string;
}

/** A FileNode as it comes off the wire. */
interface FileNode {
  readonly id: string;
  readonly parentId?: string | null;
  readonly name?: string;
  readonly nodeType?: string;
  readonly blobId?: string | null;
  readonly size?: number | null;
  readonly type?: string | null;
}

interface NodeGetResponse {
  readonly list?: ReadonlyArray<FileNode>;
  readonly notFound?: ReadonlyArray<string>;
}

interface NodeSetResponse {
  readonly created?: Record<string, { id: string; blobId?: string }>;
  readonly updated?: Record<string, unknown>;
  readonly destroyed?: ReadonlyArray<string>;
  readonly notCreated?: Record<string, { type: string; description?: string }>;
  readonly notUpdated?: Record<string, { type: string; description?: string }>;
  readonly notDestroyed?: Record<string, { type: string; description?: string }>;
}

interface JmapSession {
  readonly accounts?: Record<string, { id?: string; name?: string; email?: string }>;
  readonly primaryAccounts?: Record<string, string>;
  readonly downloadUrl?: string;
}

/**
 * One read of the account's whole file tree, indexed and keyed the way the
 * ledger keys it.
 *
 * `files` is natural key (root-relative path) -> node; `directories` is the
 * same for directory nodes. Both are needed and they are kept apart on
 * purpose: a directory sitting where a file must go is a conflict this writer
 * must refuse rather than paper over, exactly as the WebDAV writer does, and
 * one combined map would make the two indistinguishable.
 */
interface TreeSnapshot {
  readonly nodes: Map<string, FileNodeRef>;
  readonly files: Map<string, FileNode>;
  readonly directories: Map<string, FileNode>;
}

export class JmapFileTarget implements FileTargetWriter, TargetReindexer, TargetPresenceCheck {
  private readonly config: JmapFileTargetConfig;
  private accountId: string | null = null;
  private apiUrl: string | null = null;
  private authHeader: string | null = null;
  private downloadUrlTemplate: string | null = null;
  private connectPromise: Promise<void> | null = null;
  /**
   * The account's file tree as of the first read this pass.
   *
   * Held as a PROMISE so concurrent items coalesce onto one enumeration rather
   * than racing to build it N times, and `undefined` INSIDE the promise means
   * "could not be built" — never "the account is empty". The difference is the
   * whole ballgame: an empty tree reads as "the target holds nothing", which
   * would make us write everything a second time.
   */
  private treeSnapshot: Promise<TreeSnapshot | undefined> | null = null;

  constructor(config: JmapFileTargetConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------

  /**
   * Self-connect on first use, single-flight.
   *
   * `FileTargetWriter` has no `connect()` and the sync path never calls the
   * concrete one, so a writer that waits to be connected throws on every
   * write. Same lesson, same fix as `JmapTargetWriter` and
   * `JmapContactTarget`. A failed connect is not cached, so the next call
   * retries.
   */
  private async ensureConnected(): Promise<void> {
    if (this.accountId && this.apiUrl && this.authHeader) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().catch((err: unknown) => {
        this.connectPromise = null;
        throw err;
      });
    }
    await this.connectPromise;
  }

  async connect(): Promise<void> {
    this.authHeader = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
    const sessionUrl = `${this.config.baseUrl}${this.config.wellKnownPath ?? '/.well-known/jmap'}`;
    // `loadJmapSession`, NOT `JamClient.loadSession`. That helper never checks
    // `response.ok`, so a 401 carrying a JSON body resolves as a session with no
    // accounts — and the guard below then blames account resolution for what was
    // only ever a rejected credential. No data was ever at risk (the guard does
    // its job); the DIAGNOSIS was wrong, which costs the reader time exactly
    // when a connection is broken. See `jmap-session.ts`.
    const session = (await loadJmapSession(sessionUrl, this.authHeader)) as JmapSession;

    // The session's own `apiUrl` is IGNORED, and that is not an oversight:
    // Stalwart advertises `https://0.0.0.0/jmap/`, which is unroutable. The
    // mail writer has said so since 0001 and the spike proved it again on
    // 2026-08-05. Rebuild from the base URL we were actually given.
    this.apiUrl = this.config.baseUrl.endsWith('/')
      ? `${this.config.baseUrl}jmap`
      : `${this.config.baseUrl}/jmap`;

    // The download template's PATH is the server's to define and cannot be
    // guessed — see `blobDownloadUrl`. Its HOST is not trusted, for the same
    // reason `apiUrl` is not.
    this.downloadUrlTemplate = typeof session.downloadUrl === 'string' ? session.downloadUrl : null;

    // Resolve the account by MATCHING the configured address, never by taking
    // the first one. Writing a customer's files into somebody else's account
    // is the worst thing this file could do, and it is one loose
    // `Object.keys(...)[0]` away — which is exactly how it once happened on
    // the mail side.
    let resolved: string | undefined;
    for (const [id, info] of Object.entries(session.accounts ?? {})) {
      if (info.email === this.config.username || info.name === this.config.username) {
        resolved = id;
        break;
      }
    }
    resolved ??= session.primaryAccounts?.['urn:ietf:params:jmap:filenode'];

    if (!resolved) {
      throw new Error(
        `Could not resolve a JMAP filenode account for '${this.config.username}'. The session ` +
          `advertises ${Object.keys(session.accounts ?? {}).length} account(s) and no ` +
          `primaryAccounts entry for urn:ietf:params:jmap:filenode. Refusing to proceed rather ` +
          `than guess which account to write a customer's files into.`,
      );
    }
    this.accountId = resolved;
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  /**
   * `fetch`, but a target that answers "too many requests" is waited out
   * rather than turned into a failed item. See `jmap-target.ts` for the
   * measurements behind the numbers; a 429 is the server asking for a pause,
   * and the only correct response to that is to pause.
   */
  private async fetchWithRateLimitRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, init);
      const rateLimited = response.status === 429 || response.status === 503;
      if (!rateLimited || attempt >= RATE_LIMIT_ATTEMPTS - 1) return response;

      const header = response.headers.get('retry-after');
      const waitMs = header
        ? parseRetryAfterMs(header)
        : RATE_LIMIT_BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
      await response.text().catch(() => undefined);
      log.warn(
        `[jmap-files] ${response.status} from ${new URL(url).pathname}; waiting ` +
          `${Math.round(waitMs)}ms before retry ${attempt + 2}/${RATE_LIMIT_ATTEMPTS}`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private async apiRequest<T>(method: string, args: Record<string, unknown>): Promise<T> {
    if (!this.apiUrl || !this.authHeader) throw new Error('Not connected to JMAP server');

    const response = await this.fetchWithRateLimitRetry(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ using: USING, methodCalls: [[method, args, 'c1']] }),
    });

    if (!response.ok) {
      // Read as TEXT first. A proxy or rate limiter answers with HTML, and
      // `response.json()` then throws a parse error saying nothing about the
      // status the server actually returned — the real failure replaced by a
      // misleading one (hard rule 9).
      const body = await response.text().catch(() => '');
      let detail = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body) as { type?: string; detail?: string; description?: string };
        detail = `${parsed.type ?? 'unknown'} - ${parsed.description ?? parsed.detail ?? 'no description'}`;
      } catch {
        // Not JSON; the truncated body is the best description available.
      }
      throw new Error(`JMAP ${method} failed: HTTP ${response.status} - ${detail}`);
    }

    const result = (await response.json()) as { methodResponses?: Array<unknown[]> };
    const first = result.methodResponses?.[0];
    if (!first || !Array.isArray(first) || first.length < 2) {
      throw new Error(`Invalid JMAP response format for ${method}`);
    }

    // A method-level error arrives as ["error", {...}] inside methodResponses
    // with HTTP 200 (RFC 8620 §3.6.2). Returning `first[1]` blindly hands that
    // error object back AS IF it were the result, so a refused query becomes
    // `{ list: undefined }`, enumeration yields nothing, and verification
    // reads the target as EMPTY — reported as total data loss.
    if (first[0] === 'error') {
      const err = first[1] as { type?: string; description?: string };
      throw new Error(
        `JMAP ${method} failed: ${err?.type ?? 'unknown'}` +
          (err?.description ? ` - ${err.description}` : ''),
      );
    }
    return first[1] as T;
  }

  // ---------------------------------------------------------------------
  // The tree
  // ---------------------------------------------------------------------

  /**
   * Read the account's whole file tree and key it the way the ledger does.
   *
   * ONE call with `ids: null`, which is how the spike read it. Paging would
   * need `FileNode/query`, and nothing has confirmed this server implements
   * it; a paginating enumerator built on an unverified method fails by
   * returning FEWER nodes than exist, which reads as data loss. That bound is
   * stated rather than hidden — the same call and the same reasoning as
   * `JmapContactTarget.listEntries`.
   */
  private async readTree(): Promise<TreeSnapshot> {
    await this.ensureConnected();
    const response = await this.apiRequest<NodeGetResponse>('FileNode/get', {
      accountId: this.accountId,
      ids: null,
      properties: [...NODE_PROPERTIES],
    });

    const raw = response.list ?? [];
    const refs: FileNodeRef[] = [];
    for (const node of raw) {
      if (typeof node.id !== 'string' || typeof node.name !== 'string') {
        // Identity is `name` + `parentId`. A node missing either cannot be
        // keyed, and keying it by its JMAP id would report a file that IS
        // there as missing — the ADR-0020 failure mode.
        throw new Error(
          `FileNode ${String(node.id)} on the target has no name; it cannot be keyed for ` +
            `verification, and keying it by its JMAP id would report a file that IS there as ` +
            `missing.`,
        );
      }
      refs.push({ id: node.id, name: node.name, parentId: node.parentId ?? null });
    }
    const nodes = fileNodeIndex(refs);

    const files = new Map<string, FileNode>();
    const directories = new Map<string, FileNode>();
    for (const node of raw) {
      const kind = nodeKind(node);
      const path = reconstructFileNodePath(node.id, nodes);
      if (!path.ok) {
        // Refuse loudly. A partial or guessed path is a well-formed string
        // that hashes to something no other transport will ever produce, so
        // the item would copy again on every single pass, forever, silently.
        throw new Error(
          `Cannot key FileNode ${node.id} on the target: ${path.reason} Nothing on this account ` +
            `can be compared against the ledger until that is resolved.`,
        );
      }
      (kind === 'directory' ? directories : files).set(path.path, node);
    }
    return { nodes, files, directories };
  }

  /**
   * The tree, read once per writer instance.
   *
   * Returns `undefined`, never an empty snapshot, when the account cannot be
   * enumerated — the caller then probes per item, which is slower and still
   * correct. A silent empty snapshot would be indistinguishable from an empty
   * account and would make this writer copy everything a second time.
   */
  private async tree(): Promise<TreeSnapshot | undefined> {
    this.treeSnapshot ??= this.readTree().catch((err: unknown) => {
      log.warn(
        `[jmap-files] could not enumerate the target account ` +
          `(${err instanceof Error ? err.message : String(err)}); falling back to a per-file ` +
          `existence check`,
      );
      return undefined;
    });
    return this.treeSnapshot;
  }

  /** Forget the cached tree, so the next read sees what we just wrote. */
  private invalidateTree(): void {
    this.treeSnapshot = null;
  }

  /**
   * Record something we just created into the cached tree.
   *
   * Cheaper than invalidating, and not merely as an optimisation: creating a
   * three-deep folder would otherwise re-read the whole account once per
   * segment, and each of those reads is the one call this connector cannot
   * page. The snapshot is ours and we know exactly what changed.
   */
  private remember(path: string, node: FileNode, snapshot: TreeSnapshot | undefined): void {
    if (!snapshot) return;
    snapshot.nodes.set(node.id, {
      id: node.id,
      name: node.name ?? lastSegment(path),
      parentId: node.parentId ?? null,
    });
    (nodeKind(node) === 'directory' ? snapshot.directories : snapshot.files).set(path, node);
  }

  // ---------------------------------------------------------------------
  // Directories
  // ---------------------------------------------------------------------

  /**
   * Ensure a directory exists; return its node id.
   *
   * The empty path is the account's file root, which has no node of its own —
   * a root-level node carries `parentId: null`. `''` is therefore returned to
   * mean exactly that, and `parentIdFor` turns it back into `null`.
   */
  async ensureDirectory(folder: FileFolder): Promise<string> {
    await this.ensureConnected();
    return this.ensureDirectoryPath(normalizeRelativePath(folder.path));
  }

  /**
   * Create every missing segment of `path`, root first, and return the leaf's
   * node id (`''` for the root itself).
   *
   * Intermediate directories are created rather than assumed: the sync loop
   * calls `ensureDirectory` per SOURCE folder, and a file whose parent folder
   * was never listed still has to land somewhere. WebDAV gets this for free —
   * a path is a path — and JMAP does not, because a node without a parent is
   * a node in a different place.
   */
  private async ensureDirectoryPath(path: string): Promise<string> {
    if (path === '') return '';

    const segments = path.split('/').filter((s) => s !== '');
    let parentId: string | null = null;
    let walked = '';

    for (const segment of segments) {
      walked = walked === '' ? segment : `${walked}/${segment}`;
      const snapshot = await this.tree();

      const asFile = snapshot?.files.get(walked);
      if (asFile) {
        // A file sitting where a directory has to go. The mirror of the
        // WebDAV writer's directory-over-file conflict, and refused for the
        // same reason: replacing it would destroy the customer's data and
        // adopting it would record a directory that is not one.
        throw new Error(
          `Cannot create directory ${walked}: the target already holds a FILE at that path. ` +
            `Rename the source folder and retry, or accept leaving it behind.`,
        );
      }

      const existing = snapshot?.directories.get(walked);
      if (existing) {
        parentId = existing.id;
        continue;
      }

      parentId = await this.createDirectory(segment, parentId, walked, snapshot);
    }

    return parentId ?? '';
  }

  /** One `FileNode/set` create for a directory, adopting an `alreadyExists`. */
  private async createDirectory(
    name: string,
    parentId: string | null,
    fullPath: string,
    snapshot: TreeSnapshot | undefined,
  ): Promise<string> {
    const response = await this.apiRequest<NodeSetResponse>('FileNode/set', {
      accountId: this.accountId,
      // No `@type`. Stalwart refused it with `invalidProperties: ["@type"]`
      // during the spike — recorded so nobody adds it back.
      create: { '0': { name, parentId } },
    });

    const id = response.created?.['0']?.id;
    if (id) {
      this.remember(fullPath, { id, name, parentId, nodeType: 'directory' }, snapshot);
      return id;
    }

    const failure = response.notCreated?.['0'];
    if (failure?.type === 'alreadyExists') {
      // The server reaching the outcome we wanted. Re-read and find it by
      // PATH — never by picking a node, which is how a customer's files end
      // up filed under something they did not ask for.
      this.invalidateTree();
      const again = await this.tree();
      const found = again?.directories.get(fullPath);
      if (found) return found.id;
    }
    throw new Error(
      `FileNode/set could not create directory '${fullPath}': ${failure?.type ?? 'no id returned'}` +
        (failure?.description ? ` - ${failure.description}` : ''),
    );
  }

  // ---------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------

  /**
   * Idempotently write one file.
   *
   * The natural key is the root-relative path — exactly what
   * `fileNaturalKeyHash` hashes — and on this transport it is RECONSTRUCTED
   * from the node's parent chain rather than read off a field, because a
   * FileNode has no path. That is what makes a mapping switchable between this
   * target and the WebDAV one without re-copying anything (hard rule 1).
   *
   * `parentId` is ignored, exactly as the WebDAV writer ignores it: the
   * natural key handed to us is already root-relative AND self-contained — it
   * includes its own containing folders — so combining it with a parent would
   * double the prefix.
   */
  async upsertFile(
    _parentId: string,
    raw: RawFileItem,
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    await this.ensureConnected();
    const naturalKey = normalizeRelativePath(raw.item.path);
    if (naturalKey === '') {
      throw new Error('Refusing to write a file with an empty path: it has no natural key.');
    }

    // UPDATE PATH. Reached only for an item WE copied whose source has since
    // changed — `runDomainSync` decides that, never this writer.
    if (options?.overwrite) {
      return this.rewriteFile(raw, naturalKey, options.expectedTargetVersion);
    }

    const snapshot = await this.tree();

    if (snapshot?.directories.has(naturalKey)) {
      // A DIRECTORY where this file has to go. Writing over it would destroy
      // it; adopting it would record an item whose content was never written.
      // There is no third answer this writer can give on its own, so it fails
      // the item and the operator decides — exactly the shape per-item failure
      // isolation exists for.
      throw new Error(
        `Cannot write ${naturalKey}: the target already holds a DIRECTORY at that path. ` +
          `Writing the file would destroy it, and adopting the directory would record an item ` +
          `that was never copied. Rename the source file and retry, or accept leaving it behind.`,
      );
    }

    const existing = snapshot
      ? snapshot.files.get(naturalKey)?.id
      : await this.findFileByNaturalKey('', naturalKey);
    if (existing) {
      // Already on the target under our natural key: not written, ADOPTED.
      // A distinct fact from a ledger fast-path skip, and it has to be visible
      // before a cutover — see `UpsertResult.adopted`.
      return { targetId: existing, created: false, adopted: true };
    }

    const parentNodeId = await this.ensureDirectoryPath(parentPathOf(naturalKey));
    const content = raw.content;
    if (!content) {
      // A file with no bytes is not the same thing as an empty file, and the
      // sync loop already refuses to hand one over (`runFileSync`'s fetchRaw).
      // Writing a zero-byte node in its place would be a silent empty copy of
      // somebody's file — the worst failure this code can produce.
      throw new Error(
        `No content for ${naturalKey}; refusing to create an empty node in its place.`,
      );
    }

    const blobId = await this.uploadContent(content, raw.item.mimeType);
    const response = await this.apiRequest<NodeSetResponse>('FileNode/set', {
      accountId: this.accountId,
      create: {
        '0': {
          name: lastSegment(naturalKey),
          parentId: parentIdFor(parentNodeId),
          blobId,
          ...(raw.item.mimeType ? { type: raw.item.mimeType } : {}),
        },
      },
    });

    const createdId = response.created?.['0']?.id;
    if (!createdId) {
      const failure = response.notCreated?.['0'];
      // `alreadyExists` is the SERVER reaching the outcome we wanted. The
      // snapshot is taken once per pass, so the window between "not in the
      // snapshot" and this write is a whole pass wide — the server, not our
      // snapshot, is what actually guarantees no second copy here.
      if (failure?.type === 'alreadyExists') {
        this.invalidateTree();
        const found = await this.findFileByNaturalKey('', naturalKey);
        if (found) return { targetId: found, created: false, adopted: true };
      }
      throw new Error(
        `FileNode/set refused ${naturalKey}: ${failure?.type ?? 'no id returned'}` +
          (failure?.description ? ` - ${failure.description}` : ''),
      );
    }

    this.remember(
      naturalKey,
      {
        id: createdId,
        name: lastSegment(naturalKey),
        parentId: parentIdFor(parentNodeId),
        nodeType: 'file',
      },
      snapshot,
    );
    // NOT `response.created['0'].blobId`, even if the server volunteers one.
    // See `storedNodeVersion`, and the header: the handle the store uses is
    // the one on the NODE.
    const targetVersion = await this.storedNodeVersion(createdId);
    return {
      targetId: createdId,
      created: true,
      ...(targetVersion !== undefined ? { targetVersion } : {}),
    };
  }

  /**
   * Replace a file this writer already wrote.
   *
   * **The ownership guard is built rather than borrowed, and that is the point
   * of this method.** The WebDAV writer compares an ETag; a JMAP FileNode
   * exposes none. What it does expose is a `blobId`, which is the server's own
   * handle for the stored bytes and changes when they change — so the version
   * marker here is a fingerprint of the node AS STORED, re-read and
   * re-fingerprinted before any rewrite or removal. An owner who edited our
   * copy in the new system — which shadow migration positively invites — keeps
   * their edit (hard rule 2).
   */
  private async rewriteFile(
    raw: RawFileItem,
    naturalKey: string,
    expectedTargetVersion?: string,
  ): Promise<UpsertResult> {
    const snapshot = await this.tree();
    const targetId = snapshot?.files.get(naturalKey)?.id
      ?? (await this.findFileByNaturalKey('', naturalKey));
    if (!targetId) {
      // Asked to rewrite something that is not there. Falling through to a
      // create would be convenient and wrong: the caller believes this item is
      // already on the target, and silently disagreeing hides whatever made
      // that untrue.
      throw new Error(
        `Asked to rewrite file ${naturalKey}, but no node with that path is on the target. ` +
          `Refusing to create one instead — the caller believes this item was already copied, ` +
          `and quietly disagreeing would hide whatever made that false.`,
      );
    }

    if (expectedTargetVersion !== undefined) {
      const current = await this.storedNodeVersion(targetId);
      if (current !== undefined && current !== expectedTargetVersion) {
        // Someone edited our copy. Not an error and deliberately not thrown:
        // a conflict is a fact about ownership, not a failure to migrate.
        return { targetId, created: false, conflicted: true };
      }
    }

    const content = raw.content;
    if (!content) {
      throw new Error(`No content for ${naturalKey}; refusing to blank the node on the target.`);
    }

    const blobId = await this.uploadContent(content, raw.item.mimeType);
    const response = await this.apiRequest<NodeSetResponse>('FileNode/set', {
      accountId: this.accountId,
      update: {
        [targetId]: {
          blobId,
          ...(raw.item.mimeType ? { type: raw.item.mimeType } : {}),
        },
      },
    });
    const failure = response.notUpdated?.[targetId];
    if (failure) {
      // HTTP 200 either way (RFC 8620 §3.6.2): a per-item refusal arrives in
      // `notUpdated`, not as a transport error. Not looking is how a rewrite
      // that did nothing gets counted as an update.
      throw new Error(
        `FileNode/set could not update ${targetId} (${naturalKey}): ${failure.type}` +
          (failure.description ? ` - ${failure.description}` : ''),
      );
    }

    // The node's identity did not change — same id, same path, same parent —
    // so the cached tree is still accurate. Only its blob moved, and the
    // fingerprint below is re-read rather than cached.
    const targetVersion = await this.storedNodeVersion(targetId);
    return {
      targetId,
      created: false,
      updated: true,
      ...(targetVersion !== undefined ? { targetVersion } : {}),
    };
  }

  /** Upload the bytes so `FileNode/set` has a blob to attach. */
  private async uploadContent(content: Uint8Array, mimeType?: string): Promise<string> {
    if (!this.apiUrl || !this.authHeader) throw new Error('Not connected to JMAP server');
    // Built from the resolved apiUrl, not the session's `uploadUrl`, for the
    // same reason `connect()` ignores `apiUrl`: the advertised host is
    // unroutable on Stalwart.
    const url = `${this.apiUrl}/upload/${encodeURIComponent(this.accountId!)}`;
    const response = await this.fetchWithRateLimitRetry(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': mimeType || 'application/octet-stream',
      },
      // Sliced to this view's own bytes before being wrapped, exactly as the
      // mail writer does. A Uint8Array can be a WINDOW onto a larger buffer
      // (`subarray` and several decoders produce those), and handing the
      // underlying buffer over would upload bytes belonging to another file.
      body: new Blob([
        content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ) as ArrayBuffer,
      ]),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`File blob upload failed: HTTP ${response.status} - ${detail.slice(0, 300)}`);
    }
    const { blobId } = (await response.json()) as { blobId?: string };
    if (!blobId) throw new Error('File blob upload returned no blobId');
    // Returned for the CREATE call only. It must never be kept for a later
    // read — Stalwart re-issues the handle once the blob is attached to a
    // node (spike, 2026-08-06), so the uploaded id stops being the store's.
    return blobId;
  }

  // ---------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------

  /**
   * Is this file already on the target?
   *
   * A failed lookup is NOT "not found". `upsertFile` reads `undefined` as "not
   * on the target yet" and writes, so swallowing a transient failure here
   * silently creates a duplicate — which breaks the one property the whole
   * product rests on (hard rule 1), and hard rule 9 forbids turning a failure
   * into an empty result. Failing loudly is safe and resumable: the pass
   * aborts, the cursor stays put, and the next pass re-scans from the same
   * point.
   */
  async findFileByNaturalKey(_parentId: string, naturalKey: string): Promise<string | undefined> {
    await this.ensureConnected();
    // A FRESH read, not the cached snapshot: this is the fallback the snapshot
    // failed to provide, and it is also what confirms an `alreadyExists`.
    const tree = await this.readTree();
    return tree.files.get(normalizeRelativePath(naturalKey))?.id;
  }

  /**
   * Every file on this target, keyed the way the ledger keys them.
   *
   * `naturalKey` is the root-relative path reconstructed from the parent
   * chain — the same shape `WebdavFileSource.toRelativePath` produces, pinned
   * by `jmap-file-path.unit.test.ts` through `fileNaturalKeyHash` rather than
   * by string comparison.
   *
   * `sizeBytes` is carried through because the node reports it and the spike
   * proved it real (`size: 27` for 27 bytes uploaded). That is what lets §20
   * report `totalBytesTarget` as a measurement — unlike contacts, which have
   * no such field and get counts alone.
   *
   * @param mailboxId Restrict to one directory node's subtree. Omitted, the
   *   whole account is listed.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    const tree = await this.readTree();

    for (const [path, node] of tree.files) {
      if (mailboxId && !isDescendantOf(node, mailboxId, tree.nodes)) continue;
      yield {
        naturalKey: path,
        targetId: node.id,
        mailboxId: node.parentId ?? '',
        // Left undefined rather than guessed: an estimated total is
        // indistinguishable from a measured one in the report, and the whole
        // point of the field is that it was measured.
        ...(typeof node.size === 'number' ? { sizeBytes: node.size } : {}),
      };
    }
  }

  /**
   * Hash a sampled file as it is stored on the target (§20 checksum leg).
   *
   * **THE ONE THING THIS METHOD EXISTS TO GET RIGHT: the blobId is read off
   * the NODE.** Stalwart re-issues the handle once a blob is attached, so the
   * id that came back from the upload is not the id the store uses. Keeping
   * the upload's would not fail at write time — it would surface here as an
   * intermittent 404, counted as `checksumUnavailable`, which looks exactly
   * like a check that ran and had nothing to say. That is the failure mode
   * this whole domain's §20 leg would quietly die of.
   *
   * Called for sampled items only, so the two round trips are bounded by the
   * sample size rather than the size of the account. Returns undefined when
   * the blob cannot be read: the sample is then counted as unavailable, never
   * as a mismatch — absence of evidence is not evidence of corruption.
   */
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    await this.ensureConnected();
    if (!this.apiUrl || !this.authHeader || !this.accountId) return undefined;

    const response = await this.apiRequest<NodeGetResponse>('FileNode/get', {
      accountId: this.accountId,
      ids: [entry.targetId],
      properties: [...NODE_PROPERTIES],
    });
    const blobId = response.list?.[0]?.blobId;
    if (!blobId) {
      // Say why. Silently returning undefined made every mail sample come back
      // `checksumUnavailable` with no indication of the cause, so §20's
      // content leg was reported as "not exercised" run after run and nothing
      // said the download was failing (hard rule 9).
      log.warn(`[jmap-files] no blobId on node ${entry.targetId}; cannot content-verify it`);
      return undefined;
    }

    const url = this.blobDownloadUrl(blobId, lastSegment(entry.naturalKey));
    const downloaded = await this.fetchWithRateLimitRetry(url, {
      headers: { Authorization: this.authHeader },
    });
    if (!downloaded.ok) {
      log.warn(`[jmap-files] blob download failed: GET ${url} -> ${downloaded.status}`);
      return undefined;
    }
    return fileContentHash(new Uint8Array(await downloaded.arrayBuffer()));
  }

  /**
   * Where to GET a blob.
   *
   * Prefers the session's RFC 8620 §2 `downloadUrl` template, because the path
   * shape is the server's to define and cannot be guessed: Stalwart's ends in
   * a `/{name}` segment, so a hand-built `/download/{accountId}/{blobId}` is a
   * 404 every time — which is how all ten mail samples in the first full
   * verification run came back `checksumUnavailable`.
   *
   * The template's HOST is not trusted, for the same reason `apiUrl` is not.
   * Take the template's path and query, and re-base them on the origin already
   * proven to work.
   */
  private blobDownloadUrl(blobId: string, name: string): string {
    const origin = new URL(this.apiUrl!).origin;

    if (this.downloadUrlTemplate) {
      const filled = this.downloadUrlTemplate
        .replace(/{accountId}/g, encodeURIComponent(this.accountId!))
        .replace(/{blobId}/g, encodeURIComponent(blobId))
        // `name` is a download filename hint and `type` the requested content
        // type; neither affects the bytes that come back.
        .replace(/{name}/g, encodeURIComponent(name || 'file'))
        .replace(/{type}/g, encodeURIComponent('application/octet-stream'));
      const resolved = new URL(filled, origin);
      resolved.protocol = new URL(origin).protocol;
      resolved.host = new URL(origin).host;
      return resolved.toString();
    }

    return `${this.apiUrl}/download/${encodeURIComponent(this.accountId!)}/${encodeURIComponent(blobId)}`;
  }

  /**
   * A stable fingerprint of one node AS THE SERVER STORES IT.
   *
   * The ownership marker this transport does not otherwise have — see
   * `rewriteFile`. Built over the fixed `NODE_PROPERTIES` list so it is
   * deterministic, canonicalised because JMAP makes no promise about key order
   * and Stalwart demonstrably varies it between reads: hashing the raw JSON
   * would report a conflict on every rewrite and quietly stop update
   * propagation working at all.
   *
   * `undefined` when the node cannot be read, which costs that item its
   * overwrite protection and nothing else — the caller then rewrites without
   * the guard, exactly as it would against a server that sent no ETag.
   */
  private async storedNodeVersion(targetId: string): Promise<string | undefined> {
    try {
      const response = await this.apiRequest<NodeGetResponse>('FileNode/get', {
        accountId: this.accountId,
        ids: [targetId],
        properties: [...NODE_PROPERTIES],
      });
      const node = response.list?.[0];
      if (!node) return undefined;
      // `id` is excluded: it is the server's handle, not part of what the node
      // says about its content, and including it would make the fingerprint
      // agree with itself for the wrong reason.
      const { id: _id, ...rest } = node;
      return createHash('sha256').update(canonicalJson(rest)).digest('hex');
    } catch (err) {
      log.warn(
        `[jmap-files] could not read ${targetId} back to fingerprint it ` +
          `(${err instanceof Error ? err.message : String(err)}); this file has no overwrite ` +
          `protection on the next pass`,
      );
      return undefined;
    }
  }

  /**
   * Is the node still there? (ADR-0030, amended.)
   *
   * `FileNode/get` for one id, and the ANSWER SHAPE is the whole point:
   * `notFound` is the server saying confidently that it does not have this,
   * which is what authorises a removal elsewhere. An empty `list` with the id
   * absent from `notFound` is neither, and is refused rather than read as
   * absence.
   *
   * Deliberately NOT sharing `storedNodeVersion`'s error handling: that one
   * swallows a failure and returns undefined, because losing overwrite
   * protection on one file is a smaller harm than failing a pass. Here a
   * swallowed failure would authorise destroying a copy, so it throws.
   */
  async hasItem(targetId: string): Promise<boolean> {
    await this.ensureConnected();
    const response = await this.apiRequest<NodeGetResponse>('FileNode/get', {
      accountId: this.accountId,
      ids: [targetId],
      properties: [...NODE_PROPERTIES],
    });
    if (response.list?.some((node) => node.id === targetId)) return true;
    if (response.notFound?.includes(targetId)) return false;
    throw new Error(
      `FileNode/get said neither that ${targetId} exists nor that it does not, so the target ` +
        'cannot confirm the copy is there. Nothing was removed.',
    );
  }

  // ---------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------

  /**
   * Destroy a node this writer wrote (implements `TargetRemover`).
   *
   * The only destructive operation here, reached solely through an explicit
   * owner decision in core's `applyDeletion` — see that function for the gates
   * in front of it.
   *
   * Reports `deleted` rather than `binned`. A Nextcloud WebDAV DELETE lands in
   * that account's trashbin and can be reported as recoverable; nothing has
   * established that a JMAP `FileNode/set destroy` does anything of the kind
   * on Stalwart, and understating recoverability is the safe direction to be
   * wrong in.
   */
  async removeItem(
    targetId: string,
    options?: { readonly expectedTargetVersion?: string },
  ): Promise<RemovalResult> {
    await this.ensureConnected();

    if (options?.expectedTargetVersion !== undefined) {
      // Same guard as the rewrite path, and it matters more here: this is the
      // one operation that cannot be undone.
      const current = await this.storedNodeVersion(targetId);
      if (current !== undefined && current !== options.expectedTargetVersion) {
        return { conflicted: true };
      }
    }

    const response = await this.apiRequest<NodeSetResponse>('FileNode/set', {
      accountId: this.accountId,
      destroy: [targetId],
    });
    const failure = response.notDestroyed?.[targetId];
    if (failure) {
      throw new Error(
        `FileNode/set could not destroy ${targetId}: ${failure.type}` +
          (failure.description ? ` - ${failure.description}` : ''),
      );
    }
    if (!response.destroyed?.includes(targetId)) {
      // Neither destroyed nor refused. Reporting success on that would let the
      // ledger tombstone a row for a file still sitting on the target.
      throw new Error(
        `FileNode/set reported neither destroyed nor notDestroyed for ${targetId}; refusing to ` +
          `record a removal the server did not confirm.`,
      );
    }
    this.invalidateTree();
    return { kind: 'deleted' };
  }
}

/**
 * File or directory, refusing to guess.
 *
 * `nodeType` is what the spike observed (`"file"` / `"directory"`). Inferring
 * it from the presence of a `blobId` would be a guess, and the two answers
 * lead to opposite destructive outcomes: a file mistaken for a directory is
 * never migrated, a directory mistaken for a file is written over.
 */
function nodeKind(node: FileNode): 'file' | 'directory' {
  if (node.nodeType === 'file') return 'file';
  if (node.nodeType === 'directory') return 'directory';
  throw new Error(
    `FileNode ${node.id} reports nodeType ${JSON.stringify(node.nodeType)}, which is neither ` +
      `'file' nor 'directory'. Guessing would either skip a file forever or write over a ` +
      `directory, so this refuses.`,
  );
}

/** Is `node` inside the subtree rooted at `ancestorId`? */
function isDescendantOf(
  node: FileNode,
  ancestorId: string,
  nodes: ReadonlyMap<string, FileNodeRef>,
): boolean {
  const seen = new Set<string>();
  let current = node.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    // The cycle guard is not paranoia: `reconstructFileNodePath` refuses on a
    // cycle, so a tree containing one never gets this far — but this function
    // walks the same chain and a hang is worse than a wrong answer.
    if (seen.has(current)) return false;
    seen.add(current);
    current = nodes.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * Normalise a root-relative path the way `webdav-target-writer.ts` does.
 *
 * The SAME transformation, not a similar one: both sides of a transport switch
 * have to agree on `Documents/report.pdf` with no leading slash and no
 * trailing slash. Note what it does NOT do — no percent-encoding, no case
 * folding, no Unicode normalisation — matching `toRelativePath` exactly, for
 * the reasons set out in `jmap-file-path.ts`.
 */
function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** The containing directory of a root-relative path (`''` at the root). */
function parentPathOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Last non-empty path segment — a node's own `name`. */
function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** `''` is the account root, which is `parentId: null` on the wire. */
function parentIdFor(nodeId: string): string | null {
  return nodeId === '' ? null : nodeId;
}

/** JSON with object keys sorted at every depth, so equal nodes hash equal. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
