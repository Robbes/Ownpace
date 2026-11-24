// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LAST 90 DAYS FIRST (workplan 0170 §3).
 *
 * Every first copy of mail, files and calendars runs in two phases: a pass
 * that lists only what falls in a window of the last 90 days (phase A), then
 * the ordinary first pass (phase B), which the ledger's read-ahead makes cost
 * a listing plus the older items. A migration can also be set to the window
 * alone (`recentOnly`), for a person trying a destination with their fresh
 * data; it can be broadened to everything later, never narrowed (§5.3).
 *
 * This file is the vocabulary both editions and every source share: the
 * window's length, which data types have one, where its record lives in the
 * `cursor` table, and the three predicates the sync loop asks of each listed
 * item. Every predicate answers `true` when it cannot decide: an item kept
 * that could have been left out costs a copy a little early; an item left out
 * that belonged in the window is the one mistake a window must not make.
 */

import type { DiscoveryDomain } from './discovery.ts';
import type { MailItem } from './mail.ts';
import type { FileItem } from './file.ts';
import type { RawCalendarEvent } from './calendar.ts';
import { componentsNamed, declaredZones, latestEnd, parseIcalComponents } from './ical-occurrences.ts';
import type { CursorStore } from './ports.ts';
import type { MappingId, TenantId } from './ids.ts';

/** How many days a window holds. */
export const RECENT_WINDOW_DAYS = 90;

/**
 * The data types a window applies to. Contacts and tasks are copied whole in
 * every pass: they are small, and a person needs them whole (§3.1).
 */
export const WINDOWED_DOMAINS = ['email', 'file', 'calendar'] as const satisfies readonly DiscoveryDomain[];

export type WindowedDomain = (typeof WINDOWED_DOMAINS)[number];

/** Whether a data type has a window. */
export function isWindowedDomain(domain: DiscoveryDomain): domain is WindowedDomain {
  return (WINDOWED_DOMAINS as ReadonlyArray<DiscoveryDomain>).includes(domain);
}

/**
 * The start of the UTC day `days` before `anchor`.
 *
 * A day boundary rather than the anchor's own time, so two passes on the same
 * day ask a source the same question, and a server that filters by day (IMAP
 * `SINCE`) answers it exactly.
 */
export function windowSince(anchor: Date, days: number = RECENT_WINDOW_DAYS): Date {
  if (!Number.isFinite(anchor.getTime())) throw new RangeError('windowSince: the anchor is not a date');
  if (!Number.isInteger(days) || days < 1) throw new RangeError(`windowSince: ${days} is not a number of days`);
  return new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - days),
  );
}

/** An ISO date as milliseconds, or `undefined` when it does not parse. */
function instant(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** A message is in the window when it was received on or after `since`. No date: in. */
export function mailInWindow(item: MailItem, since: Date): boolean {
  const received = instant(item.receivedAt);
  return received === undefined || received >= since.getTime();
}

/**
 * A file is in the window when it was modified on or after `since`.
 *
 * In with no date, which an export archive's item without a sidecar date
 * presents as the epoch (D6, *"one uploads all"*), and a directory always is:
 * it is where the window's files go, not an item of its own age.
 */
export function fileInWindow(item: FileItem, since: Date): boolean {
  if (item.isDirectory) return true;
  const modified = instant(item.modifiedAt);
  if (modified === undefined || modified <= 0) return true;
  return modified >= since.getTime();
}

/**
 * An event is in the window when it ends on or after `since`, and a recurring
 * series when any of its occurrences does, whole, with every override it
 * carries (D1 (a)). Decided from the iCalendar object alone, by
 * `latestEnd` (`ical-occurrences.ts`, workplan 0170 §4.3): out only when the
 * latest moment any occurrence can end is before `since`.
 *
 * In, whatever its dates:
 *
 *  - a task or a journal entry (never windowed: their data type is `task`);
 *  - an object with no VEVENT, or one this cannot read;
 *  - an object whose every VEVENT is an override (RECURRENCE-ID) with no
 *    series beside it, as Graph lists an exception apart from its series:
 *    the series' other occurrences are not here to read;
 *  - a VEVENT with no DTSTART this can parse, an RRULE whose last occurrence
 *    this cannot bound (a COUNT over BY-parts), or an RDATE it cannot read.
 *
 * An object with several VEVENTs (a series and its overrides) is in when any
 * of them is: an override moved into the window brings its series with it.
 */
export function eventInWindow(raw: RawCalendarEvent, since: Date): boolean {
  if (raw.item.type !== 'event') return true;
  const roots = parseIcalComponents(raw.icalendar);
  const events = componentsNamed(roots, 'VEVENT');
  if (events.length === 0) return true;
  if (events.every((e) => e.properties.some((p) => p.name === 'RECURRENCE-ID'))) return true;
  const zones = declaredZones(roots);
  return events.some((e) => {
    const end = latestEnd(e, zones);
    return end === undefined || end >= since.getTime();
  });
}

/**
 * A pass's window, as the orchestration hands it to a data type's pass
 * (`runShadowPass`, `runCalendarSync`, `runFileSync`), which adds the
 * predicate for its own items. Absent, the pass reads the whole source.
 */
export interface PassWindow {
  readonly since: Date;
  /** A 90-day migration's pass, rather than phase A of a migration of everything. */
  readonly only: boolean;
}

// ---------------------------------------------------------------------------
// The window record, in the `cursor` table (§3.3)
// ---------------------------------------------------------------------------

/**
 * Where a data type's window is recorded: its `since`, and whether phase A is
 * done. Built with U+0001 as `discardedScanCursorKey` is, so no real
 * collection path can produce it.
 */
export function windowRecordKey(domain: DiscoveryDomain): string {
  return `\u0001window-record\u0001${domain}`;
}

/**
 * A 90-day migration's own cursor for a collection, apart from its content
 * cursor. A cursor stored after a window listing (IMAP's `uidNext` after
 * `SEARCH SINCE`) would tell a later full pass that every older item had been
 * seen; kept here, *Copy everything* finds no content cursor and lists whole.
 */
export function windowCursorKey(collectionPath: string): string {
  return `\u0001window\u0001${collectionPath}`;
}

/** The record's value, JSON in `SyncCursor.value`. */
export interface WindowRecord {
  /** ISO 8601, UTC midnight. */
  readonly since: string;
  /** `in` once phase A reached the end of every collection. */
  readonly state: 'copying' | 'in';
}

/** A stored record, or `undefined` when it is missing or does not read as one. */
export function parseWindowRecord(value: string | undefined): WindowRecord | undefined {
  if (value === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    // Cursors are non-authoritative (ADR-0020): an unreadable record means
    // phase A runs again, which copies nothing the ledger already holds.
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const { since, state } = data as Record<string, unknown>;
  if (typeof since !== 'string' || instant(since) === undefined) return undefined;
  if (state !== 'copying' && state !== 'in') return undefined;
  return { since, state };
}

/** A record as `SyncCursor.value` stores it. */
export function formatWindowRecord(record: WindowRecord): string {
  return JSON.stringify({ since: record.since, state: record.state });
}

// ---------------------------------------------------------------------------
// The contract (§5)
// ---------------------------------------------------------------------------

/**
 * A 90-day migration's setting, as `mailbox_mapping.source_config_override`
 * stores it under `recentOnly` and `MappingConfig.recentOnly` carries it.
 *
 * `anchor` is the moment the migration was created, so its window grows with
 * time and never slides. Absent only in an appliance's mapping file before
 * the appliance first records the mapping and writes it (§5.4); the engine
 * never runs a window without one.
 */
export interface RecentOnlySetting {
  readonly days: number;
  readonly anchor?: string;
}

/** The key the setting is stored under, in the override and in a mapping file. */
export const RECENT_ONLY_FIELD = 'recentOnly';

/**
 * The read of a migration's window (`window` on `GET /api/migrations/:id`),
 * from the window records, so a page can show the milestone without a table.
 */
export interface MigrationWindowView {
  /** A 90-day migration, not yet broadened. */
  readonly recentOnly: boolean;
  /** The window's start, or `null` while no windowed pass has begun. */
  readonly since: string | null;
  /** The windowed data types whose phase A is done. */
  readonly in: ReadonlyArray<WindowedDomain>;
  /** The windowed data types whose phase A has started and is not done. */
  readonly copying: ReadonlyArray<WindowedDomain>;
}

/**
 * A migration's window as its read says it (§5.2), from the records in its
 * cursor store. `since` is the 90-day setting's own when it has one, and
 * otherwise the earliest record's, which is the anchor phase A recorded (D7).
 */
export async function readWindowView(
  cursors: Pick<CursorStore, 'get'>,
  tenantId: TenantId,
  mappingId: MappingId,
  recentOnly: RecentOnlySetting | undefined,
): Promise<MigrationWindowView> {
  const isIn: WindowedDomain[] = [];
  const copying: WindowedDomain[] = [];
  let since: string | null =
    recentOnly?.anchor !== undefined ? windowSince(new Date(recentOnly.anchor), recentOnly.days).toISOString() : null;
  for (const domain of WINDOWED_DOMAINS) {
    const record = parseWindowRecord((await cursors.get(tenantId, mappingId, windowRecordKey(domain)))?.value);
    if (!record) continue;
    (record.state === 'in' ? isIn : copying).push(domain);
    if (recentOnly === undefined && (since === null || record.since < since)) since = record.since;
  }
  return { recentOnly: recentOnly !== undefined, since, in: isIn, copying };
}
