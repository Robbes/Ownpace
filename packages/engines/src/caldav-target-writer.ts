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
} from '@openmig/shared';
import { calendarNaturalKeyHash, calendarContentHash, isOnTarget, neutraliseScheduling } from '@openmig/shared';
import { CALENDAR_COMPONENTS, componentOfIcalendar } from '@openmig/shared';
import type { CalendarComponent } from '@openmig/shared';
import { collectionSlug } from './dav-collection-path.ts';
import {
  parseMultiStatus,
  firstElementText,
  hasResourceType,
  extractUid,
  decodeHref,
  hrefRelativeTo,
  unescapeXml,
  sizeOf,
} from './dav-multistatus.ts';
import { requestWithDavRetry } from './dav-retry.ts';
import { readEtag, ownershipOf } from './dav-target-version.ts';
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
}

/**
 * The two domains a CalDAV writer can be filing for.
 *
 * Narrower than `DiscoveryDomain` on purpose: this writer speaks CalDAV, so
 * `email`, `contact` and `file` are not answers it could ever want, and a
 * union that admitted them would let a caller hand one over by mistake.
 */
export type CalDavLedgerDomain = Extract<DiscoveryDomain, 'calendar' | 'task'>;

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
    // stable slug from the folder and re-home it under calendars/<target-user>/.
    const calendarPath = this.normalizeCalendarPath(
      `calendars/${this.config.username}/${collectionSlug(folder.name, folder.path, 'calendar')}`,
    );

    // Check if calendar already exists via PROPFIND
    const exists = await this.calendarExists(calendarPath);
    if (exists) {
      return calendarPath;
    }

    // Create new calendar using MKCALENDAR
    await this.createCalendar(calendarPath, folder);
    return calendarPath;
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
    const naturalKey = uid;
    const naturalKeyHash = calendarNaturalKeyHash(naturalKey);

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
    if (existingId) {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: this.domain,
        mappingId: this.mappingId,
        naturalKeyHash,
        contentHash: contentHashValue,
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
      });
      return { targetId: existingId, created: false, adopted: true };
    }

    // Upload the event to the calendar
    const written = await this.uploadEvent(calendarId, raw, uid);
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
   * Returns the event ID if found, undefined otherwise.
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

    const response = await this.httpClient.request({
      method: 'REPORT',
      url: this.buildUrl(calendarId),
      body: query,
      headers: {
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status === 207) {
      // Multi-status response - parse for matching resources
      const href = this.parseMultiStatusResponse(response.body, naturalKey);
      return href || undefined;
    }

    return undefined;
  }

  /**
   * Stream every event on this target, keyed the way the ledger keys them.
   *
   * This is what makes calendar verifiable at all. Until it existed, only the
   * two mail targets implemented `TargetReindexer`, so `runVerification` had no
   * way to read a calendar target and reported the whole domain
   * NOT_VERIFIABLE — blocking any cutover that had actually copied events.
   *
   * `naturalKey` is the VEVENT UID, exactly what `upsertCalendarEvent` hashes
   * with `calendarNaturalKeyHash`. `targetId` is the resource href, matching
   * what that method records as the ledger's target id.
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

  /** Every calendar collection under `calendars/<username>/`. */
  private async listCalendarCollections(): Promise<string[]> {
    const homeSet = this.normalizeCalendarPath(`calendars/${this.config.username}`);
    const response = await this.httpClient.request({
      method: 'PROPFIND',
      url: this.buildUrl(homeSet),
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: this.authHeader(),
      },
    });

    if (response.status !== 207) {
      // Failing loudly matters more here than anywhere else: an empty list is
      // indistinguishable from "the target has no events", which verification
      // would report as total data loss (hard rule 9).
      throw new Error(
        `PROPFIND on calendar home set ${homeSet} failed with status ${response.status}: ${response.body}`,
      );
    }

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
    return parseMultiStatus(response.body)
      .filter((r) => hasResourceType(r.xml, 'calendar'))
      .map((r) => hrefRelativeTo(r.href, this.buildUrl('')))
      // An href outside the configured base is not ours to read; dropping it is
      // right, and `''` is the home set itself — not a calendar, though some
      // servers list it.
      .filter((relative): relative is string => relative !== undefined && relative !== '')
      .map((relative) => this.normalizeCalendarPath(relative))
      .filter((path) => path !== homeSet);
  }

  /** Every calendar resource in one collection, as ledger-shaped entries. */
  private async *listEventsIn(calendarPath: string): AsyncIterable<TargetEntry> {
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
              ${CALENDAR_COMPONENTS.map(
                (component) => `<C:comp name="${component}">
                <C:prop name="UID"/>
              </C:comp>`,
              ).join('\n              ')}
            </C:comp>
          </C:calendar-data>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            ${CALENDAR_COMPONENTS.map((component) => `<C:comp-filter name="${component}"/>`).join(
              '\n            ',
            )}
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
        `calendar-query REPORT on ${calendarPath} failed with status ${response.status}: ${response.body}`,
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
        targetId: decodeHref(item.href),
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
    // `targetId` is the resource href, which is SERVER-absolute. Handing it to
    // buildUrl unconverted doubles the DAV prefix — the defect that made every
    // calendar REPORT 404 until hrefRelativeTo was applied to collections.
    const relative = hrefRelativeTo(entry.targetId, this.buildUrl(''));
    if (relative === undefined) {
      log.warn(`[caldav] ${entry.targetId} is outside the configured base; not content-verifying it`);
      return undefined;
    }

    let response: HttpResponse;
    try {
      response = await this.httpClient.request({
        method: 'GET',
        url: this.buildUrl(relative),
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

  private async createCalendar(path: string, folder: CalendarFolder): Promise<void> {
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

    if (response.status !== 201) {
      throw new Error(`MKCALENDAR failed for ${path} with status ${response.status}: ${response.body}`);
    }
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

  private extractUidFromIcalendar(icalendar: string): string {
    const uidMatch = icalendar.match(/UID:[^\r\n]+/i);
    if (!uidMatch) {
      throw new Error('Invalid iCalendar data: missing UID');
    }
    const parts = uidMatch[0].split(':');
    return parts[1]?.trim() ?? '';
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
  ): Promise<{ path: string; etag?: string; conflicted?: boolean }> {
    // Generate event filename from UID
    const filename = `${uid}.ics`;
    const eventPath = `${calendarId}${filename}`;

    // OWNERSHIP, re-checked at the last possible moment.
    //
    // `classifyKnownItem` decided this item is ours to replace from the ledger's
    // status — which records that we WROTE these bytes, not that they are still
    // the bytes we wrote. Shadow migration invites the owner into the new system
    // before cutover; if they corrected this event there, overwriting it now
    // destroys their work silently and counts it as a success.
    if (overwrite && expectedTargetVersion !== undefined) {
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
      body: neutraliseScheduling(raw.icalendar),
      headers: {
        'Content-Type': 'text/calendar',
        // Create-only, atomically, UNLESS this is a deliberate rewrite.
        //
        // The precondition is what makes hard rule 2 hold at the protocol
        // level: the existence check and this write are separate requests, so
        // on its own that pairing is check-then-act, and anything appearing at
        // this href in between would be silently REPLACED. 412 then means
        // "someone got there first", which is not an error — the resource is
        // what we would have written.
        //
        // On the update path replacing IS the intent, and the ownership
        // decision was already made upstream against the ledger
        // (`classifyKnownItem`: only an item we copied ourselves, never one the
        // destination already had). Sending the precondition anyway made the
        // server refuse with 412, which this method reports as success — so the
        // rewrite silently did nothing while the pass counted `updated: 1`.
        ...(overwrite ? {} : { 'If-None-Match': '*' }),
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    // 412: something is already there. Not an error — the caller's snapshot was
    // merely stale, and the resource is exactly what we would have written.
    //
    // Unreachable on the overwrite path, which sends no precondition. If a
    // server returns it anyway, that is a refusal to replace and must not be
    // reported as a successful rewrite.
    if (response.status === 412) {
      if (overwrite) {
        throw new Error(
          `PUT for ${eventPath} was refused with 412 on a deliberate rewrite. ` +
            'The item was NOT replaced; reporting it as updated would record a ' +
            'copy the target does not hold.',
        );
      }
      // Something was already there, so its version is not ours to claim.
      return { path: eventPath };
    }

    if (response.status !== 201 && response.status !== 204) {
      // A REFUSAL NAMES THE COMPONENT, NEVER A BARE 403 (workplan 0113 T4).
      //
      // A CalDAV collection may declare which components it accepts (RFC 4791
      // §5.2.3), and writing a VTODO into a VEVENT-only calendar is refused —
      // by SabreDAV with a 403 whose body is a stack of XML, which tells the
      // reader nothing they can act on. So on the refusal path only (never on a
      // write that worked) the collection is asked what it accepts, and the
      // sentence says which component was written and which the target takes.
      throw new Error(await this.refusalDetail(calendarId, eventPath, raw.icalendar, response));
    }

    // What the server says this object is now. Recorded so a later pass can
    // tell whether the copy is still the one we made; absent is fine and simply
    // costs this item its overwrite protection.
    return { path: eventPath, ...(readEtag(response) !== undefined ? { etag: readEtag(response) } : {}) };
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
    const plain = `PUT failed for ${eventPath} with status ${response.status}: ${response.body}`;
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
      `does not hold ${component}, so the write cannot land here. Server said: ${response.body}`
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
    const set = response.body.match(
      /<[A-Za-z]+:supported-calendar-component-set[^>]*>([\s\S]*?)<\/[A-Za-z]+:supported-calendar-component-set>/i,
    );
    if (!set?.[1]) return undefined;
    const known = new Set<string>(CALENDAR_COMPONENTS);
    const components = [...set[1].matchAll(/<[A-Za-z]*:?comp\s[^>]*name="([^"]+)"/gi)]
      .map((m) => m[1]!.toUpperCase())
      .filter((name) => known.has(name)) as CalendarComponent[];
    return components.length > 0 ? [...new Set(components)] : undefined;
  }

  private parseMultiStatusResponse(
    response: string,
    searchUid: string,
  ): string | null {
    // Parse XML response to find matching href
    const hrefMatches = response.matchAll(/<D:href>([^<]+)<\/D:href>/g);
    for (const match of hrefMatches) {
      const href = match[1];
      if (!href) continue;
      // Check if this resource contains the matching UID
      // In a real implementation, we'd parse the full response
      if (href.includes(searchUid)) {
        return href;
      }
    }
    return null;
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
      const response = await fetch(options.url, {
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
