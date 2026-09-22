// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Graph Drive Source Connector Implementation
 * 
 * Implements FileSource interface for Microsoft OneDrive/SharePoint file synchronization.
 * Uses Microsoft Graph API v1.0 with delta query for incremental synchronization.
 * 
 * Features:
 * - File/folder enumeration via {scope}/drive/root/children endpoint
 * - Delta query for incremental sync, scoped per folder ({scope}/drive/root:{path}:/delta)
 * - Each folder lists its OWN files, placed by parent id: a folder's delta is its
 *   whole subtree, and delta entries carry no `parentReference.path` (see `placementOf`)
 * - Path normalization as natural key (§10)
 * - cTag/quickXorHash as cheap change detection before byte hashing
 * - Download streams to file writer
 * - Handle renamed files (same GUID, different path) - log as drift, not duplicate
 * - Rate limiting and throttling support
 */

import { graphFailure } from './graph-refusal.ts';
import type { FileSource, FileFolder, RawFileItem, SyncCursor, ThrottleLimiter, FileItem } from '@openmig/shared';
import type { GraphDriveSourceConfig, GraphDriveItem, GraphDriveDeltaResponse, GraphDriveDeltaCursor, ParsedPath, NormalizePathOptions } from './graph-drive-source.types.ts';
import { graphScopePrefix } from './graph-scope.ts';
import type { HttpClient as _HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { fileVersion, log, STREAM_FILES_LARGER_THAN_BYTES } from '@openmig/shared';

/** The tick and the delegated scope this face needs — named in a refusal's way forward (0114 T6). */
const FILES_FACE = { face: 'Files', scope: 'Files.Read' } as const;

/**
 * Graph Drive source connector implementation.
 */
/** Deeper than any real drive nests — a guard against a looping walk. */
const MAX_FOLDER_DEPTH = 64;

/** One delta read, every page: the last occurrence of each item, and where to resume. */
interface DeltaRead {
  readonly items: ReadonlyArray<GraphDriveItem>;
  readonly deltaLink: string;
}

/** What one read of the whole drive holds, for this pass's listings. */
interface DriveSnapshot {
  /** Where the drive's change feed resumes after this read. */
  readonly deltaLink: string;
  /** Each folder's own files, by the folder's id. */
  readonly filesByParent: ReadonlyMap<string, ReadonlyArray<GraphDriveItem>>;
  /** Files in no folder the read could place. Counted by the root, once. */
  readonly unplaced: ReadonlyArray<GraphDriveItem>;
  /** Every file the read returned. */
  readonly files: number;
  /** Each folder's id, by the path `listFolders` gave it. */
  readonly folderIdByPath: ReadonlyMap<string, string>;
}

/** A stored cursor, read back: the drive's change feed, or one folder's own delta. */
interface ResumePoint {
  readonly scope: 'drive' | 'folder';
  readonly deltaLink: string;
}

const DRIVE_FEED_CURSOR = 'graph-drive-feed:';
const FOLDER_DELTA_CURSOR = 'graph-drive-delta:';

export class GraphDriveSource implements FileSource {
  private readonly config: GraphDriveSourceConfig;
  private readonly baseUrl: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  private readonly provider: string;
  /** `{baseUrl}/me` or `{baseUrl}/users/{address}` — see graph-scope.ts. */
  private readonly scope: string;
  /**
   * WHICH FOLDER EACH ID IS, as the last walk found it (2026-09-22).
   *
   * Microsoft's delta documentation says its entries *"won't include a value
   * for path"* in `parentReference`, and that *"when using delta you should
   * always track items by id"*. This connector built every file's key from
   * exactly that path and dropped a file without one with a log line —
   * uncounted, uncopied, on no screen. The walk in `listFolders` already sees
   * every folder's id beside the path it builds from names, so it keeps that
   * pairing here, and `listSince` places a file by its parent's id first. A
   * reported path is the fallback, not the source.
   *
   * Rebuilt by every walk, so a folder renamed since the last one does not
   * keep its old path.
   */
  private folderPathById = new Map<string, string>();
  /**
   * THE WHOLE DRIVE, READ ONCE FOR THIS PASS (2026-09-22).
   *
   * The owner's first Microsoft preflight was still counting Files an hour
   * in, which is the worker's limit for one attempt, and started over from
   * the top. `listFolders` walked the drive a request per folder, one after
   * another, and every folder's listing then asked Graph again. Microsoft's
   * delta on the drive's root *"starts enumerating the drive's hierarchy"*:
   * every folder and every file with the parent each lives in, a page of items
   * at a time. So `listFolders` reads it once, builds the folders from it, and
   * keeps each folder's files here for `listSince` to answer from.
   *
   * Undefined when that read named no root, and `listFolders` walked instead.
   */
  // Not `snapshot`: that name is the file port's own marker for an ARCHIVE
  // (`FileSource.snapshot`), which switches off absence-based detection. The
  // compiler refused the clash; this comment says why the name is not reused.
  private driveRead?: DriveSnapshot;
  /**
   * The drive's change feed, read once per link this pass. On a later pass
   * every folder's cursor holds the same link, so the first folder to ask
   * reads it and every other folder is answered from that one read.
   */
  private changeReads = new Map<string, Promise<DeltaRead>>();

  constructor(
    config: GraphDriveSourceConfig,
    throttleLimiter?: ThrottleLimiter,
  ) {
    this.config = config;
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
    this.throttleLimiter = throttleLimiter;
    this.provider = this.extractProviderFromBaseUrl(this.baseUrl);
    // Application-permission scope, workplan 0027 T0; `/me` by default.
    this.scope = graphScopePrefix(this.baseUrl, config.mailbox);
  }

  /**
   * Every folder in the drive, ROOT INCLUDED, from ONE read of the drive.
   *
   * Two things this had wrong until 2026-08-17, both of which lost files
   * silently rather than failing:
   *
   *  - It listed `/drive/root/children` and never recursed, so only top-level
   *    folders were ever returned. The sync loop migrates exactly what this
   *    answers, so nothing nested was ever enumerated as a collection.
   *  - It omitted the root itself. Every other file source emits `{ path: '' }`
   *    first (`WebdavFileSource`, Drive, Box, Dropbox), because files sitting
   *    directly in the account root live in that collection and nothing else
   *    lists them.
   *
   * And a third until 2026-09-22: it WALKED, a request per folder, one after
   * another, and each folder's listing then asked again (see `driveRead`). It
   * now reads the root's delta once and builds the tree from each folder's
   * parent id. The walk stays for a read that names no root, so this can never
   * do worse than it did.
   *
   * Folder paths keep this connector's leading-slash form (`/Documents`),
   * which a folder's own delta URL needs verbatim (`…/root:/Documents:/delta`).
   * The root is the one exception, spelled `''`.
   */
  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    this.changeReads = new Map();
    const read = await this.readDelta(`${this.scope}/drive/root/delta`, 'Failed to list drive items');
    const built = this.snapshotOf(read);
    this.driveRead = built?.snapshot;
    return built !== undefined ? built.folders : this.walkFolders();
  }

  /** The folder-by-folder walk, kept for a drive whose delta named no root. */
  private async walkFolders(): Promise<ReadonlyArray<FileFolder>> {
    const folders: FileFolder[] = [{ path: '' }];
    this.folderPathById = new Map();

    const walk = async (url: string, prefix: string, depth: number): Promise<void> => {
      // A drive cannot nest this deep; a walk that says otherwise is looping,
      // and an unbounded recursion against a customer tenant is the expensive
      // way to find that out.
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(
          `OneDrive folder walk passed ${MAX_FOLDER_DEPTH} levels at "${prefix}" — refusing to ` +
            'keep recursing.',
        );
      }
      let nextLink: string | undefined;
      do {
        const response = await this.makeRequest({
          url: nextLink ?? url,
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.status !== 200) {
          throw new Error(graphFailure('Failed to list drive items', response, FILES_FACE));
        }

        const data = JSON.parse(response.body) as {
          value: GraphDriveItem[];
          '@odata.nextLink'?: string;
        };

        // Only folders: files arrive through `listSince`, per collection.
        for (const item of data.value) {
          // Every child names its parent by id, and its parent is the folder
          // being walked. This is how the ROOT's id is learned: nothing lists
          // the root as an item of its own.
          const parentId = item.parentReference?.id;
          if (parentId !== undefined) this.folderPathById.set(parentId, prefix);
          if (!item.folder) continue;
          const path = `${prefix}/${item.name}`;
          this.folderPathById.set(item.id, path);
          folders.push({
            path,
            name: item.name,
            quota: item.folder.childCount
              ? {
                  used: 0, // Graph doesn't provide folder quota directly
                  available: undefined,
                }
              : undefined,
          });
          await walk(`${this.scope}/drive/items/${item.id}/children`, path, depth + 1);
        }

        nextLink = data['@odata.nextLink'];
      } while (nextLink);
    };

    await walk(`${this.scope}/drive/root/children`, '', 0);
    return folders;
  }

  /**
   * The folders, and each folder's files, from one read of the drive. Or
   * undefined when the read named no root to build them under.
   *
   * A folder whose parent chain does not reach the root is left out rather
   * than guessed at, and so is a file in one: the file is counted as
   * unplaceable, by the root.
   */
  private snapshotOf(read: DeltaRead): { snapshot: DriveSnapshot; folders: FileFolder[] } | undefined {
    const live = read.items.filter((item) => !item.deleted);
    const root = live.find((item) => item.root !== undefined);
    if (root === undefined) return undefined;

    const folderById = new Map<string, GraphDriveItem>();
    for (const item of live) {
      if (item.folder && item.id !== root.id) folderById.set(item.id, item);
    }
    const pathById = new Map<string, string>([[root.id, '']]);
    // Each chain is climbed once and remembered, so a deep tree costs its
    // size and not its size times its depth.
    const pathOf = (id: string, depth: number): string | undefined => {
      const known = pathById.get(id);
      if (known !== undefined) return known;
      // A drive cannot nest this deep; a tree that says otherwise loops.
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(
          `OneDrive folder tree passed ${MAX_FOLDER_DEPTH} levels at folder ${id} — refusing to ` +
            'keep climbing.',
        );
      }
      const folder = folderById.get(id);
      const parentId = folder?.parentReference?.id;
      if (folder === undefined || parentId === undefined) return undefined;
      const parent = pathOf(parentId, depth + 1);
      if (parent === undefined) return undefined;
      const path = `${parent}/${folder.name}`;
      pathById.set(id, path);
      return path;
    };
    const folders: FileFolder[] = [];
    for (const folder of folderById.values()) {
      const path = pathOf(folder.id, 0);
      if (path !== undefined) folders.push({ path, name: folder.name });
    }
    folders.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const filesByParent = new Map<string, GraphDriveItem[]>();
    const unplaced: GraphDriveItem[] = [];
    let files = 0;
    for (const item of live) {
      if (item.folder || item.root !== undefined) continue;
      files += 1;
      const parentId = item.parentReference?.id;
      if (item.name && parentId !== undefined && pathById.has(parentId)) {
        const siblings = filesByParent.get(parentId) ?? [];
        siblings.push(item);
        filesByParent.set(parentId, siblings);
      } else {
        unplaced.push(item);
      }
    }

    this.folderPathById = pathById;
    return {
      snapshot: {
        deltaLink: read.deltaLink,
        filesByParent,
        unplaced,
        files,
        folderIdByPath: new Map([...pathById].map(([id, path]) => [path, id])),
      },
      folders: [{ path: '' }, ...folders],
    };
  }

  /**
   * One delta read, every page. Microsoft: *"The same item may appear more
   * than once in a delta feed … You should use the last occurrence you see."*
   */
  private async readDelta(url: string, failure: string): Promise<DeltaRead> {
    const byId = new Map<string, GraphDriveItem>();
    let deltaLink = '';
    let next: string | undefined = url;
    while (next !== undefined) {
      const response = await this.makeRequest({
        url: next,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.status !== 200) {
        throw new Error(graphFailure(failure, response, FILES_FACE));
      }
      const data = JSON.parse(response.body) as GraphDriveDeltaResponse;
      for (const item of data.value) {
        if (item.id) byId.set(item.id, item);
      }
      deltaLink = data['@odata.deltaLink'] ?? deltaLink;
      next = data['@odata.nextLink'];
    }
    return { items: [...byId.values()], deltaLink };
  }

  /**
   * The top level only, ONE request, for a probe or a qualification
   * (workplan 0114 T10). `listFolders` above walks the whole drive — right
   * for a pass, which migrates exactly what it answers, and wrong for a Test
   * that has 20 seconds and a person waiting: the owner's whole-Dropbox Test
   * of 2026-09-02 could not finish a recursive listing inside the browser's
   * patience, and OneDrive is no smaller. So this asks Graph for the root's
   * children once, keeps the folders, and says when the page was cut short —
   * past the cap the count is a floor, and the probe words it as one.
   */
  async listTopLevelFolders(): Promise<{ folders: ReadonlyArray<FileFolder>; truncated: boolean }> {
    const response = await this.makeRequest({
      url: `${this.scope}/drive/root/children?$top=200`,
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.status !== 200) {
      throw new Error(graphFailure('Failed to list the top level of the drive', response, FILES_FACE));
    }
    const data = JSON.parse(response.body) as {
      value: GraphDriveItem[];
      '@odata.nextLink'?: string;
    };
    const folders: FileFolder[] = data.value
      .filter((item) => item.folder !== undefined)
      .map((item) => ({ path: `/${item.name}`, name: item.name }));
    return { folders, truncated: data['@odata.nextLink'] !== undefined };
  }

  /**
   * How much the drive holds, from the one place Graph states it: the
   * drive's own `quota.used`. One request, metadata only — the same cheap
   * sizing Drive's `about` gives, and the number OneDrive's own storage page
   * shows the person, so the Measured line agrees with what they can see.
   */
  async storageUsage(): Promise<{ bytes: number }> {
    const response = await this.makeRequest({
      url: `${this.scope}/drive`,
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.status !== 200) {
      throw new Error(graphFailure("Failed to read the drive's quota", response, FILES_FACE));
    }
    const data = JSON.parse(response.body) as { quota?: { used?: number } };
    const used = data.quota?.used;
    if (typeof used !== 'number') {
      throw new Error("the drive answered without a quota.used figure, so its size is unmeasured");
    }
    return { bytes: used };
  }

  /**
   * The item's path, derived from the fields Graph ACTUALLY returns.
   *
   * There is no `path` property on a driveItem. The type declared one, no
   * response ever carried it, and the natural key therefore fell through to
   * `/${item.name}` for every file in the drive — the whole tree flattened
   * onto the root, so `/Work/notes.txt` and `/Personal/notes.txt` became one
   * key and collided on the ledger's unique index. The unit fixtures invented
   * the field too, which is why the suite stayed green.
   *
   * Graph gives `parentReference.path`: `/drive/root:` at the root,
   * `/drive/root:/Documents` below it, `/drives/{id}/root:/…` when the drive
   * is addressed by id. Everything up to and including `root:` is addressing,
   * not path.
   *
   * `undefined` when it cannot be derived, and the caller SKIPS that item
   * loudly rather than falling back to a bare name: a wrong key is worse than
   * a missing one, because it silently merges two different files.
   *
   * NOT percent-decoded. Whether Graph encodes this field for names with
   * spaces or `%` is exactly the sort of thing only a real tenant settles, and
   * decoding a literal `%` corrupts it (the trap `webdav-trashbin.ts`
   * documents); workplan 0058 records it as the first live run's question.
   */
  private itemPath(item: GraphDriveItem): string | undefined {
    if (!item.name) return undefined;
    const dir = this.reportedDir(item);
    if (dir === undefined) return undefined;
    return this.normalizePath(`${dir}/${item.name}`);
  }

  /** The directory `parentReference.path` names, when Graph sent one: `''` at the root. */
  private reportedDir(item: GraphDriveItem): string | undefined {
    const parent = item.parentReference?.path;
    if (parent === undefined) return undefined;
    const marker = parent.indexOf('root:');
    if (marker === -1) return undefined;
    return parent.slice(marker + 'root:'.length);
  }

  /**
   * Which listing a delta entry belongs to, and on what directory its key is
   * built (2026-09-22).
   *
   * A folder's delta is its whole SUBTREE — Microsoft's words are that delta
   * *"starts enumerating the drive's hierarchy"* — and `listFolders` returns
   * every folder, so without this a file three folders deep was listed four
   * times: by the root and by each folder above it. The ledger's key kept the
   * copy single, but the preflight summed all four listings into the count the
   * owner approves, and the pass paid for every one of them.
   *
   * So a listing keeps its DIRECT children only, and knows them by the
   * parent's id where the walk knows that id — which it does for every folder
   * that existed when the pass began. Everything else in the read is some
   * other listing's: a deeper folder's file, or a file in a folder created
   * after the walk, which the next pass's walk lists.
   *
   * `unplaced` only when neither an id the walk knows nor a reported path
   * says where the file is — and then the key would be a guess, and a wrong
   * key silently merges two files.
   */
  private placementOf(
    item: GraphDriveItem,
    here: string,
    foldersInThisRead: ReadonlySet<string>,
  ): { readonly dir: string } | 'elsewhere' | 'unplaced' {
    if (!item.name) return 'unplaced';
    const parentId = item.parentReference?.id;
    if (parentId !== undefined) {
      const walked = this.folderPathById.get(parentId);
      if (walked !== undefined) return walked === here ? { dir: walked } : 'elsewhere';
      if (foldersInThisRead.has(parentId)) return 'elsewhere';
    }
    const reported = this.reportedDir(item);
    if (reported === undefined) return 'unplaced';
    return reported === here ? { dir: reported } : 'elsewhere';
  }

  /**
   * A folder's OWN files: all of them on a first read, what changed since the
   * cursor on a later one.
   *
   * Three ways to answer, tried in this order:
   *
   *  1. NO CURSOR, and this pass read the drive (`driveRead`): from that read,
   *     with no request at all.
   *  2. A cursor on the drive's CHANGE FEED, which is what 1 hands out: the
   *     feed is read once per link (`changeReads`), and every folder keeps its
   *     own from the same read.
   *  3. Anything else is this folder's own delta, as it always was: a cursor
   *     from before 2026-09-22, which scoped a delta to one folder, or a
   *     listing made without `listFolders`. When this pass did read the drive,
   *     its next cursor moves to the drive's feed, so an old cursor is used
   *     once and then retired.
   *
   * Whichever way, a folder keeps only its DIRECT children (`placementOf`):
   * a delta is a whole subtree, and `listFolders` returns every folder.
   */
  async listSince(
    folder: FileFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawFileItem>;
    nextCursor: SyncCursor;
    removed?: ReadonlyArray<string>;
    unreadable?: number;
    listedElsewhere?: number;
  }> {
    const isRoot = folder.path === '/' || folder.path === '';
    // The directory this listing answers for, in the form `placementOf` compares.
    const here = isRoot ? '' : folder.path;
    // An unreadable cursor reads as none: a full listing, as it always did.
    const resumed = cursor ? this.resumePointOf(cursor) : undefined;

    if (resumed === undefined && this.driveRead !== undefined) {
      return this.fromSnapshot(folder, here, isRoot, this.driveRead);
    }

    if (resumed?.scope === 'drive') {
      let read = this.changeReads.get(resumed.deltaLink);
      if (read === undefined) {
        read = this.readDelta(resumed.deltaLink, 'Failed to list drive changes');
        this.changeReads.set(resumed.deltaLink, read);
      }
      const changes = await read;
      // Every folder is answered from this same read, so only the root reports
      // what it says was deleted: each removal once, not once per folder.
      return this.fromChanges(here, isRoot, changes, isRoot, this.feedCursor(folder, changes.deltaLink));
    }

    // Scope the delta to THE FOLDER BEING POLLED. The files sync calls this
    // once per folder; both branches used to request the whole drive's root
    // delta, so every folder's poll processed every item on the drive (the
    // ledger's natural key made it converge, but at N-folders × whole-drive
    // cost per pass — 0026 T1 item 1). Graph addresses a folder's delta by
    // path — `{scope}/drive/root:/{path}:/delta` — which scopes the response
    // server-side to that folder's DESCENDANTS: its whole subtree, not its own
    // files. `placementOf` keeps this folder's own; see there.
    const baseUrl = isRoot
      ? `${this.scope}/drive/root/delta`
      : `${this.scope}/drive/root:${folder.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}:/delta`;
    const changes = await this.readDelta(resumed?.deltaLink || baseUrl, 'Failed to list drive changes');
    const nextCursor =
      this.driveRead !== undefined
        ? this.feedCursor(folder, this.driveRead.deltaLink)
        : { value: this.encodeCursor({ deltaLink: changes.deltaLink, folderPath: folder.path }) };
    return this.fromChanges(here, isRoot, changes, true, nextCursor);
  }

  /** A folder's own files, from this pass's read of the whole drive. */
  private fromSnapshot(
    folder: FileFolder,
    here: string,
    isRoot: boolean,
    snapshot: DriveSnapshot,
  ): {
    items: ReadonlyArray<RawFileItem>;
    nextCursor: SyncCursor;
    unreadable?: number;
    listedElsewhere?: number;
  } {
    const id = snapshot.folderIdByPath.get(here);
    const own = id === undefined ? [] : (snapshot.filesByParent.get(id) ?? []);
    const built = this.toRawFileItems(own.map((item) => ({ item, dir: here })));
    // COUNTED ONCE, by the root, like an unplaceable file in a delta below.
    const unplaced = isRoot ? snapshot.unplaced : [];
    for (const item of unplaced) this.warnUnplaced(item);
    const unreadable = built.unreadable + unplaced.length;
    // The read returned these too, for other folders. Said so the sync loop
    // does not take a folder holding only subfolders for one that answered
    // nothing, and withhold its cursor.
    const listedElsewhere = snapshot.files - own.length - unplaced.length;
    return {
      items: built.items,
      nextCursor: this.feedCursor(folder, snapshot.deltaLink),
      ...(unreadable > 0 ? { unreadable } : {}),
      ...(listedElsewhere > 0 ? { listedElsewhere } : {}),
    };
  }

  /** A folder's own files among what one delta read returned. */
  private fromChanges(
    here: string,
    isRoot: boolean,
    changes: DeltaRead,
    reportRemovals: boolean,
    nextCursor: SyncCursor,
  ): {
    items: ReadonlyArray<RawFileItem>;
    nextCursor: SyncCursor;
    removed?: ReadonlyArray<string>;
    unreadable?: number;
    listedElsewhere?: number;
  } {
    /**
     * Item IDs Graph reported as DELETED on this poll.
     *
     * The delta query's own removal report, and the OneDrive equivalent of a
     * CalDAV `sync-collection` 404: the service states outright that an item is
     * gone, rather than us inferring it from an absence with a dozen innocent
     * causes. It was being read and thrown away below — `if (item.deleted)
     * continue`, under a comment saying deletions "should be handled separately"
     * with nothing anywhere handling them.
     *
     * IDs, not paths. A deleted delta entry is not guaranteed to carry usable
     * path metadata — `name` and `parentReference` may be partial — but `id` is
     * always present and never changes, which is why it is what the ledger row
     * records as the item's source ref.
     */
    const removed: string[] = [];
    // Folders this read returned, so a file in one the walk has not seen yet is
    // known to belong to a folder rather than to nowhere.
    const foldersInThisRead = new Set<string>();
    const files: GraphDriveItem[] = [];
    for (const item of changes.items) {
      // DELETED, and now carried up instead of discarded. Folders included: a
      // deleted folder's children each get their own delta entry, but a folder
      // whose id we recorded is an item too, and dropping it here would make
      // that one silently unreportable.
      if (item.deleted) {
        removed.push(item.id);
        continue;
      }
      if (item.folder || item.root !== undefined) {
        foldersInThisRead.add(item.id);
        continue;
      }
      files.push(item);
    }

    // Files this read returned that another folder's listing yields — see
    // `placementOf`. Reported so the sync loop can tell a folder holding only
    // subfolders from one that answered nothing.
    let listedElsewhere = 0;
    let unplaced = 0;
    const mine: Array<{ item: GraphDriveItem; dir: string }> = [];
    for (const item of files) {
      const placement = this.placementOf(item, here, foldersInThisRead);
      if (placement === 'elsewhere') {
        listedElsewhere += 1;
        continue;
      }
      if (placement === 'unplaced') {
        // Never fall back to the bare name. That fallback is what flattened
        // every file onto the root; a wrong key silently merges two files.
        //
        // COUNTED ONCE, by the root. The root's read is the one every file
        // in the drive appears in, so counting here as well would count one
        // file once per folder above it — the fault `placementOf` exists to
        // remove.
        if (isRoot) {
          unplaced += 1;
          this.warnUnplaced(item);
        } else {
          listedElsewhere += 1;
        }
        continue;
      }
      mine.push({ item, dir: placement.dir });
    }
    const built = this.toRawFileItems(mine);
    const unreadable = built.unreadable + unplaced;

    // Omitted rather than sent as `[]` when Graph reported nothing, so "the
    // service reported no deletions" and "this poll cannot report deletions" are
    // not spelled the same way. A full `children` listing is the second case.
    return {
      items: built.items,
      nextCursor,
      ...(reportRemovals && removed.length > 0 ? { removed } : {}),
      // Omitted rather than sent as 0, so "none failed" and "this listing
      // cannot report" read differently downstream.
      ...(unreadable > 0 ? { unreadable } : {}),
      ...(listedElsewhere > 0 ? { listedElsewhere } : {}),
    };
  }

  /** Metadata only: content comes from `fetch`, never from a listing. */
  private toRawFileItems(placed: ReadonlyArray<{ item: GraphDriveItem; dir: string }>): {
    items: RawFileItem[];
    unreadable: number;
  } {
    const items: RawFileItem[] = [];
    let unreadable = 0;
    for (const { item, dir } of placed) {
      try {
        // The natural key: the folder it lives in, and its own name.
        const naturalKey = this.normalizePath(`${dir}/${item.name}`);

        // Get change detection hash (quickXorHash or cTag)
        const changeHash = item.quickXorHash || item.cTag;

        items.push({
          item: {
            path: naturalKey,
            isDirectory: false,
            size: item.size || 0,
            // `quickXorHash` when Graph publishes one, and otherwise the
            // item's `cTag` — which is a CHANGE TOKEN, not a hash of anything.
            // Either way NOT for change detection, whatever this comment said
            // until 2026-09-09: `classifyKnownItem` decides on `sourceVersion`
            // and never on a hash, and neither value is comparable with the
            // SHA-256 the ledger stores. See `FileItem.contentHash`.
            contentHash: changeHash,
            // The version an edit is detected by — see `FileItem.etag`. Absent
            // until 2026-09-22, so a OneDrive file edited after its first copy
            // was never copied again. The content hash first: `cTag` is the
            // content-only tag, but a OneDrive for Business delta omits it on
            // create and modify (Microsoft's delta documentation).
            ...fileVersion(item.file?.hashes?.quickXorHash ?? item.cTag, item.lastModifiedDateTime),
            modifiedAt: item.lastModifiedDateTime,
            mimeType: item.file?.mimeType,
            sourceRef: item.id,
          },
          // Content is NOT fetched here - use fetch() method instead
          content: undefined,
        });
      } catch (error) {
        // COUNTED, NOT JUST LOGGED (2026-09-07). A `log.warn` and a `continue`
        // put this file nowhere the owner looks: absent from the pass, from
        // the total they approve, and from both sides of the verification
        // gate, which then agree and report PASS. `unreadable` is how the
        // skip earns its silence — see `ports.ts`.
        unreadable += 1;
        log.warn(`Failed to process file ${item.id}:`, error);
      }
    }
    return { items, unreadable };
  }

  private warnUnplaced(item: GraphDriveItem): void {
    log.warn(
      `[graph-drive] cannot place "${item.name}" (id ${item.id}): its parent is no ` +
        'folder this pass read and Graph reported no parentReference.path, so ' +
        'where it lives cannot be named and a natural key would be a guess.',
    );
  }

  /** A cursor on the drive's change feed, held by every folder alike. */
  private feedCursor(folder: FileFolder, deltaLink: string): SyncCursor {
    return { value: `${DRIVE_FEED_CURSOR}${folder.path}:${deltaLink}` };
  }

  /**
   * A stored cursor, read back, or undefined when it cannot be — which lists
   * the folder in full, as an unreadable cursor always has.
   */
  private resumePointOf(cursor: SyncCursor): ResumePoint | undefined {
    if (cursor.value.startsWith(DRIVE_FEED_CURSOR)) {
      const parts = cursor.value.slice(DRIVE_FEED_CURSOR.length).split(':');
      const deltaLink = parts.slice(1).join(':');
      return parts.length < 2 || deltaLink === '' ? undefined : { scope: 'drive', deltaLink };
    }
    try {
      const { deltaLink } = this.decodeCursor(cursor);
      return deltaLink === '' ? undefined : { scope: 'folder', deltaLink };
    } catch {
      return undefined;
    }
  }

  /** The one GET that reads an item's bytes. Used buffered and streamed alike. */
  private contentUrl(itemId: string): string {
    return `${this.scope}/drive/items/${itemId}/content`;
  }

  /**
   * Ask for an item's bytes, and hand back the response unread.
   *
   * Unread on purpose: the caller decides whether to buffer it or stream it,
   * and a body read here would settle that question for both.
   */
  private async openContent(itemId: string): Promise<Response> {
    return this.sendRaw({
      url: this.contentUrl(itemId),
      method: 'GET',
      headers: { 'Accept': 'application/octet-stream' },
    });
  }

  /**
   * Fetch file content as Uint8Array.
   *
   * THIS USED TO DESTROY EVERY FILE THAT WAS NOT PLAIN TEXT.
   *
   * It read `makeRequest(...).body` — which is `await response.text()` — and
   * then re-encoded it: `new TextEncoder().encode(response.body)`. A UTF-8
   * decode followed by a UTF-8 re-encode is lossless only for input that IS
   * valid UTF-8. Every other byte sequence became U+FFFD on the way in, and
   * re-encoding cannot recover it: the bytes are gone at the decode, not at
   * the encode.
   *
   * The same defect was found and fixed on the DAV path (see
   * `webdav-source.ts`, where it was measured on a 476 KB JPEG that came back
   * as 863 KB of replacement characters). It survived here because nothing
   * downstream can notice: the ledger's `content_hash` is computed from
   * whatever these bytes are, so the copy agrees with its own record and count
   * parity is perfect. Every JPEG, PDF, MP4 and Office document copied out of
   * OneDrive was corrupt, and the only thing able to see it is a reader
   * opening the file at the far end.
   *
   * `arrayBuffer()` is the whole fix. There is no encoding step because there
   * is no text: bytes come out as they went in.
   */
  private async fetchFileContent(itemId: string): Promise<Uint8Array> {
    const response = await this.openContent(itemId);

    if (response.status !== 200) {
      throw new Error(
        graphFailure(
          'Failed to download file',
          { status: response.status, body: await response.text() },
          FILES_FACE,
        ),
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Fetch full raw data for an item (implements FileSource interface).
   */
  async fetch(item: FileItem): Promise<RawFileItem> {
    // Extract item ID from sourceRef
    const itemId = item.sourceRef;
    if (!itemId) {
      throw new Error(`Item missing sourceRef: ${JSON.stringify(item)}`);
    }

    /**
     * A LARGE FILE ARRIVES AS A BODY, NOT AS BYTES (workplan 0120 T5).
     *
     * Below the threshold nothing changes: most files are small and a buffer
     * is simpler than the machinery. Above it, holding the file was the whole
     * ceiling — a file larger than the runner's RAM killed the process
     * mid-pass, with no failure row and no sentence, which from a customer's
     * side is a migration that stops on one file and never says which.
     *
     * The threshold is the LISTING's size (`item.size`, Graph's own `size`
     * field), because it is the only figure available before the download
     * starts. A source that under-reports costs one buffered read of something
     * bigger than advertised — which is what every file did before this.
     *
     * `open()` re-issues the GET, because a body must be re-openable: a retry
     * after a half-written upload starts from the beginning, and a stream that
     * has been consumed cannot. A second GET is what "start again" means here.
     */
    if (item.size > STREAM_FILES_LARGER_THAN_BYTES) {
      return {
        item,
        body: {
          sizeBytes: item.size,
          open: async () => {
            const response = await this.openContent(itemId);
            if (response.status !== 200) {
              throw new Error(
                graphFailure(
                  `Failed to open ${item.path} for reading`,
                  { status: response.status, body: await response.text() },
                  FILES_FACE,
                ),
              );
            }
            if (!response.body) {
              // A 200 with no body, on a file the listing gave a size to.
              // Returning an empty stream here would write an empty file and
              // record it as a copy — the worst outcome available to this
              // code, which is why it is a throw and not a `?? empty`.
              throw new Error(
                `${item.path}: Graph answered ${response.status} with no body to read`,
              );
            }
            return response.body;
          },
        },
      };
    }

    // Fetch content
    const content = await this.fetchFileContent(itemId);

    return {
      item,
      content,
    };
  }

  // Private helper methods

  /**
   * Make an authenticated HTTP request to Graph API.
   */
  private async makeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    const response = await this.sendRaw(options);

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { status: response.status, body, headers };
  }

  /**
   * One request, one retry policy, and the body left unread.
   *
   * Every Graph call in this file goes through here. It returns the `Response`
   * rather than a decoded one because THE CALLER OWNS THE DECODE: JSON wants
   * `text()`, a file wants `arrayBuffer()`, and a large file wants the stream
   * and nothing else. Reading the body here is what made `fetchFileContent`
   * text-decode a JPEG — the decision had already been taken for it, one
   * layer down, for every response alike.
   *
   * This was two copies of the same closure (`executeRequest` and
   * `doRequest`), identical but for which one ran inside the throttle
   * limiter — so the retry-after handling had to be got right twice, and a
   * change to one was a silent divergence from the other.
   */
  private async sendRaw(options: HttpRequestOptions): Promise<Response> {
    const token = await this.config.tokenProvider.getToken();

    const attempt = async (): Promise<Response> => {
      const response = await fetch(options.url, {
        method: options.method,
        headers: {
          'Authorization': `Bearer ${token.accessToken}`,
          ...options.headers,
        },
        body: typeof options.body === 'string' ? options.body : undefined,
      });

      // Handle 429/503 responses with Retry-After
      if ((response.status === 429 || response.status === 503) && this.throttleLimiter) {
        // Discard the throttle response's own body before asking again. An
        // unread body holds its connection open, and a retry loop that leaks
        // one per attempt exhausts the pool exactly when the provider has
        // asked us to slow down.
        await response.body?.cancel().catch(() => {});
        const retryAfter = response.headers.get('retry-after');
        const waitTime = this.throttleLimiter.handleRateLimited(response.status, retryAfter || undefined);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return attempt(); // Retry
      }

      return response;
    };

    // If throttling is enabled, use the throttle limiter
    if (this.throttleLimiter) {
      return this.throttleLimiter.executeWithThrottling(
        this.config.tenantId,
        this.provider,
        attempt,
        // `Headers` is not an object with keys — the limiter's default reader
        // would index it and find nothing, so a 429 that reached the outer
        // loop would back off on the default instead of on what Graph asked
        // for.
        (response) => response.headers.get('retry-after') ?? undefined,
      );
    }

    return attempt();
  }

  /**
   * Extract provider from base URL.
   */
  private extractProviderFromBaseUrl(baseUrl: string): string {
    try {
      const url = new URL(baseUrl);
      return url.hostname;
    } catch {
      return 'graph';
    }
  }

  /**
   * Normalize path according to §10 natural key requirements.
   * Handles:
   * - Multiple consecutive slashes
   * - Relative path segments (. and ..)
   * - Trailing slashes
   * - Case normalization (for case-insensitive filesystems)
   */
  normalizePath(path: string, options?: NormalizePathOptions): string {
    const opts = {
      collapseSlashes: true,
      resolveDots: true,
      removeTrailingSlash: true,
      ...options,
    };

    if (!path) {
      return '/';
    }

    // Ensure path starts with /
    let result = path.startsWith('/') ? path : `/${path}`;

    // Collapse multiple slashes
    if (opts.collapseSlashes) {
      result = result.replace(/\/+/g, '/');
    }

    // Resolve . and .. segments
    if (opts.resolveDots) {
      const segments = result.split('/');
      const resolved: string[] = [];
      
      for (const segment of segments) {
        if (segment === '.' || segment === '') {
          // Skip current directory references and empty segments
          continue;
        } else if (segment === '..') {
          // Go up one directory
          if (resolved.length > 0) {
            resolved.pop();
          }
        } else {
          resolved.push(segment);
        }
      }
      
      result = '/' + resolved.join('/');
    }

    // Remove trailing slash (except for root)
    if (opts.removeTrailingSlash && result.length > 1 && result.endsWith('/')) {
      result = result.slice(0, -1);
    }

    // Ensure root is /
    if (result === '') {
      result = '/';
    }

    return result;
  }

  /**
   * Parse path into components.
   */
  parsePath(path: string): ParsedPath {
    const normalized = this.normalizePath(path);
    
    // Find the last slash to split directory and base
    const lastSlashIndex = normalized.lastIndexOf('/');
    const dir = lastSlashIndex > 0 ? normalized.slice(0, lastSlashIndex) : '';
    const base = lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
    
    // Find the last dot to split name and extension
    const lastDotIndex = base.lastIndexOf('.');
    let name: string;
    let ext: string;
    
    if (lastDotIndex > 0) {
      name = base.slice(0, lastDotIndex);
      ext = base.slice(lastDotIndex + 1);
    } else {
      name = base;
      ext = '';
    }

    return {
      root: normalized.startsWith('/') ? '/' : '',
      dir,
      base,
      ext,
      name,
    };
  }

  /**
   * Encode cursor for storage.
   */
  private encodeCursor(cursor: GraphDriveDeltaCursor): string {
    return `${FOLDER_DELTA_CURSOR}${cursor.folderPath}:${cursor.deltaLink}`;
  }

  /**
   * Decode cursor from storage.
   */
  private decodeCursor(cursor: SyncCursor): GraphDriveDeltaCursor {
    const value = cursor.value;

    if (!value.startsWith(FOLDER_DELTA_CURSOR)) {
      throw new Error(`Invalid cursor format: ${value}`);
    }

    const parts = value.slice(FOLDER_DELTA_CURSOR.length).split(':');
    if (parts.length < 2) {
      throw new Error(`Invalid cursor format: ${value}`);
    }

    const folderPath = parts[0] ?? '';
    const deltaLink = parts.slice(1).join(':');

    return {
      deltaLink,
      folderPath,
    };
  }

  /**
   * Same item (same GUID), different place — a rename or a move.
   *
   * The third site that read the phantom `item.path`: with no such field it
   * compared `undefined` against `undefined`, so this answered FALSE for every
   * rename it was asked about. It goes through `itemPath` now, like the
   * natural key does. Two items whose paths cannot be derived are not called a
   * rename — that would be a guess about customer data from no evidence.
   */
  isRename(oldItem: GraphDriveItem, newItem: GraphDriveItem): boolean {
    if (oldItem.id !== newItem.id) return false;
    const before = this.itemPath(oldItem);
    const after = this.itemPath(newItem);
    if (before === undefined || after === undefined) return false;
    return before !== after;
  }

  /**
   * Get the change hash for an item.
   * Uses quickXorHash if available, otherwise cTag, otherwise etag.
   */
  getChangeHash(item: GraphDriveItem): string | undefined {
    return item.quickXorHash || item.cTag || (item as unknown as Record<string, string>)['@odata.etag'];
  }
}
