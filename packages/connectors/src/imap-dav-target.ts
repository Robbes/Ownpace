// Copyright 2026 OpenHands Agent (Apache-2.0)
// IMAP/DAV target writer for Soverin, openDesk, and other IMAP servers.
// Implements TargetWriter interface for mail import with idempotency support.
// U1 from workplan 0002-imap-dav-target.

import imap, { ImapSimple } from "imap-simple";
import type {
  TargetWriter,
  TargetReindexer,
  TargetRemover,
  TargetEntry,
  MailFolder,
  RawMessage,
  MailKeyword,
  RemovalResult,
  UpsertResult,
} from "@openmig/shared";
import { contentHash } from "@openmig/shared";
import { log } from '@openmig/shared';
import { foldersFromImapMailboxTree, type RawImapMailbox } from "./imap-source";

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

/** The part of node-imap's `Box` (the SELECT result) this file relies on. */
interface ImapBox {
  /** RFC 3501 §2.3.1.1. Changes iff every UID in the mailbox has been re-issued. */
  readonly uidvalidity: number;
}

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
export class ImapDavMailTarget implements TargetWriter, TargetReindexer, TargetRemover {
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
   * The account's mailboxes, flattened to `MailFolder[]` with RFC 6154 special
   * use resolved.
   *
   * Via `imap-simple`'s own promise-returning `getBoxes()`, NOT `conn.imap.getBoxes`
   * (the raw node-imap method) called with zero arguments and cast to a
   * promise-returning function. That method is CALLBACK-ONLY: called with no
   * callback it returns `undefined`, and `await undefined` is `undefined` — so
   * every caller here saw an empty account and never an error. `ensureMailbox`
   * took that as "the mailbox does not exist" and `listEntries` fell through to
   * its `['INBOX']` fallback, which is precisely the partial view its own
   * comment refuses to continue on. The `catch` never fired because nothing
   * threw. Same bug, same fix, as `ImapSource.getBoxesSafely`.
   *
   * Flattened through the shared `foldersFromImapMailboxTree` so nested
   * mailboxes come back as fully-qualified paths (what `openBox` wants) and
   * special use is read from `attribs` — the field node-imap actually
   * populates.
   */
  private async listMailboxes(): Promise<MailFolder[]> {
    if (!this.conn) throw new Error('Not connected to IMAP server');
    const tree = (await this.conn.getBoxes()) as
      | Record<string, RawImapMailbox>
      | undefined;
    return foldersFromImapMailboxTree(tree);
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

    const existing = await this.listMailboxes();
    if (existing.some((f) => f.path === mailboxName)) {
      return mailboxName;
    }

    // `addBox`, which is what imap-simple actually exposes. The previous cast
    // called `addMailbox`, a method that exists on nothing: creating a mailbox
    // threw `addMailbox is not a function`, so this target could only ever
    // write into folders the account already had.
    await this.conn.addBox(mailboxName);

    // NO special-use flag is set here, deliberately. RFC 6154 assigns special
    // use at CREATE time (`CREATE "x" (USE (\Trash))`) or by server policy;
    // there is no IMAP command to attach one afterwards, and node-imap's
    // `addBox` cannot send the USE parameter. The code that used to sit here
    // called a `setFlags(name, flags, true)` that exists on neither imap-simple
    // nor node-imap, so it threw a TypeError into a catch that logged "could
    // not set special-use flag" — a warning about a real limitation, produced
    // by a call that was never going to work. The limitation is real; the call
    // was noise. Nothing downstream depends on it: the bin is found by reading
    // the flags the SERVER assigned (see `findBin`).
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
      // Already on the target under our natural key: not written, ADOPTED.
      // Distinct from a ledger fast-path skip — see UpsertResult.adopted.
      return {
        targetId: existingUid,
        created: false,
        adopted: true,
        targetVersion: await this.uidValidityOf(mailboxId),
      };
    }

    // Open the mailbox
    const box = await this.selectBox(mailboxId);
    const targetVersion = String(box.uidvalidity);

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
          return { targetId: String(newUid), created: true, targetVersion };
        }
      }

      // Header search unsupported or unindexed: re-scan the mailbox and match
      // the Message-ID ourselves.
      //
      // This used to take "the highest UID in the mailbox" as the one just
      // appended. That is a GUESS — a concurrent delivery, or any message the
      // account already held with a higher UID, makes it the wrong message —
      // and the ledger row it produced pointed our natural key at somebody
      // else's mail. Harmless while nothing acted on `targetId`; now that
      // `removeItem` does, it would have removed the wrong message on an
      // `apply`. `findByNaturalKey` does a complete scan and throws rather than
      // guessing, which is the only acceptable behaviour for an id that a
      // destructive operation will later be pointed at.
      const rescanned = await this.findByNaturalKey(mailboxId, messageId);
      if (rescanned) {
        return { targetId: rescanned, created: true, targetVersion };
      }

      throw new Error(
        `Appended the message to ${mailboxId} but could not find it again by Message-ID ` +
          `${messageId}, so there is no id to record for it. Refusing to guess a UID: the ` +
          `recorded id is what a later removal would act on.`,
      );
    } catch (err) {
      log.error('[imap-dav-target] Error appending message:', (err as Error).message);
      throw err;
    }
  }

  /**
   * SELECT a mailbox read-write and return the server's own description of it.
   *
   * Not `conn.openBox()`, whose @types declare `Promise<string>` — the runtime
   * resolves node-imap's `Box`, but code that relies on a typing being wrong is
   * one dependency bump away from breaking silently. Going through
   * `conn.imap.openBox` states the shape we need and asks for read-write
   * explicitly, which is what `removeItem` requires.
   */
  private async selectBox(name: string): Promise<ImapBox> {
    if (!this.conn) throw new Error('Not connected to IMAP server');
    const conn = this.conn;
    return new Promise<ImapBox>((resolve, reject) => {
      (
        conn.imap.openBox as unknown as (
          name: string,
          readOnly: boolean,
          cb: (err: Error | null, box: ImapBox) => void,
        ) => void
      )(name, false, (err, box) => (err ? reject(err) : resolve(box)));
    });
  }

  /**
   * A mailbox's UIDVALIDITY, as a string, for the ledger's `targetVersion`.
   *
   * WHAT "the version of our copy" MEANS ON IMAP. Every other writer records an
   * ETag over the object's own bytes, but an IMAP message cannot be edited in
   * place at all: RFC 3501 has no command for it, and a client that "edits" one
   * appends a new message and deletes the old, which produces a new UID. So the
   * thing that can invalidate our handle is not the message changing — it is
   * the MAILBOX being recreated, which resets UIDVALIDITY and re-issues every
   * UID to a different message.
   *
   * Recording it turns `expectedTargetVersion` into exactly the right check for
   * this target: "the UID I am about to remove is still being counted from the
   * same origin it was when I wrote it". Without it, an account whose mailbox
   * was rebuilt would have `apply` remove whatever message now happens to hold
   * that number.
   */
  private async uidValidityOf(mailbox: string): Promise<string> {
    const box = await this.selectBox(mailbox);
    return String(box.uidvalidity);
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
    let mailboxNames: string[];

    if (mailboxId) {
      // If a specific mailbox is requested, just use that
      mailboxNames = [mailboxId];
    } else {
      // Try to get all mailboxes
      try {
        mailboxNames = (await this.listMailboxes()).map((f) => f.path);
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
   * The account's bin, by RFC 6154 FLAG rather than by name.
   *
   * Never by name. Stalwart calls it "Deleted Items", Exchange "Deleted Items",
   * Gmail "[Gmail]/Bin" or "[Gmail]/Trash" depending on the account's locale,
   * and a Dutch account gets "Prullenbak". A `/trash/i` match finds none of
   * those, and the failure mode is silent: no bin found means the message is
   * expunged outright instead of binned, turning a recoverable removal into an
   * unrecoverable one.
   *
   * Undefined when the server advertises no `\Trash` mailbox at all, which is
   * the honest answer — `removeItem` then reports `deleted` rather than
   * pretending the copy is recoverable.
   */
  private async findBin(): Promise<string | undefined> {
    const folders = await this.listMailboxes();
    return folders.find((f) => f.specialUse === 'trash')?.path;
  }

  /**
   * Is `uid` still present in the currently-selected mailbox?
   *
   * `conn.imap.search`, which answers with the UID list itself, rather than
   * `conn.search`, which follows every hit with a FETCH to build message
   * objects. Nothing here needs the message — only whether it is there.
   */
  private async uidExists(uid: number): Promise<boolean> {
    if (!this.conn) throw new Error('Not connected to IMAP server');
    const conn = this.conn;
    const uids = await new Promise<number[]>((resolve, reject) => {
      conn.imap.search([['UID', String(uid)]], (err, found) =>
        err ? reject(err) : resolve(found),
      );
    });
    return uids.includes(uid);
  }

  /**
   * Remove the copy of one message the owner deleted on the source (ADR-0024).
   *
   * THE ONE DESTRUCTIVE PATH in this writer, reached only through
   * `applyDeletion`'s seven gates and one explicit owner decision at a time.
   * Everything here exists because an IMAP UID is a far weaker handle than the
   * JMAP id or DAV href the other writers remove by:
   *
   * - It is **mailbox-scoped**, so `collection` is required. Absent or empty —
   *   every ledger row written before the collection column was populated — is
   *   refused, not guessed. Guessing INBOX would remove message number N from
   *   the inbox because number N in some other folder was deleted on the
   *   source.
   * - It is **only valid under one UIDVALIDITY**. `expectedTargetVersion` is
   *   that value (see `uidValidityOf`); if the mailbox has been recreated since
   *   we wrote, every UID we hold now names a different message and the whole
   *   handle is void.
   *
   * Binning is preferred over expunging wherever the account has a `\Trash`
   * mailbox, because a removal the owner can undo for their server's retention
   * window is a materially different promise from one they cannot. `kind` says
   * which they got rather than assuming.
   */
  async removeItem(
    targetId: string,
    options?: { readonly expectedTargetVersion?: string; readonly collection?: string },
  ): Promise<RemovalResult> {
    await this.ensureConnected();
    if (!this.conn) {
      throw new Error('Not connected to IMAP server');
    }

    const mailbox = options?.collection;
    if (!mailbox) {
      throw new Error(
        `Cannot remove IMAP message ${targetId}: no mailbox was supplied. An IMAP UID only ` +
          `identifies a message within one mailbox, so without it there is nothing safe to act ` +
          `on — removing the same UID from a guessed mailbox would delete a different message. ` +
          `Remove this item in the target system yourself, then choose \`keep\`.`,
      );
    }

    const uid = Number(targetId);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error(
        `Cannot remove IMAP message: "${targetId}" is not a UID. Nothing was changed.`,
      );
    }

    const box = await this.selectBox(mailbox);

    // GATE 5 for this target. A changed UIDVALIDITY means the mailbox was
    // recreated and every UID re-issued: the message this row points at is not
    // the message we wrote, and may be anyone's. Thrown rather than reported as
    // `conflicted`, because `conflicted` tells the operator "somebody edited
    // your copy" — a specific, and here false, explanation. This is a stale
    // handle, and saying so is the only honest answer (hard rule 9).
    const expected = options?.expectedTargetVersion;
    if (expected !== undefined && expected !== String(box.uidvalidity)) {
      throw new Error(
        `Refusing to remove UID ${uid} from ${mailbox}: the mailbox reports UIDVALIDITY ` +
          `${box.uidvalidity} but this item was written under ${expected}. The mailbox has been ` +
          `recreated since, so every UID now names a different message and this one cannot be ` +
          `identified. Nothing was changed. Remove the item in the target system yourself, then ` +
          `choose \`keep\`.`,
      );
    }

    if (!(await this.uidExists(uid))) {
      // Already gone — somebody removed it in the new system by hand. Reported
      // as "no removal" rather than claimed as a success: the ledger row is
      // then left saying the item is on the target, which §20 verification
      // surfaces as `missingOnTarget`. Loud and correctable beats a tombstone
      // recorded for something this never touched.
      log.warn(
        `[imap-dav-target] UID ${uid} is no longer in ${mailbox}; nothing to remove. ` +
          `Verification will report the item as missing on the target until reconciled.`,
      );
      return {};
    }

    const bin = await this.findBin();

    if (bin && bin !== mailbox) {
      await this.conn.moveMessage([String(uid)], bin);
      await this.verifyGone(mailbox, uid, `move to ${bin}`);
      return { kind: 'binned' };
    }

    // No bin, or the copy is already in it — expunge.
    //
    // UID EXPUNGE (RFC 4315), never the bare EXPUNGE. A bare EXPUNGE removes
    // EVERY message in the mailbox that carries `\Deleted`, including ones
    // another client flagged and has not committed — this would destroy data
    // nobody in this product ever looked at, which hard rule 2 forbids
    // outright. `imap-simple.deleteMessage` does exactly that, which is why
    // this goes to node-imap directly. A server without UIDPLUS gets a refusal
    // instead of a broader deletion than was asked for.
    const conn = this.conn;
    if (!conn.imap.serverSupports('UIDPLUS')) {
      throw new Error(
        `Refusing to remove UID ${uid} from ${mailbox}: the server has no ${bin ? '' : '`\\Trash` ' }` +
          `mailbox to move it to and does not support UIDPLUS, so the only way to delete it ` +
          `would be a bare EXPUNGE — which also removes every other message in the mailbox ` +
          `that anyone has flagged \\Deleted. Nothing was changed. Remove the item in the ` +
          `target system yourself, then choose \`keep\`.`,
      );
    }

    await conn.addFlags([uid], '\\Deleted');
    await new Promise<void>((resolve, reject) => {
      conn.imap.expunge([uid], (err) => (err ? reject(err) : resolve()));
    });
    await this.verifyGone(mailbox, uid, 'expunge');
    return { kind: 'deleted' };
  }

  /**
   * Confirm the message really left the mailbox.
   *
   * A read-back, for the reason the JMAP writer grew one: a server can accept a
   * MOVE or an EXPUNGE, answer OK, and leave the message where it was. Without
   * this the ledger records a tombstone for a copy that is still sitting on the
   * target, and nothing in the system ever looks again — the row now says the
   * item was removed, so verification does not expect it either. That is
   * silent, permanent, and exactly the class of bug this codebase pays for
   * read-backs to avoid.
   */
  private async verifyGone(mailbox: string, uid: number, what: string): Promise<void> {
    await this.selectBox(mailbox);
    if (await this.uidExists(uid)) {
      throw new Error(
        `The ${what} of UID ${uid} in ${mailbox} was accepted but the message is still there. ` +
          `Refusing to record it as removed.`,
      );
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
