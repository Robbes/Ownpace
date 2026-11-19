// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CalDAV Target Writer Implementation
 * 
 * Implements CalendarTargetWriter interface for CalDAV calendar synchronization.
 * Uses vdirsyncer for bulk operations and direct JMAP/CalDAV API calls for individual operations.
 * Follows the idempotency pattern with ledger fast-path and target-side existence checks.
 */

import type {
  CalendarTargetWriter,
  CalendarFolder,
  RawCalendarEvent,
  UpsertResult,
  UpsertOptions,
  Ledger,
  TenantId,
  MappingId,
  TargetReindexer,
  TargetEntry,
  RemovalResult,
  DiscoveryDomain,
  CalendarEvent,
} from '@openmig/shared';
import {
  naturalKeyForCalendar,
  naturalKeyForTask,
  naturalKeyTextForCalendar,
  naturalKeyTextForTask,
  calendarContentHash,
  displayNameForCalendar,
  isOnTarget,
  neutraliseScheduling,
  namesGuests,
  withoutGuests,
} from '@openmig/shared';
import { createHash } from 'node:crypto';
import { CALENDAR_COMPONENTS, collectionCarries, componentOfIcalendar } from '@openmig/shared';
import { davRefusalBody, withFailureCategory } from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import { payloadDefectNote } from './dav-payload-defects.ts';
import type { CalendarComponent } from '@openmig/shared';
import { collectionSlug } from './dav-collection-path.ts';
import { refusalSaysUidAlreadyPresent } from './dav-uid-conflict.ts';
import {
  findHrefByUid,
  parseMultiStatus,
  firstElementText,
  hasResourceType,
  extractUid,
  hrefRelativeTo,
  targetIdRelativeTo,
  unescapeXml,
  sizeOf,
} from './dav-multistatus.ts';
import { requestWithDavRetry } from './dav-retry.ts';
import { NOT_THIS_PLACE, isNamed, discoverHomeSet, type CollectionAt } from './dav-home-set.ts';
import { readEtag, readVersion, ownershipOf, ifMatchFor } from './dav-target-version.ts';
import { removeDavResource, assertRemovableTargetId } from './dav-remove.ts';
import { log } from '@openmig/shared';

/**
 * Configuration for CalDAV target writer
 */
export interface CalDAVTargetConfig {
  /** CalDAV endpoint URL */
  url: string;
  /** Authentication username */
  username: string;
  /** Authentication password or token */
  password: string;
  /** Calendar home set path */
  homeSet?: string;
  /** Default calendar color */
  color?: string;
  /** Default calendar description */
  description?: string;
  /**
   * The target mails every guest of what it is handed, whatever
   * `SCHEDULE-AGENT` says (`TARGETS_THAT_MAIL_GUESTS`, workplan 0160): write
   * each object without ATTENDEE and ORGANIZER (`withoutGuests`), so there is
   * nobody to mail. Set from the target's kind by the deps builders.
   */
  mailsGuests?: boolean;
}

/**
 * The two domains a CalDAV writer can be filing for.
 *
 * Narrower than `DiscoveryDomain` on purpose: this writer speaks CalDAV, so
 * `email`, `contact` and `file` are not answers it could ever want, and a
 * union that admitted them would let a caller hand one over by mistake.
 */
export type CalDavLedgerDomain = Extract<DiscoveryDomain, 'calendar' | 'task'>;

/** One calendar a server listed: where it is, what it calls itself, and what it says it holds. */
interface CalendarAt extends CollectionAt {
  /** Absent when it declares no `supported-calendar-component-set`, and then it holds every kind. */
  readonly components?: ReadonlyArray<CalendarComponent>;
}

/**
 * What a `supported-calendar-component-set` in this XML declares, or
 * undefined when it declares nothing this product knows. Undeclared means
 * the collection holds every kind (RFC 4791 §5.2.3; see `collectionCarries`).
 */
function componentsDeclaredIn(xml: string): ReadonlyArray<CalendarComponent> | undefined {
  const set = firstElementText(xml, 'supported-calendar-component-set');
  if (!set) return undefined;
  const known = new Set<string>(CALENDAR_COMPONENTS);
  const components = [...set.matchAll(/<(?:[A-Za-z0-9._-]+:)?comp\s[^>]*name=["']([^"']+)["']/gi)]
    .map((m) => m[1]!.toUpperCase())
    .filter((name) => known.has(name)) as CalendarComponent[];
  return components.length > 0 ? [...new Set(components)] : undefined;
}

/**
 * THE LAST SEGMENT OF A NEW CALENDAR'S ADDRESS, IN A HOME THE SERVER NAMED:
 * a UUID, the same one on every pass (workplan 0160).
 *
 * Where this writer assumes Nextcloud's layout, a new calendar is made at
 * its slug, as it always was. In a home the server named, that is no longer
 * a safe guess. Cirrux names its calendars by UUID
 * (https://cirrux.co/help/api/calendar, read 2026-11-19), as Apple's apps
 * name the calendars they make. On a test mailbox on 2026-11-19, Cirrux
 * answered 201 to an MKCALENDAR at a slug, and then refused with 404 every
 * event written to that address.
 *
 * Derived, not random, so that every pass asks for the same address, and so
 * a calendar made by an earlier pass is found again by its path, even after
 * its owner renames it. A task list and a calendar with the same name get
 * different addresses. The UUID has version 5's shape (RFC 9562 §5.5), from
 * SHA-1 over a name of this writer's own rather than over a registered
 * namespace.
 */
export function newCalendarSegment(username: string, domain: CalDavLedgerDomain, slug: string): string {
  const hash = createHash('sha1').update(`ownpace:new-calendar:v1\n${username}\n${domain}\n${slug}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * CalDAV target writer implementation
 */
export class CalDAVTargetWriter implements CalendarTargetWriter, TargetReindexer {
  private readonly config: CalDAVTargetConfig;
  private readonly ledger: Ledger;
  private readonly tenantId: TenantId;
  private readonly mappingId: MappingId;
  /**
   * WHICH DOMAIN'S ROWS THIS WRITER FILES — and the only field on it that is
   * not about talking to a server.
   *
   * On the wire a task is a calendar object, so ONE class writes both and both
   * factories return it. In the LEDGER they are separate domains, and this
   * class used to write `itemType: 'calendar'` for every object it touched.
   * That went unnoticed for as long as the task domain never ran: on
   * 2026-09-04, the first self-hosted run where it did, the calendar domain
   * reported `itemsSynced: 17` against a source holding 9 events — the extra 8
   * being the 8 tasks, filed here under `calendar` while the sync loop filed
   * them again under `task`. Two rows per task, calendar's counts and bytes
   * inflated by the whole task corpus, and the `find` fast path below looking
   * for a `todo:` key in the wrong domain, so it never hit.
   *
   * Required rather than defaulted, deliberately: an optional key nobody
   * assigns is exactly how the parser lost the tasks domain in the first
   * place (see `DOMAIN_CONFIG_KEY`). Forgetting it here is a compile error.
   */
  private readonly domain: CalDavLedgerDomain;
  private readonly httpClient: HttpClient;
  /**
   * Per-collection snapshot of what the target already holds, natural key ->
   * href, built once and reused for every item in that collection.
   *
   * The existence check used to be one `calendar-query` REPORT PER ITEM. That
   * is a network round trip each, and it dominated: a real run moved 203 events
   * — 52 KB in total — in 76 seconds, 374 ms an item, essentially none of it
   * data transfer. One REPORT for the whole collection answers the same
   * question.
   *
   * A promise, not a Set, so concurrent items coalesce onto one in-flight
   * listing instead of racing to build it N times.
   */
  private readonly collectionKeys = new Map<string, Promise<Map<string, string> | undefined>>();
  /** The calendar home the server names; asked once, see `discoveredHomeSet`. */
  private discoveredHome: Promise<string | undefined> | undefined;

  constructor(
    config: CalDAVTargetConfig,
    deps: {
      ledger: Ledger;
      tenantId: TenantId;
      mappingId: MappingId;
      domain: CalDavLedgerDomain;
      httpClient?: HttpClient;
    },
  ) {
    this.config = config;
    this.ledger = deps.ledger;
    this.tenantId = deps.tenantId;
    this.mappingId = deps.mappingId;
    this.domain = deps.domain;
    this.httpClient = deps.httpClient ?? createDefaultHttpClient();
  }

  /**
   * Ensure a calendar exists with the given folder metadata.
   * Returns the calendar ID (href) for use in subsequent operations.
   */
  async ensureCalendar(folder: CalendarFolder): Promise<string> {
    // The collection MUST live under THIS writer's own account, not wherever the
    // source folder came from. In a real cross-account/cross-server migration the
    // folder handed to us by the domain-sync loop is the SOURCE collection (e.g.
    // /remote.php/dav/calendars/<source-user>/personal/); using its path verbatim
    // would target the wrong user (or double the DAV prefix). We therefore derive a
    // stable slug from the folder and re-home it under calendars/<target-user>/,
    // where Nextcloud and SabreDAV keep a user's calendars. A server that keeps
    // them elsewhere is asked where (see `calendarAfterRefusal`).
    const slug = collectionSlug(folder.name, folder.path, 'calendar');
    const calendarPath = this.normalizeCalendarPath(`calendars/${this.config.username}/${slug}`);

    // Check if calendar already exists via PROPFIND
    const exists = await this.calendarExists(calendarPath);
    if (exists) {
      return calendarPath;
    }

    // Create new calendar using MKCALENDAR
    const made = await this.createCalendar(calendarPath, folder);
    if (made.status === 201) return calendarPath;
    return this.calendarAfterRefusal(folder, slug, calendarPath, made);
  }

  /**
   * WHERE THE CALENDAR GOES WHEN THE ASSUMED PLACE IS REFUSED (workplan 0160).
   *
   * Nextcloud's layout is an assumption, and Cirrux does not keep it: on a
   * test mailbox, on 2026-11-19, its CalDAV server answered the MKCALENDAR
   * at `calendars/<mailbox>/<slug>/` with 404. The calendar pass failed
   * before it wrote an event, and since a failed type ends the pass, the
   * tasks and the mail behind it had no turn either. So the server is asked
   * where this account's calendars are, and the folder goes, in this order:
   *
   *   1. into a calendar the account already has under the folder's name and
   *      that holds this writer's kind (VEVENT, or VTODO for a task list), as
   *      it does when the assumed path exists;
   *   2. into a new calendar in the home the server named, where that is not
   *      the home this writer assumed, at a UUID of its own
   *      (`newCalendarSegment`) and read back where the server says it made
   *      it (`whereItWasMade`). Apps add task lists to a Cirrux mailbox over
   *      CalDAV (https://cirrux.co/help/api/tasks, read 2026-11-19);
   *   3. into the account's ONE calendar that holds this kind, where no new
   *      one can be made.
   *
   * Several, and none of them this folder's, is not guessed between: the pass
   * fails, and names them.
   */
  private async calendarAfterRefusal(
    folder: CalendarFolder,
    slug: string,
    assumedPath: string,
    refusal: HttpResponse,
  ): Promise<string> {
    const refused = `MKCALENDAR failed for ${assumedPath} with status ${refusal.status}: ${davRefusalBody(refusal.body)}`;
    if (!NOT_THIS_PLACE.has(refusal.status)) throw new Error(refused);

    let account: { home: string; calendars: CalendarAt[] };
    try {
      account = await this.accountCalendars();
    } catch (err) {
      throw new Error(
        `${refused}. Looking for this account's own calendars failed too: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const { home } = account;
    const kind: CalendarComponent = this.domain === 'task' ? 'VTODO' : 'VEVENT';
    const holding = account.calendars.filter((calendar) => collectionCarries(calendar.components, kind));

    // By its name, or by the address an earlier pass made it at, which still
    // holds after its owner renames it.
    const segment = newCalendarSegment(this.config.username, this.domain, slug);
    const named = holding.find(
      (calendar) => isNamed(calendar, slug) || collectionSlug(undefined, calendar.path, '') === segment,
    );
    if (named !== undefined) return named.path;

    if (home !== this.assumedHome()) {
      const path = this.normalizeCalendarPath(`${home}${segment}`);
      const there = await this.createCalendar(path, folder);
      if (there.status === 201) return this.whereItWasMade(path, there, folder, slug, home, account.calendars, kind);
      if (!NOT_THIS_PLACE.has(there.status)) {
        throw new Error(`MKCALENDAR failed for ${path} with status ${there.status}: ${davRefusalBody(there.body)}`);
      }
    }

    const only = holding.length === 1 ? holding[0] : undefined;
    if (only !== undefined) {
      log.info(
        `[caldav] no calendar can be made for ${folder.name || slug} (MKCALENDAR ${refusal.status}); ` +
          `its ${kind} objects go into ${only.path}, the one calendar this account has that holds them`,
      );
      return only.path;
    }
    throw new Error(
      `${refused}. No calendar could be made for ${folder.name || slug}, and the account has ` +
        (holding.length === 0
          ? `none at ${home} that holds ${kind} to write into.`
          : `${holding.length} at ${home} that hold ${kind}, none of them by that name ` +
            `(${holding.map((calendar) => calendar.displayName ?? calendar.path).join(', ')}): ` +
            'which one they go into is not guessed.'),
    );
  }

  /**
   * WHERE A CALENDAR THE SERVER SAID IT MADE ACTUALLY IS (workplan 0160).
   *
   * RFC 4791 §5.3.1 makes the calendar at the address asked for, and a 201
   * says it did. Cirrux's 201, on 2026-11-19, did not: every event written to
   * that address was then refused with 404. So in a home the server named, a
   * 201 is read back:
   *
   *   1. a calendar at the address asked for, which is where a server that
   *      follows the RFC made it;
   *   2. a calendar at the `Location` the answer gave, on this host and under
   *      this base;
   *   3. the calendar the home lists now and did not list before: the one with
   *      the folder's name, or the only new one that holds this kind.
   *
   * None of these, and the pass fails, naming what it asked for, rather than
   * writing every event of the folder to an address the server refuses.
   */
  private async whereItWasMade(
    path: string,
    made: HttpResponse,
    folder: CalendarFolder,
    slug: string,
    home: string,
    before: readonly CalendarAt[],
    kind: CalendarComponent,
  ): Promise<string> {
    if (await this.calendarIsAt(path)) return path;

    const location = made.headers['location'];
    if (location !== undefined && location.trim() !== '') {
      const at = this.calendarPathFromHref(location.trim(), path);
      if (at !== undefined && at !== path && (await this.calendarIsAt(at))) {
        log.info(`[caldav] MKCALENDAR for ${path} made ${folder.name || slug} at ${at}, the address it answered with`);
        return at;
      }
    }

    const after = await this.calendarsIn(home);
    const known = new Set(before.map((calendar) => calendar.path));
    const fresh =
      after.status === 207
        ? after.calendars.filter(
            (calendar) => !known.has(calendar.path) && collectionCarries(calendar.components, kind),
          )
        : [];
    const chosen = fresh.find((calendar) => isNamed(calendar, slug)) ?? (fresh.length === 1 ? fresh[0] : undefined);
    if (chosen !== undefined) {
      log.info(
        `[caldav] MKCALENDAR for ${path} made ${folder.name || slug} at ${chosen.path}, ` +
          `which the server lists in ${home}; not where it was asked for`,
      );
      return chosen.path;
    }
    throw new Error(
      `MKCALENDAR for ${path} was answered 201, but no calendar is there, the answer named no other ` +
        `address that holds one, and ${home} ` +
        (after.status !== 207
          ? `could not be listed again (status ${after.status}).`
          : fresh.length === 0
            ? `lists no new calendar that holds ${kind}.`
            : `lists ${fresh.length} new ones that hold ${kind}, none of them by that name ` +
              `(${fresh.map((calendar) => calendar.displayName ?? calendar.path).join(', ')}): ` +
              'which one it made is not guessed.'),
    );
  }

  /** A server href as this writer's calendar path, or undefined when it lies on another host or outside the base. */
  private calendarPathFromHref(href: string, requestedPath: string): string | undefined {
    let url: URL;
    try {
      url = new URL(href, this.buildUrl(requestedPath));
    } catch {
      return undefined;
    }
    const base = this.buildUrl('');
    if (url.origin !== new URL(base).origin) return undefined;
    const relative = hrefRelativeTo(url.pathname, base);
    if (relative === undefined || relative === '') return undefined;
    return this.normalizeCalendarPath(relative);
  }

  /**
   * Is a calendar at this address? Its resourcetype, asked at Depth 0, says
   * so. A 207 alone does not: a server that answers 201 for a calendar it
   * keeps elsewhere may answer for an address that holds none.
   */
  private async calendarIsAt(path: string): Promise<boolean> {
    try {
      const response = await this.httpClient.request({
        method: 'PROPFIND',
        url: this.buildUrl(path),
        body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`,
        headers: {
          Depth: '0',
          'Content-Type': 'application/xml',
          Authorization: this.authHeader(),
        },
      });
      return (
        response.status === 207 && parseMultiStatus(response.body).some((r) => hasResourceType(r.xml, 'calendar'))
      );
    } catch (err) {
      log.warn(`[caldav] could not read ${path} back: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** The status a Depth-0 PROPFIND of one collection answers, or undefined when it could not be asked. */
  private async collectionStatus(path: string): Promise<number | undefined> {
    try {
      const response = await this.httpClient.request({
        method: 'PROPFIND',
        url: this.buildUrl(path),
        headers: { Depth: '0', Authorization: this.authHeader() },
      });
      return response.status;
    } catch (err) {
      log.warn(`[caldav] could not ask whether ${path} is there: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /**
   * THE SAME LEDGER KEY THE SYNC LOOP WILL COMPUTE FOR THIS OBJECT.
   *
   * Both write a row for every item — the loop through `recordIfAbsent`, this
   * writer through the same call one layer down, first-writer-wins. That only
   * yields ONE row if the two agree on the key, and this writer used to hash
   * everything with `calendarNaturalKeyHash` regardless.
   *
   * For a calendar event they agreed, so nothing ever showed. For a task they
   * did not: `naturalKeyForTask` carries the `todo:` prefix (a VTODO and a
   * VEVENT may share a UID — see `taskNaturalKeyHash`), so every task got TWO
   * ledger rows under two hashes, and the task domain reported exactly twice
   * its corpus. Found by the self-hosted gate on 2026-09-04, in the run that
   * first let the task domain reach a real server.
   *
   * Delegates to the same helpers `runCalendarSync` and `runTaskSync` pass as
   * their `naturalKey`, on the same `item` object, so the two cannot drift
   * again — including over RECURRENCE-ID, which neither side populates today
   * and both would pick up together on the day one does.
   */
  private ledgerKeyFor(raw: RawCalendarEvent, uid: string): string {
    return this.domain === 'task'
      ? naturalKeyForTask(this.keyedFrom(raw, uid))
      : naturalKeyForCalendar(this.keyedFrom(raw, uid));
  }

  /**
   * THE SAME OBJECT'S IDENTIFIER IN PLAIN TEXT, for the confirmed list.
   *
   * Off `keyedFrom` too, so it carries RECURRENCE-ID exactly when the key does.
   * Split out rather than recomputed because the drift the block above exists
   * to prevent would come straight back if the two read different fields.
   */
  private ledgerKeyTextFor(raw: RawCalendarEvent, uid: string): string {
    return this.domain === 'task'
      ? naturalKeyTextForTask(this.keyedFrom(raw, uid))
      : naturalKeyTextForCalendar(this.keyedFrom(raw, uid));
  }

  /**
   * `uid` from the iCalendar bytes rather than `raw.item.uid`: those bytes
   * are what lands on the target, and a caller may hand this writer a raw
   * object with no `item` at all. Everything else about the key comes from
   * the item when there is one.
   */
  private keyedFrom(raw: RawCalendarEvent, uid: string): CalendarEvent {
    return { ...(raw.item ?? {}), uid } as CalendarEvent;
  }

  /**
   * Idempotently write a calendar event to the target.
   * Uses ledger fast-path and target-side UID check to ensure idempotency.
   */
  async upsertCalendarEvent(
    calendarId: string,
    raw: RawCalendarEvent,
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    // Extract UID from iCalendar data
    const uid = this.extractUidFromIcalendar(raw.icalendar);
    // The UID, as the SERVER knows it: matched against `calendar-data` in the
    // existence REPORT and used as the key of the per-collection snapshot. Not
    // a ledger key — that is the hash below.
    const naturalKey = uid;
    const naturalKeyHash = this.ledgerKeyFor(raw, uid);
    // What the confirmed list will call this object. Recorded HERE as well as
    // by the loop for the same reason `collection` and `sourceRef` are: this
    // writer can win the `recordIfAbsent` race, and a field only the loser
    // passes is a field that never lands.
    const naturalKeyText = this.ledgerKeyTextFor(raw, uid);
    // And the name a person calls it, for the same race and the same reason.
    // `displayNameForCalendar` rather than a branch on `this.domain`: a task's
    // name and an event's are both the SUMMARY, and the two shared helpers
    // differ only in what they are called. The `todo:` distinction lives in the
    // KEY, which is where it belongs.
    const name = displayNameForCalendar(raw.item);

    // UPDATE PATH: the source event changed after we copied it, so rewrite it.
    //
    // Deliberately ahead of the ledger fast-path, which is precisely what this
    // is overriding. `runDomainSync` is the only caller that sets `overwrite`,
    // and it does so only for an item this tool copied itself — never for one
    // the destination already held (hard rule 2). The ledger row is left to
    // the sync loop's `recordUpdate`, which owns the new source version.
    //
    // A CalDAV PUT to the same href replaces the object, so no delete is
    // involved and the UID — the natural key — does not move.
    if (options?.overwrite) {
      const written = await this.uploadEvent(
        calendarId,
        raw,
        uid,
        true,
        options.expectedTargetVersion,
      );
      if (written.conflicted) {
        // Nothing was written. Reported, not thrown: this is a fact about
        // ownership, not a failure to migrate, and throwing would spend one of
        // the item's five attempts and count towards the systemic-failure
        // tripwire — both of which describe something else.
        return { targetId: written.path, created: false, conflicted: true };
      }
      // Nothing was written, and nobody was mailed: the copy lists guests the
      // target would have mailed (above). Reported, not thrown, for the same
      // reasons; and not a conflict, since nobody edited the copy.
      if (written.keptForGuests) return { targetId: written.path, created: false, keptForGuests: true };
      (await this.keysIn(calendarId))?.set(naturalKey, written.path);
      return {
        targetId: written.path,
        created: false,
        updated: true,
        ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
      };
    }

    // LEDGER FAST-PATH: Check if already migrated
    const known = await this.ledger.find(this.tenantId, this.mappingId, this.domain, naturalKeyHash);
    // `isOnTarget`, not merely "a row exists". A `failed` row means we tried and
    // did not copy it; short-circuiting on one told the sync loop the retry had
    // succeeded, and the loop then recorded the row as 'updated' — clearing the
    // failure, counting the item as synced, and never writing anything. The
    // E2E caught it: the planted unmigratable item failed on the first pass,
    // was silently "migrated" on the second, and vanished from the queue.
    if (known && isOnTarget(known.status)) {
      return { targetId: known.targetId, created: false };
    }

    // Compute content hash for change detection
    const contentHashValue = calendarContentHash(raw.icalendar);
    // Recorded here, not only by the sync loop: `recordIfAbsent` makes the first
    // writer win, and that is this one. See webdav-target-writer.ts.
    const sizeBytes = Buffer.byteLength(raw.icalendar, 'utf8');

    // Check if the object already exists on target (by UID), asking the server
    // for the component we are about to write rather than for VEVENT always
    // (workplan 0113 T4).
    const existingId = await this.existingTargetId(
      calendarId,
      naturalKey,
      componentOfIcalendar(raw.icalendar),
    );
    // ONE RECORDING, TWO WAYS OF ARRIVING AT IT.
    //
    // The by-UID check below is the ordinary way: we ask first and the server
    // says yes. The other is the server refusing `uploadEvent`'s create, on
    // the UID (RFC 4791 §5.3.2) or on the href (412), and naming the object
    // when asked — the same fact, learned from the refusal instead of from
    // the question, and it has to be recorded the same way or the two paths
    // disagree about what the row means.
    const adopt = async (targetId: string): Promise<UpsertResult> => {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: this.domain,
        mappingId: this.mappingId,
        naturalKeyHash,
        contentHash: contentHashValue,
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
        naturalKey: naturalKeyText,
        // The name, by the same race: a row this writer inserts is a row the
        // loop's own `recordIfAbsent` will no-op on.
        ...(name !== undefined ? { displayName: name } : {}),
      });
      return { targetId, created: false, adopted: true };
    };

    if (existingId) return adopt(existingId);

    // Upload the event to the calendar
    const written = await this.uploadEvent(calendarId, raw, uid);
    // THE COLLECTION HELD THIS UID AFTER ALL — the check above missed it
    // because the listing was stale, or failed, or because a sibling source
    // handle carrying the same UID was written earlier in this very pass. The
    // server said so by refusing the create, on the href (412) or on the UID,
    // and then named the object when asked. Nothing was written, so none of
    // the create-path recording below is true of it.
    if (written.alreadyHeld) {
      // Keep the snapshot current, exactly as the create path does: a THIRD
      // handle with this UID is then answered from memory rather than by a
      // refusal.
      (await this.keysIn(calendarId))?.set(naturalKey, written.path);
      return adopt(written.path);
    }
    const eventId = written.path;
    // Keep the snapshot current: a duplicate UID later in the same pass is then
    // answered from memory instead of being written twice.
    (await this.keysIn(calendarId))?.set(naturalKey, eventId);

    // RECORD IN LEDGER
    await this.ledger.recordIfAbsent({
      tenantId: this.tenantId,
        itemType: this.domain,
      mappingId: this.mappingId,
      naturalKeyHash,
      contentHash: contentHashValue,
      targetId: eventId,
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
      naturalKey: naturalKeyText,
      // The name, by the same race as `naturalKey` above.
      ...(name !== undefined ? { displayName: name } : {}),
      // NOT from the loop: only this writer saw the server's answer to the
      // PUT. Same race, opposite direction — recorded here or not at all.
      ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
    });

    return {
      targetId: eventId,
      created: true,
      ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
    };
  }

  /**
   * Natural key -> href for everything already in this collection.
   *
   * Returns undefined when the collection cannot be listed, and the caller then
   * falls back to the per-item REPORT — a target we cannot enumerate must still
   * be migratable, just not as quickly.
   */
  private keysIn(collectionId: string): Promise<Map<string, string> | undefined> {
    let pending = this.collectionKeys.get(collectionId);
    if (!pending) {
      pending = (async () => {
        try {
          const keys = new Map<string, string>();
          for await (const entry of this.listEntries(collectionId)) {
            keys.set(entry.naturalKey, entry.targetId);
          }
          return keys;
        } catch (err) {
          log.warn(
            `[caldav] could not list ${collectionId} up front, falling back to a per-item ` +
              `existence check: ${err instanceof Error ? err.message : String(err)}`,
          );
          return undefined;
        }
      })();
      this.collectionKeys.set(collectionId, pending);
    }
    return pending;
  }

  /** Is this item already on the target? Snapshot first, per-item REPORT as fallback. */
  private async existingTargetId(
    collectionId: string,
    naturalKey: string,
    component?: CalendarComponent,
  ): Promise<string | undefined> {
    const keys = await this.keysIn(collectionId);
    if (keys) return keys.get(naturalKey);
    return this.findCalendarByNaturalKey(collectionId, naturalKey, component);
  }

  /**
   * Find a calendar event by its natural key (UID).
   * Returns the event ID if found, undefined when the server says it is not
   * there, and throws when the server gave no answer (workplan 0149 T2).
   */
  async findCalendarByNaturalKey(
    calendarId: string,
    naturalKey: string,
    component?: CalendarComponent,
  ): Promise<string | undefined> {
    // THE FILTER FOLLOWS THE COMPONENT BEING WRITTEN (workplan 0113 T4).
    //
    // This asked for `VEVENT` and nothing else, so a task already on the target
    // came back as "not there" — and was re-PUT on every pass, for ever. Same
    // href, so nothing duplicated and nothing was lost; it is the idempotency
    // CHECK that was blind, not the write. Reachable without any task feature
    // at all: `sync-collection` is component-agnostic, so a mixed collection
    // (Nextcloud's default calendar declares VEVENT,VTODO) already carries
    // tasks through this writer.
    //
    // A caller that knows the component asks for exactly it. One that does not
    // asks for all three, which is strictly more likely to find what is there —
    // never less. RFC 4791 §9.7.1: sibling comp-filters are a logical OR.
    const components = component ? [component] : CALENDAR_COMPONENTS;
    // Use CalDAV REPORT to search for the object by UID
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:resourcetype/>
          <C:calendar-data/>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            ${components
              .map(
                (component) => `<C:comp-filter name="${component}">
              <C:prop-filter name="UID">
                <C:text-match>${this.escapeXml(naturalKey)}</C:text-match>
              </C:prop-filter>
            </C:comp-filter>`,
              )
              .join('\n            ')}
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;

    // Retried as the writes are: a busy Nextcloud answers on a later attempt
    // instead of failing the item (workplan 0149 T2).
    const response = await this.requestWithRetry({
      method: 'REPORT',
      url: this.buildUrl(calendarId),
      body: query,
      headers: {
        // A REPORT with no Depth header is a Depth: 0 REPORT (RFC 3253 §3.6),
        // so this asked the CALENDAR about itself and never reached an event.
        // It was the only REPORT in this file without one; its own sibling
        // listing twenty lines down has always sent `Depth: 1`.
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status === 207) {
      // CalDAV's text-match has no equality option at all (RFC 4791 §9.7.5
      // defines collation and negate-condition, and nothing else), so the
      // server's answer is a SUBSTRING match on the UID. The exact comparison
      // has to happen here, against the returned component's own UID.
      const href = findHrefByUid(response.body, naturalKey, 'calendar-data');
      // Converted HERE, not by the caller: this value is recorded as the
      // ledger's `targetId` on the adoption path, and a raw server href
      // there is the doubled DAV prefix all over again — this time on a row
      // that outlives the run.
      return href === undefined ? undefined : targetIdRelativeTo(href, this.buildUrl(''));
    }

    // 404: the collection is gone, and so is anything that was in it.
    if (response.status === 404) return undefined;

    // ANY OTHER ANSWER IS NO ANSWER (workplan 0149 T2, hard rule 9).
    //
    // This returned `undefined` for every status but 207, so a busy server's
    // 500, an expired login's 401 and a refusal's 403 all read as "not on the
    // target". That answer decides whether to write, and since a 412 is asked
    // about here, whether to adopt. The JMAP and IMAP lookups have always
    // refused it; the item fails this pass and is asked again on the next.
    throw new Error(
      `calendar-query REPORT by UID on ${calendarId} failed; refusing to treat this as "not ` +
        'present", because a write or an adoption would then rest on an answer the server never ' +
        `gave. Cause: status ${response.status}: ${davRefusalBody(response.body)}`,
    );
  }

  /**
   * Stream every event on this target, keyed the way the ledger keys them.
   *
   * This is what makes calendar verifiable at all. Until it existed, only the
   * two mail targets implemented `TargetReindexer`, so `runVerification` had no
   * way to read a calendar target and reported the whole domain
   * NOT_VERIFIABLE — blocking any cutover that had actually copied events.
   *
   * `naturalKey` is the component's UID — the same string `upsertCalendarEvent`
   * hashes, through `ledgerKeyFor`, under this writer's own domain. `targetId`
   * is the resource href, matching what that method records as the ledger's
   * target id.
   *
   * @param mailboxId Restrict to one calendar collection path. Omitted, every
   *   calendar under this account's home set is walked.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    const calendars = mailboxId ? [mailboxId] : await this.listCalendarCollections();

    for (const calendarPath of calendars) {
      for await (const entry of this.listEventsIn(calendarPath)) {
        yield entry;
      }
    }
  }

  /** Every calendar collection of this account; see `accountCalendars` for where they are looked for. */
  private async listCalendarCollections(): Promise<string[]> {
    return (await this.accountCalendars()).calendars.map((calendar) => calendar.path);
  }

  /** Nextcloud's and SabreDAV's place for this account's calendars, assumed first. */
  private assumedHome(): string {
    return this.normalizeCalendarPath(`calendars/${this.config.username}`);
  }

  /**
   * This account's calendar home and the calendars in it (workplan 0160).
   *
   * The assumed home first, as before. When it holds no calendar, or answers
   * with one of `NOT_THIS_PLACE`'s statuses, the home the server names
   * instead. An assumed home that lists empty, with no other named, is an
   * account without calendars, and says so. Every other failure throws.
   * Failing loudly matters more here than anywhere else: an empty list is
   * indistinguishable from "the target has no events", which verification
   * would report as total data loss (hard rule 9).
   */
  private async accountCalendars(): Promise<{ home: string; calendars: CalendarAt[] }> {
    const assumed = this.assumedHome();
    const here = await this.calendarsIn(assumed);
    if (here.status === 207 && here.calendars.length > 0) return { home: assumed, calendars: here.calendars };

    if (here.status === 207 || NOT_THIS_PLACE.has(here.status)) {
      const named = await this.discoveredHomeSet();
      if (named !== undefined && named !== assumed) {
        const there = await this.calendarsIn(named);
        if (there.status === 207) return { home: named, calendars: there.calendars };
        throw new Error(
          `PROPFIND on calendar home set ${named} failed with status ${there.status}: ${davRefusalBody(there.body)}`,
        );
      }
      if (here.status === 207) return { home: assumed, calendars: here.calendars };
    }

    throw new Error(
      `PROPFIND on calendar home set ${assumed} failed with status ${here.status}: ${davRefusalBody(here.body)}`,
    );
  }

  /**
   * The calendars directly under `home`, with their names and the kinds they
   * say they hold; `calendars` is empty unless 207.
   */
  private async calendarsIn(
    home: string,
  ): Promise<{ status: number; body: string; calendars: CalendarAt[] }> {
    const response = await this.httpClient.request({
      method: 'PROPFIND',
      url: this.buildUrl(home),
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop>` +
        '<D:resourcetype/><D:displayname/><C:supported-calendar-component-set/></D:prop></D:propfind>',
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: this.authHeader(),
      },
    });
    if (response.status !== 207) return { status: response.status, body: response.body, calendars: [] };

    // An href in a multistatus is SERVER-absolute (`/remote.php/dav/calendars/
    // <user>/personal/`), while `buildUrl` treats its argument as relative to
    // the configured base and just concatenates. Handing hrefs to it straight
    // produced `…/remote.php/dav/remote.php/dav/calendars/<user>/personal/`,
    // and every calendar-query REPORT 404'd:
    //
    //   REPORT /remote.php/dav/remote.php/dav/calendars/e2e-target/personal/ 404
    //   Sabre\DAV\Exception\NotFound — File not found: remote.php in 'root'
    //
    // The writes never hit this because they build their own relative paths;
    // only the reindexer feeds server hrefs back in, so it surfaced the first
    // time verification ran against a real Nextcloud. `hrefRelativeTo` (#142)
    // exists for exactly this and is what the WebDAV reindexer already uses.
    const calendars = parseMultiStatus(response.body)
      .filter((r) => hasResourceType(r.xml, 'calendar'))
      .flatMap((r): CalendarAt[] => {
        const relative = hrefRelativeTo(r.href, this.buildUrl(''));
        // An href outside the configured base is not ours to read; dropping it
        // is right, and `''` is the home set itself — not a calendar, though
        // some servers list it.
        if (relative === undefined || relative === '') return [];
        const path = this.normalizeCalendarPath(relative);
        if (path === home) return [];
        const name = firstElementText(r.xml, 'displayname');
        const displayName = name === undefined ? '' : unescapeXml(name).trim();
        const components = componentsDeclaredIn(r.xml);
        return [
          {
            path,
            ...(displayName === '' ? {} : { displayName }),
            ...(components === undefined ? {} : { components }),
          },
        ];
      });
    return { status: 207, body: response.body, calendars };
  }

  /**
   * The calendar home the SERVER names for this account (RFC 4791 §6.2.1),
   * asked as `discoverHomeSet` says, or undefined.
   *
   * Asked once per writer, and only after the assumed home failed, so a
   * server that serves Nextcloud's layout costs no request more than before.
   */
  private discoveredHomeSet(): Promise<string | undefined> {
    this.discoveredHome ??= discoverHomeSet('caldav', this.buildUrl(''), this.authHeader(), (options) =>
      this.httpClient.request(options),
    ).then((relative) => (relative === undefined ? undefined : this.normalizeCalendarPath(relative)));
    return this.discoveredHome;
  }

  /** Every calendar resource in one collection, as ledger-shaped entries. */
  private async *listEventsIn(calendarPath: string): AsyncIterable<TargetEntry> {
    // ONE COMPONENT, THIS WRITER'S OWN — not all three at once.
    //
    // This filter used to name VEVENT, VTODO and VJOURNAL as sibling
    // comp-filters, on the reading that it was asking for any of them. It is
    // not: RFC 4791 §9.7.1 makes a comp-filter's children a conjunction, so
    // "a VCALENDAR containing a VEVENT and a VTODO and a VJOURNAL" describes
    // no object anybody has. Sabre's PDO backend — Nextcloud's — is more
    // forgiving and simply takes the FIRST child as the component to index on,
    // which is why the query appeared to work for four domains and one
    // workplan: the first child was VEVENT, so events came back and nothing
    // else ever did.
    //
    // The self-hosted gate met the consequence on 2026-09-04, the first run
    // where the task domain reached a real server: eight VTODOs sitting in
    // `restart-resume-seed-tasks/` (a collection whose
    // `supported-calendar-component-set` says VTODO, written there by this
    // very class), and a verification report reading `tasks: targetCount 0,
    // missingOnTarget 8` — every migrated task declared lost, and
    // `canProceedToCutover: false` on a migration that had copied everything.
    //
    // Scoped to the domain rather than unioned over all three, because that is
    // also the right answer for the other half of verification: a calendar
    // reindexer that listed VTODOs would report every task as "extra on
    // target", and no domain owns VJOURNAL at all.
    const component = this.domain === 'task' ? 'VTODO' : 'VEVENT';
    // Partial retrieval (RFC 4791 §9.6): ask for the UID rather than the whole
    // event body. Enumeration is metadata-only by contract and a mailbox-sized
    // calendar should not be downloaded in full to count it.
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:getetag/>
          <D:getcontentlength/>
          <C:calendar-data>
            <C:comp name="VCALENDAR">
              <C:comp name="${component}">
                <C:prop name="UID"/>
              </C:comp>
            </C:comp>
          </C:calendar-data>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="${component}"/>
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;

    const response = await this.httpClient.request({
      method: 'REPORT',
      url: this.buildUrl(calendarPath),
      body: query,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: this.authHeader(),
      },
    });

    if (response.status !== 207) {
      throw new Error(
        `calendar-query REPORT on ${calendarPath} failed with status ${response.status}: ${davRefusalBody(response.body)}`,
      );
    }

    for (const item of parseMultiStatus(response.body)) {
      const data = firstElementText(item.xml, 'calendar-data');
      if (data === undefined) {
        // The collection itself comes back in some servers' Depth:1 responses
        // with no calendar-data. Skipping it is right; skipping an actual event
        // would not be, which is why the UID check below throws instead.
        continue;
      }
      const uid = extractUid(unescapeXml(data));
      if (!uid) {
        // Yielding the href as a stand-in key would mis-key the item and make a
        // present event look missing — the ADR-0020 failure mode fixed in the
        // mail reindexers. Fail instead.
        throw new Error(`Calendar resource ${item.href} returned no UID; cannot key it for verification.`);
      }
      yield {
        naturalKey: uid,
        targetId: targetIdRelativeTo(item.href, this.buildUrl('')),
        mailboxId: calendarPath,
        ...sizeOf(item.xml),
        // No contentHash from the LISTING: it fetches only the UID, and a hash
        // of the server's re-serialized bytes could never equal the source's.
        // `contentHashFor` below fetches sampled items in full and fingerprints
        // them canonically instead.
      };
    }
  }

  /**
   * A canonical content fingerprint for one sampled event.
   *
   * The listing cannot supply this — it deliberately fetches only the UID — and
   * a byte hash would be meaningless here anyway: CalDAV servers re-serialize
   * iCalendar, so the octets are the server's, not ours. `calendarContentHash`
   * is a canonical fingerprint over opaque text properties (see
   * dav-canonical.ts for exactly what is compared and what a match claims), so
   * the same function applied to the source and to what comes back is a
   * like-for-like comparison.
   *
   * Called only for sampled items, so the extra GET is bounded by the sample
   * size, not the calendar size. Returns undefined — never a wrong hash — when
   * the resource cannot be read, so the sample is counted as unavailable rather
   * than as corruption.
   */
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    // `targetId` is base-relative BY CONTRACT: `listEntries` converts the
    // server's href once, on the way in, so every consumer — and every
    // ledger row written from an adoption — speaks one coordinate system.
    // Converting again here would find nothing under the base and quietly
    // decline to verify anything at all.

    let response: HttpResponse;
    try {
      response = await this.httpClient.request({
        method: 'GET',
        url: this.buildUrl(entry.targetId),
        headers: { Authorization: this.authHeader() },
      });
    } catch (err) {
      log.warn(`[caldav] GET ${entry.targetId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }

    if (response.status !== 200) {
      log.warn(`[caldav] GET ${entry.targetId} -> ${response.status}; cannot content-verify it`);
      return undefined;
    }

    return calendarContentHash(response.body);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
  }

  // Private helper methods

  private normalizeCalendarPath(path: string): string {
    // Normalize path to ensure consistent format
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    // Ensure .ics extension for individual events, no extension for calendars
    if (normalized.endsWith('.ics/')) {
      normalized = normalized.slice(0, -4);
    }
    return normalized;
  }

  private async calendarExists(path: string): Promise<boolean> {
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
        `[caldav] could not check whether ${path} exists: ` +
          `${err instanceof Error ? err.message : String(err)}; treating it as absent`,
      );
      return false;
    }
  }

  /** Make one calendar, and hand back the server's answer: 201 when made, the refusal otherwise. */
  private async createCalendar(path: string, folder: CalendarFolder): Promise<HttpResponse> {
    // RFC 4791 §5.3.1: the MKCALENDAR request body's root element MUST be in the CalDAV
    // namespace (C:mkcalendar), not DAV: — servers (e.g. SabreDAV, which Nextcloud uses)
    // deserialize the body by its Clark-notation element name and silently fail to create a
    // real calendar collection (while still returning success) if the root is misnamed.
    // THE COMPONENT SET TRAVELS WITH THE COLLECTION (RFC 4791 §5.2.3, workplan
    // 0113 T4). A task list is a calendar collection that says VTODO; created
    // without saying so it becomes an ordinary calendar, and the tasks written
    // into it are refused or hidden by a client that reads the property. Sent
    // only when the SOURCE declared one — a collection that declared nothing is
    // recreated as one that declares nothing, rather than being narrowed to
    // whatever this pass happened to see in it.
    const componentSet = folder.components?.length
      ? `<C:supported-calendar-component-set>${folder.components
          .map((component) => `<C:comp name="${component}"/>`)
          .join('')}</C:supported-calendar-component-set>`
      : '';
    const mkcalendar = `<?xml version="1.0" encoding="utf-8"?>
      <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:set>
          <D:prop>
            <D:displayname>${this.escapeXml(folder.name || folder.path)}</D:displayname>
            ${folder.description ? `<C:calendar-description>${this.escapeXml(folder.description)}</C:calendar-description>` : ''}
            ${folder.color ? `<CR:color xmlns:CR="http://apple.com/ns/ical/">${this.escapeXml(folder.color)}</CR:color>` : ''}
            ${componentSet}
          </D:prop>
        </D:set>
      </C:mkcalendar>`;

    const response = await this.requestWithRetry({
      method: 'MKCALENDAR',
      url: this.buildUrl(path),
      body: mkcalendar,
      headers: {
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    return response;
  }

  /**
   * Retry a write request a few times on a transient 5xx before giving up. Needed for the
   * demo/self-host Nextcloud backend, which uses SQLite by default -- a single-writer database
   * that genuinely returns "SQLSTATE[HY000]: General error: 5 database is locked" under
   * concurrent domain writes (confirmed live: calendar and contact syncs racing the same
   * account). The lock is transient by nature, so a short backoff is the standard mitigation
   * rather than requiring every demo deployment to run a concurrent-safe database.
   */
  private async requestWithRetry(
    options: HttpRequestOptions,
  ): Promise<HttpResponse> {
    // Shared with the other DAV writers and with the seed script's proven
    // parameters — see dav-retry.ts for why 5 attempts with jitter, and why
    // 423/429 count as transient alongside 5xx.
    return requestWithDavRetry(() => this.httpClient.request(options));
  }

  /**
   * THE UID, WHOLE (2026-09-17) — see `extractUidFromVcard` in
   * `carddav-target-writer.ts` for the defect this replaces, which was the
   * same code and the same consequence one file over: `UID:urn:uuid:8f2b…`
   * became `urn`, every such event resolved to `urn.ics`, and the second
   * onwards were recorded as already placed on the strength of a 412 about
   * somebody else's event.
   *
   * `extractUid` is imported by this file already — for the multistatus
   * parse, four hundred lines down — which is what makes the private copy
   * above it worth naming rather than just deleting.
   */
  private extractUidFromIcalendar(icalendar: string): string {
    const uid = extractUid(icalendar);
    if (uid === undefined) {
      throw new Error('Invalid iCalendar data: missing UID');
    }
    return uid;
  }

  /**
   * The ETag the target currently reports for an object, or undefined.
   *
   * A HEAD rather than a GET: the question is "is this still the object we
   * wrote", and the bytes are not needed to answer it. One extra request, only
   * on the rewrite path, which fires only when the source has actually changed.
   */
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

  private async uploadEvent(
    calendarId: string,
    raw: RawCalendarEvent,
    uid: string,
    overwrite = false,
    expectedTargetVersion?: string,
  ): Promise<{ path: string; etag?: string; conflicted?: boolean; alreadyHeld?: boolean; keptForGuests?: boolean }> {
    // Generate event filename from UID
    const filename = `${uid}.ics`;
    const eventPath = `${calendarId}${filename}`;

    // A COPY THAT STILL LISTS GUESTS IS NOT REWRITTEN, at a target that mails
    // its guests itself (workplan 0160, 2026-11-19).
    //
    // The rewrite below goes through `withoutGuests`, which takes every guest
    // off, and Cirrux mails a guest a cancellation when they are taken off an
    // event. A copy written before the guests came out (#1947) still lists
    // them. So the copy the target holds is read first, and left exactly as it
    // is when it lists a guest: the copy's guests are the ones who would be
    // mailed, whatever the source says now. Gone (404, 410), there is nobody
    // to mail and the rewrite goes on as before. A read that cannot say, a
    // refusal or an answer with no calendar object in it, throws, with
    // nothing written: an unknown copy is not a copy without guests.
    if (overwrite && this.config.mailsGuests) {
      const held = await this.requestWithRetry({
        method: 'GET',
        url: this.buildUrl(eventPath),
        headers: { Authorization: this.authHeader() },
      });
      if (held.status !== 404 && held.status !== 410) {
        const answered = held.status >= 200 && held.status < 300;
        if (!answered || !/BEGIN:VCALENDAR/i.test(held.body)) {
          throw new Error(
            `GET ${eventPath} ${answered ? 'answered with no calendar object' : `failed with status ${held.status}`}, ` +
              'so whether the copy there still lists guests is unknown, and this target mails each guest a ' +
              'rewrite takes off. Nothing was written.',
          );
        }
        if (namesGuests(held.body)) return { path: eventPath, keptForGuests: true };
      }
    }

    // OWNERSHIP, checked at the last possible moment: by the server, in the
    // PUT itself (workplan 0149 T3).
    //
    // `classifyKnownItem` decided this item is ours to replace from the ledger's
    // status — which records that we WROTE these bytes, not that they are still
    // the bytes we wrote. Shadow migration invites the owner into the new system
    // before cutover; if they corrected this event there, overwriting it now
    // destroys their work silently and counts it as a success.
    //
    // A strong version goes as `If-Match` on the PUT below, so the server
    // refuses the write if the copy changed, with no gap between checking and
    // writing. A weak one cannot be matched that way (D4) and keeps the read
    // and comparison every rewrite used to make. With no version at all the
    // rewrite goes ahead unchecked, as it always has (D3).
    const ifMatch = overwrite ? ifMatchFor(expectedTargetVersion) : undefined;
    if (overwrite && expectedTargetVersion !== undefined && ifMatch === undefined) {
      const verdict = ownershipOf(expectedTargetVersion, await this.currentEtag(eventPath));
      if (verdict === 'changed') {
        return { path: eventPath, conflicted: true };
      }
    }

    const response = await this.requestWithRetry({
      method: 'PUT',
      url: this.buildUrl(eventPath),
      // NEUTERED, at the one choke point every calendar byte passes through
      // (0103 T1 / ADR-0043). SCHEDULE-AGENT=CLIENT on every ATTENDEE and
      // ORGANIZER, so an RFC 6638 target stores the copy instead of MAILING
      // the attendees of every migrated meeting — and so our own later
      // DELETE (take-back, gated apply) does not fan out CANCELs. This
      // cannot disturb change detection: calendarContentHash fingerprints
      // UID/SUMMARY/DESCRIPTION/LOCATION only, pinned by test.
      //
      // A target that mails guests regardless (Cirrux, 2026-11-19, workplan
      // 0160) gets no guest at all: each ATTENDEE and ORGANIZER becomes a
      // COMMENT naming them, which is not fingerprinted either.
      body: neutraliseScheduling(this.config.mailsGuests ? withoutGuests(raw.icalendar) : raw.icalendar),
      headers: {
        'Content-Type': 'text/calendar',
        // Create-only, atomically, UNLESS this is a deliberate rewrite.
        //
        // The precondition is what makes hard rule 2 hold at the protocol
        // level: the existence check and this write are separate requests, so
        // on its own that pairing is check-then-act, and anything appearing at
        // this href in between would be silently REPLACED. 412 then means
        // "someone got there first": what is there is asked about below, and
        // adopted only on the server's word (workplan 0149 T1).
        //
        // On the update path replacing IS the intent, and the ownership
        // decision was already made upstream against the ledger
        // (`classifyKnownItem`: only an item we copied ourselves, never one the
        // destination already had). Sending the precondition anyway made the
        // server refuse with 412, which this method then reported as success —
        // so the rewrite silently did nothing while the pass counted
        // `updated: 1`. The update path's precondition is the other one:
        // `If-Match` with the version we recorded, when it is strong (above).
        ...(overwrite ? (ifMatch !== undefined ? { 'If-Match': ifMatch } : {}) : { 'If-None-Match': '*' }),
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    // 412: SOMETHING IS ALREADY AT THIS HREF, AND IT IS NOT OURS (workplan
    // 0149 T1).
    //
    // This returned the bare path, which the caller took for a write: the row
    // was recorded `copied`, so a source change later overwrote it and *apply
    // deletions* would remove it — an item the customer already had, treated
    // as one we wrote. Nothing in a 412 says whose the object is. It may have
    // appeared since the snapshot, a failed lookup may have hidden it, or our
    // own PUT may have landed behind a 5xx its retry never saw.
    //
    // So the collection is asked who holds this UID, as the refusal of the
    // UID below is. An object the server names is adopted: never rewritten
    // and never removed as ours, including, at worst, our own landed copy.
    // With none named, the href holds something else, and the item fails.
    //
    // On the overwrite path it is `If-Match` refusing (workplan 0149 T3): the
    // copy is no longer the one we wrote, so nothing was written and it is the
    // owner's now (hard rule 2). A server that refuses to replace with no
    // precondition sent gets the same answer: not written, and not reported as
    // a rewrite.
    if (response.status === 412) {
      if (overwrite) return { path: eventPath, conflicted: true };
      const held = await this.uidAlreadyHeldAt(calendarId, raw, uid);
      if (held !== undefined) return { path: held, alreadyHeld: true };
      throw withFailureCategory(
        'target_refused',
        new Error(
          `PUT for ${eventPath} was refused with 412: the target already holds something at that ` +
            'address. ' +
            (this.ledgerKeyTextFor(raw, uid) !== uid
              ? 'This is a modified occurrence of a recurring series, and one is never recorded ' +
                "against what holds its series' UID. "
              : `No object in ${calendarId} carries this item's UID, so what is there is something ` +
                'else. ') +
            'Nothing was written, and nothing was recorded.',
        ),
      );
    }

    if (response.status !== 201 && response.status !== 204) {
      // THE 412 ABOVE, ON THE OTHER AXIS. `If-None-Match: *` makes the write
      // atomic against the HREF; RFC 4791 §5.3.2's uniqueness rule is on the
      // UID, and the href is ours to choose. So a second source handle
      // carrying one UID finds its own path free, the precondition does not
      // fire, and the server refuses the body instead. See dav-uid-conflict.ts
      // for why that was reaching the operator as `unknown`.
      //
      // Read BEFORE `refusalDetail`, which costs a PROPFIND to diagnose a
      // refusal this branch is not going to report.
      if (!overwrite && refusalSaysUidAlreadyPresent(response.body)) {
        const held = await this.uidAlreadyHeldAt(calendarId, raw, uid);
        // Only ever on an href the SERVER named. A refusal is a claim about
        // the collection, not a handle to the object, and recording an item
        // against a path we inferred is how the last defect in this file
        // worked.
        if (held !== undefined) return { path: held, alreadyHeld: true };
      }

      // A REFUSAL NAMES THE COMPONENT, NEVER A BARE 403 (workplan 0113 T4).
      //
      // A CalDAV collection may declare which components it accepts (RFC 4791
      // §5.2.3), and writing a VTODO into a VEVENT-only calendar is refused —
      // by SabreDAV with a 403 whose body is a stack of XML, which tells the
      // reader nothing they can act on. So on the refusal path only (never on a
      // write that worked) the collection is asked what it accepts, and the
      // sentence says which component was written and which the target takes.
      throw withFailureCategory(
        'target_refused',
        // The write did not happen and the destination is where to look. Stated
        // rather than left to the regex, because this throw site has already
        // branched on why — see stated-failure-category.ts. The 400 that
        // carried Rob's four events matched no rule and read `unknown`, whose
        // remedy is "send it to us and we will look".
        new Error(await this.refusalDetail(calendarId, eventPath, raw.icalendar, response)),
      );
    }

    // What the server says this object is now. Recorded so a later pass can
    // tell whether the copy is still the one we made; absent is fine and simply
    // costs this item its overwrite protection.
    // `readVersion`, not `readEtag`: a weak ETag is recorded as weak (0149 T3).
    const version = readVersion(response);
    return { path: eventPath, ...(version !== undefined ? { etag: version } : {}) };
  }

  /**
   * Where the collection is already holding this item's UID — `undefined`
   * when we must not claim what is there.
   *
   * Asked after either refusal of a create: the 412 on the href and the
   * server's refusal of the UID. One rule for both (workplan 0149 T1).
   *
   * KEYED BY THE UID ALONE, OR NOT AT ALL. `naturalKeyForCalendar` appends
   * RECURRENCE-ID for a modified occurrence, so a series and its override are
   * two ledger items sharing one iCalendar UID — that sharing is precisely
   * what makes them one event (RFC 5545 §3.8.4.4). The object already in the
   * collection under that UID is then the SERIES, and it is not this item:
   * recording the override against it would report the override migrated with
   * nothing of it on the target, and a later rewrite would replace the whole
   * series with the override alone.
   *
   * The test asks the same function the ledger key comes from rather than
   * scanning the body for the property, so the two cannot drift apart.
   */
  private async uidAlreadyHeldAt(
    calendarId: string,
    raw: RawCalendarEvent,
    uid: string,
  ): Promise<string | undefined> {
    if (this.ledgerKeyTextFor(raw, uid) !== uid) return undefined;
    return this.findCalendarByNaturalKey(calendarId, uid, componentOfIcalendar(raw.icalendar));
  }

  /**
   * Why a PUT was refused, in a sentence a person can act on.
   *
   * Costs one PROPFIND, and only when a write has ALREADY failed — the happy
   * path is untouched. When the collection's declared component set does not
   * include what was being written, that is almost certainly the cause and the
   * message says so by name; otherwise the server's own status and body are
   * reported unchanged, because a guess dressed as a diagnosis is worse than
   * the raw refusal (§11.2's honest passthrough).
   */
  private async refusalDetail(
    calendarId: string,
    eventPath: string,
    icalendar: string,
    response: { status: number; body: string },
  ): Promise<string> {
    // The server's own words, plus anything structurally wrong with the object
    // we sent. Empty for a well-formed one, so this cannot dress a clean
    // refusal in a diagnosis it has not earned — the rule this method already
    // follows for the component check below.
    const plain =
      `PUT failed for ${eventPath} with status ${response.status}: ` +
      `${davRefusalBody(response.body)}${payloadDefectNote(icalendar)}`;
    // A 404 to a PUT usually means the calendar itself is not there, which is
    // what every one of 25 refusals meant on 2026-11-19 (workplan 0160), and
    // which the server's own words did not say.
    if (response.status === 404 && (await this.collectionStatus(calendarId)) === 404) {
      return (
        `PUT failed for ${eventPath} with status 404: the calendar ${calendarId} is not on the server, ` +
        `so nothing can be written into it. Server said: ${davRefusalBody(response.body)}`
      );
    }
    const component = componentOfIcalendar(icalendar);
    if (!component) return plain;
    let accepted: ReadonlyArray<CalendarComponent> | undefined;
    try {
      accepted = await this.collectionComponents(calendarId);
    } catch {
      // The diagnosis is a courtesy; failing to fetch it must never replace the
      // real refusal with an error about the courtesy.
      return plain;
    }
    if (!accepted || accepted.includes(component)) return plain;
    return (
      `PUT failed for ${eventPath} with status ${response.status}: the target collection ` +
      `${calendarId} accepts ${accepted.join(', ')} and this object is a ${component}. ` +
      'A CalDAV collection declares which components it holds (RFC 4791 §5.2.3); this one ' +
      `does not hold ${component}, so the write cannot land here. Server said: ${davRefusalBody(response.body)}`
    );
  }

  /** What a target collection says it accepts, or undefined when it says nothing. */
  private async collectionComponents(
    calendarPath: string,
  ): Promise<ReadonlyArray<CalendarComponent> | undefined> {
    const response = await this.requestWithRetry({
      method: 'PROPFIND',
      url: this.buildUrl(calendarPath),
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
          <D:prop><C:supported-calendar-component-set/></D:prop>
        </D:propfind>`,
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });
    if (response.status !== 207) return undefined;
    return componentsDeclaredIn(response.body);
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Remove an event this writer wrote (implements `TargetRemover`).
   *
   * Reached solely through an explicit owner decision in `applyDeletion` — see that
   * function for the gates.
   *
   * Always reports `deleted`, even on a server that in fact keeps deleted calendar
   * objects for a while: which servers do is version-dependent and this code cannot
   * tell which version it is talking to. Understating recoverability is the safe
   * direction to be wrong in — the reverse promises a recovery path that may not
   * exist.
   */
  async removeItem(
    targetId: string,
    options?: { readonly expectedTargetVersion?: string },
  ): Promise<RemovalResult> {
    assertRemovableTargetId(targetId, 'this item');
    return removeDavResource({
      url: this.buildUrl(targetId),
      authorization: this.authHeader(),
      request: (opts) => this.httpClient.request(opts),
      kind: 'deleted',
      // A copy that still lists guests is not deleted at a target that mails
      // them a cancellation for it (workplan 0160): see `keepIfItListsGuests`.
      ...(this.config.mailsGuests ? { keepIfItListsGuests: true } : {}),
      ...(options?.expectedTargetVersion !== undefined
        ? { expectedTargetVersion: options.expectedTargetVersion }
        : {}),
    });
  }

  private buildUrl(path: string): string {
    const baseUrl = this.config.url.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    return `${baseUrl}/${normalizedPath}`;
  }
}

/**
 * HTTP client interface for CalDAV requests
 */
export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

export interface HttpRequestOptions {
  method: string;
  url: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Create a default HTTP client using Node.js fetch
 */
function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const response = await tenantFetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body,
        headers,
      };
    },
  };
}
