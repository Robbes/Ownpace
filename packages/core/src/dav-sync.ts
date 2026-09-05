// Copyright 2026 OpenHands Agent (Apache-2.0)
/**
 * DAV domain sync wrappers - thin wrappers around runDomainSync for CalDAV
 * (events AND tasks), CardDAV, and WebDAV.
 * 
 * Each wrapper operates on REAL domain-typed sources/targets, not generic types.
 * The abstraction is at the function level, parameterizing the loop with domain-specific injections.
 */

import { applyTargetFolderPrefix,
  type Ledger,
  type CursorStore,
  type CalendarSource,
  type CalendarTargetWriter,
  type CalendarFolder,
  type RawCalendarEvent,
  type ContactSource,
  type ContactTargetWriter,
  type ContactFolder,
  type RawContact,
  type FileSource,
  type FileTargetWriter,
  type FileFolder,
  type RawFileItem,
  type TenantId,
  type MappingId,
  naturalKeyForCalendar,
  naturalKeyForTask,
  calendarContentHash,
  contactNaturalKeyHash,
  contactContentHash,
  fileNaturalKeyHash,
  fileContentHash,
} from '@openmig/shared';
import { runDomainSync, type DomainSyncResult } from './domain-sync.ts';

/**
 * Dependencies for calendar (CalDAV) sync.
 */
export interface CalendarSyncDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly source: CalendarSource;
  readonly target: CalendarTargetWriter;
  readonly ledger: Ledger;
  readonly cursors?: CursorStore;
  readonly concurrency?: number;
  /** What to do when the destination already holds the item; `'skip'` (adopt) by default. */
  readonly onCollision?: 'skip' | 'fail';
  /** Create every target directory under this folder — see `MappingConfig.targetFolderPrefix`. */
  readonly targetFolderPrefix?: string;
  /**
   * Measure-and-record what this target will DO with the calendar objects
   * this pass writes (0105 T0) — `schedulingRecorder` in orchestration.
   * Called before any write, so the first pass of a mapping's life records
   * the verdict before the first calendar object lands. The closure holds
   * its own once-per-mapping guard and never throws: a mapping must not
   * fail to migrate because an advisory record could not be written.
   */
  readonly recordTargetScheduling?: () => Promise<void>;
}

/**
 * Run CalDAV sync using the generalized domain sync loop.
 *
 * Idempotent: running twice creates 0 items on the second run.
 * Non-destructive: never deletes or overwrites on the target.
 */
export async function runCalendarSync(deps: CalendarSyncDeps): Promise<DomainSyncResult> {
  const { tenantId, mappingId, source, target, ledger, cursors, concurrency } = deps;

  // BEFORE the loop, deliberately — the whole point of the record is that
  // the measurement provably preceded the first write (workplan 0105 T0).
  await deps.recordTargetScheduling?.();

  return runDomainSync<CalendarSource, CalendarTargetWriter, RawCalendarEvent, CalendarFolder>({
    tenantId,
    mappingId,
    domain: 'calendar',
    source,
    target,
    ledger,
    cursors,
    concurrency,
    listFolders: () => source.listFolders(),
    listSince: (folder, cursor) => source.listSince(folder, cursor),
    fetchRaw: async (item) => {
      const raw = item.icalendar;
      return { 
        raw: { item: item.item, icalendar: raw } as RawCalendarEvent,
        sizeBytes: Buffer.from(item.icalendar, 'utf8').length 
      };
    },
    upsert: async (calendarId, raw, _item, options) =>
      target.upsertCalendarEvent(calendarId, raw as RawCalendarEvent, options),
    // Through the shared helper, not the bare UID: a recurring series and each
    // of its modified occurrences share a UID, so keying on it alone makes an
    // exception look like an item the target already has (see
    // `naturalKeyForCalendar`).
    naturalKey: (item) => naturalKeyForCalendar(item.item),
    // The CalDAV ETag, when the server sent one. Undefined keeps the old
    // skip-anything-seen behaviour rather than guessing at change.
    sourceVersion: (item) => item.item.etag,
    // The DAV href — exactly what an RFC 6578 `sync-collection` 404 reports,
    // and the only way back from a removal report to this item once its body
    // is gone.
    sourceRef: (item) => item.item.sourcePath,
    contentHash: (raw) => calendarContentHash((raw as RawCalendarEvent).icalendar),
    ensureCollection: (folder) => target.ensureCalendar(folder),
    ...(deps.onCollision ? { onCollision: deps.onCollision } : {}),
  });
}

/**
 * Dependencies for task (CalDAV, VTODO) sync.
 *
 * The SAME shape as a calendar's, and deliberately an alias rather than a copy:
 * on the wire a task IS a calendar object (RFC 4791), fetched from a CalDAV
 * collection and written by the CalDAV writer. What separates the two is the
 * component the source asks for and the natural key the ledger files it under,
 * and both of those are decided below rather than by the type.
 */
export type TaskSyncDeps = CalendarSyncDeps;

/**
 * Run CalDAV **task** sync using the generalized domain sync loop.
 *
 * ## Why this function did not exist for a whole workplan
 *
 * Workplan 0113 built the source (T3a/T3b), made the writer follow the
 * component it is given (T4), gave the ledger its own natural key (T2), and
 * added `task` to five separate lists (T5). Nothing tied them together. Both
 * dispatchers — `runOneDomain` in orchestration and `run-delta-sync`'s domain
 * loop — ended in a bare `else` that ran `runFileSync`, so a selected task
 * domain ran a FILE pass against FILE deps, copied nothing (the file pass is
 * idempotent), and was then marked COMPLETED.
 *
 * That is worse than an omission. An omission leaves a domain unsynced and
 * visibly so; this reported success for work it had not done, on a mapping
 * whose owner had ticked Tasks. Found on the owner's own Spark on 2026-09-03
 * by the managed smoke's task-lane assertion (0113 T7) — the only thing in the
 * system that asked the question — against a source holding two VTODOs and a
 * `scope_selection` row that said `task`.
 *
 * ## What makes it a task rather than a calendar
 *
 * Two things, and only two:
 *
 *  - the SOURCE, built with `component: 'VTODO'`, which is what makes the
 *    CalDAV `calendar-query` ask for to-dos and what makes discovery keep only
 *    collections whose `supported-calendar-component-set` declares them;
 *  - the NATURAL KEY, `naturalKeyForTask`, whose `todo:` prefix exists because
 *    a VTODO and a VEVENT may carry the same UID on one account. Keying tasks
 *    with `naturalKeyForCalendar` would make a to-do and an event collide in
 *    the ledger and each look, to the other, like an item already copied.
 *
 * Everything else — the fetch, the upsert, the content hash, the ETag, the
 * href — is the calendar pass, because on the wire there is no difference.
 *
 * Idempotent: running twice creates 0 items on the second run.
 * Non-destructive: never deletes or overwrites on the target.
 */
export async function runTaskSync(deps: TaskSyncDeps): Promise<DomainSyncResult> {
  const { tenantId, mappingId, source, target, ledger, cursors, concurrency } = deps;

  // Same contract as the calendar pass: the measurement provably precedes the
  // first write (workplan 0105 T0).
  await deps.recordTargetScheduling?.();

  return runDomainSync<CalendarSource, CalendarTargetWriter, RawCalendarEvent, CalendarFolder>({
    tenantId,
    mappingId,
    domain: 'task',
    source,
    target,
    ledger,
    cursors,
    concurrency,
    listFolders: () => source.listFolders(),
    listSince: (folder, cursor) => source.listSince(folder, cursor),
    fetchRaw: async (item) => {
      const raw = item.icalendar;
      return {
        raw: { item: item.item, icalendar: raw } as RawCalendarEvent,
        sizeBytes: Buffer.from(item.icalendar, 'utf8').length,
      };
    },
    upsert: async (calendarId, raw, _item, options) =>
      target.upsertCalendarEvent(calendarId, raw as RawCalendarEvent, options),
    // THE ONE LINE THAT IS NOT THE CALENDAR PASS. `naturalKeyForTask` carries
    // the `todo:` prefix and the same RECURRENCE-ID rule a calendar event has,
    // because RFC 5545 lets a VTODO recur too.
    naturalKey: (item) => naturalKeyForTask(item.item),
    sourceVersion: (item) => item.item.etag,
    sourceRef: (item) => item.item.sourcePath,
    contentHash: (raw) => calendarContentHash((raw as RawCalendarEvent).icalendar),
    ensureCollection: (folder) => target.ensureCalendar(folder),
    ...(deps.onCollision ? { onCollision: deps.onCollision } : {}),
  });
}

/**
 * Dependencies for contact (CardDAV) sync.
 */
export interface ContactSyncDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly source: ContactSource;
  readonly target: ContactTargetWriter;
  readonly ledger: Ledger;
  readonly cursors?: CursorStore;
  readonly concurrency?: number;
  /** What to do when the destination already holds the item; `'skip'` (adopt) by default. */
  readonly onCollision?: 'skip' | 'fail';
  /** Create every target directory under this folder — see `MappingConfig.targetFolderPrefix`. */
  readonly targetFolderPrefix?: string;
}

/**
 * Run CardDAV sync using the generalized domain sync loop.
 * 
 * Idempotent: running twice creates 0 items on the second run.
 * Non-destructive: never deletes or overwrites on the target.
 */
export async function runContactSync(deps: ContactSyncDeps): Promise<DomainSyncResult> {
  const { tenantId, mappingId, source, target, ledger, cursors, concurrency } = deps;

  return runDomainSync<ContactSource, ContactTargetWriter, RawContact, ContactFolder>({
    tenantId,
    mappingId,
    domain: 'contact',
    source,
    target,
    ledger,
    cursors,
    concurrency,
    listFolders: () => source.listFolders(),
    listSince: (folder, cursor) => source.listSince(folder, cursor),
    fetchRaw: async (item) => {
      const raw = item.vcard;
      return { 
        raw: { item: item.item, vcard: raw } as RawContact,
        sizeBytes: Buffer.from(raw, 'utf8').length 
      };
    },
    upsert: async (folderId, raw, _item, options) =>
      target.upsertContact(folderId, raw as RawContact, options),
    naturalKey: (item) => contactNaturalKeyHash(item.item.uid),
    sourceVersion: (item) => item.item.etag,
    // The DAV href, for the same reason as calendar above.
    sourceRef: (item) => item.item.sourcePath,
    contentHash: (raw) => contactContentHash((raw as RawContact).vcard),
    ensureCollection: (folder) => target.ensureContactFolder(folder),
    ...(deps.onCollision ? { onCollision: deps.onCollision } : {}),
  });
}

/**
 * Dependencies for file (WebDAV) sync.
 */
export interface FileSyncDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly source: FileSource;
  readonly target: FileTargetWriter;
  readonly ledger: Ledger;
  readonly cursors?: CursorStore;
  readonly concurrency?: number;
  /** What to do when the destination already holds the item; `'skip'` (adopt) by default. */
  readonly onCollision?: 'skip' | 'fail';
  /** Create every target directory under this folder — see `MappingConfig.targetFolderPrefix`. */
  readonly targetFolderPrefix?: string;
}

/**
 * Run WebDAV sync using the generalized domain sync loop.
 * 
 * Idempotent: running twice creates 0 items on the second run.
 * Non-destructive: never deletes or overwrites on the target.
 */
export async function runFileSync(deps: FileSyncDeps): Promise<DomainSyncResult> {
  const { tenantId, mappingId, source, target, ledger, cursors, concurrency } = deps;

  return runDomainSync<FileSource, FileTargetWriter, RawFileItem, FileFolder>({
    tenantId,
    mappingId,
    domain: 'file',
    source,
    target,
    ledger,
    cursors,
    concurrency,
    listFolders: () => source.listFolders(),
    listSince: (folder, cursor) => source.listSince(folder, cursor),
    // The download happens HERE, inside the loop's bounded concurrency —
    // not during listing.
    //
    // This used to read `item.content ?? new Uint8Array(0)`, which is two
    // defects in one expression. The listing's inline download made every
    // fetch serial and buffered a whole folder in memory. And the `??` meant
    // any source that did NOT inline content — the Graph drive source, whose
    // listSince explicitly sets `content: undefined` and says "use fetch()" —
    // had EVERY file written as ZERO BYTES, recorded in the ledger with the
    // hash of the empty string and reported as created. A silent empty copy of
    // someone's files is the worst failure this code can produce, and both
    // halves of verification would have agreed it was fine.
    fetchRaw: async (item) => {
      const content = item.content ?? (await source.fetch(item.item)).content;
      if (!content) {
        // A source that lists a file and then cannot produce its bytes is
        // broken; writing an empty file in its place is not a recovery.
        throw new Error(`File source returned no content for ${item.item.path}`);
      }
      return {
        raw: { item: item.item, content } as RawFileItem,
        // Prefer the bytes we actually hold over the listing's advertised size
        // — same reasoning as mail, where a missing `size` silently zeroed the
        // whole domain's byte total.
        sizeBytes: content.length || (item.item?.size ?? 0),
      };
    },
    upsert: async (parentId, raw, _item, options) =>
      target.upsertFile(parentId, raw as RawFileItem, options),
    naturalKey: (item) => fileNaturalKeyHash(item.item.path),
    // Only when the source can answer it cheaply. Without it the loop can spot
    // a moved file only on a cursor-less pass, which in production is the first
    // one and none after — a detector that cannot fire when it matters. Hashed
    // here so the loop compares like with like: `naturalKey` above hashes the
    // same `path` through the same function.
    ...(source.listKeys
      ? {
          listCollectionKeys: async (folder: FileFolder) =>
            (await source.listKeys!(folder)).map(fileNaturalKeyHash),
        }
      : {}),
    // What the owner threw away, when the source can tell us. Hashed here for the
    // same reason as `listCollectionKeys` above: the loop compares natural keys, so
    // both sides of every comparison go through this one function rather than two
    // that have to agree by coincidence.
    ...(source.listTrashedPaths
      ? {
          listDiscardedKeys: async () => {
            const listing = await source.listTrashedPaths!();
            return {
              keys: listing.paths.map(fileNaturalKeyHash),
              // Carried, not swallowed: entries the source could not NAME are
              // deletions whose evidence silently drops to `inferred`, which
              // costs the owner the apply action (`TrashListing`).
              unnameable: listing.unnameable,
              ...(listing.reason ? { reason: listing.reason } : {}),
            };
          },
        }
      : {}),
    sourceVersion: (item) => item.item.etag,
    // The SOURCE'S OWN handle for the file, which is not the same thing in every
    // file source — and that is the point.
    //
    // For WebDAV it is the server's href from the PROPFIND; for OneDrive it is the
    // Graph item id. The second is what makes Graph's delta deletions usable: a
    // deleted delta entry carries the id and no reliable path, so `sourceRef` is
    // the only way back from "item X is gone" to the row we wrote for it.
    //
    // This used to record `item.path`, which was the natural key over again —
    // true, but redundant, and useless as a removal anchor for the one source that
    // has removals. Falls back to the path for any source with no handle of its
    // own, so a blank is never recorded as if it meant something.
    sourceRef: (item) => item.item.sourceRef || item.item.path,
    contentHash: (raw) => fileContentHash((raw as RawFileItem).content ?? new Uint8Array(0)),
    ensureCollection: (folder) =>
      target.ensureDirectory(
        deps.targetFolderPrefix
          ? { ...folder, path: applyTargetFolderPrefix(deps.targetFolderPrefix, folder.path) }
          : folder,
      ),
    ...(deps.onCollision ? { onCollision: deps.onCollision } : {}),
    // A snapshot's absences are evidence of nothing (0116 §5) — the source
    // says so about itself, and the loop turns its absence-counting off.
    ...(source.snapshot ? { snapshot: true } : {}),
  });
}
