// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A plain IMAP client for TESTS to inspect and seed a server with.
 *
 * **This is the independent observer, and that is the whole reason it exists
 * as its own file rather than being deleted alongside `imap-simple`.**
 *
 * Several integration tests need to put messages on a server, or read back what
 * a connector claims to have written, WITHOUT going through the connector under
 * test. If a test seeds through `ImapFlowSource` and verifies through
 * `ImapFlowSource`, a connector that misreads a mailbox agrees with itself and
 * the test passes. Those tests used `imap-simple` directly for exactly that
 * separation; workplan 0032 T3b removes that dependency, and the tempting move
 * — deleting the six call sites along with everything else the `grep` turned up
 * — would have removed the observer too.
 *
 * So the observer is ported, not dropped. It is a different client library from
 * the one the connectors use only by accident of history now; what it still is,
 * and must stay, is a different CODE PATH: no import from `@openmig/connectors`,
 * no shared helper with the thing being observed. If this file ever starts
 * calling a connector to check a connector, it has stopped being evidence.
 *
 * Deliberately small. Connect, seed, count, purge, list, close — the operations
 * the tests actually perform, and nothing built out for a use nobody has.
 *
 * @see docs/workplans/0032-imapflow-migration.md — T3b
 */

import { ImapFlow } from 'imapflow';

export interface ImapTestClientConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Default true — the test servers speak IMAPS on their mapped port. */
  readonly tls?: boolean;
  /** Default false — the test certificates are self-signed. */
  readonly rejectUnauthorized?: boolean;
}

/** One message to place on a server. */
export interface SeedMessage {
  readonly messageId: string;
  readonly subject: string;
  readonly body: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Connect, run `fn`, and always close.
 *
 * A test that leaks a connection leaves the mailbox SELECTed, and the next test
 * to run against the same account gets a server-side lock timeout that reads as
 * a flake rather than as the missing `close()` it is.
 */
export async function withImapTestClient<T>(
  config: ImapTestClientConfig,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls ?? true,
    tls: { rejectUnauthorized: config.rejectUnauthorized ?? false },
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** The RFC822 bytes for a seed message, with the Message-ID the test names. */
export function rfc822For(msg: SeedMessage): string {
  return (
    `From: ${msg.from ?? 'source@dev.local'}\r\n` +
    `To: ${msg.to ?? 'target@dev.local'}\r\n` +
    `Subject: ${msg.subject}\r\n` +
    `Message-ID: ${msg.messageId}\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    `${msg.body}\r\n`
  );
}

/**
 * Remove every message from `mailbox`, so a test starts from a known state.
 *
 * **Uses UID EXPUNGE where the server offers it (RFC 4315).** A bare EXPUNGE
 * removes every message in the mailbox carrying `\Deleted`, including ones
 * another client flagged and never committed — the same widening
 * `ImapFlowDavMailTarget` refuses in production. It matters less in a test
 * account, and doing it the careful way here means the test helper cannot be
 * cited as precedent for doing it the other way somewhere that matters.
 *
 * Returns how many messages were removed.
 */
export async function purgeMailbox(client: ImapFlow, mailbox = 'INBOX'): Promise<number> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids: number[] = [];
    for await (const message of client.fetch('1:*', { uid: true }, { uid: true })) {
      uids.push(message.uid);
    }
    if (uids.length === 0) return 0;

    const removed = await client.messageDelete(uids, { uid: true });
    // imapflow reports a refused delete by RETURN VALUE rather than by throwing
    // — its expunge command catches its own error, logs a warning and returns
    // false. A purge that quietly did nothing would leave the next test looking
    // at the previous test's messages and blaming itself.
    if (!removed) {
      throw new Error(
        `Could not purge ${uids.length} message(s) from ${mailbox}: the server refused the ` +
          `delete. The mailbox is NOT in the clean state this test assumes.`,
      );
    }
    return uids.length;
  } finally {
    lock.release();
  }
}

/**
 * Purge every mailbox on the account, reporting rather than throwing.
 *
 * Callers use this as `beforeAll` cleanup where a failure to clean one mailbox
 * has never been worth failing the run over — a mailbox the server will not let
 * us open is warned about and skipped. **The failures are RETURNED rather than
 * swallowed**, so a caller that decides otherwise can act on them, and so a
 * cleanup that silently did nothing at all is visible in the result instead of
 * only in a log line nobody greps for.
 */
export async function purgeAllMailboxes(
  client: ImapFlow,
): Promise<{ purged: Record<string, number>; failed: Record<string, string> }> {
  const purged: Record<string, number> = {};
  const failed: Record<string, string> = {};
  for (const path of await listMailboxPaths(client)) {
    try {
      purged[path] = await purgeMailbox(client, path);
    } catch (err) {
      failed[path] = err instanceof Error ? err.message : String(err);
    }
  }
  return { purged, failed };
}

/** Append `messages` to `mailbox`, creating it when it is absent. */
export async function seedMailbox(
  client: ImapFlow,
  messages: ReadonlyArray<SeedMessage>,
  mailbox = 'INBOX',
): Promise<void> {
  if (mailbox !== 'INBOX') await ensureMailbox(client, mailbox);
  for (const msg of messages) {
    await client.append(mailbox, Buffer.from(rfc822For(msg)), []);
  }
}

/**
 * How many messages `mailbox` holds, read from the server rather than cached.
 *
 * **Not `client.mailbox.exists`.** That is a snapshot taken when the mailbox was
 * SELECTed and imapflow does NOT re-SELECT one that is already open, so a
 * mailbox appended to since the lock was taken still reports its old count. That
 * exact stale read was a real bug in `ImapFlowDavMailTarget` (0032 T2), found by
 * the write-path parity harness, and a test helper that repeated it would
 * confirm whatever the code did.
 */
export async function countMessages(client: ImapFlow, mailbox = 'INBOX'): Promise<number> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    let count = 0;
    for await (const _message of client.fetch('1:*', { uid: true }, { uid: true })) count++;
    return count;
  } finally {
    lock.release();
  }
}

/** What a test needs to know about a mailbox to reason about UIDs. */
export interface MailboxState {
  readonly uidValidity: number;
  /** The highest UID present, or 0 for an empty mailbox. */
  readonly maxUid: number;
  readonly count: number;
}

/**
 * Read a mailbox's UIDVALIDITY and highest UID, for tests that set a cursor.
 *
 * `uidValidity` comes off the SELECT and is a `bigint` in imapflow (RFC 3501
 * allows the full 32-bit range); it is narrowed to `number` here because that
 * is what `encodeImapCursor` takes and every test value is small. The UIDs are
 * counted from a live fetch rather than from `mailbox.exists` — see
 * `countMessages`.
 */
export async function mailboxState(client: ImapFlow, mailbox = 'INBOX'): Promise<MailboxState> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const box = client.mailbox;
    if (!box) throw new Error(`Could not read the state of ${mailbox}: no mailbox is selected.`);
    let maxUid = 0;
    let count = 0;
    for await (const message of client.fetch('1:*', { uid: true }, { uid: true })) {
      count++;
      if (message.uid > maxUid) maxUid = message.uid;
    }
    return { uidValidity: Number(box.uidValidity), maxUid, count };
  } finally {
    lock.release();
  }
}

/** Every mailbox path on the account. */
export async function listMailboxPaths(client: ImapFlow): Promise<string[]> {
  const boxes = await client.list();
  return boxes.map((b) => b.path);
}

/**
 * Ensure `mailbox` exists, and say nothing if it already did.
 *
 * Asks LIST rather than calling `mailboxCreate` and swallowing the failure:
 * a swallowed create hides a server that refused for a reason worth knowing
 * (a quota, a namespace, a name the server will not accept), and the test then
 * fails later somewhere less informative.
 */
export async function ensureMailbox(client: ImapFlow, mailbox: string): Promise<void> {
  const existing = await listMailboxPaths(client);
  if (!existing.includes(mailbox)) {
    await client.mailboxCreate(mailbox);
  }
}
