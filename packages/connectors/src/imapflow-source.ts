// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The IMAP source read path on `imapflow` (workplan 0032 T1).
 *
 * **This does not replace `imap-source.ts` yet, and that is the whole method.**
 * 0032 moves 1430 lines off `imap-simple`, and the path being moved is the one
 * thing in this product with nightly end-to-end evidence behind it. A rewrite
 * that lands in one commit trades that evidence for a hope. So this ships
 * BESIDE the proven client, and `imap-parity.integration.test.ts` — which until
 * today compared `ImapSource` with itself — now runs the two against the same
 * seeded Stalwart mailbox and reports every disagreement as a named field on a
 * named message. Cutting over is a separate, evidence-backed step.
 *
 * ============================================================================
 * THE ONE FIELD THIS IS ALL ABOUT
 * ============================================================================
 *
 * `naturalKeyForItem()` hashes `MailItem.messageId`. If a new client normalises
 * that header differently — whitespace, angle brackets, casing — **every
 * message re-copies on the next pass, and every write succeeds while it
 * happens** (hard rule 1). No count is wrong, no error is raised, and the
 * mailbox is simply twice its size.
 *
 * So this file does not have its own opinion about the field. It calls
 * `messageIdFromEnvelopeValue` from `imap-source.ts` — the same function the
 * proven client calls. That removes the risk of OUR logic drifting between two
 * files, and it deliberately does not hide a difference in what the two
 * CLIENTS hand in: `imapflow` trims the ENVELOPE value and `node-imap` does
 * not, so a server that ever emits a padded msg-id produces a real difference
 * that the harness will name. That is the correct outcome — the harness exists
 * to surface it, not to be spared it.
 *
 * `mapImapFlagsToKeywords` and `uidFromSourceRef` are shared for the same
 * reason, at lower stakes.
 *
 * ============================================================================
 * ONE DELIBERATE REFUSAL, AND IT IS A SCOPE DECISION RATHER THAN A DETAIL
 * ============================================================================
 *
 * `imapflow` reports a richer `specialUse` than `node-imap` does. Where a
 * server does not advertise RFC 6154, it **infers the role from the folder's
 * NAME**, with localised tables covering "Gelöschte Elemente", "Отправленные"
 * and dozens more (`lib/special-use.js`).
 *
 * **This connector does not use it.** Special-use is derived from the server's
 * own LIST flags — precisely what `node-imap` exposes as `attribs` — so the two
 * clients agree.
 *
 * That is not conservatism for its own sake. `specialUse` decides two things
 * with real consequences: which folders `excludeSpecialUse` keeps OUT of the
 * migration (Trash and Junk by default), and which folder the mail deletion
 * signal scans as the owner's bin (§11.1, "the owner's bin, read as a deletion
 * signal"). Taking imapflow's inference would silently change BOTH for any
 * account whose server omits SPECIAL-USE — folders that migrate today would
 * stop migrating, and a folder nobody classified as a bin would start being
 * read as evidence that the owner deleted things. Whatever the merits, that is
 * an owner-visible scope change, and shipping it inside a client swap would be
 * exactly the kind of silent behaviour change T0's harness was built to
 * prevent. It is recorded in 0032's status block as its own decision.
 *
 * @see docs/workplans/0032-imapflow-migration.md — T1
 * @see packages/connectors/src/imap-parity.ts — the harness that gates this
 */

import { ImapFlow } from 'imapflow';
import type { SourceConnector, SyncCursor, TokenProvider } from '@openmig/shared';
import type { MailFolder, MailItem, RawMessage, SpecialUse } from '@openmig/shared';
import {
  encodeImapCursor,
  decodeImapCursor,
  mapImapFlagsToKeywords,
  mapImapSpecialUse,
  messageIdFromEnvelopeValue,
  uidFromSourceRef,
  type ImapSourceConfigWithTokenProvider,
} from './imap-conventions';

/**
 * How many times to re-ask for a message that is not there yet, and how long
 * to wait between tries.
 *
 * Carried over from `imap-source.ts` verbatim rather than reconsidered: it
 * exists because a message APPENDed moments earlier is occasionally not yet
 * visible to a fresh connection, and that race belongs to the server, not to
 * the client library. Changing it here would make a parity difference that had
 * nothing to do with the migration.
 */
const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_MS = 50;

/**
 * The IMAP source read path, on `imapflow`.
 *
 * Deliberately the same constructor config as `ImapSource`, so the parity
 * harness can build both from one set of credentials and so a future cutover
 * is a changed `new`, not a changed call site.
 */
export class ImapFlowSource implements SourceConnector {
  private readonly config: ImapSourceConfigWithTokenProvider;
  private readonly tokenProvider?: TokenProvider;

  constructor(config: ImapSourceConfigWithTokenProvider) {
    this.config = config;
    this.tokenProvider = config.tokenProvider;
  }

  /**
   * Open a connection, per call.
   *
   * Per-call, like `ImapSource`, and for the same reason: `SourceConnector` has
   * no lifecycle, so a connector holding a socket between calls has nobody to
   * tell it to let go. imapflow's IDLE loop is switched OFF (`disableAutoIdle`)
   * because nothing here waits for a push — leaving it on means every listing
   * ends by entering IDLE and then has to break out of it.
   */
  async connect(): Promise<ImapFlow> {
    let accessToken: string | undefined = this.config.auth.accessToken;
    if (this.tokenProvider && this.config.authType === 'XOAUTH2') {
      const token = await this.tokenProvider.getToken();
      accessToken = token.accessToken;
    }

    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.tls,
      auth:
        this.config.authType === 'XOAUTH2'
          ? { user: this.config.auth.user, ...(accessToken ? { accessToken } : {}) }
          : { user: this.config.auth.user, pass: this.config.auth.password ?? '' },
      // Self-signed certs in dev, matching `ImapSource`'s `tlsOptions`. Same
      // posture, so a parity run is not comparing two different trust models.
      tls: { rejectUnauthorized: false },
      // imapflow logs every command at info level by default, which would put
      // mailbox names and message counts into the worker's log for every pass.
      logger: false,
      disableAutoIdle: true,
    });

    await client.connect();
    return client;
  }

  // ---------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------

  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    return this.withConnection((client) => this.listFoldersInternal(client));
  }

  private async listFoldersInternal(client: ImapFlow): Promise<ReadonlyArray<MailFolder>> {
    const listed = await client.list();

    if (listed.length === 0) {
      // The same fallback `ImapSource` has, kept so the two agree even in the
      // failure case. A server that answers LIST with nothing but can still
      // open INBOX is migratable; reporting "no folders" would report an
      // account with mail in it as empty, which hard rule 9 forbids.
      try {
        await client.mailboxOpen('INBOX');
        return [{ path: 'INBOX', name: 'INBOX', specialUse: 'inbox' as SpecialUse }];
      } catch (openErr) {
        throw new Error(
          'IMAP LIST returned no mailboxes and INBOX cannot be opened. ' +
            'This indicates a server-side issue or missing account configuration.',
          { cause: openErr },
        );
      }
    }

    return listed.map((box) => ({
      path: box.path,
      name: box.name,
      // The SERVER's own LIST flags, never imapflow's name-based inference —
      // see the header. `flags` is a Set here and an array in node-imap; the
      // contents are the same attributes.
      specialUse: mapImapSpecialUse([...(box.flags ?? [])]),
    }));
  }

  // ---------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------

  async listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<MailItem>; nextCursor: SyncCursor; unkeyable?: number }> {
    return this.withConnection((client) => this.listSinceInternal(client, folder, cursor));
  }

  private async listSinceInternal(
    client: ImapFlow,
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<MailItem>; nextCursor: SyncCursor; unkeyable?: number }> {
    const lock = await client.getMailboxLock(folder.path);
    try {
      const box = client.mailbox;
      if (!box || typeof box === 'boolean') {
        throw new Error('No mailbox opened');
      }

      // imapflow reports UIDVALIDITY as a bigint (it is a 32-bit unsigned value
      // the spec allows to be large); the cursor format is decimal text either
      // way, so this is a representation change and not a value one.
      const uidValidity = Number(box.uidValidity);
      let uidNext = box.uidNext || 1;
      let cursorUidNext: number | undefined;

      if (cursor) {
        try {
          const decoded = decodeImapCursor(cursor);
          if (decoded.uidValidity === uidValidity) {
            // UIDVALIDITY changed means the server re-numbered the mailbox and
            // the cursor is meaningless — a full scan, exactly as `ImapSource`
            // does, rather than resuming from a UID that now names a different
            // message.
            cursorUidNext = decoded.uidNext;
            uidNext = decoded.uidNext;
          }
        } catch {
          // Invalid cursor, do a full scan.
        }
      }

      const items: MailItem[] = [];
      let maxUidNext = uidNext;
      let unkeyable = 0;

      // An empty mailbox is not fetched at all. `1:*` against zero messages is
      // an error on some servers and an empty result on others, and a thrown
      // error here would read as "this folder could not be listed" — which the
      // sync loop treats very differently from "this folder is empty".
      const messages = box.exists === 0 ? [] : await this.fetchListing(client);

      for (const msg of messages) {
        const uid = msg.uid;
        // Filtered by UID rather than by a range search, matching
        // `ImapSource`: `>=` the cursor's uidNext, so a message that arrived
        // AT the boundary is included rather than skipped.
        if (cursorUidNext !== undefined && uid < cursorUidNext) continue;

        const messageId = messageIdFromEnvelopeValue(msg.envelope?.messageId);
        if (!messageId) {
          // No Message-ID, so no natural key from the listing. Emitted with an
          // empty one: the sync path derives a stable id from the body bytes,
          // writes it in as a real header and keys the ledger by it. Counted,
          // because the customer is told how many of their messages we had to
          // give an id to.
          unkeyable++;
        }

        items.push({
          messageId: messageId ?? '',
          folder,
          keywords: mapImapFlagsToKeywords([...(msg.flags ?? [])]),
          receivedAt: toIsoDate(msg.internalDate),
          size: msg.size as number,
          sourceRef: `${folder.path}:${uid}`,
        });

        if (uid > maxUidNext) {
          maxUidNext = uid + 1;
        }
      }

      return {
        items,
        nextCursor: { value: encodeImapCursor(uidValidity, maxUidNext) },
        ...(unkeyable > 0 ? { unkeyable } : {}),
      };
    } finally {
      lock.release();
    }
  }

  /**
   * Every message in the open mailbox, with the attributes a `MailItem` needs.
   *
   * `1:*` by SEQUENCE, not by UID, because that is what `ImapSource`'s
   * `search(['ALL'])` returns — every message in the mailbox — and a UID range
   * of `1:*` would mean something subtly different on a mailbox whose first UID
   * is not 1. The cursor filter is applied afterwards by both clients.
   */
  private async fetchListing(client: ImapFlow) {
    return client.fetchAll('1:*', {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      size: true,
    });
  }

  // ---------------------------------------------------------------------
  // Fetching
  // ---------------------------------------------------------------------

  async fetch(item: MailItem): Promise<RawMessage> {
    return this.withConnection((client) => this.fetchInternal(client, item));
  }

  private async fetchInternal(client: ImapFlow, item: MailItem): Promise<RawMessage> {
    const lock = await client.getMailboxLock(item.folder.path);
    try {
      const uid = uidFromSourceRef(item.sourceRef);

      let message: Awaited<ReturnType<ImapFlow['fetchOne']>> = false;
      for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (message) break;
        await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_MS));
      }

      if (!message) {
        throw new Error(`Message not found: ${item.sourceRef}`);
      }
      if (!message.source) {
        // The message exists and its bytes did not arrive. Returning an empty
        // buffer would copy a zero-byte message and count it a success, which
        // is the worst thing this method could do.
        throw new Error(`No body found for message: ${item.sourceRef}`);
      }

      return { item, rfc822: message.source };
    } finally {
      lock.release();
    }
  }

  // ---------------------------------------------------------------------
  // Connection lifecycle + token refresh
  // ---------------------------------------------------------------------

  /**
   * Run one operation on a fresh connection, retrying once through a refreshed
   * token if the failure was an auth failure.
   *
   * One place rather than the three near-identical copies `imap-source.ts`
   * carries, because the third of them is where a `finally` was once missed.
   * The retry is deliberately ONCE: a token that is still rejected after a
   * refresh is a configuration problem, and retrying it in a loop turns a clear
   * failure into a slow one.
   */
  private async withConnection<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    let client = await this.connect();
    try {
      return await operation(client);
    } catch (error) {
      if (isAuthError(error) && this.tokenProvider) {
        await closeQuietly(client);
        await this.tokenProvider.refresh();
        client = await this.connect();
        try {
          return await operation(client);
        } finally {
          await closeQuietly(client);
        }
      }
      throw error;
    } finally {
      await closeQuietly(client);
    }
  }
}

/**
 * INTERNALDATE as an ISO string.
 *
 * imapflow types this as `Date | string`, so both are handled. The `new Date()`
 * fallback matches `ImapSource` exactly — it is not a good answer, but it is
 * the SAME answer, and a parity harness comparing two different fallbacks would
 * report a difference that says nothing about the migration.
 */
function toIsoDate(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Close a connection without letting the close itself become the failure.
 *
 * A `logout()` that throws while the operation SUCCEEDED would turn a good
 * pass into a failed one; a `logout()` that throws while the operation already
 * failed would replace the real error with a meaningless one (hard rule 9).
 * Neither is acceptable, and `close()` is the unconditional fallback because a
 * socket left open outlives the pass.
 */
async function closeQuietly(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {
      // Already gone. Nothing further to do and nothing worth reporting: the
      // connection is per-call, so a socket we cannot close is a socket the
      // server has closed for us.
    }
  }
}

/**
 * Is this an authentication failure worth refreshing a token for?
 *
 * The same patterns `imap-source.ts` matches, plus imapflow's own
 * `AUTHENTICATIONFAILED` response code, which node-imap never surfaced in that
 * form. Kept as a superset rather than a rewrite: narrowing it would mean a
 * token that used to be refreshed silently stops being.
 */
export function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('authentication failed') ||
    message.includes('authenticationfailed') ||
    message.includes('unauthorized') ||
    message.includes('xoauth2') ||
    message.includes('invalid token') ||
    message.includes('token expired') ||
    message.includes('401')
  );
}
