// Copyright 2026 OpenHands Agent (Apache-2.0)
// IMAP source connector for O365 (XOAUTH2) and generic IMAP (LOGIN).
// Supports RFC 6154 special-use folder detection and incremental listing via UIDVALIDITY/UIDNEXT.
// T2 from workplan 0001-first-slice-jmap-mail.

import imap, { ImapSimple } from "imap-simple";
import type { SourceConnector, SyncCursor, TokenProvider } from "@openmig/shared";
import type {
  MailFolder,
  MailItem,
  RawMessage,
  MailKeyword,
  SpecialUse,
} from "@openmig/shared";

/**
 * Configuration for IMAP connection.
 */
export interface ImapSourceConfig {
  host: string;
  port: number;
  tls: boolean;
  auth: {
    user: string;
    password?: string;
    accessToken?: string; // For XOAUTH2
  };
  authType?: "LOGIN" | "XOAUTH2";
}

/**
 * Extended configuration for IMAP connection with TokenProvider support.
 */
export interface ImapSourceConfigWithTokenProvider extends ImapSourceConfig {
  tokenProvider?: TokenProvider;
}

/**
 * Cursor encoding for IMAP: "UIDVALIDITY:UIDNEXT"
 */
export function encodeImapCursor(uidValidity: number, uidNext: number): string {
  return `${uidValidity}:${uidNext}`;
}

export function decodeImapCursor(cursor: SyncCursor): {
  uidValidity: number;
  uidNext: number;
} {
  const parts = cursor.value.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid IMAP cursor format: ${cursor.value}`);
  }
  const uidValidity = parseInt(parts[0]!, 10);
  const uidNext = parseInt(parts[1]!, 10);
  if (isNaN(uidValidity) || isNaN(uidNext)) {
    throw new Error(`Invalid IMAP cursor format: ${cursor.value}`);
  }
  return { uidValidity, uidNext };
}

/**
 * Map IMAP system flags to our MailKeyword type.
 *
 * EXPORTED for `imapflow-source.ts` (workplan 0032 T1). Shared rather than
 * transcribed: a second copy of this that drifted would show up as a lost flag
 * on every message the two clients disagreed about, and the whole point of the
 * migration is that the only thing that changes is the CLIENT.
 */
export function mapImapFlagsToKeywords(flags: string[]): MailKeyword[] {
  const keywords: MailKeyword[] = [];
  for (const flag of flags) {
    const lower = flag.toLowerCase();
    if (lower === "\\seen") keywords.push("$seen");
    else if (lower === "\\flagged") keywords.push("$flagged");
    else if (lower === "\\draft") keywords.push("$draft");
    else if (lower === "\\answered") keywords.push("$answered");
  }
  return keywords;
}

/**
 * Map IMAP special-use attributes to our SpecialUse type.
 */
export function mapImapSpecialUse(attributes: string[]): SpecialUse {
  for (const attr of attributes) {
    const lower = attr.toLowerCase();
    if (lower === "\\inbox") return "inbox";
    if (lower === "\\sent") return "sent";
    if (lower === "\\drafts") return "drafts";
    if (lower === "\\archive") return "archive";
    if (lower === "\\junk" || lower === "\\spam") return "junk";
    if (lower === "\\trash" || lower === "\\deleted") return "trash";
  }
  return "normal";
}

/**
 * What a listing FETCH asks the server for, and the reason it is a constant.
 *
 * **`size` was missing here until 2026-08-06, and nothing noticed for months.**
 * node-imap only appends `RFC822.SIZE` to the FETCH when `options.size` is set
 * (`Connection.js`: `if (options.size) fetching.push('RFC822.SIZE')`), so
 * `attrs.size` was always `undefined` and every `MailItem.size` this connector
 * produced was empty.
 *
 * That is not cosmetic. Pre-sync discovery sums exactly this field
 * (`itemBytes` in `apps/worker/src/orchestration.ts`) to tell the owner how
 * much data is about to move, on the §11.2 Review & confirm screen they
 * approve before anything is copied — so the mail domain has been showing a
 * count with no bytes behind it. (The SYNC path is unaffected: `reconcile.ts`
 * deliberately uses the fetched message's own byte length rather than the
 * listing's advertised size, which is why the ledger totals are right.)
 *
 * **It was found by the workplan 0032 parity harness on its first real run**,
 * as `INBOX/items/INBOX:50 · size: '' vs 216` — `imapflow` populates the field
 * and `imap-simple` did not. Worth recording because it is the argument for
 * having built the harness at all: the difference it named was a defect in the
 * PROVEN client, not in the candidate.
 *
 * A constant rather than an inline literal for the same reason
 * `CARD_PROPERTIES` is one in `jmap-contact-target.ts`: a request list that
 * silently loses an entry is a PASSING read returning less than the server
 * holds, and `imap-source.unit.test.ts` pins this one.
 */
export const LISTING_FETCH_CRITERIA = {
  bodies: '', // Headers only — the body comes from `fetch()`, per item.
  struct: true, // BODYSTRUCTURE
  envelope: true, // ENVELOPE, which carries the Message-ID
  size: true, // RFC822.SIZE — see above.
  markSeen: false, // Never modify the source (hard rule 2).
} as const;

/**
 * An ENVELOPE's message-id as `MailItem.messageId` — angle brackets included.
 *
 * **The single most load-bearing line in the IMAP source, and the reason
 * workplan 0032 has a parity harness at all.** `naturalKeyForItem()` hashes
 * this string, so if two clients produce different forms of it, every message
 * re-copies on the next pass and every write succeeds while it happens
 * (hard rule 1). No count is wrong and no error is raised — the mailbox is
 * simply twice its size.
 *
 * EXPORTED so `imapflow-source.ts` calls exactly this, rather than a
 * transcription of it. Note what that does and does not buy: it removes the
 * risk of OUR logic drifting between two files, and it deliberately does NOT
 * paper over a difference in what the two CLIENTS hand in — different input
 * still gives different output, which is precisely what the harness must be
 * able to see. (`imapflow` trims the ENVELOPE value; `node-imap` does not. If
 * a server ever emits a padded msg-id, that difference is real and this
 * function will report it as one rather than hide it.)
 *
 * Returns null when the envelope carried nothing — the caller counts that as
 * `unkeyable` and the sync derives an id from the body bytes.
 */
export function messageIdFromEnvelopeValue(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  // Already bracketed: returned VERBATIM. Trimming here would be a silent
  // normalisation and is exactly the class of change the harness exists to
  // catch — the decision about whether a padded id should be trimmed belongs
  // in one place, not smuggled into a helper.
  if (raw.startsWith('<') && raw.endsWith('>')) return raw;
  return `<${raw}>`;
}

/**
 * The UID out of a `MailItem.sourceRef` (`"<folder>:<uid>"`).
 *
 * EXPORTED for the same reason as the two helpers above: a folder path may
 * itself contain a colon, so the UID is the LAST segment, and two clients
 * splitting that differently would fetch the wrong message rather than fail.
 */
export function uidFromSourceRef(sourceRef: string): number {
  const parts = sourceRef.split(':');
  const uid = parseInt(parts[parts.length - 1] || '0', 10);
  return isNaN(uid) ? 0 : uid;
}

/** The shape node-imap's `getBoxes()` actually returns, per its own type declarations. */
export interface RawImapMailbox {
  attribs?: string[];
  delimiter?: string;
  children?: Record<string, RawImapMailbox> | null;
}

/**
 * Flatten node-imap's `getBoxes()` tree into our `MailFolder[]`.
 *
 * Extracted as a pure function so this can be unit-tested against the REAL
 * node-imap shape without a live connection — `listFolders()` below had never
 * been exercised by anything but a real IMAP server, and it read
 * `mailbox.attributes` where node-imap's own `Folder` type (and everything that
 * populates it) calls the field `attribs`. `mailbox.attributes` is therefore
 * always `undefined`, `mapImapSpecialUse` always received `[]`, and every
 * folder — including Trash — resolved to `specialUse: 'normal'`. That silently
 * broke both `excludeSpecialUse` (Trash/Junk were never excluded from content
 * sync) and the mail deletion signal (`resolveDiscardedItems` never found a
 * bin to scan), and nothing caught it because no test ever supplied a
 * `getBoxes()`-shaped fixture — only the pure `mapImapSpecialUse(string[])`
 * function was reachable without a real server.
 *
 * Also recurses into `children`, which the previous flat `Object.entries(list)`
 * loop did not: a server that nests folders under a namespace (common outside
 * a flat layout like this repo's dev Stalwart) would have its special-use
 * folders missed entirely. Builds each nested path as `parent<delimiter>child`,
 * matching what `conn.openBox()` expects for a fully-qualified mailbox name.
 */
export function foldersFromImapMailboxTree(
  tree: Record<string, RawImapMailbox> | null | undefined,
  prefix = "",
  parentDelimiter = "/",
): MailFolder[] {
  const folders: MailFolder[] = [];
  for (const [name, mailbox] of Object.entries(tree ?? {})) {
    const path = prefix ? `${prefix}${parentDelimiter}${name}` : name;
    folders.push({
      path,
      name,
      specialUse: mapImapSpecialUse(mailbox.attribs ?? []),
    });
    if (mailbox.children) {
      folders.push(
        ...foldersFromImapMailboxTree(mailbox.children, path, mailbox.delimiter ?? parentDelimiter),
      );
    }
  }
  return folders;
}

/**
 * IMAP source connector implementation.
 */
export class ImapSource implements SourceConnector {
  private readonly config: ImapSourceConfigWithTokenProvider;
  private readonly tokenProvider?: TokenProvider;

  constructor(config: ImapSourceConfigWithTokenProvider) {
    this.config = config;
    this.tokenProvider = config.tokenProvider;
  }

  /**
   * Connect to the IMAP server and return a connection.
   */
  async connect(): Promise<ImapSimple> {
    // Get access token from TokenProvider if available
    let accessToken: string | undefined = this.config.auth.accessToken;
    
    if (this.tokenProvider && this.config.authType === "XOAUTH2") {
      const token = await this.tokenProvider.getToken();
      accessToken = token.accessToken;
    }

    const connectionConfig: imap.ImapSimpleOptions = {
      imap: {
        user: this.config.auth.user,
        password: this.config.auth.password ?? "",
        xoauth2:
          this.config.authType === "XOAUTH2"
            ? accessToken
            : undefined,
        host: this.config.host,
        port: this.config.port,
        tls: this.config.tls,
        tlsOptions: { rejectUnauthorized: false }, // For self-signed certs in dev
        authTimeout: 30000,
      },
    };

    return imap.connect(connectionConfig);
  }

  /**
   * Enumerate folders with special-use detection (RFC 6154).
   */
  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    const conn = await this.connect();
    try {
      const list = await this.getBoxesSafely(conn);

      // Handle case where getBoxes returns undefined - this can happen with some IMAP servers
      // that don't include INBOX in the LIST response or use a different response format.
      // In this case, we'll try to open INBOX directly and include it in the folder list.
      if (!list) {

        try {
          await conn.openBox('INBOX');

          // Return INBOX as the only folder
          return [{
            path: 'INBOX',
            name: 'INBOX',
            specialUse: 'inbox' as SpecialUse,
          }];
        } catch (openErr) {
          throw new Error(
            'IMAP getBoxes() returned undefined and INBOX cannot be opened. ' +
            'This indicates a server-side issue or missing account configuration.',
            { cause: openErr }
          );
        }
      }

      return foldersFromImapMailboxTree(list);
    } catch (error) {
      // Check if this is an authentication error and we have a token provider
      if (this.isAuthError(error) && this.tokenProvider) {
        // Force refresh the token and retry once
        await this.tokenProvider.refresh();
        const conn = await this.connect();
        try {
          const list = await this.getBoxesSafely(conn);

          if (!list) {
            throw new Error(
              'IMAP getBoxes() returned undefined after token refresh. ' +
              'This indicates a server-side issue or missing account configuration.',
              { cause: error }
            );
          }

          return foldersFromImapMailboxTree(list);
        } finally {
          conn.end();
        }
      }
      throw error;
    } finally {
      conn.end();
    }
  }

  /**
   * The mailbox tree, via `imap-simple`'s own promise-returning `getBoxes()`.
   *
   * NOT `conn.imap.getBoxes` (the raw node-imap method) called with zero
   * arguments and cast to a promise-returning function — that method's real
   * signature is `getBoxes(namespace, cb)`; called with nothing, `namespace`
   * stays undefined, is not a function, so `cb` stays undefined too, and
   * node-imap enqueues the LIST command with no callback at all. `await`ing the
   * result of that call was `await`ing `undefined` (a no-op — `await` on a
   * non-promise just resolves to it immediately), so `listFolders()` silently
   * treated EVERY account as if `getBoxes()` had failed, falling back to
   * `[INBOX]` and never seeing any other folder — Trash included — regardless
   * of what `mapImapSpecialUse` did with the attributes it was never given.
   * `imap-simple`'s `getBoxes()` wraps the same underlying call with an actual
   * callback and is what every e2e script here has used successfully all along.
   */
  private async getBoxesSafely(conn: ImapSimple): Promise<Record<string, RawImapMailbox> | undefined> {
    return conn.getBoxes() as Promise<Record<string, RawImapMailbox> | undefined>;
  }

  /**
   * List messages in a folder, optionally since a cursor.
   * Returns items and the next cursor to persist.
   */
  async listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<MailItem>; nextCursor: SyncCursor }> {
    const conn = await this.connect();
    try {
      return await this.listSinceInternal(conn, folder, cursor);
    } catch (error) {
      // Check if this is an authentication error and we have a token provider
      if (this.isAuthError(error) && this.tokenProvider) {
        // Force refresh the token and retry once
        await this.tokenProvider.refresh();
        const conn = await this.connect();
        try {
          return await this.listSinceInternal(conn, folder, cursor);
        } finally {
          conn.end();
        }
      }
      throw error;
    } finally {
      conn.end();
    }
  }

  /**
   * Internal method to list messages (without reconnection logic).
   */
  private async listSinceInternal(
    conn: ImapSimple,
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<MailItem>; nextCursor: SyncCursor }> {
    await conn.openBox(folder.path);

      // Get UIDVALIDITY from the opened box
      // Note: node-imap uses _box (with underscore) internally
      type ImapBox = { 
        name: string;
        uidvalidity: number; 
        uidnext?: number;
        messages?: number; // Total number of messages in the mailbox
        flags: string[];
        readOnly: boolean;
      };
      const box = (conn.imap as unknown as { _box?: ImapBox })._box;
      if (!box) {
        throw new Error("No mailbox opened");
      }
      const uidValidity = box.uidvalidity;

      // Determine search criteria
      let searchCriteria: string[] = ["ALL"];
      let uidNext = box.uidnext || 1;

      if (cursor) {
        try {
          const decoded = decodeImapCursor(cursor);
          if (decoded.uidValidity === uidValidity) {
            // Only fetch messages with UID >= UIDNEXT from the cursor
            // Fetch ALL messages and filter by UID manually (more reliable than range search)
            searchCriteria = ['ALL'];
            uidNext = decoded.uidNext;
          }
        } catch {
          // Invalid cursor, do a full scan
        }
      }

      const results = await conn.search(searchCriteria, LISTING_FETCH_CRITERIA);

      // Filter results by UID if we're using a cursor
      let filteredResults = results || [];
      if (cursor) {
        try {
          const decoded = decodeImapCursor(cursor);
          if (decoded.uidValidity === uidValidity) {
            filteredResults = filteredResults.filter(msg => {
              const uid = msg.attributes?.uid;
              // Include all messages with UID >= cursor.uidNext
              return uid >= decoded.uidNext;
            });
          }
        } catch {
          // Invalid cursor, use all results
        }
      }

      const items: MailItem[] = [];
      let maxUidNext = uidNext;

      let unkeyable = 0;
      for (const msg of filteredResults) {
        const attrs = msg.attributes;

        // Extract Message-ID from envelope
        const messageId = this.extractMessageId(msg);
        if (!messageId) {
          // No Message-ID, so no natural key from the listing. These used to be
          // dropped outright — never copied, and invisible to both halves of
          // the verification gate at once (#145 made them at least countable).
          //
          // They are now EMITTED with an empty messageId. The sync path fetches
          // the body, derives a stable id from its bytes, writes it into the
          // message as a real Message-ID header, and keys the ledger by it — so
          // the message migrates and the target reindexer can read the same key
          // back. See `ensureMessageId`.
          //
          // Still counted: the customer is told how many of their messages we
          // had to give an id to, because we modified those messages.
          unkeyable++;
        }

        // Extract internal date
        const receivedAt =
          attrs.date?.toISOString() || new Date().toISOString();

        // Extract flags
        const keywords = mapImapFlagsToKeywords(attrs.flags || []);

        // Create sourceRef for fetching the full message
        const sourceRef = `${folder.path}:${attrs.uid}`;

        items.push({
          // Empty when the source had none; the sync derives and writes one.
          messageId: messageId ?? '',
          folder,
          keywords,
          receivedAt,
          size: attrs.size,
          sourceRef,
        });

        // Track max UID for cursor
        if (attrs.uid > maxUidNext) {
          maxUidNext = attrs.uid + 1;
        }
      }

      const nextCursor: SyncCursor = {
        value: encodeImapCursor(uidValidity, maxUidNext),
      };
      return { items, nextCursor, ...(unkeyable > 0 ? { unkeyable } : {}) };
  }

  /**
   * Fetch the full RFC822 bytes for an item.
   */
  async fetch(item: MailItem): Promise<RawMessage> {
    const conn = await this.connect();
    try {
      return await this.fetchInternal(conn, item);
    } catch (error) {
      // Check if this is an authentication error and we have a token provider
      if (this.isAuthError(error) && this.tokenProvider) {
        // Force refresh the token and retry once
        await this.tokenProvider.refresh();
        const conn = await this.connect();
        try {
          return await this.fetchInternal(conn, item);
        } finally {
          conn.end();
        }
      }
      throw error;
    } finally {
      conn.end();
    }
  }

  /**
   * Internal method to fetch a message (without reconnection logic).
   */
  private async fetchInternal(
    conn: ImapSimple,
    item: MailItem,
  ): Promise<RawMessage> {
    await conn.openBox(item.folder.path);

      const uid = this.extractUidFromSourceRef(item.sourceRef);
      
      // Fetch the raw RFC822 message using the UID
      // Retry up to 3 times to handle potential race conditions where the message
      // hasn't been fully committed to the IMAP server yet
      let results: Array<{ attributes: { uid: number }; parts: Array<{ body: unknown }> }> = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Search for the specific UID using the correct node-imap criteria format
        // node-imap expects an array of criteria, where each criterion is either a string or an array
        // For UID search, we need to nest it: [['UID', String(uid)]]
        results = await conn.search([['UID', String(uid)]] as unknown as string[], {
          bodies: '',  // Fetch entire message body
          markSeen: false,
        });
        if (results.length > 0) {
          break;
        }
        // Small delay between retries to allow IMAP server to commit the message
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (results.length === 0) {
        throw new Error(`Message not found: ${item.sourceRef}`);
      }

      const msg = results[0]!;
      
      // The raw message should be in msg.parts[0].body
      if (!msg.parts || msg.parts.length === 0) {
        throw new Error(`No parts found for message: ${item.sourceRef}`);
      }
      
      const rfc822Data = msg.parts[0]?.body;
      if (!rfc822Data) {
        throw new Error(`No body found for message: ${item.sourceRef}`);
      }
      
      // Ensure we have a Buffer
      const rfc822Buffer = Buffer.isBuffer(rfc822Data)
        ? rfc822Data
        : Buffer.from(rfc822Data as string);

      return {
        item,
        rfc822: rfc822Buffer,
      };
  }

  /**
   * Extract Message-ID from parsed headers.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractMessageId(msg: any): string | null {
    // The search result structure is: { attributes: { envelope: { messageId: ... } }, parts: [...] }
    // Try to get from envelope first (fetched with envelope: true)
    const envelope = msg.attributes?.envelope || msg.envelope;
    // Delegates to the exported helper so the imapflow source produces the
    // natural key through the SAME code rather than a copy of it (0032 T1).
    return messageIdFromEnvelopeValue(envelope?.messageId);
  }

  /**
   * Extract UID from sourceRef (format: "folder:uid").
   */
  private extractUidFromSourceRef(sourceRef: string): number {
    return uidFromSourceRef(sourceRef);
  }

  /**
   * Check if an error is an authentication error.
   * IMAP authentication errors typically contain specific error messages.
   */
  private isAuthError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    // Common IMAP authentication error patterns
    return (
      message.includes("authentication failed") ||
      message.includes("unauthorized") ||
      message.includes("xoauth2") ||
      message.includes("invalid token") ||
      message.includes("token expired") ||
      message.includes("401")
    );
  }
}
