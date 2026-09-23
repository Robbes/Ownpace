// Copyright 2026 The Ownpace authors (Apache-2.0)

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
  fileVersion,
  googleEditorKindOf,
  nativeFilePoliciesOf,
  permissionsNotDiscoverable,
  markNeedsDecision,
  statedFailureCategoryOf,
  withFailureCategory,
  type FailureCategory,
  type FileSource,
  type GoogleEditorKind,
  type FileFolder,
  type FileItem,
  type PermissionGrant,
  type PermissionListing,
  type RawFileItem,
  type SyncCursor,
  type TrashListing,
} from '@openmig/shared';
import { driveFailure, isDriveDecision } from './drive-refusal.ts';
import {
  DRIVE_FOLDER_MIME,
  GOOGLE_NATIVE_PREFIX,
  NATIVE_EXPORT_EXTENSIONS,
  NATIVE_EXPORT_TYPES,
  exportStabilityOf,
  nativeFileWord,
  stablePoliciesFor,
  type DriveFile,
  type DriveFileList,
  type DriveTransport,
  type DriveResponse,
  type GoogleDriveSourceConfig,
  type ExportStability,
  type NativeFilePolicy,
} from './google-drive-source.types.ts';
// The seam's threshold, not DAV's — every connector that moves to `FileBody`
// decides at the same size, or a file of a given size behaves differently
// depending on where it came from. It is defined in `webdav-source.ts` because
// DAV was the first connector to move; #874 lifts it into `@openmig/shared`
// beside `MAX_BUFFERED_FILE_BYTES` and re-exports it from there, so this
// import resolves either way and can be retargeted when that lands.
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';

const DEFAULT_BASE = 'https://www.googleapis.com/drive/v3';

/**
 * Native types Drive CAN export a rendering of. Every other
 * `application/vnd.google-apps.*` — form, map, site, jam, script, shortcut —
 * has NO export in any format (`files.export` answers 403 for them), so an
 * export policy is not a way out for those and the message must not offer it.
 * Mirrors the keys of `NATIVE_EXPORT_TYPES` exactly — drawing included, since
 * every policy now maps one (SVG under both document families, PDF under
 * `export-pdf`). A guard test asserts the two agree, because a type listed
 * here but unmapped there tells an owner "choose a policy that covers it"
 * about a file no policy covers.
 */
export const EXPORTABLE_NATIVE_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

export const DRIVE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/**
 * Thrown per item, so one un-migratable file never fails a whole folder.
 *
 * A DECISION, not an error (`markNeedsDecision`): the sync loop parks it on
 * first sight rather than retrying a policy five times or counting it toward
 * the "the world is broken" tripwire — which a folder of 25 Google Docs
 * tripped live on 2026-09-11, stopping the pass for the files that COULD
 * have been copied.
 *
 * The sentence depends on what the thing is, because the way out does:
 *   - a Doc/Sheet/Slides/Drawing can be EXPORTED, so the policy is named;
 *   - a Form, My Map, Site or Apps Script cannot be exported at all, so
 *     offering a policy would send the operator to a setting that changes
 *     nothing;
 *   - a shortcut is a pointer to something else, not content.
 */
/**
 * WHAT TO DO ABOUT A REFUSED FILE, read off the measurements rather than
 * written into the sentence.
 *
 * This used to be the fixed clause *"export-pdf is stable for a Doc and loses
 * editability"*, which was true on the day a Doc was the only thing anyone had
 * measured. It then said Doc to every customer whose SLIDES DECK had just been
 * refused — the wrong file type, in the one sentence whose whole job is telling
 * somebody what to do next. Two measurements later it would also have been
 * needlessly bleak: a Doc refused under `export-odf` can go to `export-office`
 * and STAY EDITABLE, and the fixed clause sent it to PDF.
 *
 * So the way out is derived per type, and the consequence is that a
 * measurement is the only thing that can change this advice. A green that turns
 * red later removes a recommendation nobody has to remember to withdraw.
 *
 * AN EMPTY LIST IS NOT A BUG and must not be read as one: a type with nothing
 * measured stable genuinely has no way out through a policy today, and saying
 * that is better than naming a format nobody has run. **No type is in that
 * position as this is written** (2026-09-17): every one of the twelve cells has
 * been measured and every editor type has at least two policies measured
 * stable. The branch stays because a Google product added tomorrow starts with
 * nothing measured, which is exactly the case it is for.
 */
function wayOutFor(kind: string, mimeType: string, refused: NativeFilePolicy): string {
  const alternatives = stablePoliciesFor(mimeType).filter((policy) => policy !== refused);
  const keepIt = `Move the ${kind} out of scope and keep it where it is.`;
  if (alternatives.length === 0) {
    return `No export policy is measured stable for a ${kind}, so there is no format to switch to. ${keepIt}`;
  }
  const named = alternatives.map((policy) => `"${policy}"`).join(' and ');
  const verb = alternatives.length === 1 ? 'is' : 'are';
  // The editability cost is attached to the policy that carries it rather than
  // stated in general: "export-office" keeps a document editable and "export-pdf"
  // does not, and a customer choosing between them needs that difference and not
  // a blanket warning over both.
  //
  // TWO SHAPES, because with one alternative the parenthetical form names the
  // same policy twice in a row — `"export-pdf" is measured stable for a Slides
  // deck ("export-pdf" is not editable afterwards)` — which reads like a stutter
  // and buries the one thing being said. With two it is the parenthetical that
  // does the work, saying WHICH of them costs the editing.
  const onlyPdf = alternatives.length === 1 && alternatives[0] === 'export-pdf';
  const cost = onlyPdf
    ? ', though a PDF is not editable afterwards'
    : alternatives.includes('export-pdf')
      ? ' ("export-pdf" is not editable afterwards)'
      : '';
  return `${named} ${verb} measured stable for a ${kind}${cost}. Switch the mapping's export policy, or: ${keepIt}`;
}

export class NativeFileRefused extends Error {
  constructor(
    name: string,
    mimeType: string,
    policy: NativeFilePolicy = 'refuse',
    /**
     * What the measurement says about THIS policy on THIS type, when the
     * policy has a rendering for it at all.
     *
     * Only `unstable` ever reaches here — `refusalFor` does not refuse an
     * `unmeasured` combination, because a blank is not a red (see there). The
     * parameter takes the whole type rather than a boolean so that if that
     * product decision is ever revisited, the call site changes and this
     * signature does not.
     */
    stability: ExportStability = 'stable',
  ) {
    // The word a person uses, not the MIME suffix. The LEDGER key stays the
    // suffix (see `nativeFileWord`); this is only the sentence.
    const kind = nativeFileWord(mimeType);
    // WHICH KIND OF REFUSAL THIS IS, decided in the same branch that writes
    // the sentence (workplan 0125 T4).
    //
    // Both values already existed; what did not is any way for them to leave
    // this constructor. `classifyFailure` reads message text, so it was handed
    // prose about a `nativeFilePolicy` and answered `unknown` — thirty of the
    // owner's files, whose remedy then read "send it to us and we will look"
    // about a refusal written here. The category is stated instead, beside the
    // decision marker it already carried, and travels the same way.
    //
    // The line is WHETHER A SETTING WOULD CHANGE THE ANSWER, because that is
    // what the Failures page offers a press for:
    //
    //  - `source_refused` — nothing we could configure makes Drive produce a
    //    file. A Form, a My Map, a Site, a shortcut with no content of its own.
    //  - `policy_refused`  — the source would have handed it over and the
    //    destination was never asked; this migration's own policy declined.
    //
    // THE SPLIT IS THE EXPORTABLE/NOT-EXPORTABLE ONE, and nothing finer. A
    // first draft made `policy_refused` conditional on another policy being
    // measured stable for the type, so a group whose remedy is "change the
    // export policy" could never hold an item no policy carries. The condition
    // cannot fire: the three branches that could reach it are all below the
    // `EXPORTABLE_NATIVE_TYPES` guard, and every exportable type has at least
    // two stable policies. A branch nothing can execute is a branch no test can
    // prove, so it is not here.
    //
    // WHAT HOLDS THE CLAIM INSTEAD is a guard over the measurement table
    // itself, in `a-policy-offered-for-a-form-that-cannot-be-exported`: every
    // exportable type must keep a stable policy to switch TO, whichever one is
    // in force. Add a Google type with nothing measured and that goes red,
    // naming the type — rather than this shipping a `policy_refused` whose
    // remedy names no format, which is the one-button-two-remedies defect the
    // category was added to end, reappearing one size down.
    let category: FailureCategory;
    let message: string;
    if (mimeType === DRIVE_SHORTCUT_MIME) {
      category = 'source_refused';
      message =
        `"${name}" is a Google Drive shortcut: a pointer to an item that lives elsewhere, not ` +
        'a file of its own, so there is nothing to copy. If the item it points to is in scope ' +
        'it is copied under its own path; otherwise accept leaving the shortcut behind.';
    } else if (!EXPORTABLE_NATIVE_TYPES.has(mimeType)) {
      category = 'source_refused';
      // The owner's own wording, 2026-09-22, shortened from one that took three
      // clauses to say "no format exists". "Copy", not the "move" of the
      // draft: nothing is taken from the old account, ever, and the word the
      // product uses for that is the one a person should read here.
      message =
        `"${name}" is a Google ${kind} and has no file to copy: Drive cannot export a ${kind} in ` +
        'any format — to keep it, open it in Drive and share or download it there. Accept ' +
        'leaving it behind here.';
    } else if (policy === 'refuse') {
      category = 'policy_refused';
      // NAMES THE SCREEN, NOT THE CONFIG KEY (2026-09-22). This told a person
      // their migration was "configured with nativeFilePolicy=\"refuse\"" and
      // listed three policy ids, because when it was written the setting had
      // no screen and the key was its only name. It has one now, titled
      // "Export format for Google files", and the owner reading this row on a
      // live migration found it "very long" and asked why a file NAMED
      // `.xlsx` could not be exported. The lossy-export reasoning lives on that
      // screen's own "Why?", where a person choosing a format will read it.
      message =
        `"${name}" is a Google ${kind}: it has no file to copy until Drive exports one, and this ` +
        'migration is set not to export. Choose a format under Export format for Google files, ' +
        'and the next pass copies it in that format and closes this line — or leave it behind.';
    } else if (stability === 'unstable') {
      category = 'policy_refused';
      // MEASURED, not suspected. Drive CAN export this one — the refusal is
      // about what the export is worth, which is a harder thing to explain and
      // a worse thing to get wrong. If this file were copied, every later pass
      // would see a different hash for a document nobody touched, re-copy it,
      // and succeed; the owner would find their whole library rewritten every
      // night with nothing in any report saying so.
      message =
        `"${name}" is a Google ${kind}. Drive can export one under "${policy}", but the export ` +
        'is NOT byte-stable: exporting the same unchanged file twice gives two different ' +
        'results, measured on a real account. Copying it would make every later pass see a ' +
        `change that did not happen and re-copy it, nightly, forever. ${wayOutFor(kind, mimeType, policy)} ` +
        'This is a measurement, not a guess — see workplan 0042 T3.';
    } else {
      category = 'policy_refused';
      message =
        `"${name}" is a Google ${kind}, and the mapping's export policy (${policy}) has no ` +
        `rendering for a ${kind}. Choose a policy that covers it, or accept leaving it behind.`;
    }
    super(message);
    this.name = 'NativeFileRefused';
    markNeedsDecision(this);
    withFailureCategory(category, this);
  }
}

/**
 * Every export policy, `refuse` first: every policy a document's name can come
 * from. Derived from the export table, so a policy added there is a former name
 * looked for here (0042 T8 (b)).
 */
const EVERY_POLICY: ReadonlyArray<NativeFilePolicy> = [
  'refuse',
  ...(Object.keys(NATIVE_EXPORT_TYPES) as Array<Exclude<NativeFilePolicy, 'refuse'>>),
];

/**
 * The name a Drive file gets under `policy`. `GoogleDriveSource.exportedName`
 * says why the name matters: it is part of the natural key.
 */
function exportedNameUnder(file: DriveFile, policy: NativeFilePolicy): string {
  if (policy === 'refuse' || !isNativeEditorFile(file.mimeType)) return file.name;
  const target = NATIVE_EXPORT_TYPES[policy][file.mimeType];
  if (!target) return file.name;
  const ext = NATIVE_EXPORT_EXTENSIONS[target];
  // No extension known for an export we do map is a gap in the table, not a
  // reason to rename the file: leave the name alone rather than inventing a
  // suffix. The guard test makes this branch unreachable.
  if (!ext) return file.name;
  return file.name.toLowerCase().endsWith(ext) ? file.name : `${file.name}${ext}`;
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

/** What `storageUsage` answers — Google's own quota figures for this account. */
export interface DriveStorageUsage {
  /** My Drive, bin excluded. */
  readonly bytes: number;
  readonly trashBytes: number;
  /** The account's storage limit, when Google states one. */
  readonly limitBytes?: number;
  /** Always true for Drive: native editor files weigh nothing here. */
  readonly nativeFilesExcluded: true;
}

/**
 * THE ONE WAY PAST THE STABILITY REFUSAL, and it exists for the instrument that
 * produced the measurement in the first place.
 *
 * ## The circle this breaks
 *
 * `EXPORT_STABILITY` is built from the output of
 * `scripts/drive-export-stability.ts`, and that script measures THROUGH this
 * connector on purpose — the question it answers is "what would a migration
 * store", and a hand-rolled export would answer a different one. So when the
 * connector learned to refuse what the table calls `unstable`, the script
 * inherited the refusal and stopped being able to measure the two combinations
 * the table condemns. The instrument could no longer take a reading it had
 * itself produced, which also means it could not notice Google FIXING one: a
 * red would have been permanent by construction, with no way back to green
 * short of editing the table by hand on no evidence.
 *
 * ## Why a third argument and not a config field
 *
 * `GoogleDriveSourceConfig` is parsed from an appliance's config file and from
 * a managed connection's stored row. Anything in it is reachable by a customer
 * or an operator typing a key, which is exactly what must not be true of this:
 * the refusal is the only thing standing between a Slides deck and a library
 * rewritten nightly. A separate positional argument is not in that schema,
 * cannot arrive through it, and reads at the call site as the sentence it is.
 *
 * `a-deck-that-would-be-rewritten-nightly.unit.test.ts` holds the other half:
 * no production call site passes it.
 */
export type MeasuringInstrument = {
  /**
   * Named at length so it cannot be set casually, and so a reviewer seeing it
   * in a diff outside `scripts/` knows immediately that something is wrong.
   */
  readonly exportDespiteMeasuredInstability: true;
};

export class GoogleDriveSource implements FileSource {
  private readonly baseUrl: string;
  private readonly rootFolderId: string;
  /**
   * The single setting, which is what a native file that is none of the four
   * editor kinds is read under. It makes no difference to one of those: no
   * policy has a rendering for a Form, so every one refuses it the same way.
   */
  private readonly policy: NativeFilePolicy;
  /** The format each editor kind is exported in — see `policyFor`. */
  private readonly policies: Readonly<Record<GoogleEditorKind, NativeFilePolicy>>;
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

  /**
   * Native files this policy will refuse, by Google editor kind, accumulated as
   * folders are listed. Read by the preflight through `nativeRefusals()`.
   */
  private readonly refusedNative = new Map<string, number>();

  private readonly transport: DriveTransport;

  /**
   * Whether this source may export a combination the measurements call
   * `unstable`. FALSE for every migration, and settable only by passing a
   * third constructor argument that spells out what it is for.
   */
  private readonly measuring: boolean;

  constructor(
    transport: DriveTransport,
    config: GoogleDriveSourceConfig = {},
    instrument?: MeasuringInstrument,
  ) {
    this.transport = transport;
    this.measuring = instrument?.exportDespiteMeasuredInstability === true;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.rootFolderId = config.rootFolderId ?? 'root';
    // Defaults to refusing, not exporting. See NativeFilePolicy: of the two ways
    // to be wrong, only "your Docs did not migrate, and here is why" is one an
    // owner can act on.
    this.policy = config.nativeFilePolicy ?? 'refuse';
    // Each kind's own format where the mapping gives one (0042 T9), read by the
    // same function the revision snapshot records with, so what a migration is
    // recorded as and what it exports cannot disagree about an unset kind.
    this.policies = nativeFilePoliciesOf(config);
  }

  /**
   * The policy THIS file is exported under (workplan 0042 T9).
   *
   * Asked per file rather than read once per source, because since the owner's
   * decision of 2026-09-23 a Doc and a deck in the same folder can go different
   * ways: no editable format carries all four kinds, so one setting for all of
   * them made somebody choose which kind to lose. Every decision below — the
   * name, the export, the refusal, the names the file had before — asks this,
   * so no two of them can read a file under different policies.
   */
  private policyFor(mimeType: string): NativeFilePolicy {
    const kind = googleEditorKindOf(mimeType);
    return kind === undefined ? this.policy : this.policies[kind];
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
   * How much the account's Drive holds, as Google reports it (2026-09-02):
   * one `about` request, no walk. `usageInDrive` is My Drive without the
   * bin; the bin is reported apart so it can be named. Google-native files
   * (Docs, Sheets, Slides) count for nothing in this figure and are exported
   * on migration, so the target ends up larger than this says — the caller
   * says so beside the number rather than pretending precision.
   *
   * The whole of My Drive, not the configured root: a per-root total would be
   * a walk over every file's size, which is what this exists to avoid.
   */
  async storageUsage(): Promise<DriveStorageUsage> {
    const about = (await this.getJson(`${this.baseUrl}/about?fields=storageQuota`)) as {
      storageQuota?: { usage?: string; usageInDrive?: string; usageInDriveTrash?: string; limit?: string };
    };
    const n = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const q = about.storageQuota ?? {};
    return {
      bytes: n(q.usageInDrive) ?? 0,
      trashBytes: n(q.usageInDriveTrash) ?? 0,
      ...(n(q.limit) !== undefined ? { limitBytes: n(q.limit) } : {}),
      nativeFilesExcluded: true,
    };
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
      // TALLIED HERE BECAUSE THE WALK IS ALREADY HAPPENING (0042 T7). The
      // preflight lists every folder to count items; asking `refusalFor` about
      // each file as it goes costs a map lookup and no request at all, where a
      // second walk would cost the owner's Drive quota to learn something this
      // one already knows.
      //
      // The item is still pushed. A refused file is LISTED and then refused at
      // `fetch`, inside the sync loop's per-item boundary, so it lands in the
      // failures queue with its reason and the rest of the folder migrates.
      // Filtering it out of the listing here would make it vanish instead —
      // uncounted, unreported, and indistinguishable from a file that was never
      // there.
      // EVERY FILE THIS POLICY WILL NOT CARRY — not only the measured-unstable
      // ones.
      //
      // This counted `policy !== 'refuse'` and unstable-only, on a stated
      // argument: *"under `refuse` every native file is refused and the
      // policy's own name says so"*. That holds for a policy somebody CHOSE.
      // It does not hold for a DEFAULT, and `refuse` is the default — so the
      // one case the number was omitted from is the one where nobody has been
      // told anything. The owner met it on 2026-09-22: a full migration under
      // the default, the setting never seen, and the consequence arriving
      // afterwards as twenty failure rows. Which is verbatim the outcome the
      // confirm screen's own comment says this count exists to prevent —
      // *"while the choice is still open, and not as a queue full of failure
      // rows after the first pass"*.
      //
      // `refusalFor` DECIDES, rather than a second copy of its branches, so
      // the count and the per-item reason cannot disagree about what is
      // refused. Its category is what separates the two kinds of no: a
      // `policy_refused` file has some export policy that would carry it, and
      // a `source_refused` one — a Form, a Map, a shortcut — has none and
      // never will, so counting it here would promise that changing the
      // setting brings it back. Bounded by the native files in the walk, not
      // by the walk.
      //
      // A COUNT MUST NEVER BE ABLE TO FAIL A WALK. `mimeType` is required by
      // the type and Drive's own `fields` asks for it, so an absent one means a
      // provider sent less than it promised. Losing one file from a
      // confirm-screen tally is the right price for that; throwing loses the
      // whole folder's listing. The old form was shielded from this by
      // accident — under the default policy it short-circuited before it ever
      // read the field, which is why no test had to think about it.
      if (typeof file.mimeType === 'string' && isNativeEditorFile(file.mimeType)) {
        const refusal = this.refusalFor(file);
        if (refusal !== undefined && statedFailureCategoryOf(refusal) === 'policy_refused') {
          const kind = file.mimeType.slice(GOOGLE_NATIVE_PREFIX.length);
          this.refusedNative.set(kind, (this.refusedNative.get(kind) ?? 0) + 1);
        }
      }
      // The SAME name for the path and the item, so the natural key and what
      // the owner sees on the target cannot disagree about the suffix.
      const path = this.childPath(folder.path, this.exportedName(file));
      items.push({
        item: this.toFileItem(file, path, this.formerPathsOf(file, folder.path, path)),
      });
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
   * Files the account OWNS that no walk from the migration root can reach
   * (workplan 0058) — Drive's "unorganized" items, and the coverage question
   * every file source should be able to answer about itself.
   *
   * Drive is the one provider where a file can genuinely FLOAT: delete a
   * parent folder without deleting its contents, or create a file through the
   * API with no `parents`, and the file stays in the account, owned and
   * intact, reachable by search but by no path. Drive's own UI hides it
   * (`is:unorganized` in search is how a person finds it). `listFolders`
   * walks DOWN from `rootFolderId`, so a pass never sees it — it is not
   * migrated, and until this existed nothing said so. That is the silent
   * under-migration this product exists not to do (hard rule 9).
   *
   * Deliberately CHEAP and read-only: one paged `files.list` over
   * `'me' in owners`, asking only for `parents`, which is the same listing
   * shape `listOwnedShareGrants` already makes for the sharing scan. Nothing
   * here fetches bytes or changes what a pass migrates — it reports.
   *
   * Only files the account OWNS: a file shared WITH the account has parents
   * the account cannot see, so it would read as orphaned for everyone, every
   * pass. Those are the documented shared-with-me case instead, and rooting a
   * mapping at a shared folder is their supported route.
   */
  async listOrphanedFiles(options?: { maxItems?: number }): Promise<{
    readonly files: ReadonlyArray<{ id: string; name: string }>;
    readonly capped: boolean;
  }> {
    const maxItems = options?.maxItems ?? 200;
    const q = `'me' in owners and trashed=false and mimeType!='${DRIVE_FOLDER_MIME}'`;
    const fields = 'nextPageToken,files(id,name,parents)';
    const found: Array<{ id: string; name: string }> = [];

    let pageToken: string | undefined;
    let pages = 0;
    do {
      if (++pages > 100) return { files: found, capped: true };
      const url =
        `${this.baseUrl}/files?q=${encodeURIComponent(q)}&pageSize=100` +
        `&fields=${encodeURIComponent(fields)}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const page = (await this.getJson(url)) as DriveFileList;
      for (const file of page.files ?? []) {
        // No parents at all is what "unorganized" means on the wire. A file
        // WITH parents may still be out of this migration's root, which is a
        // scoping decision rather than a floating file — not this report's
        // business (see `TrashListing` for the same distinction).
        if (file.parents && file.parents.length > 0) continue;
        if (found.length >= maxItems) return { files: found, capped: true };
        found.push({ id: file.id, name: file.name });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    return { files: found, capped: false };
  }

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
    // `parents` and `mimeType` ride along on THIS call, for nothing — which is
    // the whole reason the sharing queue groups on the container rather than
    // on Drive's own inheritance reporting. `permissionDetails.inherited` was
    // measured (2026-09-18, the owner's Drive) to arrive only on
    // `permissions.list`, one request per item — 482 extra calls on his Drive
    // per scan — and to arrive WITHOUT `inheritedFrom`, so it could not have
    // been the grouping key even at that price. See workplan 0123 §5.
    const fields =
      'nextPageToken,files(id,name,shared,mimeType,parents,permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery))';

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
            mimeType?: string;
            parents?: string[];
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
              // Where it sits (workplan 0123 T4). Only the FIRST parent is
              // carried: Drive's `parents` is an array for historical reasons
              // (multi-parenting was removed in 2020 and the field kept its
              // shape), so a second entry is not a second home to group under.
              // A file with NO parents is Drive's "unorganized" — genuinely
              // placeless, which `listOrphanedFiles` reports as its own
              // finding — and it correctly leaves `parentKey` unset here, so
              // the queue lists it alone rather than inventing a folder.
              itemKey: file.id,
              ...(file.parents?.[0] ? { parentKey: file.parents[0] } : {}),
              ...(file.mimeType !== undefined
                ? { isContainer: file.mimeType === DRIVE_FOLDER_MIME }
                : {}),
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

    const exportUrl = this.exportUrlFor(meta);
    const url =
      exportUrl ??
      `${this.baseUrl}/files/${encodeURIComponent(fileId)}?alt=media&${GET_ALL_DRIVES}`;

    /**
     * A LARGE FILE ARRIVES AS A BODY, NOT AS BYTES (workplan 0120 T5).
     *
     * Below the threshold nothing changes: most files are small and a buffer
     * is simpler than the machinery. Above it, holding the file was the whole
     * ceiling — a file larger than the runner's RAM killed the process
     * mid-pass, with no failure row and no sentence.
     *
     * AN EXPORT IS NEVER STREAMED, and that is the Drive-specific decision.
     * Drive reports no `size` for a native editor file — a Google Doc has no
     * bytes until one is asked for — so the exported length is unknowable
     * before the export exists. `FileBody.sizeBytes` has to be honest BEFORE a
     * byte is read: the daily byte meter spends it ahead of the fetch and the
     * target promises it as `Content-Length`. A guessed size there is worse
     * than a buffer, and native exports are documents, which are small. So the
     * branch is taken only when there is no export URL, i.e. for an ordinary
     * file whose listing `size` came from Drive's own `size` field.
     *
     * The size CORRECTION below (`size: bytes.byteLength`) is therefore not
     * lost by streaming: it exists for exports, where the listing size was
     * absent, and exports still take the buffered path.
     *
     * The metadata call above still happens here rather than at `open()`,
     * unlike the Graph and Dropbox bodies which issue nothing until opened.
     * It has to: the refusal for a native file must land inside the sync
     * loop's per-item boundary, and whether this file can be streamed at all
     * is what that call answers.
     */
    if (exportUrl === undefined && item.size > STREAM_FILES_LARGER_THAN_BYTES) {
      return {
        item,
        body: {
          sizeBytes: item.size,
          // A fresh GET per call. A retry after a half-written upload starts
          // from the beginning, and a stream that has been consumed cannot.
          open: async () => {
            const streamed = await this.download(url, item);
            if (!streamed.body) {
              // A 200 with no body, on a file the listing gave a size to.
              // An empty stream here would write an empty file and record it
              // as a copy — the worst outcome available to this code.
              throw new Error(
                `Drive answered ${streamed.status} for "${item.path}" with no body to read.`,
              );
            }
            return streamed.body;
          },
        },
      };
    }

    const response = await this.download(url, item);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      item: { ...item, size: bytes.byteLength },
      content: bytes,
      // THE ONE PLACE THAT KNOWS. These bytes exist because we asked Drive to
      // render a document that has none of its own, and `RawFileItem.rendering`
      // is what tells the sync loop to compare them by the container's parts
      // rather than whole (ADR-0046). An ordinary file downloaded through
      // `alt=media` takes the other branch of this same expression and is not
      // marked — a `.zip` the customer stored is their bytes, and normalising
      // its container away would hide a change they made.
      ...(exportUrl === undefined ? {} : { rendering: true as const }),
    };
  }

  /** The one download, issued fresh each time — buffered read and `open()` alike. */
  private async download(url: string, item: FileItem): Promise<DriveResponse> {
    const response = await this.transport(url);
    if (!response.ok) {
      // Google's envelope goes; Google's words stay. See `drive-refusal.ts`
      // for the shape and for why the sentence says what reached the
      // destination — the failure queue's own category reads a 403 like this
      // as the TARGET refusing, and sends the reader to the wrong account.
      const body = await safeText(response);
      const failure = new Error(
        driveFailure(`Drive refused the download of "${item.path}"`, {
          status: response.status,
          body,
        }),
      );
      // A refusal that answers the same way every pass is parked on its first
      // attempt rather than tried five times (`ports.ts`, and #207 in the
      // other direction). `cannotExportFile` is the observed one: Drive will
      // refuse that file for that account until somebody changes something in
      // Drive, and five attempts only delay the person finding out.
      throw isDriveDecision(body) ? markNeedsDecision(failure) : failure;
    }
    return response;
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

  /**
   * What this file is CALLED once it has landed on the target.
   *
   * A Google Doc's `name` carries no extension, because there is no file for
   * one to describe. Under an export policy there is: the bytes that arrive
   * are ODT, DOCX, SVG or PDF, and copying them out under the bare name
   * produces "Aanbiedingstekst" holding a Word document — which Nextcloud
   * shows as unknown and the owner's desktop offers no application for. So the
   * export's own suffix is appended.
   *
   * NOT appended when the name already ends in it: somebody who called their
   * Doc "Q3 report.pdf" gets one `.pdf`, not two. Case-insensitively, because
   * ".PDF" is the same claim.
   *
   * APPENDED when the name ends in some OTHER format's suffix: a Sheet called
   * "Budget.xls" lands as "Budget.xls.xlsx". The owner's decision (0042 T8
   * (c), 2026-09-23): the name they gave stays whole, and the last suffix,
   * which is the one Nextcloud types a file by, is what the bytes are.
   *
   * THIS IS PART OF THE NATURAL KEY. The key is the path (§10, ADR-0020), and
   * the path is built from this name — so a mapping that already copied Docs
   * under a policy would see the suffixed paths as new items and copy them
   * again beside the old. That is survivable only because it cannot have
   * happened yet: `refuse` is the default, an export policy is documented as
   * unmeasured (0042 T6), and no deployment has selected one. Anyone adding a
   * fourth policy after that is no longer free to change this.
   */
  private exportedName(file: DriveFile): string {
    return exportedNameUnder(file, this.policyFor(file.mimeType));
  }

  /**
   * The paths this document would have under the OTHER export policies
   * (0042 T8 (b)), for `FileItem.formerPaths`.
   *
   * The comment above is why this exists. The name is part of the key, so the
   * day an owner switches policy, every Google document is listed under a key
   * the ledger has never seen, and a failure recorded under the old key (most
   * often a refused Slides deck) is never listed again. Naming the old keys is
   * what lets the pass close those failures instead of leaving them on the
   * Failures screen for good. Computed with the same function as the current
   * name, so the two cannot disagree about a suffix. Empty for a file whose name
   * is its own.
   */
  private formerPathsOf(file: DriveFile, folderPath: string, current: string): string[] {
    if (typeof file.mimeType !== 'string' || !isNativeEditorFile(file.mimeType)) return [];
    const inForce = this.policyFor(file.mimeType);
    const paths = new Set<string>();
    for (const policy of EVERY_POLICY) {
      if (policy === inForce) continue;
      const path = this.childPath(folderPath, exportedNameUnder(file, policy));
      if (path !== current) paths.add(path);
    }
    return [...paths];
  }

  private toFileItem(file: DriveFile, path: string, formerPaths: ReadonlyArray<string> = []): FileItem {
    return {
      path,
      name: this.exportedName(file),
      ...(formerPaths.length > 0 ? { formerPaths } : {}),
      isDirectory: false,
      size: Number.parseInt(file.size ?? '0', 10) || 0,
      // Drive's MD5, for binary files only — see `FileItem.contentHash` for why
      // that is not comparable with anything but another Drive listing.
      //
      // Absent on Google-native files. That is a SYMPTOM of why they cannot
      // ride the ordinary path, not the reason: a native Doc has no stored
      // bytes to hash or to download, only an export in some other format
      // (0116).
      //
      // Until 2026-09-09 this comment gave the reason as the missing checksum
      // itself, on the grounds that every pass would then see a difference.
      // That is not a mechanism this codebase has — change detection is
      // `sourceVersion`, in `classifyKnownItem`, and no hash reaches it. The
      // exclusion was always right; the reason was not, and a wrong reason in
      // a comment is what the next person changing this listing acts on.
      ...(file.md5Checksum ? { contentHash: file.md5Checksum } : {}),
      // THE VERSION, which is what makes an edit in Google reach the copy.
      // `classifyKnownItem` rewrites a known file only when this changes, and
      // skips one that has none — so until 2026-09-22, when this was absent,
      // a file edited after its first copy was never copied again. The bytes'
      // own checksum where Drive keeps one; the last modification otherwise,
      // which is the only change a native Doc can show before it is exported.
      ...fileVersion(file.md5Checksum, file.modifiedTime),
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
    const policy = this.policyFor(file.mimeType);
    if (policy === 'refuse' || !isNativeEditorFile(file.mimeType)) return undefined;
    const target = NATIVE_EXPORT_TYPES[policy][file.mimeType];
    if (!target) return undefined;
    // A SECOND GATE, on purpose. `fetch` asks `refusalFor` first and throws, so
    // nothing measured-unstable reaches here today — but that is an ORDERING,
    // and an ordering is what a later edit reorders. The cost of the duplicate
    // check is a map lookup; the cost of losing it is a policy silently
    // exporting the file the measurement refused.
    if (!this.measuring && exportStabilityOf(policy, file.mimeType) === 'unstable') {
      return undefined;
    }
    return (
      `${this.baseUrl}/files/${encodeURIComponent(file.id)}/export` +
      `?mimeType=${encodeURIComponent(target)}`
    );
  }

  /**
   * What this policy will refuse in everything listed so far, by editor kind.
   *
   * An OPTIONAL CAPABILITY, in the shape `listTrashedPaths` and `storageUsage`
   * already use: the preflight asks for it if the source has it and carries on
   * if not. It is meaningful only after a walk — before one it is `{}`, which
   * is why the caller attaches it AFTER `discoverSource` returns rather than
   * reading it up front.
   *
   * COUNTED UNDER `refuse` TOO, which it was not. The argument for leaving it
   * out was that under `refuse` the policy's own name says every native file
   * is refused — true of a policy somebody chose, and `refuse` is the DEFAULT.
   * A default says nothing to the person who never opened the screen, and the
   * per-item reason it deferred to arrives in the failures queue, after the
   * run. See the tally site for what that cost.
   *
   * Only `policy_refused` files are counted: a Form or a Map has no export in
   * any policy, so including it would promise a remedy that does not exist.
   */
  nativeRefusals(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.refusedNative);
  }

  /** Whether this item would be refused, and why — exposed so callers can ask. */
  refusalFor(file: DriveFile): NativeFileRefused | undefined {
    if (!isNativeEditorFile(file.mimeType)) return undefined;
    const policy = this.policyFor(file.mimeType);
    if (policy === 'refuse') return new NativeFileRefused(file.name, file.mimeType);
    const map = NATIVE_EXPORT_TYPES[policy];
    // No rendering at all — the oldest of the three refusals, and the only one
    // that is about Drive rather than about us.
    if (!map[file.mimeType]) {
      return new NativeFileRefused(file.name, file.mimeType, policy);
    }
    // A rendering exists. Whether it is worth having is the measurement's
    // question.
    //
    // ONLY `unstable` REFUSES, and the line is drawn there deliberately.
    // `unmeasured` is recorded in the table and reported, but it does NOT stop
    // a copy: turning off a path that works today on the strength of a
    // measurement nobody has run would be a product decision — it would refuse
    // every Drawing, and it would have refused every Sheet and Slide under
    // `export-pdf`, the escape hatch an owner reaches for when `export-office`
    // will not do. Those were measured on 2026-09-16 and came back stable, one
    // day after this comment was written: the hatch would have been shut on no
    // evidence, the day before the evidence arrived. A Drawing under
    // `export-office` was deliberately made to work (SVG), and this is not the
    // change that turns it off again.
    //
    // The asymmetry is the same one the whole workplan runs on: a red is
    // conclusive and a blank is not. A blank is a reason to go and measure,
    // which `EXPORT_STABILITY` now names precisely enough to act on.
    const stability = exportStabilityOf(policy, file.mimeType);
    // The instrument is exempt from this ONE refusal and from no other: a
    // shortcut still has nothing to export, a Form still cannot be rendered,
    // and `refuse` still refuses. Only the verdict this script's own output
    // wrote is lifted, and only for the script that has to be able to write it
    // again.
    if (this.measuring) return undefined;
    return stability === 'unstable'
      ? new NativeFileRefused(file.name, file.mimeType, policy, stability)
      : undefined;
  }
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}
