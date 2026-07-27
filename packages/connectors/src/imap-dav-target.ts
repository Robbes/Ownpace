// Copyright 2026 OpenHands Agent (Apache-2.0)
// IMAP/DAV target writer for Soverin, openDesk, and other IMAP servers.
// Implements TargetWriter interface for mail import with idempotency support.
// U1 from workplan 0002-imap-dav-target.

import imap, { ImapSimple } from "imap-simple";
import type {
  TargetWriter,
  TargetReindexer,
  TargetEntry,
  MailFolder,
  RawMessage,
  MailKeyword,
  UpsertResult,
} from "@openmig/shared";
import { contentHash } from "@openmig/shared";

/**
 * Configuration for IMAP target connection.
 */
export interface ImapDavTargetConfig {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  rejectUnauthorized?: boolean; // For self-signed certs in dev
}

/**
 * IMAP search result entry.
 */
interface _SearchEntry {
  attributes: {
    uid: number;
  };
}

/**
 * IMAP fetch result.
 */
interface _FetchResult {
  attributes: {
    uid: number;
    body?: {
      data?: Buffer;
    };
  };
}

/**
 * Map our SpecialUse to IMAP special-use flags.
 */
const SPECIAL_USE_TO_IMAP: Record<string, string | undefined> = {
  inbox: "\\Inbox",
  sent: "\\Sent",
  drafts: "\\Drafts",
  archive: "\\Archive",
  junk: "\\Junk",
  trash: "\\Trash",
  normal: undefined,
};

/**
 * Map our MailKeyword to IMAP flags.
 */
const KEYWORD_TO_FLAG: Record<MailKeyword, string> = {
  "$seen": "\\Seen",
  "$flagged": "\\Flagged",
  "$draft": "\\Draft",
  "$answered": "\\Answered",
};

/**
 * IMAP/DAV mail target writer implementation.
 * Uses IMAP APPEND for writing messages with idempotency via Message-ID search.
 */
export class ImapDavMailTarget implements TargetWriter, TargetReindexer {
  private readonly config: ImapDavTargetConfig;
  private conn: ImapSimple | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(config: ImapDavTargetConfig) {
    this.config = config;
  }

  /**
   * Lazily establish the IMAP connection on first use (single-flight). The `TargetWriter`
   * interface has no `connect()`, and the sync path (`runShadowPass`/`runDomainSync`) never
   * calls the concrete `connect()` — so, like `ImapSource` which self-connects on every op,
   * this writer must self-connect. Without it every write threw "Not connected to IMAP server"
   * in the real (non-test) path. Concurrent callers share one in-flight connect; a failed
   * connect is not cached, so the next call retries. (Mirrors the JmapTargetWriter fix.)
   */
  private async ensureConnected(): Promise<void> {
    if (this.conn) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().catch((err) => {
        this.connectPromise = null;
        throw err;
      });
    }
    await this.connectPromise;
  }

  /**
   * Connect to the IMAP server.
   */
  async connect(): Promise<void> {
    
    const config = {
      imap: {
        host: this.config.host,
        port: this.config.port,
        user: this.config.username,
        password: this.config.password,
        tls: this.config.tls,
        tlsOptions: {
          rejectUnauthorized: this.config.rejectUnauthorized ?? true,
        },
        authTimeout: 30000,
      },
    };

    this.conn = await imap.connect(config);
  }

  /**
   * Disconnect from the IMAP server.
   */
  async disconnect(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
      this.connectPromise = null;
    }
  }

  /**
   * Ensure a mailbox exists for the given folder/role; return its name (IMAP uses names as IDs).
   */
  async ensureMailbox(folder: MailFolder): Promise<string> {
    await this.ensureConnected();
    if (!this.conn) {
      throw new Error('Not connected to IMAP server');
    }

    const mailboxName = folder.path || folder.name;
    if (!mailboxName) {
      throw new Error('Mailbox name or path is required');
    }

    // Use the underlying node-imap connection to get mailbox list
    type MailboxInfo = { attributes?: string[] };
    const mailboxes = await (
      (this.conn.imap.getBoxes as () => Promise<Record<string, MailboxInfo>>)()
    );

    // Handle case where getBoxes returns undefined
    if (!mailboxes) {
      // Try to open the mailbox directly - if it exists, we're good
      try {
        await this.conn.openBox(mailboxName);
        return mailboxName;
      } catch {
        // Mailbox doesn't exist, create it
        // addMailbox is not in the type definition but exists in the runtime
        await (this.conn as unknown as { addMailbox: (name: string) => Promise<void> }).addMailbox(mailboxName);
        return mailboxName;
      }
    } else {
      const existingBox = mailboxes[mailboxName];
      if (existingBox) {
        return mailboxName;
      }

      // Create the mailbox
      await (this.conn as unknown as { addMailbox: (name: string) => Promise<void> }).addMailbox(mailboxName);
    }

    // Set special-use flag if applicable
    if (folder.specialUse && SPECIAL_USE_TO_IMAP[folder.specialUse]) {
      const imapFlag = SPECIAL_USE_TO_IMAP[folder.specialUse]!;
      // Note: Not all IMAP servers support setting special-use flags
      // This is best-effort
      try {
        // Set flags on the mailbox itself (not messages)
        await (this.conn as unknown as { setFlags: (name: string, flags: string[], isPermanent: boolean) => Promise<void> }).setFlags(mailboxName, [imapFlag], true);
      } catch (err) {
        console.warn('[imap-dav-target] Could not set special-use flag:', (err as Error).message);
      }
    }

    return mailboxName;
  }

  /**
   * Check if a message with the given Message-ID already exists in the mailbox.
   * Returns the UID if found, or undefined.
   */
  async findByNaturalKey(mailboxId: string, naturalKey: string): Promise<string | undefined> {
    await this.ensureConnected();
    if (!this.conn) {
      throw new Error('Not connected to IMAP server');
    }

    try {
      await this.conn.openBox(mailboxId);
      
      // Normalize the naturalKey - it might have < > brackets
      const normalizedKey = naturalKey.replace(/[<>]/g, '');
      
      // Search ALL messages to get their UIDs
      const allResults = await (this.conn.search as unknown as (criteria: string[]) => Promise<Array<{ attributes?: { uid: number } }>>)(['ALL']);

      const typedResults = allResults as Array<{ attributes?: { uid: number } }>;

      if (!typedResults || typedResults.length === 0) {
        return undefined;
      }

      // Fetch headers for each message to find the matching Message-ID
      // Use the underlying node-imap connection for fetch
      const imap = this.conn.imap;
      
      for (const result of typedResults) {
        const uid = result.attributes?.uid;
        if (!uid) continue;
        
        try {
          // Fetch just the Message-ID header for this message using node-imap directly
          let messageIdHeader: string | undefined;
          
          await new Promise<void>((resolve, reject) => {
            const fetch = imap.fetch([uid], { bodies: ['HEADER'] });
            
            fetch.on('message', (msg: { on: (event: string, cb: (stream: { on: (event: string, cb: (chunk: Buffer) => void) => void; once: (event: string, cb: () => void) => void }) => void) => void }) => {
              msg.on('body', (stream: { on: (event: string, cb: (chunk: Buffer) => void) => void; once: (event: string, cb: () => void) => void }) => {
                let headers = '';
                stream.on('data', (chunk: Buffer) => {
                  headers += chunk.toString('utf8');
                });
                stream.once('end', () => {
                  // Parse the Message-ID from the headers string
                  // Try both \r\n and \n as line separators
                  const lines = headers.split(/\r?\n/);
                  for (const line of lines) {
                    const lowerLine = line.toLowerCase();
                    if (lowerLine.startsWith('message-id:')) {
                      messageIdHeader = line.substring('message-id:'.length).trim();
                      break;
                    }
                  }
                });
              });
            });
            
            fetch.once('error', reject);
            fetch.once('end', () => resolve());
          });
          
          if (messageIdHeader) {
            // Normalize the found Message-ID (remove angle brackets and whitespace)
            const foundKey = messageIdHeader.replace(/[<>]/g, '').trim();
            if (foundKey === normalizedKey) {
              return String(uid);
            }
          }
        } catch (fetchErr) {
          // We cannot read this message's headers, so we cannot rule out that it
          // IS the message we're looking for. Skipping it and continuing would
          // let the scan finish "not found" on an incomplete read — and upsertEmail
          // turns that into an APPEND, i.e. a duplicate. Fail instead.
          const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          throw new Error(
            `Could not read headers for UID ${uid} in mailbox ${mailboxId} while looking up ` +
              `Message-ID ${naturalKey}; refusing to report "not present" from a partial scan ` +
              `because that would append a duplicate. Cause: ${message}`,
            { cause: fetchErr },
          );
        }
      }

      // A complete scan that matched nothing — this really is "not present".
      return undefined;
    } catch (err) {
      // Same reasoning as above, for a failure of the search itself (connection
      // drop, SELECT failure, …). A failed lookup is not a negative result
      // (hard rule 1; hard rule 9 forbids failures becoming empty results).
      //
      // Failing loudly is safe and resumable: the pass aborts, the folder keeps
      // its old cursor, and the next pass re-scans from the same point.
      if (err instanceof Error && err.message.startsWith('Could not read headers for UID')) {
        throw err; // already the specific error above — don't re-wrap
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Lookup failed for Message-ID ${naturalKey} in mailbox ${mailboxId}; refusing to treat ` +
          `this as "not present" because that would append a duplicate. Cause: ${message}`,
        { cause: err },
      );
    }
  }

  /**
   * Idempotently write a message into the target mailbox.
   * First checks if the message exists by Message-ID, then APPENDs if new.
   */
  async upsertEmail(
    mailboxId: string,
    raw: RawMessage,
    keywords: ReadonlyArray<MailKeyword>,
  ): Promise<UpsertResult> {
    await this.ensureConnected();
    if (!this.conn) {
      throw new Error('Not connected to IMAP server');
    }

    // Extract Message-ID from raw message (rfc822 property)
    const messageId = this.extractMessageId(raw.rfc822);
    if (!messageId) {
      throw new Error('No Message-ID found in raw message');
    }


    // Check if message already exists
    const existingUid = await this.findByNaturalKey(mailboxId, messageId);
    if (existingUid) {
      return { targetId: existingUid, created: false };
    }

    // Open the mailbox
    await this.conn.openBox(mailboxId);

    // Prepare flags
    const flags: string[] = [];
    for (const keyword of keywords) {
      if (KEYWORD_TO_FLAG[keyword]) {
        flags.push(KEYWORD_TO_FLAG[keyword]);
      }
    }

    // Append the message with flags
    // Note: imap-simple append signature is append(message, options)
    // The append method doesn't return the UID, so we'll search for it after appending
    interface AppendOptions {
      mailbox: string;
      flags?: string[];
    }
    const appendOptions: AppendOptions = {
      mailbox: mailboxId,
      flags: flags.length > 0 ? flags : ['\\Seen'], // Default to seen if no flags
    };

    try {
      // Append the message (rfc822 is a Uint8Array)
      await this.conn.append(raw.rfc822, appendOptions);

      // Wait a moment for the message to be indexed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Search for the message we just appended to get its UID
      // IMAP search syntax: [['HEADER', 'field', 'value']]
      const searchResults = await (this.conn.search as unknown as (criteria: unknown) => Promise<Array<{ attributes?: { uid: number } }>>)([['HEADER', 'Message-ID', messageId]]);

      const typedSearchResults = searchResults as Array<{ attributes?: { uid: number } }>;

      if (typedSearchResults && typedSearchResults.length > 0) {
        const firstResult = typedSearchResults[0];
        const newUid = firstResult?.attributes?.uid;
        if (newUid) {
          return { targetId: String(newUid), created: true };
        }
      }

      // If header search fails, try searching ALL and filtering by Message-ID
      const allResults = await (this.conn.search as unknown as (criteria: string[]) => Promise<Array<{ attributes?: { uid: number } }>>)(['ALL']);
      
      const typedAllResults = allResults as Array<{ attributes?: { uid: number } }>;

      if (typedAllResults && typedAllResults.length > 0) {
        // Get the highest UID (most recent message)
        const lastResult = typedAllResults[typedAllResults.length - 1];
        const latestUid = lastResult?.attributes?.uid;
        if (latestUid) {
          return { targetId: String(latestUid), created: true };
        }
      }

      throw new Error('Failed to get UID after appending message');
    } catch (err) {
      console.error('[imap-dav-target] Error appending message:', (err as Error).message);
      throw err;
    }
  }

  /**
   * Extract Message-ID from raw RFC822 message.
   */
  private extractMessageId(raw: Uint8Array | string): string | null {
    const content = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
    const match = content.match(/Message-ID:\s*([^\r\n]+)/i);
    if (match) {
      return match[1]?.trim().replace(/[<>]/g, '') || null;
    }
    return null;
  }

  /**
   * Extract Received/Date header for INTERNALDATE.
   */
  private extractReceivedAt(raw: Uint8Array | string): string | null {
    const content = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
    
    // Try Date header first
    const dateMatch = content.match(/Date:\s*([^\r\n]+)/i);
    if (dateMatch) {
      return dateMatch[1]?.trim() || null;
    }
    
    return null;
  }

  /**
   * List all entries in the target for reindexing.
   * Streams entries from all mailboxes.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    await this.ensureConnected();
    if (!this.conn) {
      throw new Error('Not connected to IMAP server');
    }

    // Determine which mailboxes to list
    let mailboxNames: string[] = [];
    
    if (mailboxId) {
      // If a specific mailbox is requested, just use that
      mailboxNames = [mailboxId];
    } else {
      // Try to get all mailboxes
      try {
        const mailboxes = await (
          (this.conn.imap.getBoxes as () => Promise<Record<string, { attributes?: string[] } | undefined>>)()
        );
        
        if (mailboxes) {
          mailboxNames = Object.keys(mailboxes);
        }
      } catch (err) {
        // Falling back to INBOX here would silently reindex a fraction of the
        // account. The ledger rebuilt from that partial view looks complete, so
        // the next sync re-creates every message we never enumerated (ADR-0020
        // recovery turning into mass duplication). Fail instead.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Could not enumerate mailboxes for reindex; refusing to continue with a partial ` +
            `view because the rebuilt ledger would look complete while missing messages. ` +
            `Cause: ${message}`,
          { cause: err },
        );
      }

      // An account with genuinely no mailboxes reported still has an INBOX.
      if (mailboxNames.length === 0) {
        mailboxNames = ['INBOX'];
      }
    }

    for (const boxName of mailboxNames) {
      try {
        await this.conn.openBox(boxName);
        
        // Search for all messages
        const results = await (this.conn.search as unknown as (criteria: string[]) => Promise<Array<{ attributes?: { uid: number } }>>)(['ALL']);
        
        const typedResults = results as Array<{ attributes?: { uid: number } }>;
        
        if (!typedResults || typedResults.length === 0) {
          continue;
        }

        // Get the underlying node-imap connection for fetching headers
        const imap = this.conn.imap;

        for (const entry of typedResults) {
          const uid = entry.attributes?.uid;
          if (!uid) continue;

          try {
            // Fetch Message-ID header using node-imap directly
            let messageId: string | undefined;
            let sizeBytes: number | undefined;

            await new Promise<void>((resolve, reject) => {
              const fetch = imap.fetch([uid], { bodies: ['HEADER'] });

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fetch.on('message', (msg: any) => {
                // RFC822.SIZE, which node-imap reports on every fetch. Free
                // here, and what lets verification report totalBytesTarget as a
                // measurement rather than null.
                msg.on('attributes', (attrs: { size?: number }) => {
                  if (typeof attrs?.size === 'number') sizeBytes = attrs.size;
                });
                msg.on('body', (stream: { on: (event: string, cb: (chunk: Buffer) => void) => void; once: (event: string, cb: () => void) => void }) => {
                  let headers = '';
                  stream.on('data', (chunk: Buffer) => {
                    headers += chunk.toString('utf8');
                  });
                  stream.once('end', () => {
                    // Parse the Message-ID from the headers string
                    const lines = headers.split(/\r?\n/);
                    for (const line of lines) {
                      const lowerLine = line.toLowerCase();
                      if (lowerLine.startsWith('message-id:')) {
                        messageId = line.substring('message-id:'.length).trim().replace(/[<>]/g, '');
                        break;
                      }
                    }
                  });
                });
              });
              
              fetch.once('error', reject);
              fetch.once('end', () => resolve());
            });
            
            if (!messageId) {
              // The fetch succeeded but carried no Message-ID header. This used
              // to fall through to `messageId || String(uid)` — the very UID
              // fallback the catch block below refuses to make, just on the
              // success path where nothing threw. A UID-keyed ledger row can
              // never match the message's real Message-ID, so the next sync
              // treats it as unknown and re-appends it: a duplicate created by
              // the reindex meant to prevent one.
              throw new Error(
                `No Message-ID header for UID ${uid} in mailbox ${boxName} during reindex; ` +
                  `refusing to key the entry by UID because the resulting ledger row would ` +
                  `never match and the message would be duplicated.`,
              );
            }

            yield {
              naturalKey: messageId,
              targetId: String(uid),
              mailboxId: boxName,
              ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
            };
          } catch (fetchErr) {
            // Falling back to the UID as the natural key is worse than failing:
            // the ledger row it produces can never match the message's real
            // Message-ID, so the next sync sees an unknown item and re-appends
            // it — a duplicate, created by the very recovery meant to prevent
            // one. The natural key must be the real one or nothing.
            const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            throw new Error(
              `Could not read Message-ID for UID ${uid} in mailbox ${boxName} during reindex; ` +
                `refusing to fall back to the UID as a natural key because the resulting ledger ` +
                `row would never match and the message would be duplicated. Cause: ${message}`,
              { cause: fetchErr },
            );
          }
        }
      } catch (err) {
        // Skipping the mailbox would omit every message in it from the rebuilt
        // ledger — and an incomplete ledger makes the next sync re-create them
        // all. Surface it (hard rule 9) rather than quietly returning less.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to list entries in mailbox ${boxName} during reindex; refusing to skip it ` +
            `because omitted messages would be re-created as duplicates on the next sync. ` +
            `Cause: ${message}`,
          { cause: err },
        );
      }
    }
  }
  /**
   * Hash a sampled message as it is stored on the target (§20 checksum leg).
   *
   * `BODY[]` is the message as appended, so hashing it with the same
   * `contentHash` the sync path used on the source is a like-for-like
   * comparison. Called for sampled items only.
   *
   * Returns undefined when the body cannot be read — the sample is then counted
   * as unavailable, never as a mismatch. Absence of evidence is not evidence of
   * corruption; scoring it as one is the bug #139 fixed.
   */
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    await this.ensureConnected();
    if (!this.conn) return undefined;

    const uid = Number(entry.targetId);
    if (!Number.isInteger(uid)) return undefined;

    try {
      await this.conn.openBox(entry.mailboxId);
      const imap = this.conn.imap;

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const fetch = imap.fetch([uid], { bodies: [''] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch.on('message', (msg: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          msg.on('body', (stream: any) => {
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          });
        });
        fetch.once('error', reject);
        fetch.once('end', () => resolve());
      });

      if (chunks.length === 0) return undefined;
      return contentHash(new Uint8Array(Buffer.concat(chunks)));
    } catch {
      return undefined;
    }
  }

}
