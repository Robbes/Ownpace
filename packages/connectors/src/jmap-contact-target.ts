// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Contacts as a JMAP target — workplan 0031 T2.1.
 *
 * WHY THIS EXISTS AT ALL. Stalwart already serves contacts over CardDAV and
 * `carddav-target-writer.ts` works. What this buys is the thing the owner
 * decided 0031 for: ONE PROTOCOL PER TARGET — one credential, one failure
 * mode, one set of semantics per migration. DAV is not being replaced;
 * Nextcloud, openDesk and Soverin do not speak JMAP for this domain and their
 * targets stay exactly as they are.
 *
 * ============================================================================
 * THE ONE DESIGN DECISION, AND THE EVIDENCE UNDER IT
 * ============================================================================
 *
 * Every contacts source in this product hands the sync loop a `RawContact`
 * carrying the ORIGINAL vCard TEXT. The CardDAV writer PUTs those bytes
 * verbatim, so nothing is lost because nothing is interpreted. JMAP has no
 * vCard — `ContactCard` is JSContact (RFC 9553) — so this writer must convert,
 * and there were only two ways to do it:
 *
 *   (1) WE convert. The only structured thing we hold besides the vCard text
 *       is `Contact`, our own normalised model, and it is lossy by design: no
 *       IMPP, no ROLE, no GEO, no X- properties, one photo. Every card would
 *       arrive thinner than it left, forever, with a green result and a
 *       correct count.
 *
 *   (2) THE SERVER converts, via `ContactCard/parse` on an uploaded vCard
 *       blob. The mapping is then Stalwart's own — the same one its CardDAV
 *       store uses — so a card written over JMAP holds what a card written
 *       over CardDAV holds.
 *
 * **This writer takes route (2), and the spike proved it rather than assumed
 * it** (`scripts/jmap-target-spike.ts`, step 3b and rungs A-C, 2026-08-05).
 * The decisive rung is C: the card THIS PATH writes, read back out through the
 * CardDAV door, returns every property that went in — `UID` unchanged, a
 * standalone `GEO`, `IMPP`, `ROLE`, `CATEGORIES`, `BDAY`, and even an
 * `X-OPENMIG-PROBE` with no JSContact equivalent at all, carried through the
 * RFC 9555 `vCard` escape hatch.
 *
 * It is NOT byte-identical: Stalwart adds `PROP-ID`, `JSCOMPS` and `JSPROP`
 * round-trip machinery and writes the street into both the legacy `ADR`
 * component and RFC 9554's structured one. Nothing is lost by that, and it is
 * exactly why `contactContentHash` is a canonical fingerprint rather than a
 * hash of bytes.
 *
 * ============================================================================
 * TWO THINGS THIS WRITER CARRIES RATHER THAN FIXES
 * ============================================================================
 *
 * **Every read names `vCard` explicitly.** `ContactCard/get` does NOT
 * volunteer the escape hatch: ask for the card and you get one that looks
 * complete and is not. Asked for by name it is all there. A read that omits it
 * is a PASSING read returning a thinner card, which is the worst shape of
 * failure this repo keeps finding — so `CARD_PROPERTIES` below is the only
 * property list this file uses, and `jmap-contact-target.unit.test.ts` pins it.
 *
 * **There is no §20 checksum leg.** A stored `ContactCard` carries no `blobId`
 * and no other handle back to vCard bytes, so there is nothing to fetch and
 * fingerprint. `contentHashFor` is therefore NOT implemented — deliberately,
 * and said out loud here, because contacts verified over JMAP get counts and
 * presence only. The one way round it is reading the same store back over
 * CardDAV, which costs precisely the one credential and one failure mode this
 * plan exists to buy.
 *
 * @see docs/workplans/0031-jmap-full-target.md — T2, the three rungs and their output
 */

import { loadJmapSession } from './jmap-session.ts';
import type {
  ContactTargetWriter,
  ContactFolder,
  RawContact,
  UpsertResult,
  UpsertOptions,
  TargetReindexer,
  TargetEntry,
  RemovalResult,
} from '@openmig/shared';
import { parseRetryAfterMs, log } from '@openmig/shared';
import { createHash } from 'node:crypto';

/** See `jmap-target.ts` — same server, same reasoning, same numbers. */
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_BASE_BACKOFF_MS = 1000;

/**
 * The ONLY property list this file uses, and the reason it is a constant.
 *
 * `vCard` is the RFC 9555 escape hatch holding every source property with no
 * JSContact equivalent — `X-OPENMIG-PROBE` in the spike, an `X-ABLabel` or an
 * `X-SOCIALPROFILE` in a real address book. Stalwart stores it faithfully and
 * `ContactCard/get` does not volunteer it, so a read that forgets to ask
 * returns a card that LOOKS complete.
 *
 * That is a passing read with missing data, and it would not fail anything: an
 * adopt decision, a reindex row or a card copied onward would all quietly
 * carry less than the target holds. One list, used everywhere, is the cheapest
 * way to make forgetting impossible.
 */
const CARD_PROPERTIES = ['id', 'uid', 'addressBookIds', 'vCard'] as const;

/** The capabilities every request here declares. `parse` is its own URN. */
const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'] as const;
const USING_PARSE = [...USING, 'urn:ietf:params:jmap:contacts:parse'] as const;

/** Connection details. Same shape as the mail writer's, deliberately. */
export interface JmapContactTargetConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  /** Optional well-known discovery path (default: /.well-known/jmap). */
  readonly wellKnownPath?: string;
}

/** A JSContact Card as it comes off the wire. Opaque to us on purpose. */
type Card = Record<string, unknown>;

interface CardGetResponse {
  readonly list?: ReadonlyArray<Card>;
  readonly notFound?: ReadonlyArray<string>;
}

interface CardSetResponse {
  readonly created?: Record<string, { id: string }>;
  readonly updated?: Record<string, unknown>;
  readonly destroyed?: ReadonlyArray<string>;
  readonly notCreated?: Record<string, { type: string; description?: string }>;
  readonly notUpdated?: Record<string, { type: string; description?: string }>;
  readonly notDestroyed?: Record<string, { type: string; description?: string }>;
}

interface AddressBookGetResponse {
  readonly list?: ReadonlyArray<{ id: string; name?: string; isDefault?: boolean }>;
}

interface ParseResponse {
  readonly parsed?: Record<string, Card>;
  readonly notParsable?: ReadonlyArray<string>;
  readonly notFound?: ReadonlyArray<string>;
}

interface JmapSession {
  readonly accounts?: Record<string, { id?: string; name?: string; email?: string }>;
  readonly primaryAccounts?: Record<string, string>;
}

export class JmapContactTarget implements ContactTargetWriter, TargetReindexer {
  private readonly config: JmapContactTargetConfig;
  private accountId: string | null = null;
  private apiUrl: string | null = null;
  private authHeader: string | null = null;
  private connectPromise: Promise<void> | null = null;
  /**
   * vCard UID -> target card id for what the account already held.
   *
   * Held as a PROMISE so concurrent items coalesce onto one enumeration
   * instead of racing to build it N times, and `undefined` INSIDE the promise
   * means "could not be built" — never "the account is empty". The difference
   * is the whole ballgame: an empty map reads as "the target holds nothing",
   * which would make us write everything a second time.
   */
  private keySnapshot: Promise<Map<string, string> | undefined> | null = null;

  constructor(config: JmapContactTargetConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------

  /**
   * Self-connect on first use, single-flight.
   *
   * `ContactTargetWriter` has no `connect()` and the sync path never calls the
   * concrete one, so a writer that waits to be connected throws on every
   * write. Same lesson, same fix as `JmapTargetWriter`. A failed connect is not
   * cached, so the next call retries.
   */
  private async ensureConnected(): Promise<void> {
    if (this.accountId && this.apiUrl && this.authHeader) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().catch((err: unknown) => {
        this.connectPromise = null;
        throw err;
      });
    }
    await this.connectPromise;
  }

  async connect(): Promise<void> {
    this.authHeader = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
    const sessionUrl = `${this.config.baseUrl}${this.config.wellKnownPath ?? '/.well-known/jmap'}`;
    // `loadJmapSession`, NOT `JamClient.loadSession`. That helper never checks
    // `response.ok`, so a 401 carrying a JSON body resolves as a session with no
    // accounts — and the guard below then blames account resolution for what was
    // only ever a rejected credential. No data was ever at risk (the guard does
    // its job); the DIAGNOSIS was wrong, which costs the reader time exactly
    // when a connection is broken. See `jmap-session.ts`.
    const session = (await loadJmapSession(sessionUrl, this.authHeader)) as JmapSession;

    // The session's own `apiUrl` is IGNORED, and that is not an oversight:
    // Stalwart advertises `https://0.0.0.0/jmap/`, which is unroutable. The
    // mail writer has said so since 0001 and the spike proved it again on
    // 2026-08-05. Rebuild from the base URL we were actually given.
    this.apiUrl = this.config.baseUrl.endsWith('/')
      ? `${this.config.baseUrl}jmap`
      : `${this.config.baseUrl}/jmap`;

    // Resolve the account by MATCHING the configured address, never by taking
    // the first one. Writing a customer's contacts into somebody else's
    // account is the worst thing this file could do, and it is one loose
    // `Object.keys(...)[0]` away — which is exactly how it once happened on
    // the mail side.
    let resolved: string | undefined;
    for (const [id, info] of Object.entries(session.accounts ?? {})) {
      if (info.email === this.config.username || info.name === this.config.username) {
        resolved = id;
        break;
      }
    }
    resolved ??= session.primaryAccounts?.['urn:ietf:params:jmap:contacts'];

    if (!resolved) {
      throw new Error(
        `Could not resolve a JMAP contacts account for '${this.config.username}'. The session ` +
          `advertises ${Object.keys(session.accounts ?? {}).length} account(s) and no ` +
          `primaryAccounts entry for urn:ietf:params:jmap:contacts. Refusing to proceed rather ` +
          `than guess which account to write a customer's contacts into.`,
      );
    }
    this.accountId = resolved;
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  /**
   * `fetch`, but a target that answers "too many requests" is waited out
   * rather than turned into a failed item. See `jmap-target.ts` for the
   * measurements behind the numbers; a 429 is the server asking for a pause,
   * and the only correct response to that is to pause.
   */
  private async fetchWithRateLimitRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, init);
      const rateLimited = response.status === 429 || response.status === 503;
      if (!rateLimited || attempt >= RATE_LIMIT_ATTEMPTS - 1) return response;

      const header = response.headers.get('retry-after');
      const waitMs = header
        ? parseRetryAfterMs(header)
        : RATE_LIMIT_BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
      await response.text().catch(() => undefined);
      log.warn(
        `[jmap-contacts] ${response.status} from ${new URL(url).pathname}; waiting ` +
          `${Math.round(waitMs)}ms before retry ${attempt + 2}/${RATE_LIMIT_ATTEMPTS}`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private async apiRequest<T>(
    method: string,
    args: Record<string, unknown>,
    using: ReadonlyArray<string> = USING,
  ): Promise<T> {
    if (!this.apiUrl || !this.authHeader) throw new Error('Not connected to JMAP server');

    const response = await this.fetchWithRateLimitRetry(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ using, methodCalls: [[method, args, 'c1']] }),
    });

    if (!response.ok) {
      // Read as TEXT first. A proxy or rate limiter answers with HTML, and
      // `response.json()` then throws a parse error saying nothing about the
      // status the server actually returned — the real failure replaced by a
      // misleading one (hard rule 9).
      const body = await response.text().catch(() => '');
      let detail = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body) as { type?: string; detail?: string; description?: string };
        detail = `${parsed.type ?? 'unknown'} - ${parsed.description ?? parsed.detail ?? 'no description'}`;
      } catch {
        // Not JSON; the truncated body is the best description available.
      }
      throw new Error(`JMAP ${method} failed: HTTP ${response.status} - ${detail}`);
    }

    const result = (await response.json()) as { methodResponses?: Array<unknown[]> };
    const first = result.methodResponses?.[0];
    if (!first || !Array.isArray(first) || first.length < 2) {
      throw new Error(`Invalid JMAP response format for ${method}`);
    }

    // A method-level error arrives as ["error", {...}] inside methodResponses
    // with HTTP 200 (RFC 8620 §3.6.2). Returning `first[1]` blindly hands that
    // error object back AS IF it were the result, so a refused query becomes
    // `{ list: undefined }`, enumeration yields nothing, and verification
    // reads the target as EMPTY — reported as total data loss. That exact bug
    // was fixed in the mail writer; it is not being re-introduced here.
    if (first[0] === 'error') {
      const err = first[1] as { type?: string; description?: string };
      throw new Error(
        `JMAP ${method} failed: ${err?.type ?? 'unknown'}` +
          (err?.description ? ` - ${err.description}` : ''),
      );
    }
    return first[1] as T;
  }

  // ---------------------------------------------------------------------
  // Address books
  // ---------------------------------------------------------------------

  /**
   * Find or create the address book, returning its JMAP id.
   *
   * Matched by NAME against the books that exist, because the id is the
   * server's to assign and the folder handed to us describes the SOURCE
   * collection. Falls back to creating one.
   */
  async ensureContactFolder(folder: ContactFolder): Promise<string> {
    await this.ensureConnected();
    const wanted = (folder.name ?? lastSegment(folder.path)).trim();

    const existing = await this.apiRequest<AddressBookGetResponse>('AddressBook/get', {
      accountId: this.accountId,
      ids: null,
    });
    const books = existing.list ?? [];
    const match = books.find((b) => (b.name ?? '').trim().toLowerCase() === wanted.toLowerCase());
    if (match) return match.id;

    const created = await this.apiRequest<CardSetResponse>('AddressBook/set', {
      accountId: this.accountId,
      create: { '0': { name: wanted } },
    });
    const id = created.created?.['0']?.id;
    if (id) return id;

    // The server refused. If it refused because the book is already there,
    // adopt it rather than fail — but only against a book we can actually
    // NAME, never by picking one.
    const failure = created.notCreated?.['0'];
    if (failure?.type === 'alreadyExists') {
      const again = await this.apiRequest<AddressBookGetResponse>('AddressBook/get', {
        accountId: this.accountId,
        ids: null,
      });
      const found = (again.list ?? []).find(
        (b) => (b.name ?? '').trim().toLowerCase() === wanted.toLowerCase(),
      );
      if (found) return found.id;
    }
    throw new Error(
      `Could not create address book '${wanted}': ${failure?.type ?? 'no id returned'}` +
        (failure?.description ? ` - ${failure.description}` : ''),
    );
  }

  // ---------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------

  /**
   * Idempotently write one contact.
   *
   * The natural key is the vCard UID — exactly what `contactNaturalKeyHash`
   * hashes — and the spike proved it survives `ContactCard/parse` unchanged,
   * which is what makes a mapping switchable between this target and the
   * CardDAV one without re-copying anything (hard rule 1).
   */
  async upsertContact(
    folderId: string,
    raw: RawContact,
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    await this.ensureConnected();
    const uid = extractUidFromVcard(raw.vcard);

    // UPDATE PATH. Reached only for an item WE copied whose source has since
    // changed — `runDomainSync` decides that, never this writer.
    if (options?.overwrite) {
      return this.rewriteContact(folderId, raw, uid, options.expectedTargetVersion);
    }

    const snapshot = await this.targetKeys();
    const existingId = snapshot
      ? snapshot.get(uid)
      : await this.findContactByNaturalKey(folderId, uid);
    if (existingId) {
      // Already on the target under our natural key: not written, ADOPTED.
      // A distinct fact from a ledger fast-path skip, and it has to be visible
      // before a cutover — see `UpsertResult.adopted`.
      return { targetId: existingId, created: false, adopted: true };
    }

    const card = await this.parseVcard(raw.vcard, uid);
    const response = await this.apiRequest<CardSetResponse>('ContactCard/set', {
      accountId: this.accountId,
      // The address book is ADDED to the server's own parsed card rather than
      // substituted into it: everything else in the object is Stalwart's
      // conversion of the source bytes, and the one thing its parser cannot
      // know is which book the card belongs in. Omitting it is refused with
      // "Contact has to belong to at least one address book" — the exact
      // analogue of `calendarIds` on an event.
      create: { '0': { ...card, addressBookIds: { [folderId]: true } } },
    });

    const createdId = response.created?.['0']?.id;
    if (!createdId) {
      const failure = response.notCreated?.['0'];
      // `alreadyExists` is the SERVER reaching the outcome we wanted. The
      // snapshot is taken once per pass, so the window between "not in the
      // snapshot" and this write is a whole pass wide — the server, not our
      // snapshot, is what actually guarantees no second copy here.
      if (failure?.type === 'alreadyExists') {
        const found = await this.findContactByNaturalKey(folderId, uid);
        if (found) {
          snapshot?.set(uid, found);
          return { targetId: found, created: false, adopted: true };
        }
      }
      throw new Error(
        `ContactCard/set refused ${uid}: ${failure?.type ?? 'no id returned'}` +
          (failure?.description ? ` - ${failure.description}` : ''),
      );
    }

    snapshot?.set(uid, createdId);
    // The version marker is a fingerprint of the card AS STORED, read back
    // rather than assumed — see `storedCardVersion` for why this transport
    // needs one at all.
    const targetVersion = await this.storedCardVersion(createdId);
    return {
      targetId: createdId,
      created: true,
      ...(targetVersion !== undefined ? { targetVersion } : {}),
    };
  }

  /**
   * Replace a card this writer already wrote.
   *
   * **The ownership guard is built rather than borrowed, and that is the point
   * of this method.** The DAV writers compare an ETag: the ledger's `copied`
   * status records that we wrote the bytes ONCE, not that they are still the
   * bytes we wrote, and shadow migration positively invites the owner to start
   * editing in the new system. JMAP contacts expose no per-card ETag, and the
   * mail writer's answer to that — accept `expectedTargetVersion` and ignore
   * it — is defensible for mail, where a message is immutable apart from flags.
   * It is not defensible here. A contact is exactly the kind of thing an owner
   * edits, and hard rule 2 puts their edit out of reach.
   *
   * So the version marker is a canonical fingerprint of the card as the server
   * stores it. Re-read it, fingerprint it the same way, and refuse if it moved.
   * Costs one round trip per rewrite, which is bounded by how many items
   * actually changed rather than by the size of the address book.
   */
  private async rewriteContact(
    folderId: string,
    raw: RawContact,
    uid: string,
    expectedTargetVersion?: string,
  ): Promise<UpsertResult> {
    const snapshot = await this.targetKeys();
    const targetId = snapshot?.get(uid) ?? (await this.findContactByNaturalKey(folderId, uid));
    if (!targetId) {
      // Asked to rewrite something that is not there. Falling through to a
      // create would be convenient and wrong: the caller believes this item is
      // already on the target, and silently disagreeing hides whatever made
      // that untrue.
      throw new Error(
        `Asked to rewrite contact ${uid} in ${folderId}, but no card with that UID is on the ` +
          `target. Refusing to create one instead — the caller believes this item was already ` +
          `copied, and quietly disagreeing would hide whatever made that false.`,
      );
    }

    if (expectedTargetVersion !== undefined) {
      const current = await this.storedCardVersion(targetId);
      if (current !== undefined && current !== expectedTargetVersion) {
        // Someone edited our copy. Not an error and deliberately not thrown:
        // a conflict is a fact about ownership, not a failure to migrate.
        return { targetId, created: false, conflicted: true };
      }
    }

    const card = await this.parseVcard(raw.vcard, uid);
    const response = await this.apiRequest<CardSetResponse>('ContactCard/set', {
      accountId: this.accountId,
      update: { [targetId]: { ...card, addressBookIds: { [folderId]: true } } },
    });
    const failure = response.notUpdated?.[targetId];
    if (failure) {
      // HTTP 200 either way (RFC 8620 §3.6.2): a per-item refusal arrives in
      // `notUpdated`, not as a transport error. Not looking is how a rewrite
      // that did nothing gets counted as an update.
      throw new Error(
        `ContactCard/set could not update ${targetId} (${uid}): ${failure.type}` +
          (failure.description ? ` - ${failure.description}` : ''),
      );
    }

    const targetVersion = await this.storedCardVersion(targetId);
    return {
      targetId,
      created: false,
      updated: true,
      ...(targetVersion !== undefined ? { targetVersion } : {}),
    };
  }

  /**
   * Hand the vCard to the SERVER and take back its JSContact card.
   *
   * This is route (2) from the header comment, and it is the whole fidelity
   * argument: the conversion is Stalwart's own, so what lands here is what
   * would have landed had the same bytes gone in over CardDAV.
   */
  private async parseVcard(vcard: string, uid: string): Promise<Card> {
    const blobId = await this.uploadVcard(vcard);
    const response = await this.apiRequest<ParseResponse>(
      'ContactCard/parse',
      { accountId: this.accountId, blobIds: [blobId] },
      USING_PARSE,
    );

    const card = response.parsed?.[blobId];
    if (!card) {
      // Say WHICH of the several "no card" outcomes happened. A single
      // "parse failed" would send somebody looking at the wrong thing:
      // notParsable is a malformed source card (one item to park), notFound is
      // a blob that vanished (a transport problem affecting everything).
      const why = response.notParsable?.includes(blobId)
        ? 'the server could not parse it as a vCard'
        : response.notFound?.includes(blobId)
          ? 'the server no longer has the uploaded blob'
          : 'the server returned neither a parsed card nor a reason';
      throw new Error(
        `ContactCard/parse produced no card for ${uid}: ${why}. Nothing was written — this item ` +
          `is not on the target.`,
      );
    }
    return card;
  }

  /** Upload the raw vCard so `ContactCard/parse` has something to read. */
  private async uploadVcard(vcard: string): Promise<string> {
    if (!this.apiUrl || !this.authHeader) throw new Error('Not connected to JMAP server');
    // Built from the resolved apiUrl, not the session's `uploadUrl`, for the
    // same reason `connect()` ignores `apiUrl`: the advertised host is
    // unroutable on Stalwart.
    const url = `${this.apiUrl}/upload/${encodeURIComponent(this.accountId!)}`;
    const response = await this.fetchWithRateLimitRetry(url, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'text/vcard' },
      body: vcard,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`vCard blob upload failed: HTTP ${response.status} - ${detail.slice(0, 300)}`);
    }
    const { blobId } = (await response.json()) as { blobId?: string };
    if (!blobId) throw new Error('vCard blob upload returned no blobId');
    return blobId;
  }

  // ---------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------

  /**
   * Is this contact already on the target? Snapshot first, per-item read as
   * the fallback.
   *
   * A failed lookup is NOT "not found". `upsertContact` reads `undefined` as
   * "not on the target yet" and writes, so swallowing a transient failure here
   * silently creates a duplicate — which breaks the one property the whole
   * product rests on (hard rule 1), and hard rule 9 forbids turning a failure
   * into an empty result. Failing loudly is safe and resumable: the pass
   * aborts, the cursor stays put, and the next pass re-scans from the same
   * point.
   */
  async findContactByNaturalKey(_folderId: string, naturalKey: string): Promise<string | undefined> {
    await this.ensureConnected();
    // Account-wide, with no address-book filter, deliberately: the natural key
    // is unique per MAPPING rather than per collection, so a card already
    // filed anywhere on this account must be adopted rather than written
    // again (ADR-0020 — even a wiped ledger cannot produce duplicates).
    const response = await this.apiRequest<CardGetResponse>('ContactCard/get', {
      accountId: this.accountId,
      ids: null,
      properties: [...CARD_PROPERTIES],
    });
    for (const card of response.list ?? []) {
      if (typeof card.uid === 'string' && card.uid === naturalKey) {
        return typeof card.id === 'string' ? card.id : undefined;
      }
    }
    return undefined;
  }

  /**
   * Every card on this target, keyed the way the ledger keys them.
   *
   * `naturalKey` is the vCard UID — exactly what `upsertContact` writes and
   * what `contactNaturalKeyHash` hashes — so a reindex rebuilds rows that
   * match what a fresh migration would produce.
   *
   * ENUMERATES THE WHOLE ACCOUNT IN ONE CALL, and that is a known bound rather
   * than an oversight. `ContactCard/query` would allow paging, but nothing has
   * confirmed this server implements it, and a paginating enumerator built on
   * an unverified method fails by returning FEWER cards than exist — which
   * reads as data loss. `ids: null` is the call the spike exercised. Paging is
   * a follow-up once `ContactCard/query` has been probed the same way.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    await this.ensureConnected();
    const response = await this.apiRequest<CardGetResponse>('ContactCard/get', {
      accountId: this.accountId,
      ids: null,
      properties: [...CARD_PROPERTIES],
    });

    for (const card of response.list ?? []) {
      const uid = card.uid;
      const id = card.id;
      if (typeof uid !== 'string' || !uid || typeof id !== 'string') {
        // A card with no UID cannot be keyed. Falling back to the JMAP id
        // would mis-key a card that IS present, making it look missing — the
        // ADR-0020 failure mode — so this fails rather than guesses.
        throw new Error(
          `ContactCard ${String(id)} on the target has no uid; it cannot be keyed for ` +
            `verification, and keying it by its JMAP id would report a card that IS there as ` +
            `missing.`,
        );
      }

      const books = Object.keys((card.addressBookIds as Record<string, boolean>) ?? {});
      if (mailboxId && !books.includes(mailboxId)) continue;

      yield {
        naturalKey: uid,
        targetId: id,
        mailboxId: mailboxId ?? books[0] ?? '',
      };
    }
  }

  /**
   * What the account already holds, keyed the way we key it.
   *
   * Reuses `listEntries` rather than enumerating separately, so the snapshot's
   * keys are guaranteed to be the keys verification and reindex compare
   * against. Returns `undefined`, never an empty map, when the account cannot
   * be enumerated — the caller then probes per item, which is slower and still
   * correct.
   */
  private async targetKeys(): Promise<Map<string, string> | undefined> {
    this.keySnapshot ??= this.buildKeySnapshot();
    return this.keySnapshot;
  }

  private async buildKeySnapshot(): Promise<Map<string, string> | undefined> {
    try {
      const keys = new Map<string, string>();
      for await (const entry of this.listEntries()) keys.set(entry.naturalKey, entry.targetId);
      return keys;
    } catch (err) {
      // Say why. A silent fallback here is indistinguishable from a fast
      // target and would hide a real problem behind nothing but a slower run.
      log.warn(
        `[jmap-contacts] could not enumerate the target account ` +
          `(${err instanceof Error ? err.message : String(err)}); falling back to a per-card ` +
          `existence check`,
      );
      return undefined;
    }
  }

  /**
   * A stable fingerprint of one card AS THE SERVER STORES IT.
   *
   * The ownership marker this transport does not otherwise have — see
   * `rewriteContact`. Canonicalised because JMAP makes no promise about key
   * order and Stalwart demonstrably varies it between reads: hashing the raw
   * JSON would report a conflict on every rewrite and quietly stop update
   * propagation working at all.
   *
   * `undefined` when the card cannot be read, which costs that item its
   * overwrite protection and nothing else — the caller then rewrites without
   * the guard, exactly as it would against a server that sent no ETag.
   */
  private async storedCardVersion(targetId: string): Promise<string | undefined> {
    try {
      const response = await this.apiRequest<CardGetResponse>('ContactCard/get', {
        accountId: this.accountId,
        ids: [targetId],
        properties: [...CARD_PROPERTIES],
      });
      const card = response.list?.[0];
      if (!card) return undefined;
      // `id` is excluded: it is the server's handle, not part of what the card
      // says, and including it would make the fingerprint agree with itself
      // for the wrong reason.
      const { id: _id, ...rest } = card;
      return createHash('sha256').update(canonicalJson(rest)).digest('hex');
    } catch (err) {
      log.warn(
        `[jmap-contacts] could not read ${targetId} back to fingerprint it ` +
          `(${err instanceof Error ? err.message : String(err)}); this card has no overwrite ` +
          `protection on the next pass`,
      );
      return undefined;
    }
  }

  // ---------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------

  /**
   * Destroy a card this writer wrote (implements `TargetRemover`).
   *
   * The only destructive operation here, reached solely through an explicit
   * owner decision in core's `applyDeletion` — see that function for the gates
   * in front of it.
   *
   * Reports `deleted` rather than `binned`: JMAP contacts has no trash
   * collection to move a card into, unlike the mail writer's trash mailbox.
   * Whether the server keeps a recoverable copy is version-dependent, and
   * understating recoverability is the safe direction to be wrong in.
   */
  async removeItem(
    targetId: string,
    options?: { readonly expectedTargetVersion?: string },
  ): Promise<RemovalResult> {
    await this.ensureConnected();

    if (options?.expectedTargetVersion !== undefined) {
      // Same guard as the rewrite path, and it matters more here: this is the
      // one operation that cannot be undone.
      const current = await this.storedCardVersion(targetId);
      if (current !== undefined && current !== options.expectedTargetVersion) {
        return { conflicted: true };
      }
    }

    const response = await this.apiRequest<CardSetResponse>('ContactCard/set', {
      accountId: this.accountId,
      destroy: [targetId],
    });
    const failure = response.notDestroyed?.[targetId];
    if (failure) {
      throw new Error(
        `ContactCard/set could not destroy ${targetId}: ${failure.type}` +
          (failure.description ? ` - ${failure.description}` : ''),
      );
    }
    if (!response.destroyed?.includes(targetId)) {
      // Neither destroyed nor refused. Reporting success on that would let the
      // ledger tombstone a row for a card still sitting on the target.
      throw new Error(
        `ContactCard/set reported neither destroyed nor notDestroyed for ${targetId}; refusing ` +
          `to record a removal the server did not confirm.`,
      );
    }
    return { kind: 'deleted' };
  }

  // NOTE: `contentHashFor` is DELIBERATELY NOT IMPLEMENTED. See the header —
  // a stored ContactCard carries no blobId and no handle back to vCard bytes,
  // so there is nothing to fetch and fingerprint comparably with the source.
  // §20's content leg therefore does not run for contacts over JMAP, and the
  // absence is stated in the workplan rather than left to look like an
  // oversight. A stub returning undefined would be worse: it would look like
  // a check that ran and found nothing to say.
}

/** Last non-empty path segment, for naming an address book after a source one. */
function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * The UID line of a vCard.
 *
 * Split on the FIRST colon only: a UID may legitimately be a URI
 * (`UID:urn:uuid:…`), and splitting on every colon truncates it to `urn` —
 * which would key every such card identically and collapse an address book
 * into one entry.
 */
export function extractUidFromVcard(vcard: string): string {
  const match = /^UID(?:;[^:\r\n]*)?:(.*)$/im.exec(vcard);
  const uid = match?.[1]?.trim();
  if (!uid) {
    throw new Error('Invalid vCard data: missing UID, so this contact has no natural key');
  }
  return uid;
}

/** JSON with object keys sorted at every depth, so equal cards hash equal. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
