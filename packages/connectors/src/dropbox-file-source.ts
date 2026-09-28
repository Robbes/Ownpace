// Copyright 2026 The Ownpace authors (Apache-2.0)

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
  FailureCategory,
  FileFolder,
  FileItem,
  FileSource,
  RawFileItem,
  SyncCursor,
  TokenProvider,
  TrashListing,
} from '@openmig/shared';
import { DROPBOX_PAPER_POLICIES, fileVersion, markNeedsDecision, withFailureCategory } from '@openmig/shared';
import type {
  DropboxEntry,
  DropboxExportOnly,
  DropboxFileItem,
  DropboxFileSourceConfig,
  DropboxListFolderResponse,
  DropboxPaperFormat,
  DropboxPaperPolicy,
  DropboxTransport,
} from './dropbox-file-source.types.ts';
// The seam's threshold, not DAV's — every connector that moves to `FileBody`
// decides at the same size, or a file of a given size behaves differently
// depending on where it came from. It is defined in `webdav-source.ts` because
// DAV was the first connector to move; #874 lifts it into `@openmig/shared`
// beside `MAX_BUFFERED_FILE_BYTES` and re-exports it from here, so this import
// keeps resolving either way and can be retargeted when that lands.
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';

/** What the transport hands back — named so `download()` can promise it. */
type DropboxResponse = Awaited<ReturnType<DropboxTransport>>;

const DEFAULT_API_BASE = 'https://api.dropboxapi.com/2';
const DEFAULT_CONTENT_BASE = 'https://content.dropboxapi.com/2';

/**
 * THE KINDS DROPBOX CALLS PAPER (workplan 0150 T2), by the extension it lists
 * them under, and the words a person reads for each.
 */
const PAPER_KINDS: ReadonlyMap<string, string> = new Map([
  ['paper', 'Paper doc'],
  ['papert', 'Paper template'],
]);

/**
 * The suffix a Paper doc arrives under in each format (workplan 0150 D4): it
 * is APPENDED, so `Notes.paper` arrives as `Notes.paper.md`, as Drive's
 * `Budget.xls` arrives as `Budget.xls.xlsx`. Replacing it would put a Paper
 * doc and a real `Notes.md` on one key, which the ledger cannot hold.
 */
const PAPER_SUFFIX: Readonly<Record<DropboxPaperFormat, string>> = {
  markdown: '.md',
  html: '.html',
};

/** Every policy a Paper doc's name can come from, `refuse` first (0150 T3 (b)). */
const EVERY_PAPER_POLICY: ReadonlyArray<DropboxPaperPolicy> = DROPBOX_PAPER_POLICIES;

/**
 * A FILE DROPBOX HANDS OVER ONLY AS AN EXPORT, REFUSED BY NAME (workplan 0150
 * T5 and T6 (a); the owner's decisions D1, D5, D6 and D9, 2026-09-26).
 *
 * Until this, a Paper doc went to `files/download` like any file, and Dropbox
 * answered 409 `unsupported_file`. That came back as a bare `Error`, with no
 * stated category, so the row read `source_refused` (*"the old account would
 * not hand this over"*), and with no decision mark, so it was tried on five
 * passes and then waited on a person without being parked (0150 T1, read on
 * the owner's migration).
 *
 * Now the listing says so first (`is_downloadable: false`), and this is thrown
 * before any download, split the way Drive's `NativeFileRefused` is, by
 * whether a setting would change the answer:
 *
 *  - `policy_refused` for a kind Dropbox exports. Dropbox would hand the file
 *    over as an export, and this migration asked for none: no format is chosen
 *    for its kind (D1), or the one chosen is not among the formats Dropbox
 *    offers for this file. So the destination was never asked. A Paper doc is
 *    always this (D9). Its remedy on the Failures page is Dropbox's own
 *    sentence, chosen by the migration's source. A Paper doc under a chosen
 *    format Dropbox offers is not refused: it is exported (0150 T3, T4).
 *  - `source_refused` for a kind Dropbox offers no export for (D5): no setting
 *    will ever make a file of it.
 *
 * Both are decisions, so the file is parked on its first attempt and never
 * counts toward a pass's 25 failures in a row (T6 (a)).
 */
export class DropboxNativeRefused extends Error {
  constructor(name: string, kind: string, exportable: boolean, notOffered?: DropboxPaperFormat) {
    const paper = PAPER_KINDS.get(kind);
    let category: FailureCategory;
    let message: string;
    if (paper && notOffered) {
      category = 'policy_refused';
      message =
        `"${name}" is a Dropbox ${paper}, and Dropbox does not offer it as ${notOffered}, the ` +
        'format this migration exports Paper docs in, so nothing was copied. Choose another ' +
        'format for Paper docs, or leave it behind.';
    } else if (paper) {
      category = 'policy_refused';
      message =
        `"${name}" is a Dropbox ${paper}. Dropbox hands one over only as an export, and this ` +
        'service does not export Paper docs yet, so nothing was copied. Export it from Dropbox ' +
        'yourself, or leave it behind.';
    } else if (exportable) {
      category = 'policy_refused';
      message =
        `"${name}" is a document Dropbox keeps in a format of its own` +
        (kind ? ` (.${kind})` : '') +
        '. Dropbox hands one over only as an export, and this service does not export these ' +
        'yet, so nothing was copied. Export it from Dropbox yourself, or leave it behind.';
    } else {
      category = 'source_refused';
      message =
        `"${name}" cannot be downloaded from Dropbox, and Dropbox offers no export for it, so ` +
        'there is no file to copy. Accept leaving it behind.';
    }
    super(message);
    this.name = 'DropboxNativeRefused';
    markNeedsDecision(this);
    withFailureCategory(category, this);
  }
}

/** The name's extension, lower-cased and without the dot; '' when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * What a listing says about a file Dropbox hands over only as an export, and
 * what this migration does with it: the format it is exported in, or none.
 */
function exportOnlyOf(entry: DropboxEntry, policy: DropboxPaperPolicy): DropboxExportOnly {
  const info = entry.export_info;
  const formats = [
    ...new Set(
      [info?.export_as, ...(info?.export_options ?? [])].filter(
        (format): format is string => typeof format === 'string' && format !== '',
      ),
    ),
  ];
  const kind = extensionOf(entry.name);
  const chosen = PAPER_KINDS.has(kind) && policy !== 'refuse' ? policy : undefined;
  if (chosen === undefined) return { kind, formats };
  // Checked against the file's own offer, as rclone does: a format the kind
  // offers in general may still be missing for one file.
  return formats.includes(chosen) ? { kind, formats, exportAs: chosen } : { kind, formats, notOffered: chosen };
}

/**
 * The name a file arrives under when `policy` is in force (0150 T3 (b)): its
 * own, or with the format's suffix appended when that policy exports it. The
 * name is part of the natural key, so the listing, `formerPaths` and the
 * tombstones all ask this one function.
 */
function nameUnder(entry: DropboxEntry, policy: DropboxPaperPolicy): string {
  if (entry.is_downloadable !== false) return entry.name;
  const exportAs = exportOnlyOf(entry, policy).exportAs;
  if (exportAs === undefined) return entry.name;
  const suffix = PAPER_SUFFIX[exportAs];
  return entry.name.toLowerCase().endsWith(suffix) ? entry.name : `${entry.name}${suffix}`;
}

/** The `.tag` of a Dropbox error body, when it is JSON that has one. */
function dropboxErrorTag(body: string): string | undefined {
  try {
    const tag = (JSON.parse(body) as { error?: { '.tag'?: unknown } }).error?.['.tag'];
    return typeof tag === 'string' ? tag : undefined;
  } catch {
    return undefined;
  }
}

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
  /** The format Paper docs arrive in, or `refuse` (0150 T3, D1). */
  private readonly paperPolicy: DropboxPaperPolicy;

  private readonly transport: DropboxTransport;
  constructor(
    transport: DropboxTransport,
    config: DropboxFileSourceConfig = {},
  ) {
    this.transport = transport;
    this.apiBase = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '');
    this.contentBase = (config.contentBaseUrl ?? DEFAULT_CONTENT_BASE).replace(/\/$/, '');
    // Dropbox's API spells the root '' and everything else '/x/y' — normalise
    // once here so a config saying 'Team' or '/Team/' means the same folder.
    //
    // The account's own folder — the one the web UI and the desktop client
    // both call "Dropbox" — IS that root. It is not a folder inside it, so
    // typing 'Dropbox' (or '/Dropbox') as the root asks the API for a
    // subfolder that does not exist, and every listing 409s with
    // path/not_found while a connection test rooted at '' sails past it.
    // The alias therefore means the whole account, exactly like ''.
    const raw = (config.rootPath ?? '').trim().replace(/\/+$/, '');
    const rootIsTheAccountItself = raw === '' || raw === '/' || /^\/?dropbox$/i.test(raw);
    this.rootPath = rootIsTheAccountItself ? '' : raw.startsWith('/') ? raw : `/${raw}`;
    // Refusing is the default (D1): of the two ways to be wrong, only "your
    // Paper docs did not migrate, and here is why" is one an owner can act on.
    // A value this source does not know stops it here, naming the ones it
    // does, rather than being read as one of them.
    const paper = config.nativeFilePolicies?.paper ?? 'refuse';
    if (!EVERY_PAPER_POLICY.includes(paper)) {
      throw new Error(
        `Unknown format for Paper docs: ${JSON.stringify(paper)}. Use one of ${EVERY_PAPER_POLICY.join(', ')}.`,
      );
    }
    this.paperPolicy = paper;
  }

  private async rpc(path: string, arg: unknown, context?: string): Promise<unknown> {
    const response = await this.transport(`${this.apiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arg),
    });
    if (!response.ok) {
      // Dropbox's own words, verbatim and truncated — its error bodies name
      // the exact `.tag` path that failed, which is the actionable part.
      const text = await response.text().catch(() => '(no body)');
      // A 409 naming `path` is Dropbox for "that folder is not there". When
      // it is the ROOT that is missing, say so in the operator's terms — the
      // stored rootPath is the only addressable thing they can fix, and the
      // bare `.tag` body does not mention it (the bug report of 2026-09-25:
      // a mapping rooted at '/Dropbox' 409s on every pass while the Test
      // button, rooted at '', passes — the sentence here is what tells the
      // two apart).
      const rootMissing =
        context !== undefined &&
        response.status === 409 &&
        /"path"|"not_found"/.test(text);
      throw new Error(
        `Dropbox answered ${response.status} on ${path}: ${text.slice(0, 300)}` +
          (rootMissing
            ? ` — the root folder configured for this connection ("${context}") does not exist ` +
              'in this Dropbox. Leave the root path empty for the whole account; the folder ' +
              'named "Dropbox" in the web view IS the account root and needs no path.'
            : ''),
      );
    }
    return response.json();
  }

  /** The whole tree under one listing: `list_folder` recursive + continue. */
  private async listAll(
    path: string,
    recursive: boolean,
    includeDeleted = false,
  ): Promise<DropboxEntry[]> {
    // The hint applies only when the listing targets a NON-EMPTY configured
    // ROOT — an empty root is the API's own spelling and cannot mis-root; a
    // 409 on a subfolder is a genuinely deleted folder, not a mis-rooting.
    const context = path === this.rootPath && this.rootPath !== '' ? this.rootPath : undefined;
    const entries: DropboxEntry[] = [];
    let page = (await this.rpc(
      'files/list_folder',
      {
        path,
        recursive,
        limit: 1000,
        ...(includeDeleted ? { include_deleted: true } : {}),
      },
      context,
    )) as DropboxListFolderResponse;
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

  /**
   * THE CHEAP QUESTION, for a probe (2026-09-02, the owner's whole-Dropbox
   * test). `listFolders` above is one recursive listing of the WHOLE tree —
   * every file and folder under the root, 1000 entries a page — which is what
   * a pass needs and what a Test cannot afford: the owner's Dropbox took
   * longer than the browser's 30 s, the API kept walking, and the connection
   * appeared minutes later. This asks the top level only, non-recursive, and
   * stops after `maxPages` pages; past the cap the count is a floor and
   * `truncated` says so, rather than a walk that outlives the person asking.
   */
  /**
   * HOW MUCH THE DROPBOX HOLDS (2026-09-02, beside the owner's "GB in
   * Drive"): one `users/get_space_usage` — the bytes in use, and the
   * allocation where Dropbox states one. A team allocation reports the
   * team's total; `bytes` is this account's own use either way. For the
   * Measured line, never for a pass.
   */
  async spaceUsage(): Promise<{ bytes: number; allocated?: number }> {
    const usage = (await this.rpc('users/get_space_usage', null)) as {
      used?: number;
      allocation?: { '.tag'?: string; allocated?: number };
    };
    if (typeof usage.used !== 'number') {
      throw new Error("Dropbox's space usage answered without a `used` figure.");
    }
    const allocated = usage.allocation?.allocated;
    return { bytes: usage.used, ...(typeof allocated === 'number' ? { allocated } : {}) };
  }

  async listTopLevelFolders(
    maxPages = 5,
  ): Promise<{ folders: ReadonlyArray<FileFolder>; truncated: boolean }> {
    const folders: FileFolder[] = [{ path: '' }];
    let page = (await this.rpc(
      'files/list_folder',
      {
        path: this.rootPath,
        recursive: false,
        limit: 1000,
      },
      this.rootPath || undefined,
    )) as DropboxListFolderResponse;
    let pages = 1;
    for (;;) {
      for (const entry of page.entries) {
        if (entry['.tag'] !== 'folder') continue;
        const path = this.relativePath(entry);
        if (path) folders.push({ path, name: entry.name });
      }
      if (!page.has_more) return { folders, truncated: false };
      if (pages >= maxPages) return { folders, truncated: true };
      page = (await this.rpc('files/list_folder/continue', {
        cursor: page.cursor,
      })) as DropboxListFolderResponse;
      pages += 1;
    }
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
      if (!path) continue;
      out.add(path);
      // A DELETED PAPER DOC, UNDER THE NAME IT ARRIVED BY (0150 T3 (b)). A
      // tombstone carries neither `is_downloadable` nor `export_info`, only
      // the fields every entry has, so this is the one place the kind is read
      // from the extension. Its row holds the name the export gave it, so
      // that name is evidence too. A key no row holds resolves to nothing.
      const exportAs = PAPER_KINDS.has(extensionOf(entry.name)) && this.paperPolicy !== 'refuse' ? this.paperPolicy : undefined;
      if (exportAs !== undefined && !entry.name.toLowerCase().endsWith(PAPER_SUFFIX[exportAs])) {
        out.add(`${path}${PAPER_SUFFIX[exportAs]}`);
      }
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

  /**
   * The one download, issued fresh each time it is called.
   *
   * Called once for a buffered read and once per `open()` for a streamed one —
   * which is the point: a body must be RE-OPENABLE, because a retry after a
   * half-written upload starts from the beginning and a stream that has been
   * consumed cannot. Nothing is cached here, deliberately.
   */
  private async download(item: FileItem, ref: string): Promise<DropboxResponse> {
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
      // THE ANSWER THE OWNER'S MIGRATION MET (0150 T1), for a file the listing
      // did not mark: 409 `unsupported_file` is Dropbox's *"This file type
      // cannot be downloaded directly; use export instead."* It is stated as
      // the same refusal, so a listing that carried no `is_downloadable`
      // still parks the file by name. Any other answer stays an ordinary
      // failure, retried and read from its words.
      if (response.status === 409 && dropboxErrorTag(text) === 'unsupported_file') {
        const name = item.name ?? item.path;
        throw new DropboxNativeRefused(name, extensionOf(name), true);
      }
      throw new Error(
        `Dropbox refused the download of "${item.path}" (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return response;
  }

  /**
   * One export, in the format the listing settled on (0150 T4): Dropbox's
   * `files/export`, on the content host, its argument in a header as the
   * download's is, the file named by its id.
   *
   * The route is marked a preview by Dropbox (D2). The one answer a setting
   * changes, `invalid_export_format`, is stated as the refusal a setting
   * would lift. Every other refusal, `retry_error` and `non_exportable`
   * among them, stays an ordinary failure, retried and read from Dropbox's
   * own words.
   */
  private async exportBytes(
    item: FileItem,
    ref: string,
    kind: string,
    format: DropboxPaperFormat,
  ): Promise<Uint8Array> {
    const response = await this.transport(`${this.contentBase}/files/export`, {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': JSON.stringify({ path: ref, export_format: format }) },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      if (response.status === 409 && dropboxErrorTag(text) === 'invalid_export_format') {
        const exported = item.name ?? item.path;
        const suffix = PAPER_SUFFIX[format];
        const listed = exported.endsWith(suffix) ? exported.slice(0, -suffix.length) : exported;
        throw new DropboxNativeRefused(listed, kind, true, format);
      }
      throw new Error(
        `Dropbox refused the export of "${item.path}" as ${format} (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async fetch(item: FileItem): Promise<RawFileItem> {
    // A FILE DROPBOX HANDS OVER ONLY AS AN EXPORT (0150 T5), refused here,
    // before any download and before the size below chooses between a buffer
    // and a stream. A streamed file is downloaded inside `open()`, under the
    // destination's write, where a refusal would be recorded as the
    // destination's. The listing has already said so, so no request is spent
    // asking.
    const exportOnly = (item as DropboxFileItem).exportOnly;
    if (exportOnly && exportOnly.exportAs === undefined) {
      throw new DropboxNativeRefused(
        item.name ?? item.path,
        exportOnly.kind,
        exportOnly.formats.length > 0,
        exportOnly.notOffered,
      );
    }
    const ref = item.sourceRef;
    if (!ref) {
      throw new Error(`No Dropbox file id recorded for "${item.path}" — cannot fetch it.`);
    }

    /**
     * A PAPER DOC IN THE FORMAT THE MIGRATION CHOSE (workplan 0150 T4).
     *
     * Before the size below, and always buffered. The listing's size is the
     * `.paper` file's, not the export's, which is unknown until Dropbox has
     * made it. A body promises its size before a byte is read (the target
     * sends it as `Content-Length`), so an export never streams: it is read
     * whole, and the item carries the export's own length, as Drive's does.
     */
    if (exportOnly?.exportAs !== undefined) {
      const bytes = await this.exportBytes(item, ref, exportOnly.kind, exportOnly.exportAs);
      return {
        item: { ...item, size: bytes.byteLength },
        content: bytes,
        // Bytes this product asked Dropbox to render, not a file the owner
        // stored (ADR-0046): a rename is paired by the id, not by these.
        rendering: true,
      };
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
     * The threshold is the LISTING's size (`entry.size`, which `toFileItem`
     * carries onto the item), because it is the only figure available before
     * the download starts. Dropbox reports it exactly for every file, so
     * unlike a provider that estimates, the branch here is taken on the same
     * number the target will be told to expect.
     */
    if (item.size > STREAM_FILES_LARGER_THAN_BYTES) {
      return {
        item,
        body: {
          sizeBytes: item.size,
          open: async () => {
            const response = await this.download(item, ref);
            if (!response.body) {
              // A 200 with no body, on a file the listing gave a size to.
              // Returning an empty stream here would write an empty file and
              // record it as a copy — the worst outcome available to this
              // code, so it is a throw and not a `?? empty`.
              throw new Error(
                `Dropbox answered ${response.status} for "${item.path}" with no body to read.`,
              );
            }
            return response.body;
          },
        },
      };
    }

    const response = await this.download(item, ref);
    return { item, content: new Uint8Array(await response.arrayBuffer()) };
  }

  private toFileItem(entry: DropboxEntry): DropboxFileItem | undefined {
    const listed = this.relativePath(entry);
    if (!listed || !entry.id) return undefined;
    // THE NAME IS CHOSEN HERE, AT LISTING (0150 T3 (b)). The sync loop writes
    // under the listed path and keeps only the bytes `fetch` returns, so an
    // export's name has to be the item's before anything is fetched. The path
    // ends in the name, so the suffix is appended to both.
    const name = nameUnder(entry, this.paperPolicy);
    const path = `${listed}${name.slice(entry.name.length)}`;
    const formerPaths = this.formerPathsOf(entry, listed, path);
    const paper = entry.is_downloadable === false && PAPER_KINDS.has(extensionOf(entry.name));
    return {
      path,
      name,
      ...(formerPaths.length > 0 ? { formerPaths } : {}),
      isDirectory: false,
      size: entry.size ?? 0,
      // Dropbox's block hash: stable per content, compared against itself
      // across passes — the same contract Drive's md5 carries.
      ...(entry.content_hash ? { contentHash: entry.content_hash } : {}),
      // The version an edit is detected by — see `FileItem.etag`. Absent
      // until 2026-09-22, so a Dropbox file edited after its first copy was
      // never copied again.
      ...fileVersion(entry.content_hash, entry.server_modified),
      modifiedAt: entry.server_modified ?? entry.client_modified ?? new Date(0).toISOString(),
      // The source's own handle — stable across renames, unlike the path.
      sourceRef: entry.id,
      // AND WHAT PAIRS A RENAMED PAPER DOC (0150 T3 (b), D8), as it pairs a
      // renamed Google document: its bytes are an export made every time it
      // is copied, which nobody promised is the same twice. The id is: a
      // rename does not change it.
      ...(paper ? { sourceIdentity: entry.id } : {}),
      // Marked here, where Dropbox says so (0150 T5): exported by `fetch` in
      // the format settled on here, or refused by it. Only an explicit
      // `false`: absent is how every file listed before, and `download` still
      // states the refusal if Dropbox then answers with it.
      ...(entry.is_downloadable === false ? { exportOnly: exportOnlyOf(entry, this.paperPolicy) } : {}),
    };
  }

  /**
   * The paths this file would have under the OTHER Paper policies (0150
   * T3 (b)), for `FileItem.formerPaths`, as Drive's are for its own. A switch
   * of format lists the file under a key the ledger has not seen, and a row
   * parked under the old key, a refused Paper doc most often, is closed by
   * naming it here. Computed by the same function as the current name.
   */
  private formerPathsOf(entry: DropboxEntry, listed: string, current: string): string[] {
    if (entry.is_downloadable !== false || !PAPER_KINDS.has(extensionOf(entry.name))) return [];
    const paths = new Set<string>();
    for (const policy of EVERY_PAPER_POLICY) {
      if (policy === this.paperPolicy) continue;
      const path = `${listed}${nameUnder(entry, policy).slice(entry.name.length)}`;
      if (path !== current) paths.add(path);
    }
    return [...paths];
  }
}
