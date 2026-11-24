// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MARKED ONLY: a test migration's source, which lists only what its marker
 * selects (workplan 0162 T2; the owner's decisions of 2026-11-20, §2).
 *
 * A test organisation copies a few items made for the test out of a real
 * account, chosen by a marker in their own titles, `[Ownpace-test]` by
 * default. One wrapper per source port does it, applied where a mapping's
 * source is built, as `GmailFolderView` is, whenever the mapping carries a
 * marker (`mailbox_mapping.test_marker`, ledger migration 0070). So
 * discovery, every pass and its bin scan, and the apply jobs all see the same
 * marked set (§2 (d)), and nothing unmarked reaches the ledger or the target.
 *
 * ## What decides (§2 (a))
 *
 * The marker anywhere in the item's OWN title, ignoring case, and nothing
 * else: not the folder, the label, the sender or the guests. So
 * `Re: [Ownpace-test] …` stays in.
 *
 *  - mail: the Subject the listing read from the envelope (`MailItem.subject`);
 *  - events and tasks: the SUMMARY. A recurring series is decided by its
 *    master's SUMMARY and its overrides follow it (`calendarTitles`);
 *  - contacts: the FN;
 *  - files: the file's own name.
 *
 * ## What it changes in a listing, and what it leaves alone
 *
 * `items` loses what is not marked, and `unmarked` hands back what it set
 * aside, for two questions the loop asks and nothing else: whether there was
 * any, so a first read the marker emptied still stores its cursor
 * (`firstReadSawNothing`); and their keys, so an item still at the source is
 * never resolved as deleted because the collection it left reported it
 * removed, or its bin holds its key (§2 (f)). Nothing about them is stored.
 * Everything else a listing carries passes through as it came: `removed`
 * above all, unfiltered, because a removal names no title and the loop already
 * skips a key the ledger never copied (`resolveReportedRemovals`, `if (!row)
 * continue;`). Mail's `unkeyable` is counted again over what is kept, since it
 * promises a copy; a count of what the source could not list or read
 * (`unlisted`, `unreadable`) names no title and is carried as it was.
 *
 * `markedOnly` on the wrapper is how the loop knows (`SourceConnector.
 * markedOnly`): it then makes a collection at its first marked item rather
 * than on first sight, and for files it counts no unexplained absence.
 *
 * ## Every optional method a caller asks for by name is forwarded
 *
 * Present on the wrapper exactly when the inner source has it, because callers
 * test for presence (`source.listKeys ?`, `typeof x.nativeRefusals ===
 * 'function'`, `offers(source, 'measureMailbox')`), and a method present on a
 * wrapper with nothing behind it fails inside a pass. `GmailFolderView` lost
 * `measureMailbox` this way once. The forwarded measures (`measureMailbox`,
 * `countMessages`, `storageUsage`, `nativeRefusals`) count the account, not
 * the marked set: none of them is computed from titles, and no screen reads
 * them through a mapping's source today.
 *
 * Files' `listKeys` stays the INNER, unfiltered listing: every path the folder
 * holds, so a marked file still in place is seen, and one moved away or
 * deleted is not. The bin (`listTrashedPaths`) is filtered by name like a
 * listing, because the bin scan sees the marked set too (§2 (d)).
 *
 * ## Sharing, by the same rule
 *
 * The sharing rescan and the permission report read an account's sharing
 * through the scans, not through these wrappers, so `markedSharesOnly` holds
 * them to the same rule: a grant is kept when the thing it is on carries the
 * marker in its own name, and a grant the scans could not name refuses the
 * listing (workplan 0162, the first thing T1 settles).
 *
 * ## What it reads (§7)
 *
 * Only titles the listings already return. It keeps none that is unmarked:
 * nothing here stores, logs or writes one, and the loop reads what it hands
 * back as `unmarked` for their keys, holds those for the pass, and writes
 * none of them anywhere.
 */

import type {
  CalendarFolder,
  CalendarSource,
  ContactFolder,
  ContactSource,
  FileFolder,
  FileItem,
  FileSource,
  ListOptions,
  MailFolder,
  MailItem,
  PermissionListing,
  RawCalendarEvent,
  RawContact,
  RawFileItem,
  RawMessage,
  SourceConnector,
  SyncCursor,
  TrashListing,
} from '@openmig/shared';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** One reading of text for comparison: composed, then Unicode's lower case. */
const folded = (text: string): string => text.normalize('NFC').toLowerCase();

/**
 * Does this title carry the marker? Anywhere in it, ignoring case (§2 (a)).
 * No title is no marker.
 */
export function carriesMarker(title: string | undefined, marker: string): boolean {
  if (title === undefined || title === '') return false;
  return folded(title).includes(folded(marker));
}

/**
 * Refused rather than used: a marker the database would not have stored can
 * only arrive by a defect, and a blank one would match nearly every title.
 */
function assertUsableMarker(marker: string): string {
  if (marker.trim().length < 3) {
    throw new Error(
      'A test migration was handed a marker of fewer than three characters, which would select ' +
        'nearly every item. Nothing is listed until the migration carries a real marker ' +
        '(workplan 0162).',
    );
  }
  return marker;
}

// ---------------------------------------------------------------------------
// Titles, read from what the listings already carry
// ---------------------------------------------------------------------------

/** RFC 5545 §3.1 and RFC 6350 §3.2: a line break and one space or tab are removed. */
function unfoldedLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

/** The text escapes both formats share: `\n`, `\,`, `\;`, `\\`. */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

/**
 * One content line's name and value: `SUMMARY;LANGUAGE=en:[Ownpace-test] Plan`
 * is `SUMMARY` and `[Ownpace-test] Plan`. The value starts at the first colon
 * outside a quoted parameter, and a vCard group (`item1.FN`) is not the name.
 */
function contentLine(line: string): { name: string; value: string } | undefined {
  let quoted = false;
  let nameEnd = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && nameEnd === -1 && ch === ';') nameEnd = i;
    else if (!quoted && ch === ':') {
      const name = line.slice(0, nameEnd === -1 ? i : nameEnd).trim();
      const bare = name.slice(name.lastIndexOf('.') + 1).toUpperCase();
      return bare === '' ? undefined : { name: bare, value: line.slice(i + 1) };
    }
  }
  return undefined;
}

/** The iCalendar components that are items of their own. */
const ITEM_COMPONENTS = new Set(['VEVENT', 'VTODO', 'VJOURNAL']);

/** One item component of a calendar object: its RECURRENCE-ID, if any, and its SUMMARY. */
interface ItemComponent {
  readonly overrides: boolean;
  readonly summary?: string;
}

/**
 * The item components of one calendar object, in order, each with whether it
 * is an override (it carries a RECURRENCE-ID) and its SUMMARY. A VALARM's own
 * SUMMARY, an email alarm's subject, is not the event's and is not read.
 */
function itemComponents(icalendar: string): ItemComponent[] {
  const out: ItemComponent[] = [];
  const open: string[] = [];
  let current: { name: string; overrides: boolean; summary?: string } | undefined;
  for (const line of unfoldedLines(icalendar)) {
    const property = contentLine(line);
    if (!property) continue;
    const value = property.value.trim().toUpperCase();
    if (property.name === 'BEGIN') {
      open.push(value);
      if (current === undefined && ITEM_COMPONENTS.has(value)) current = { name: value, overrides: false };
      continue;
    }
    if (property.name === 'END') {
      open.pop();
      if (current !== undefined && value === current.name && !open.includes(current.name)) {
        out.push(current);
        current = undefined;
      }
      continue;
    }
    // Only the item's own properties: not a VALARM's inside it.
    if (current === undefined || open[open.length - 1] !== current.name) continue;
    if (property.name === 'RECURRENCE-ID') current.overrides = true;
    else if (property.name === 'SUMMARY' && current.summary === undefined) {
      current.summary = unescapeText(property.value);
    }
  }
  return out;
}

/**
 * Each listed event's or task's title, by the series rule (§2 (a)): a series
 * is decided by its master's SUMMARY, and its overrides follow it.
 *
 * - A CalDAV object carries a series whole, its master and every override in
 *   one object (Google's does), so its title is its master's SUMMARY wherever
 *   the master stands in the text.
 * - Microsoft's calendar lists an exception as an item of its own. It takes
 *   its series' title when its series is in the same listing.
 * - An override listed without its series (an exception that changed alone,
 *   or an invitation to one occurrence, whose series this account does not
 *   hold) has no master to read, and is decided by its own SUMMARY.
 *
 * Where the text holds no item component at all, the source's own reading
 * stands (`summary`, `recurrenceId`).
 */
export function calendarTitles(items: ReadonlyArray<RawCalendarEvent>): Array<string | undefined> {
  const seriesTitle = new Map<string, string | undefined>();
  const read = items.map((raw) => {
    const components = itemComponents(raw.icalendar || raw.item.icalendar || '');
    const uid = raw.item.uid.toLowerCase();
    const master = components.find((c) => !c.overrides);
    if (master) {
      seriesTitle.set(uid, master.summary);
      return { uid, title: master.summary, follows: false };
    }
    if (components.length > 0) return { uid, title: components[0]!.summary, follows: true };
    // Nothing parsed: the source's own fields, as it read them.
    if (raw.item.recurrenceId === undefined) {
      seriesTitle.set(uid, raw.item.summary);
      return { uid, title: raw.item.summary, follows: false };
    }
    return { uid, title: raw.item.summary, follows: true };
  });
  return read.map((r) => (r.follows && seriesTitle.has(r.uid) ? seriesTitle.get(r.uid) : r.title));
}

/** A card's FN, read from its own vCard; the source's `name` where the card has none. */
export function contactTitle(raw: RawContact): string | undefined {
  for (const line of unfoldedLines(raw.vcard || raw.item.vcard || '')) {
    const property = contentLine(line);
    if (property?.name === 'FN') return unescapeText(property.value);
  }
  return raw.item.name;
}

/** A path's last segment: the name a file or a folder was given. */
function lastSegment(path: string): string {
  const segments = path.split('/').filter((s) => s !== '');
  return segments[segments.length - 1] ?? '';
}

/** A file's own name: never the folders it sits in (§2 (a), open question 2). */
export function fileTitle(item: FileItem): string {
  return item.name || lastSegment(item.path);
}

// ---------------------------------------------------------------------------
// Forwarding what a caller asks for by name
// ---------------------------------------------------------------------------

/**
 * Put each named method of `inner` on `wrapper`, and only those `inner` has.
 * Bound to `inner`, so a class's prototype method keeps its `this`.
 */
function forwardWhereOffered(wrapper: object, inner: object, names: ReadonlyArray<string>): void {
  for (const name of names) {
    const method = (inner as Record<string, unknown>)[name];
    if (typeof method !== 'function') continue;
    Object.defineProperty(wrapper, name, {
      value: (...args: unknown[]) => (method as (...a: unknown[]) => unknown).apply(inner, args),
      enumerable: true,
    });
  }
}

/** Mail's measures, asked for by name (`account-qualification`, `microsoft-account-test`). */
const MAIL_MEASURES = ['measureMailbox', 'countMessages'] as const;
/** Files' measures and listings asked for by name, forwarded as they are. */
const FILE_EXTRAS = ['nativeRefusals', 'storageUsage', 'listTopLevelFolders'] as const;

/**
 * A listing's items split by the marker: those it keeps, and those it sets
 * aside, after any an inner wrapper already set aside. The second are handed
 * back as `unmarked`, and only when there are some.
 */
function byMarker<T>(
  listed: ReadonlyArray<T>,
  carries: (item: T, n: number) => boolean,
  already: ReadonlyArray<T> | undefined,
): { items: T[]; unmarked?: ReadonlyArray<T> } {
  const items: T[] = [];
  const unmarked: T[] = [...(already ?? [])];
  listed.forEach((item, n) => (carries(item, n) ? items : unmarked).push(item));
  return unmarked.length > 0 ? { items, unmarked } : { items };
}

// ---------------------------------------------------------------------------
// The four wrappers
// ---------------------------------------------------------------------------

/** Mail, by the Subject the listing read from the envelope. */
export class MarkedOnlyMail implements SourceConnector {
  readonly markedOnly = true as const;
  readonly marker: string;
  private readonly inner: SourceConnector;
  declare readonly measureMailbox?: (options?: { readonly sampleSize?: number }) => Promise<unknown>;
  declare readonly countMessages?: () => Promise<unknown>;
  /**
   * Gmail's labels are several places at once under a marker too. Its count
   * of every message (`countEveryMessage`) is NOT forwarded: a test copies
   * only what is marked, so the account's whole count is no measure of it.
   */
  readonly severalPlacesAtOnce?: true;

  constructor(inner: SourceConnector, marker: string) {
    this.inner = inner;
    this.marker = assertUsableMarker(marker);
    forwardWhereOffered(this, inner, MAIL_MEASURES);
    if (inner.severalPlacesAtOnce) this.severalPlacesAtOnce = true;
  }

  listFolders(): Promise<ReadonlyArray<MailFolder>> {
    return this.inner.listFolders();
  }

  async listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
    options?: ListOptions,
  ): ReturnType<SourceConnector['listSince']> {
    // The window's `since` passes through (workplan 0170 §3.5): the marker
    // selects from whatever the inner source lists.
    const listed = await this.inner.listSince(folder, cursor, options);
    const { items: _all, unkeyable: _counted, unmarked, ...rest } = listed;
    const split = byMarker(listed.items, (item) => carriesMarker(item.subject, this.marker), unmarked);
    // Promised a copy under a generated id: only what is kept will get one.
    const unkeyable = split.items.filter((item) => !item.messageId).length;
    return { ...rest, ...split, ...(unkeyable > 0 ? { unkeyable } : {}) };
  }

  fetch(item: MailItem): Promise<RawMessage> {
    return this.inner.fetch(item);
  }
}

/** Events and tasks, by the SUMMARY, a series by its master's. */
export class MarkedOnlyCalendar implements CalendarSource {
  readonly markedOnly = true as const;
  readonly marker: string;
  private readonly inner: CalendarSource;

  constructor(inner: CalendarSource, marker: string) {
    this.inner = inner;
    this.marker = assertUsableMarker(marker);
  }

  listFolders(): Promise<ReadonlyArray<CalendarFolder>> {
    return this.inner.listFolders();
  }

  async listSince(
    folder: CalendarFolder,
    cursor?: SyncCursor,
    options?: ListOptions,
  ): ReturnType<CalendarSource['listSince']> {
    // The window's `since` passes through (workplan 0170 §3.5): the marker
    // selects from whatever the inner source lists.
    const listed = await this.inner.listSince(folder, cursor, options);
    const titles = calendarTitles(listed.items);
    const { items: _all, unmarked, ...rest } = listed;
    return { ...rest, ...byMarker(listed.items, (_item, n) => carriesMarker(titles[n], this.marker), unmarked) };
  }
}

/** Contacts, by the FN. */
export class MarkedOnlyContacts implements ContactSource {
  readonly markedOnly = true as const;
  readonly marker: string;
  private readonly inner: ContactSource;
  declare readonly fetch?: (item: RawContact) => Promise<RawContact>;

  constructor(inner: ContactSource, marker: string) {
    this.inner = inner;
    this.marker = assertUsableMarker(marker);
    // Optional on the port, and the loop asks for it by presence
    // (`source.fetch ? …`): a source whose listing carries the whole card has
    // none, and must not be given one.
    forwardWhereOffered(this, inner, ['fetch']);
  }

  listFolders(): Promise<ReadonlyArray<ContactFolder>> {
    return this.inner.listFolders();
  }

  async listSince(folder: ContactFolder, cursor?: SyncCursor): ReturnType<ContactSource['listSince']> {
    const listed = await this.inner.listSince(folder, cursor);
    const { items: _all, unmarked, ...rest } = listed;
    return { ...rest, ...byMarker(listed.items, (item) => carriesMarker(contactTitle(item), this.marker), unmarked) };
  }
}

/** Files, by their own name. */
export class MarkedOnlyFiles implements FileSource {
  readonly markedOnly = true as const;
  readonly marker: string;
  private readonly inner: FileSource;
  declare readonly snapshot?: true;
  declare readonly listKeys?: (folder: FileFolder) => Promise<ReadonlyArray<string>>;
  declare readonly listTrashedPaths?: () => Promise<TrashListing>;
  declare readonly nativeRefusals?: () => Readonly<Record<string, number>>;
  declare readonly storageUsage?: () => Promise<unknown>;
  declare readonly listTopLevelFolders?: () => Promise<unknown>;

  constructor(inner: FileSource, marker: string) {
    this.inner = inner;
    this.marker = assertUsableMarker(marker);
    // An archive's listing is a snapshot whatever selects from it (0116 §5).
    if (inner.snapshot) Object.defineProperty(this, 'snapshot', { value: true, enumerable: true });
    // UNFILTERED: every path the folder holds, as the inner source lists it.
    forwardWhereOffered(this, inner, ['listKeys', ...FILE_EXTRAS]);
    if (typeof inner.listTrashedPaths === 'function') {
      const binOf = inner.listTrashedPaths.bind(inner);
      Object.defineProperty(this, 'listTrashedPaths', {
        value: async (): Promise<TrashListing> => {
          const bin = await binOf();
          // Entries it could not name, and why, are carried as they came.
          return { ...bin, paths: bin.paths.filter((path) => carriesMarker(lastSegment(path), this.marker)) };
        },
        enumerable: true,
      });
    }
  }

  listFolders(): Promise<ReadonlyArray<FileFolder>> {
    return this.inner.listFolders();
  }

  async listSince(
    folder: FileFolder,
    cursor?: SyncCursor,
    options?: ListOptions,
  ): ReturnType<FileSource['listSince']> {
    // The window's `since` passes through (workplan 0170 §3.5): the marker
    // selects from whatever the inner source lists.
    const listed = await this.inner.listSince(folder, cursor, options);
    const { items: _all, unmarked, ...rest } = listed;
    return {
      ...rest,
      ...byMarker(listed.items, (raw: RawFileItem) => carriesMarker(fileTitle(raw.item), this.marker), unmarked),
    };
  }

  fetch(item: FileItem): Promise<RawFileItem> {
    return this.inner.fetch(item);
  }
}

// ---------------------------------------------------------------------------
// What the builders call: the source as it is, or wrapped when marked
// ---------------------------------------------------------------------------

/** A mapping's mail source, wrapped when the mapping carries a marker. */
export function markedOnlyMail(source: SourceConnector, marker: string | null | undefined): SourceConnector {
  return marker === null || marker === undefined ? source : new MarkedOnlyMail(source, marker);
}

/** A mapping's calendar or task source, wrapped when the mapping carries a marker. */
export function markedOnlyCalendar(source: CalendarSource, marker: string | null | undefined): CalendarSource {
  return marker === null || marker === undefined ? source : new MarkedOnlyCalendar(source, marker);
}

/** A mapping's contact source, wrapped when the mapping carries a marker. */
export function markedOnlyContacts(source: ContactSource, marker: string | null | undefined): ContactSource {
  return marker === null || marker === undefined ? source : new MarkedOnlyContacts(source, marker);
}

/** A mapping's file source, wrapped when the mapping carries a marker. */
export function markedOnlyFiles(source: FileSource, marker: string | null | undefined): FileSource {
  return marker === null || marker === undefined ? source : new MarkedOnlyFiles(source, marker);
}

// ---------------------------------------------------------------------------
// Sharing: the grants on what the marker selects (workplan 0162, T1's first)
// ---------------------------------------------------------------------------

/**
 * What a test migration's sharing keeps: the listing, with only the grants on
 * marked things, or the number of grants it could not tie to a name at all.
 */
export type MarkedShares =
  | { readonly listing: PermissionListing }
  | { readonly untied: number };

/**
 * A TEST MIGRATION'S SHARING, by the rule its listings keep (§2 (a)).
 *
 * The sharing rescan and the permission report read an account's sharing
 * whole, as the scans read it (`listOwnedShareGrants`, `scanNextcloudShares`,
 * Graph's two), and neither reads through the wrappers above. Under a marker
 * nothing about an unmarked item is stored or reported, as nothing about one
 * is written by a pass. So a grant is kept when the thing it is on carries
 * the marker in its own name, by `carriesMarker`: a file's or a folder's name,
 * a calendar's, never the path or the address around it. The thing's own
 * name decides, as a file's own name decides whether it is copied: a grant
 * on a marked folder is kept, and one on an unmarked folder is not, whatever
 * it holds.
 *
 * The scans say the name as `ownName`. A grant without one cannot be tied to
 * anything the marker selects, so it can be neither kept nor set aside, and
 * the whole listing answers `untied` for the caller to refuse. A listing that
 * read nothing (`not_discoverable`) names no item and passes as it came.
 */
export function markedSharesOnly(listing: PermissionListing, marker: string): MarkedShares {
  const usable = assertUsableMarker(marker);
  if (listing.kind !== 'listed') return { listing };
  const untied = listing.grants.filter((g) => g.ownName === undefined || g.ownName === '').length;
  if (untied > 0) return { untied };
  return {
    listing: { kind: 'listed', grants: listing.grants.filter((g) => carriesMarker(g.ownName, usable)) },
  };
}

/** Is this source a test migration's marked one? The guard's question. */
export function isMarkedOnly(source: unknown): source is { readonly markedOnly: true; readonly marker: string } {
  return (
    source instanceof MarkedOnlyMail ||
    source instanceof MarkedOnlyCalendar ||
    source instanceof MarkedOnlyContacts ||
    source instanceof MarkedOnlyFiles
  );
}
