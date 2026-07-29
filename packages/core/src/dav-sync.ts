// Copyright 2026 OpenHands Agent (Apache-2.0)
/**
 * DAV domain sync wrappers - thin wrappers around runDomainSync for CalDAV, CardDAV, and WebDAV.
 * 
 * Each wrapper operates on REAL domain-typed sources/targets, not generic types.
 * The abstraction is at the function level, parameterizing the loop with domain-specific injections.
 */

import {
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
  calendarNaturalKeyHash,
  calendarContentHash,
  contactNaturalKeyHash,
  contactContentHash,
  fileNaturalKeyHash,
  fileContentHash,
} from '@openmig/shared';
import { runDomainSync, type DomainSyncResult } from './domain-sync';

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
}

/**
 * Run CalDAV sync using the generalized domain sync loop.
 * 
 * Idempotent: running twice creates 0 items on the second run.
 * Non-destructive: never deletes or overwrites on the target.
 */
export async function runCalendarSync(deps: CalendarSyncDeps): Promise<DomainSyncResult> {
  const { tenantId, mappingId, source, target, ledger, cursors, concurrency } = deps;

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
    naturalKey: (item) => calendarNaturalKeyHash(item.item.uid),
    // The CalDAV ETag, when the server sent one. Undefined keeps the old
    // skip-anything-seen behaviour rather than guessing at change.
    sourceVersion: (item) => item.item.etag,
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
    sourceVersion: (item) => item.item.etag,
    contentHash: (raw) => fileContentHash((raw as RawFileItem).content ?? new Uint8Array(0)),
    ensureCollection: (folder) => target.ensureDirectory(folder),
    ...(deps.onCollision ? { onCollision: deps.onCollision } : {}),
  });
}
