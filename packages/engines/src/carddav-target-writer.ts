// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CardDAV Target Writer Implementation
 * 
 * Implements ContactTargetWriter interface for CardDAV contact synchronization.
 * Uses vdirsyncer for bulk operations and direct CardDAV API calls for individual operations.
 * Follows the idempotency pattern with ledger fast-path and target-side existence checks.
 */

import type {
  ContactTargetWriter,
  ContactFolder,
  RawContact,
  UpsertResult,
  UpsertOptions,
  Ledger,
  TenantId,
  MappingId,
  TargetReindexer,
  TargetEntry,
  RemovalResult,
} from '@openmig/shared';
import {
  contactNaturalKeyHash,
  contactContentHash,
  displayNameForContact,
  isOnTarget,
} from '@openmig/shared';
import { carddavMatchAllFilter, carddavUidFilter, davRefusalBody } from '@openmig/shared';
import { payloadDefectNote, repairPayload } from './dav-payload-defects.ts';
import { collectionSlug } from './dav-collection-path.ts';
import {
  parseMultiStatus,
  firstElementText,
  findHrefByUid,
  hasResourceType,
  extractUid,
  hrefRelativeTo,
  targetIdRelativeTo,
  unescapeXml,
  sizeOf,
} from './dav-multistatus.ts';
import { requestWithDavRetry } from './dav-retry.ts';
import { readEtag, ownershipOf } from './dav-target-version.ts';
import { removeDavResource, assertRemovableTargetId } from './dav-remove.ts';
import { log } from '@openmig/shared';

/**
 * Configuration for CardDAV target writer
 */
export interface CardDAVTargetConfig {
  /** CardDAV endpoint URL */
  url: string;
  /** Authentication username */
  username: string;
  /** Authentication password or token */
  password: string;
  /** Address book home set path */
  homeSet?: string;
  /** Default address book description */
  description?: string;
}

/**
 * CardDAV target writer implementation
 */
export class CardDAVTargetWriter implements ContactTargetWriter, TargetReindexer {
  private readonly config: CardDAVTargetConfig;
  private readonly ledger: Ledger;
  private readonly tenantId: TenantId;
  private readonly mappingId: MappingId;
  private readonly httpClient: HttpClient;
  /**
   * Per-collection snapshot of what the target already holds, natural key ->
   * href. One `addressbook-query` REPORT for the whole book replaces one per
   * item; see the CalDAV writer for the measurement that motivated it.
   */
  private readonly collectionKeys = new Map<string, Promise<Map<string, string> | undefined>>();

  constructor(
    config: CardDAVTargetConfig,
    deps: {
      ledger: Ledger;
      tenantId: TenantId;
      mappingId: MappingId;
      httpClient?: HttpClient;
    },
  ) {
    this.config = config;
    this.ledger = deps.ledger;
    this.tenantId = deps.tenantId;
    this.mappingId = deps.mappingId;
    this.httpClient = deps.httpClient ?? createDefaultHttpClient();
  }

  /**
   * Ensure an address book exists with the given folder metadata.
   * Returns the address book ID (href) for use in subsequent operations.
   */
  async ensureContactFolder(folder: ContactFolder): Promise<string> {
    // Re-home the address book under THIS writer's own account (see collectionSlug):
    // the folder handed to us by the domain-sync loop is the SOURCE collection, which
    // in a cross-account migration belongs to a different user/server. Nextcloud/SabreDAV
    // serve a user's address books under addressbooks/users/<user>/.
    const addressBookPath = this.normalizeAddressBookPath(
      `addressbooks/users/${this.config.username}/${collectionSlug(folder.name, folder.path, 'contacts')}`,
    );

    // Check if address book already exists via PROPFIND
    const exists = await this.addressBookExists(addressBookPath);
    if (exists) {
      return addressBookPath;
    }

    // Create new address book using MKCOL
    await this.createAddressBook(addressBookPath, folder);
    return addressBookPath;
  }

  /**
   * Idempotently write a contact to the target.
   * Uses ledger fast-path and target-side UID check to ensure idempotency.
   */
  async upsertContact(
    folderId: string,
    rawIn: RawContact,
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    /**
     * THE REPAIR, FIRST — before anything reads the bytes (workplan 0124 T1).
     *
     * A `,` standing where a `;` belongs folds the next parameter into the
     * previous one's value list, and a spec-compliant parser is entitled to
     * refuse the card. Two of the owner's 1,400 contacts carried it and were
     * refused five times each. He chose to correct it on the way out rather
     * than only after a refusal: *"we already now it needs repairing, because
     * else it will not land in the target."*
     *
     * FIRST is not a style choice. `contactContentHash` runs below, and hashing
     * the UNREPAIRED bytes would store the hash of something we never sent —
     * so every later pass would compare the source against a hash that does not
     * describe what is on the target, see a change nobody made, and rewrite the
     * card nightly. The repaired body is what goes out, what is hashed, and
     * what is measured, or the three disagree.
     *
     * Deterministic, so this is stable across passes: the same source card
     * yields the same repaired bytes and therefore the same hash. And the
     * repair is idempotent, so a card that needed nothing — almost all of them
     * — comes back as the SAME STRING and everything below is untouched.
     */
    const repair = repairPayload(rawIn.vcard);
    const raw: RawContact =
      repair.corrections.length === 0 ? rawIn : { ...rawIn, vcard: repair.body };
    // Joined once and passed to whichever `recordIfAbsent` wins the race below.
    // `undefined` for a well-formed card, which leaves the column NULL — the
    // honest value for "nothing was corrected".
    const repaired = repair.corrections.length > 0 ? repair.corrections.join('; ') : undefined;

    // Extract UID from vCard data
    const uid = this.extractUidFromVcard(raw.vcard);
    const naturalKey = uid;
    const naturalKeyHash = contactNaturalKeyHash(naturalKey);
    // The card's FN. Recorded here as well as by the loop for the same reason
    // `naturalKey` is: this writer can win the `recordIfAbsent` race, and a
    // field only the loser passes is a field that never lands.
    const name = displayNameForContact(raw.item);

    // UPDATE PATH: the source card changed after we copied it. See the same
    // branch in caldav-target-writer.ts for why this precedes the fast-path
    // and why it can never touch an item the destination already held.
    if (options?.overwrite) {
      const written = await this.uploadContact(
        folderId,
        raw,
        uid,
        true,
        options.expectedTargetVersion,
      );
      if (written.conflicted) {
        return { targetId: written.path, created: false, conflicted: true };
      }
      (await this.keysIn(folderId))?.set(naturalKey, written.path);
      return {
        targetId: written.path,
        created: false,
        updated: true,
        ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
      };
    }

    // LEDGER FAST-PATH: Check if already migrated
    const known = await this.ledger.find(this.tenantId, this.mappingId, 'contact', naturalKeyHash);
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
    const contentHashValue = contactContentHash(raw.vcard);
    // Recorded here, not only by the sync loop: `recordIfAbsent` makes the first
    // writer win, and that is this one. See webdav-target-writer.ts.
    const sizeBytes = Buffer.byteLength(raw.vcard, 'utf8');

    // Check if contact already exists on target (by UID)
    const existingId = await this.existingTargetId(folderId, naturalKey);
    if (existingId) {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: 'contact',
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
        // The vCard UID, unhashed, so the confirmed list can name this card.
        // Recorded here as well as by the loop for the same race as above.
        naturalKey,
        // And the person's name, which is the half a UID cannot give.
        ...(name !== undefined ? { displayName: name } : {}),
        // Carried even on the ADOPTED path, where nothing was written. The
        // repair still happened — to the bytes we hashed and compared against
        // the destination's copy — so a row that says we corrected something is
        // telling the truth about what this pass did, and one that stayed
        // silent would not.
        ...(repaired !== undefined ? { repaired } : {}),
      });
      return { targetId: existingId, created: false, adopted: true };
    }

    // Upload the contact to the address book
    const written = await this.uploadContact(folderId, raw, uid);
    const contactId = written.path;
    (await this.keysIn(folderId))?.set(naturalKey, contactId);

    // RECORD IN LEDGER
    await this.ledger.recordIfAbsent({
      tenantId: this.tenantId,
        itemType: 'contact',
      mappingId: this.mappingId,
      naturalKeyHash,
      contentHash: contentHashValue,
      targetId: contactId,
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
      // The vCard UID, unhashed, so the confirmed list can name this card.
      // Recorded here as well as by the loop for the same race as above.
      naturalKey,
      // And the person's name, which is the half a UID cannot give.
      ...(name !== undefined ? { displayName: name } : {}),
      // NOT from the loop: only this writer saw the server's answer to the PUT.
      ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
      // What we corrected in the bytes we just PUT (workplan 0124 T1). Only
      // this writer knows — the loop never sees the payload — so it is recorded
      // here or nowhere.
      ...(repaired !== undefined ? { repaired } : {}),
    });

    return {
      targetId: contactId,
      created: true,
      ...(written.etag !== undefined ? { targetVersion: written.etag } : {}),
    };
  }

  /** Natural key -> href for this address book; undefined when it cannot be listed. */
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
            `[carddav] could not list ${collectionId} up front, falling back to a per-item ` +
              `existence check: ${err instanceof Error ? err.message : String(err)}`,
          );
          return undefined;
        }
      })();
      this.collectionKeys.set(collectionId, pending);
    }
    return pending;
  }

  /** Is this contact already on the target? Snapshot first, per-item REPORT as fallback. */
  private async existingTargetId(
    collectionId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    const keys = await this.keysIn(collectionId);
    if (keys) return keys.get(naturalKey);
    return this.findContactByNaturalKey(collectionId, naturalKey);
  }

  /**
   * Find a contact by its natural key (UID).
   * Returns the contact ID if found, undefined otherwise.
   *
   * THE FALLBACK PATH, AND IT SPOKE CALDAV. `keysIn` answers this for the
   * whole address book in one REPORT and this runs only where that could not
   * be listed — so its wrongness was invisible for as long as the listing
   * worked, and total on the day it did not. Four defects, all in this
   * request:
   *
   *   - a `VADDRESSBOOK`/`VCARD` comp-filter nesting, copied from the CalDAV
   *     writer beside it. RFC 6352 has no comp-filter; §8.6's own example
   *     filters on a prop-filter directly, because a vCard is not a container
   *     of components the way a VCALENDAR is;
   *   - no `match-type`, which §10.5.4 defaults to `contains` — so the check
   *     deciding create-vs-update was a substring search;
   *   - no `Depth` header, which §8.6 makes a MUST and RFC 3253 defaults to
   *     0 for REPORT: the query never left the collection resource itself.
   *     Every other REPORT in this file and the CalDAV one sends `Depth: 1`;
   *   - and the answer was read off the href rather than the card.
   *
   * Together they mean a server that rejected the body (400) and a server
   * that accepted it (nothing at Depth 0) both said "not on the target", so
   * every contact took the create path on every pass. Nothing was lost — the
   * PUT is by UID-derived path, so it overwrites its own earlier copy — but
   * an adoption that never happens is a ledger with no row to verify against.
   */
  async findContactByNaturalKey(
    folderId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    // Use CardDAV REPORT to search for contacts by UID
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
        <D:prop>
          <D:resourcetype/>
          <C:address-data/>
        </D:prop>
        ${carddavUidFilter(naturalKey, 'C')}
      </C:addressbook-query>`;

    const response = await this.httpClient.request({
      method: 'REPORT',
      url: this.buildUrl(folderId),
      body: query,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status === 207) {
      // The server's match is case-insensitive (§10.5.4's default collation);
      // `findHrefByUid` compares the returned card's own UID exactly.
      const href = findHrefByUid(response.body, naturalKey, 'address-data');
      // Converted here for the same reason as the CalDAV writer's: this is
      // what the adoption path records as `targetId`.
      return href === undefined ? undefined : targetIdRelativeTo(href, this.buildUrl(''));
    }

    return undefined;
  }

  /**
   * Stream every contact on this target, keyed the way the ledger keys them.
   *
   * `naturalKey` is the vCard UID — exactly what `upsertContact` hashes with
   * `contactNaturalKeyHash` — and `targetId` is the resource href, matching the
   * ledger's target id. Without this the contacts domain was NOT_VERIFIABLE and
   * blocked any cutover that had copied contacts.
   *
   * @param mailboxId Restrict to one address book path. Omitted, every address
   *   book under this account is walked.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    const books = mailboxId ? [mailboxId] : await this.listAddressBooks();

    for (const bookPath of books) {
      for await (const entry of this.listContactsIn(bookPath)) {
        yield entry;
      }
    }
  }

  /** Every address book under `addressbooks/users/<username>/`. */
  private async listAddressBooks(): Promise<string[]> {
    const homeSet = this.normalizeAddressBookPath(`addressbooks/users/${this.config.username}`);
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
      // An empty list here would read as "the target holds no contacts", which
      // verification reports as total data loss. Fail loudly (hard rule 9).
      throw new Error(
        `PROPFIND on address book home set ${homeSet} failed with status ${response.status}: ${davRefusalBody(response.body)}`,
      );
    }

    // Hrefs are SERVER-absolute; `buildUrl` concatenates onto the configured
    // base. Passing them through unconverted doubled the DAV prefix — see the
    // identical fix and the real 404 it produced in caldav-target-writer.ts.
    return parseMultiStatus(response.body)
      .filter((r) => hasResourceType(r.xml, 'addressbook'))
      .map((r) => hrefRelativeTo(r.href, this.buildUrl('')))
      // Outside the base, or the home set itself, which is not an address book.
      .filter((relative): relative is string => relative !== undefined && relative !== '')
      .map((relative) => this.normalizeAddressBookPath(relative))
      .filter((path) => path !== homeSet);
  }

  /** Every vCard in one address book, as ledger-shaped entries. */
  private async *listContactsIn(bookPath: string): AsyncIterable<TargetEntry> {
    // Partial retrieval (RFC 6352 §10.4): ask for the UID property rather than
    // the whole vCard. Enumeration is metadata-only by contract.
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
        <D:prop>
          <D:getetag/>
          <D:getcontentlength/>
          <C:address-data>
            <C:prop name="UID"/>
          </C:address-data>
        </D:prop>
        ${carddavMatchAllFilter('C')}
      </C:addressbook-query>`;

    const response = await this.httpClient.request({
      method: 'REPORT',
      url: this.buildUrl(bookPath),
      body: query,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: this.authHeader(),
      },
    });

    if (response.status !== 207) {
      throw new Error(
        `addressbook-query REPORT on ${bookPath} failed with status ${response.status}: ${davRefusalBody(response.body)}`,
      );
    }

    for (const item of parseMultiStatus(response.body)) {
      const data = firstElementText(item.xml, 'address-data');
      if (data === undefined) continue; // the collection itself, not a vCard
      const uid = extractUid(unescapeXml(data));
      if (!uid) {
        // Falling back to the href would mis-key a contact that is actually
        // present, making it look missing — the ADR-0020 failure mode.
        throw new Error(`Contact resource ${item.href} returned no UID; cannot key it for verification.`);
      }
      yield {
        naturalKey: uid,
        targetId: targetIdRelativeTo(item.href, this.buildUrl('')),
        mailboxId: bookPath,
        ...sizeOf(item.xml),
        // No contentHash from the LISTING: it fetches only the UID.
        // `contentHashFor` below fingerprints sampled items canonically.
      };
    }
  }

  /**
   * A canonical content fingerprint for one sampled contact. Mirrors the CalDAV
   * writer — see its `contentHashFor` and dav-canonical.ts for what a match
   * does and does not claim.
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
      log.warn(`[carddav] GET ${entry.targetId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }

    if (response.status !== 200) {
      log.warn(`[carddav] GET ${entry.targetId} -> ${response.status}; cannot content-verify it`);
      return undefined;
    }

    return contactContentHash(response.body);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
  }

  // Private helper methods

  private normalizeAddressBookPath(path: string): string {
    // Normalize path to ensure consistent format
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    // Ensure .vcf extension for individual contacts, no extension for address books
    if (normalized.endsWith('.vcf/')) {
      normalized = normalized.slice(0, -4);
    }
    return normalized;
  }

  private async addressBookExists(path: string): Promise<boolean> {
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
      // A failed PROPFIND is "I could not check", and this returns it as
      // "it does not exist" — which sends the caller on to create it. That
      // is not destructive (MKCOL on an existing collection is refused by the
      // server, it does not replace anything), but the error the operator
      // then sees is a confusing create failure rather than the connectivity
      // problem that actually happened. So the real reason is logged here.
      log.warn(
        `[carddav] could not check whether ${path} exists: ` +
          `${err instanceof Error ? err.message : String(err)}; treating it as absent`,
      );
      return false;
    }
  }

  private async createAddressBook(path: string, folder: ContactFolder): Promise<void> {
    // RFC 5689 Extended MKCOL (required by RFC 6352 §5.2 to create a CardDAV addressbook):
    // a plain MKCOL with no resourcetype just creates an ordinary WebDAV collection, invisible
    // to CardDAV discovery (which filters PROPFIND results by the {addressbook} resourcetype).
    const mkcol = `<?xml version="1.0" encoding="utf-8"?>
      <D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
        <D:set>
          <D:prop>
            <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
            <D:displayname>${this.escapeXml(folder.name || folder.path)}</D:displayname>
            ${folder.description ? `<C:addressbook-description>${this.escapeXml(folder.description)}</C:addressbook-description>` : ''}
          </D:prop>
        </D:set>
      </D:mkcol>`;

    const response = await this.requestWithRetry({
      method: 'MKCOL',
      url: this.buildUrl(path),
      body: mkcol,
      headers: {
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status !== 201) {
      throw new Error(`MKCOL failed for ${path} with status ${response.status}: ${davRefusalBody(response.body)}`);
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

  /**
   * THE UID, WHOLE (2026-09-17).
   *
   * This read `uidMatch[0].split(':')` and returned `parts[1]`, which is the
   * first colon-separated piece of the value and not the value:
   *
   *     UID:urn:uuid:8f2b…   →   'urn'
   *
   * `urn:uuid:` UIDs are what Apple, Nextcloud and many DAV servers emit, so
   * for a whole class of source data every card resolved to the SAME uid —
   * and therefore to the same filename, `urn.vcf`. The first card landed; the
   * second got a 412, which `uploadContact` reads as *"something is already
   * there, and it is exactly what we would have written"* and records as
   * placed. It was somebody else's card. That is silent loss, and the shape of
   * it — a wrong answer recorded as a good one — is worse than a failure.
   *
   * `extractUid` in `dav-multistatus.ts` has been correct the whole time: it
   * takes everything after the FIRST colon, tolerates a parameter
   * (`UID;VALUE=text:…`) and unfolds a wrapped line first. Both writers kept a
   * private broken copy instead; both now use the shared one.
   */
  private extractUidFromVcard(vcard: string): string {
    const uid = extractUid(vcard);
    if (uid === undefined) {
      throw new Error('Invalid vCard data: missing UID');
    }
    return uid;
  }

  /** See the same method in caldav-target-writer.ts. */
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

  private async uploadContact(
    folderId: string,
    raw: RawContact,
    uid: string,
    overwrite = false,
    expectedTargetVersion?: string,
  ): Promise<{ path: string; etag?: string; conflicted?: boolean }> {
    // Generate contact filename from UID
    const filename = `${uid}.vcf`;
    const contactPath = `${folderId}${filename}`;

    // Ownership, re-checked at the last possible moment. See the same guard in
    // caldav-target-writer.ts: the ledger's status records that we WROTE these
    // bytes, not that they are still the bytes we wrote.
    if (overwrite && expectedTargetVersion !== undefined) {
      const verdict = ownershipOf(expectedTargetVersion, await this.currentEtag(contactPath));
      if (verdict === 'changed') {
        return { path: contactPath, conflicted: true };
      }
    }

    const response = await this.requestWithRetry({
      method: 'PUT',
      url: this.buildUrl(contactPath),
      body: raw.vcard,
      headers: {
        'Content-Type': 'text/vcard',
        // Create-only, atomically, UNLESS this is a deliberate rewrite. See
        // the same header in caldav-target-writer.ts: sending the precondition
        // on the update path made the server refuse with 412, which this
        // method reports as success — a rewrite that silently did nothing
        // while the pass counted it as updated.
        ...(overwrite ? {} : { 'If-None-Match': '*' }),
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    // 412: something is already there. Not an error — the snapshot was merely
    // stale, and the resource is exactly what we would have written. On the
    // overwrite path it means the server refused to replace, which must not be
    // reported as a successful rewrite.
    if (response.status === 412) {
      if (overwrite) {
        throw new Error(
          `PUT for ${contactPath} was refused with 412 on a deliberate rewrite. ` +
            'The item was NOT replaced.',
        );
      }
      // Something was already there, so its version is not ours to claim.
      return { path: contactPath };
    }

    if (response.status !== 201 && response.status !== 204) {
      // What the SERVER said, then what is wrong with what WE sent — appended
      // only when there is something to append. A Sabre `TypeError` names no
      // property and no line, so on a refused card this note is the whole
      // diagnosis; on a well-formed one it is empty and the refusal reads
      // exactly as it did before.
      throw new Error(
        `PUT failed for ${contactPath} with status ${response.status}: ` +
          `${davRefusalBody(response.body)}${payloadDefectNote(raw.vcard)}`,
      );
    }

    return {
      path: contactPath,
      ...(readEtag(response) !== undefined ? { etag: readEtag(response) } : {}),
    };
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
   * Remove a card this writer wrote (implements `TargetRemover`).
   *
   * Reached solely through an explicit owner decision in `applyDeletion` — see that
   * function for the gates. Reports `deleted` for the same reason as the calendar
   * writer: whether an address book keeps a deleted card is version-dependent, and
   * understating recoverability is the safe direction to be wrong in.
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
 * HTTP client interface for CardDAV requests
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
