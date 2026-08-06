// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The IMAP mail WRITE path on `imapflow` (workplan 0032 T2).
 *
 * **This is the half that can lose data**, and the workplan says so: the read
 * path can be wrong loudly (items missing, counts off) while the write path can
 * be wrong quietly — a duplicate, a lost flag, an append that silently
 * truncated, a removal that took the wrong message. T1 went first so the parity
 * apparatus would be trusted before it guarded this.
 *
 * Like `ImapFlowSource`, this ships BESIDE `ImapDavMailTarget` rather than
 * instead of it. Nothing is cut over. `imap-target-parity.ts` runs the two
 * writers through the same script against the same server and reports every
 * disagreement as a named field.
 *
 * ============================================================================
 * TWO THINGS IMAPFLOW MAKES EASIER THAT MUST NOT BE TAKEN AT FACE VALUE
 * ============================================================================
 *
 * **1. `messageDelete` silently widens a destructive operation.** Its own
 * source reads `let byUid = options.uid && hasCapability(connection, 'UIDPLUS')`
 * — so on a server WITHOUT UIDPLUS, `messageDelete(uid, {uid: true})` quietly
 * issues a **bare EXPUNGE**, which removes every message in the mailbox that
 * anyone has flagged `\Deleted`, including ones another client flagged and has
 * not committed. That destroys data nobody in this product ever looked at,
 * which hard rule 2 forbids outright. `ImapDavMailTarget` refuses in that case
 * and so does this: the capability is checked HERE, before the call, and a
 * server without UIDPLUS gets a refusal rather than a broader deletion than was
 * asked for.
 *
 * **2. `messageDelete` and `messageMove` report failure by RETURN VALUE.**
 * imapflow's expunge command catches its own error, logs a warning and returns
 * `false`. A caller that ignores the result records a removal the server
 * refused. Both are checked, and the `verifyGone` read-back stays regardless,
 * because a server can accept a MOVE, answer OK, and leave the message where it
 * was.
 *
 * ============================================================================
 * WHAT IMAPFLOW GENUINELY IMPROVES, AND WHERE THAT IS A BEHAVIOUR CHANGE
 * ============================================================================
 *
 * `ImapDavMailTarget.findByNaturalKey` searches ALL, then issues **one HEADER
 * FETCH PER MESSAGE**, string-scans each for a line starting `message-id:`, and
 * compares. This does one `FETCH … ENVELOPE` for the whole mailbox instead.
 * Faster by the size of the mailbox, and **more correct in one case that is
 * worth stating rather than smuggling**: a Message-ID folded across two lines
 * is missed by a line-prefix scan and parsed correctly by ENVELOPE. The old
 * path would therefore fail to find such a message and APPEND A DUPLICATE.
 *
 * That difference is latent rather than fabricated — every message this product
 * writes carries an unfolded id, so no fixture provokes it — and it is recorded
 * here and in the workplan rather than planted in the parity fixture, because
 * manufacturing a red for a pre-existing defect nothing has hit would say
 * something untrue about the migration.
 *
 * @see docs/workplans/0032-imapflow-migration.md — T2
 * @see packages/connectors/src/imap-target-parity.ts — the harness that gates this
 */

import { ImapFlow } from 'imapflow';
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
} from '@openmig/shared';
import { contentHash, log } from '@openmig/shared';
import {
  mapImapSpecialUse,
  KEYWORD_TO_FLAG,
  extractMessageIdFromRfc822,
  type ImapDavTargetConfig,
} from './imap-conventions';

/**
 * The mail write path, on `imapflow`.
 *
 * Deliberately the same constructor config as `ImapDavMailTarget`, so the
 * parity harness builds both from one set of credentials and a future cutover
 * is a changed `new`, not a changed call site.
 */
export class ImapFlowDavMailTarget implements TargetWriter, TargetReindexer, TargetRemover {
  private readonly config: ImapDavTargetConfig;
  private client: ImapFlow | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(config: ImapDavTargetConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------

  /**
   * Self-connect on first use, single-flight.
   *
   * `TargetWriter` has no `connect()` and the sync path never calls the
   * concrete one, so a writer that waits to be connected throws on every write.
   * A failed connect is not cached, so the next call retries.
   *
   * ONE PERSISTENT CONNECTION, unlike `ImapFlowSource`'s per-call model — the
   * same shape `ImapDavMailTarget` has. A write pass performs many operations
   * against the same account and re-authenticating per message would be both
   * slower and ruder to the server's connection limits.
   */
  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().catch((err: unknown) => {
        this.connectPromise = null;
        throw err;
      });
    }
    await this.connectPromise;
  }

  async connect(): Promise<void> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.tls,
      auth: { user: this.config.username, pass: this.config.password },
      tls: { rejectUnauthorized: this.config.rejectUnauthorized ?? true },
      // imapflow logs every command at info level by default, which would put
      // mailbox names and message counts in the worker's log for every write.
      logger: false,
      disableAutoIdle: true,
    });
    await client.connect();
    this.client = client;
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connectPromise = null;
    if (!client) return;
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        // Already gone; the server closed it for us.
      }
    }
  }

  /** The live client, or a refusal. Never returns null to a caller. */
  private async live(): Promise<ImapFlow> {
    await this.ensureConnected();
    if (!this.client) throw new Error('Not connected to IMAP server');
    return this.client;
  }

  // ---------------------------------------------------------------------
  // Mailboxes
  // ---------------------------------------------------------------------

  /**
   * The account's mailboxes as `MailFolder[]`.
   *
   * Special use comes from the server's own LIST flags, NOT imapflow's
   * name-based inference — the same deliberate refusal `ImapFlowSource` makes,
   * and it matters more here: `findBin` picks the removal destination from this
   * value, so a folder that imapflow decided was `\Trash` because of its NAME
   * would become the place this writer moves a customer's deleted mail to.
   */
  private async listMailboxes(): Promise<MailFolder[]> {
    const client = await this.live();
    const listed = await client.list();
    return listed.map((box) => ({
      path: box.path,
      name: box.name,
      specialUse: mapImapSpecialUse([...(box.flags ?? [])]),
    }));
  }

  async ensureMailbox(folder: MailFolder): Promise<string> {
    const client = await this.live();
    const mailboxName = folder.path || folder.name;
    if (!mailboxName) {
      throw new Error('Mailbox name or path is required');
    }

    const existing = await this.listMailboxes();
    if (existing.some((f) => f.path === mailboxName)) {
      return mailboxName;
    }

    // `mailboxCreate` answers `{ created: false }` for one that already exists
    // rather than throwing, which is the outcome we want either way — the LIST
    // above is a pass old by the time this runs.
    //
    // NO special-use flag is set, exactly as in `ImapDavMailTarget`. RFC 6154
    // assigns special use at CREATE time or by server policy and there is no
    // command to attach one afterwards. Nothing downstream depends on it: the
    // bin is found by reading the flags the SERVER assigned (see `findBin`).
    await client.mailboxCreate(mailboxName);
    return mailboxName;
  }

  // ---------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------

  /**
   * The UID of the message with this Message-ID, or undefined.
   *
   * **A failed lookup is NOT "not present".** `upsertEmail` reads `undefined`
   * as "append it", so swallowing a transient failure here writes a duplicate —
   * which breaks the one property the whole product rests on (hard rule 1), and
   * hard rule 9 forbids turning a failure into an empty result. Failing loudly
   * is safe and resumable: the pass aborts, the folder keeps its cursor, and
   * the next pass re-scans from the same point.
   */
  async findByNaturalKey(mailboxId: string, naturalKey: string): Promise<string | undefined> {
    const client = await this.live();
    // Both sides stripped identically. `extractMessageIdFromRfc822` already
    // strips, but the caller is not always that function — a ledger row carries
    // whatever was recorded — so normalising here too costs nothing and removes
    // the way this silently answers "absent" for a message that IS there.
    const wanted = normaliseKey(naturalKey);

    let lock;
    try {
      lock = await client.getMailboxLock(mailboxId);
    } catch (err) {
      throw new Error(
        `Lookup failed for Message-ID ${naturalKey} in mailbox ${mailboxId}; refusing to treat ` +
          `this as "not present" because that would append a duplicate. Cause: ${message(err)}`,
        { cause: err },
      );
    }

    try {
      // ONE fetch for the whole mailbox. See the header for why this is
      // ENVELOPE rather than a per-message HEADER string scan, and what that
      // changes.
      //
      // A **UID** range (`{ uid: true }`), not a sequence range, and there is
      // no `mailbox.exists === 0` short-circuit in front of it. Both details
      // are the same bug, caught by the parity harness on its first real run:
      // `client.mailbox.exists` is a SNAPSHOT taken when the mailbox was
      // SELECTed, and imapflow's `getMailboxLock` does not re-SELECT one that
      // is already open — so after `upsertEmail` appended into a mailbox first
      // locked while empty, `exists` was still 0 and this returned `undefined`
      // for messages that were right there. That is the exact shape hard rule 9
      // forbids: a stale optimisation answering "not present", which
      // `upsertEmail` turns into a duplicate APPEND.
      //
      // A UID range of `1:*` is also the reason the guard is not needed at all:
      // RFC 3501 says a UID FETCH matching nothing returns no data rather than
      // an error, unlike a sequence FETCH with an out-of-range number — which
      // is what the guard was there to avoid in the first place.
      const messages = await client.fetchAll('1:*', { uid: true, envelope: true }, { uid: true });
      for (const msg of messages) {
        const found = msg.envelope?.messageId;
        if (typeof found === 'string' && normaliseKey(found) === wanted) {
          return String(msg.uid);
        }
      }
      // A COMPLETE scan that matched nothing — this really is "not present".
      return undefined;
    } catch (err) {
      throw new Error(
        `Lookup failed for Message-ID ${naturalKey} in mailbox ${mailboxId}; refusing to treat ` +
          `this as "not present" because that would append a duplicate. Cause: ${message(err)}`,
        { cause: err },
      );
    } finally {
      lock.release();
    }
  }

  // ---------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------

  async upsertEmail(
    mailboxId: string,
    raw: RawMessage,
    keywords: ReadonlyArray<MailKeyword>,
  ): Promise<UpsertResult> {
    const client = await this.live();

    const messageId = extractMessageIdFromRfc822(raw.rfc822);
    if (!messageId) {
      throw new Error('No Message-ID found in raw message');
    }

    const existingUid = await this.findByNaturalKey(mailboxId, messageId);
    if (existingUid) {
      // Already on the target under our natural key: not written, ADOPTED.
      // Distinct from a ledger fast-path skip — see `UpsertResult.adopted`.
      return {
        targetId: existingUid,
        created: false,
        adopted: true,
        targetVersion: await this.uidValidityOf(mailboxId),
      };
    }

    const targetVersion = await this.uidValidityOf(mailboxId);

    const flags: string[] = [];
    for (const keyword of keywords) {
      const flag = KEYWORD_TO_FLAG[keyword];
      if (flag) flags.push(flag);
    }

    // `\Seen` by default, matching `ImapDavMailTarget`. Not a preference: a
    // migration that silently marked a mailbox unread would hand the owner
    // thousands of "new" messages on cutover day.
    const appended = await client.append(
      mailboxId,
      Buffer.from(raw.rfc822),
      flags.length > 0 ? flags : ['\\Seen'],
    );

    if (!appended) {
      throw new Error(`APPEND of ${messageId} to ${mailboxId} was refused by the server.`);
    }

    // UIDPLUS gives the UID in the APPENDUID response, so no search is needed —
    // and this is the ONLY way to know for certain which message we just wrote.
    // `ImapDavMailTarget` had to search afterwards and fall back to a rescan.
    if (typeof appended.uid === 'number') {
      return { targetId: String(appended.uid), created: true, targetVersion };
    }

    // No UIDPLUS: find it by its Message-ID, with a COMPLETE scan that throws
    // rather than guesses.
    //
    // The old writer once took "the highest UID in the mailbox" as the one just
    // appended. That is a guess — a concurrent delivery, or any message the
    // account already held with a higher UID, makes it the wrong message — and
    // the ledger row it produced pointed our natural key at somebody else's
    // mail. `removeItem` acts on that id, so the guess was one `apply` away
    // from deleting the wrong message.
    const rescanned = await this.findByNaturalKey(mailboxId, messageId);
    if (rescanned) {
      return { targetId: rescanned, created: true, targetVersion };
    }

    throw new Error(
      `Appended the message to ${mailboxId} but could not find it again by Message-ID ` +
        `${messageId}, so there is no id to record for it. Refusing to guess a UID: the ` +
        `recorded id is what a later removal would act on.`,
    );
  }

  /**
   * A mailbox's UIDVALIDITY, as a string, for the ledger's `targetVersion`.
   *
   * WHAT "the version of our copy" MEANS ON IMAP. Every other writer records an
   * ETag over the object's own bytes, but an IMAP message cannot be edited in
   * place at all — a client that "edits" one appends a new message and deletes
   * the old, producing a new UID. So the thing that can invalidate our handle is
   * not the message changing; it is the MAILBOX being recreated, which resets
   * UIDVALIDITY and re-issues every UID to a different message.
   *
   * imapflow types it as a bigint. The ledger stores decimal text, so this is a
   * representation change and not a value one — but a `42n` reaching the column
   * would compare unequal to the `42` written by the other writer, and every
   * removal would then refuse with a stale-handle error.
   */
  private async uidValidityOf(mailbox: string): Promise<string> {
    const client = await this.live();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const box = client.mailbox;
      if (!box || typeof box === 'boolean') throw new Error('No mailbox opened');
      return String(box.uidValidity);
    } finally {
      lock.release();
    }
  }

  // ---------------------------------------------------------------------
  // Reindex
  // ---------------------------------------------------------------------

  /**
   * Every message on the target, keyed by Message-ID (ADR-0020).
   *
   * Refuses at every point the old writer refuses, and for the same reason: a
   * partial reindex produces a ledger that LOOKS complete, so the next sync
   * re-appends everything it never enumerated — mass duplication produced by
   * the recovery meant to prevent it.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    const client = await this.live();

    let mailboxNames: string[];
    if (mailboxId) {
      mailboxNames = [mailboxId];
    } else {
      try {
        mailboxNames = (await this.listMailboxes()).map((f) => f.path);
      } catch (err) {
        throw new Error(
          `Could not enumerate mailboxes for reindex; refusing to continue with a partial view ` +
            `because the rebuilt ledger would look complete while missing messages. ` +
            `Cause: ${message(err)}`,
          { cause: err },
        );
      }
      // An account with genuinely no mailboxes reported still has an INBOX.
      if (mailboxNames.length === 0) mailboxNames = ['INBOX'];
    }

    for (const boxName of mailboxNames) {
      let entries: TargetEntry[];
      try {
        entries = await this.entriesIn(client, boxName);
      } catch (err) {
        throw new Error(
          `Failed to list entries in mailbox ${boxName} during reindex; refusing to skip it ` +
            `because omitted messages would be re-created as duplicates on the next sync. ` +
            `Cause: ${message(err)}`,
          { cause: err },
        );
      }
      for (const entry of entries) yield entry;
    }
  }

  /** One mailbox's entries, collected under a lock so the iterator cannot hold it. */
  private async entriesIn(client: ImapFlow, boxName: string): Promise<TargetEntry[]> {
    const lock = await client.getMailboxLock(boxName);
    try {
      const entries: TargetEntry[] = [];
      // UID range, no `exists` short-circuit — see `findByNaturalKey` for why
      // both matter. Here the stale-`exists` bug reindexes an account as EMPTY,
      // which is worse than the lookup case: the rebuilt ledger looks complete
      // and the next sync re-appends every message in it.
      const listed = await client.fetchAll('1:*', { uid: true, envelope: true, size: true }, { uid: true });
      for (const msg of listed) {
        const found = msg.envelope?.messageId;
        if (typeof found !== 'string' || found === '') {
          // Keying by UID instead would produce a ledger row that can never
          // match the message's real Message-ID, so the next sync sees an
          // unknown item and re-appends it — a duplicate created by the
          // reindex. The natural key must be the real one or nothing.
          throw new Error(
            `No Message-ID header for UID ${msg.uid} in mailbox ${boxName} during reindex; ` +
              `refusing to key the entry by UID because the resulting ledger row would never ` +
              `match and the message would be duplicated.`,
          );
        }
        entries.push({
          // Stripped, matching what `upsertEmail` records — the two must agree
          // or a reindexed row never matches the message it describes.
          naturalKey: normaliseKey(found),
          targetId: String(msg.uid),
          mailboxId: boxName,
          // Free from the same fetch, and what lets verification report
          // `totalBytesTarget` as a measurement rather than null.
          ...(typeof msg.size === 'number' ? { sizeBytes: msg.size } : {}),
        });
      }
      return entries;
    } finally {
      lock.release();
    }
  }

  // ---------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------

  /**
   * The account's bin, by RFC 6154 FLAG rather than by name.
   *
   * Never by name. Stalwart and Exchange call it "Deleted Items", Gmail
   * "[Gmail]/Bin" or "[Gmail]/Trash" by locale, a Dutch account "Prullenbak". A
   * `/trash/i` match finds none of those, and the failure is silent: no bin
   * found means the message is expunged outright instead of binned, turning a
   * recoverable removal into an unrecoverable one.
   */
  private async findBin(): Promise<string | undefined> {
    const folders = await this.listMailboxes();
    return folders.find((f) => f.specialUse === 'trash')?.path;
  }

  /** Is `uid` still in `mailbox`? Asked under a lock, answered by UID search. */
  private async uidExists(mailbox: string, uid: number): Promise<boolean> {
    const client = await this.live();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const found = await client.search({ uid: String(uid) }, { uid: true });
      // `search` answers `false` when the mailbox is not selected — which is
      // NOT "the message is gone". Treating it as such would let a removal
      // report success having checked nothing.
      if (found === false) {
        throw new Error(`UID search in ${mailbox} was refused, so presence could not be checked.`);
      }
      return found.includes(uid);
    } finally {
      lock.release();
    }
  }

  /**
   * Remove the copy of one message the owner deleted on the source (ADR-0024).
   *
   * THE ONE DESTRUCTIVE PATH here, reached only through `applyDeletion`'s seven
   * gates and one explicit owner decision at a time. Every guard from
   * `ImapDavMailTarget` is reproduced, because an IMAP UID is a far weaker
   * handle than the JMAP id or DAV href the other writers remove by:
   *
   * - It is **mailbox-scoped**, so `collection` is required. Absent is refused,
   *   not guessed — guessing INBOX would remove message number N from the inbox
   *   because number N in some other folder was deleted on the source.
   * - It is **only valid under one UIDVALIDITY**. If the mailbox was recreated
   *   since we wrote, every UID we hold names a different message.
   */
  async removeItem(
    targetId: string,
    options?: { readonly expectedTargetVersion?: string; readonly collection?: string },
  ): Promise<RemovalResult> {
    const client = await this.live();

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

    const uidValidity = await this.uidValidityOf(mailbox);
    const expected = options?.expectedTargetVersion;
    if (expected !== undefined && expected !== uidValidity) {
      // Thrown rather than reported as `conflicted`: `conflicted` tells the
      // operator "somebody edited your copy", a specific and here FALSE
      // explanation. This is a stale handle, and saying so is the only honest
      // answer (hard rule 9).
      throw new Error(
        `Refusing to remove UID ${uid} from ${mailbox}: the mailbox reports UIDVALIDITY ` +
          `${uidValidity} but this item was written under ${expected}. The mailbox has been ` +
          `recreated since, so every UID now names a different message and this one cannot be ` +
          `identified. Nothing was changed. Remove the item in the target system yourself, then ` +
          `choose \`keep\`.`,
      );
    }

    if (!(await this.uidExists(mailbox, uid))) {
      // Already gone — somebody removed it by hand in the new system. Reported
      // as "no removal" rather than claimed as a success: the ledger row then
      // still says the item is on the target, which §20 surfaces as
      // `missingOnTarget`. Loud and correctable beats a tombstone recorded for
      // something this never touched.
      log.warn(
        `[imapflow-dav-target] UID ${uid} is no longer in ${mailbox}; nothing to remove. ` +
          `Verification will report the item as missing on the target until reconciled.`,
      );
      return {};
    }

    const bin = await this.findBin();

    if (bin && bin !== mailbox) {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const moved = await client.messageMove(String(uid), bin, { uid: true });
        // imapflow reports a refused MOVE by RETURN VALUE, not by throwing.
        if (!moved) {
          throw new Error(`The server refused to move UID ${uid} from ${mailbox} to ${bin}.`);
        }
      } finally {
        lock.release();
      }
      await this.verifyGone(mailbox, uid, `move to ${bin}`);
      return { kind: 'binned' };
    }

    // No bin, or the copy is already in it — expunge.
    //
    // **THE CAPABILITY CHECK IS HERE, NOT DELEGATED**, and this is the single
    // most important line in the file. imapflow's `messageDelete` computes
    // `byUid = options.uid && hasCapability(connection, 'UIDPLUS')` and falls
    // back to a BARE EXPUNGE when the capability is missing — which removes
    // every message in the mailbox that anyone has flagged `\Deleted`,
    // including ones another client flagged and has not committed. That is data
    // nobody in this product ever looked at, and hard rule 2 forbids touching
    // it. Passing `{uid: true}` and trusting it would be a silent widening of
    // the one destructive operation this product has.
    if (!client.capabilities.has('UIDPLUS')) {
      throw new Error(
        `Refusing to remove UID ${uid} from ${mailbox}: the server has no ${bin ? '' : '`\\Trash` '}` +
          `mailbox to move it to and does not support UIDPLUS, so the only way to delete it ` +
          `would be a bare EXPUNGE — which also removes every other message in the mailbox ` +
          `that anyone has flagged \\Deleted. Nothing was changed. Remove the item in the ` +
          `target system yourself, then choose \`keep\`.`,
      );
    }

    const lock = await client.getMailboxLock(mailbox);
    try {
      const deleted = await client.messageDelete(String(uid), { uid: true });
      // Same reason as the move: imapflow's expunge catches its own error, logs
      // a warning and returns false. Ignoring that records a removal the server
      // refused.
      if (!deleted) {
        throw new Error(`The server refused to expunge UID ${uid} from ${mailbox}.`);
      }
    } finally {
      lock.release();
    }
    await this.verifyGone(mailbox, uid, 'expunge');
    return { kind: 'deleted' };
  }

  /**
   * Confirm the message really left the mailbox.
   *
   * A read-back, because a server can accept a MOVE or an EXPUNGE, answer OK,
   * and leave the message where it was. Without this the ledger records a
   * tombstone for a copy still sitting on the target, and nothing ever looks
   * again — the row says the item was removed, so verification does not expect
   * it either. Silent, permanent, and exactly the class of bug this codebase
   * pays for read-backs to avoid.
   */
  private async verifyGone(mailbox: string, uid: number, what: string): Promise<void> {
    if (await this.uidExists(mailbox, uid)) {
      throw new Error(
        `The ${what} of UID ${uid} in ${mailbox} was accepted but the message is still there. ` +
          `Refusing to record it as removed.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------

  /**
   * Hash a sampled message as it is stored on the target (§20 checksum leg).
   *
   * `source` is the message as appended, so hashing it with the same
   * `contentHash` the sync path used on the source is like-for-like. Called for
   * sampled items only.
   *
   * Returns undefined when the body cannot be read — the sample is then counted
   * as unavailable, never as a mismatch. Absence of evidence is not evidence of
   * corruption.
   */
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    const uid = Number(entry.targetId);
    if (!Number.isInteger(uid)) {
      log.warn(
        `[imapflow] ${entry.targetId} is not a UID, so its content could not be sampled; ` +
          'counted as unavailable, not as a mismatch',
      );
      return undefined;
    }

    let client: ImapFlow;
    try {
      client = await this.live();
    } catch {
      return undefined;
    }

    let lock;
    try {
      lock = await client.getMailboxLock(entry.mailboxId);
    } catch (err) {
      log.warn(`[imapflow] could not open ${entry.mailboxId} to sample UID ${uid}: ${message(err)}`);
      return undefined;
    }

    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source || msg.source.length === 0) {
        // Unavailable, not empty content: hashing zero bytes would produce a
        // real-looking hash of nothing.
        log.warn(`[imapflow] UID ${uid} returned no body; its content could not be sampled`);
        return undefined;
      }
      return contentHash(new Uint8Array(msg.source));
    } catch (err) {
      // The RESULT is honest either way — counted as unavailable rather than as
      // a mismatch — but an operator asking "why does the check say not
      // measured?" needs something to read.
      log.warn(`[imapflow] could not sample UID ${uid} in ${entry.mailboxId}: ${message(err)}`);
      return undefined;
    } finally {
      lock.release();
    }
  }
}

/**
 * A Message-ID reduced to the form both sides of a comparison use.
 *
 * Brackets stripped and trimmed, matching `extractMessageIdFromRfc822`. Both
 * sides of every comparison in this file go through it, because a message that
 * IS on the target reading as absent gets APPENDED — a duplicate, and a
 * successful write nobody notices.
 */
function normaliseKey(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}

/** An unknown thrown value as text, without losing a non-Error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
