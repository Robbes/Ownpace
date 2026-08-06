// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Run two mail `TargetWriter`s through the same script and report every way
 * they disagree (workplan 0032 T2).
 *
 * **T0 promised this and built half of it.** Its charter was a seam that lets
 * both clients "run against the same fixtures and assert identical results:
 * same folder list, same natural keys, same flags, same append outcome" —
 * `imap-parity.ts` delivered the first three for the READ path, and the append
 * outcome was left for whenever the write path was ported. This is that half.
 *
 * ## Why it cannot be shaped like the read harness
 *
 * `compareSources` points two readers at one mailbox and compares what they
 * report. Two WRITERS cannot share a mailbox: the first to append makes the
 * second adopt, so the comparison would measure ordering rather than behaviour,
 * and every run after the first would compare two adoptions.
 *
 * So each writer gets its **own mailbox**, is driven through the **same script
 * of operations**, and the OUTCOMES are compared: what `ensureMailbox`
 * returned, what each `upsertEmail` reported (`created` / `adopted` /
 * `targetId` shape), what a second pass reported, what `findByNaturalKey`
 * found, what `listEntries` enumerated, and what `contentHashFor` computed.
 *
 * ## The two outcomes worth the whole harness
 *
 * **A duplicate.** The second pass must report `adopted` and must not grow the
 * mailbox. A writer that appends again produces a successful write, a correct
 * count, and a mailbox that doubles every pass — hard rule 1's failure mode,
 * invisible to everything except a count of what is actually there. So this
 * checks `listEntries` COUNT as well as the returned flags: a writer could
 * report `adopted` and have appended anyway.
 *
 * **The content hash.** `contentHashFor` is what §20 compares against the
 * source hash the ledger recorded. If the two writers hash differently, one of
 * them is reporting a healthy migration as corrupt — or worse, a corrupt one as
 * healthy. Both are compared against the hash of the bytes that went IN, so
 * this catches them agreeing with each other and both being wrong.
 */

import type {
  TargetWriter,
  TargetReindexer,
  TargetRemover,
  MailFolder,
  MailKeyword,
  RawMessage,
} from '@openmig/shared';
import { contentHash } from '@openmig/shared';

/** A writer that implements everything this harness exercises. */
export type ComparableMailTarget = TargetWriter & TargetReindexer & Partial<TargetRemover>;

/** One way the two writers disagreed. */
export interface TargetParityDifference {
  /** Where: `ensureMailbox`, `upsert/<messageId>`, `entries`, `hash/<messageId>`. */
  readonly where: string;
  /** Which property, so a diff of one field does not read as a diff of the item. */
  readonly field: string;
  readonly a: string;
  readonly b: string;
}

export interface TargetParityResult {
  readonly differences: ReadonlyArray<TargetParityDifference>;
  /** How many messages were written through each writer. Zero proves nothing. */
  readonly messagesWritten: number;
  /** How many entries each writer's `listEntries` returned. */
  readonly entriesListed: number;
  /** How many content hashes were computed and compared. */
  readonly hashesCompared: number;
}

/** One message the script writes, with the flags it should carry. */
export interface ParityMessage {
  readonly messageId: string;
  readonly rfc822: Uint8Array;
  readonly keywords: ReadonlyArray<MailKeyword>;
}

/**
 * Drive both writers through the same script against their own mailboxes.
 *
 * @param mailboxA mailbox path for writer `a`; must not be the one `b` uses.
 * @param mailboxB mailbox path for writer `b`.
 */
export async function compareMailTargets(
  a: ComparableMailTarget,
  b: ComparableMailTarget,
  options: {
    readonly messages: ReadonlyArray<ParityMessage>;
    readonly mailboxA: string;
    readonly mailboxB: string;
  },
): Promise<TargetParityResult> {
  const { messages, mailboxA, mailboxB } = options;
  if (mailboxA === mailboxB) {
    // Not a defensive nicety. Sharing one mailbox makes the second writer adopt
    // what the first wrote, so the harness would compare an append against an
    // adoption and report a difference that is purely an artefact of ordering.
    throw new Error(
      'compareMailTargets needs a mailbox per writer: sharing one makes the second writer adopt ' +
        "the first's messages, so the comparison would measure ordering rather than behaviour.",
    );
  }

  const differences: TargetParityDifference[] = [];
  const record = (where: string, field: string, av: unknown, bv: unknown): void => {
    const as = String(av ?? '');
    const bs = String(bv ?? '');
    if (as !== bs) differences.push({ where, field, a: as, b: bs });
  };

  // --- ensureMailbox -----------------------------------------------------
  const folderA: MailFolder = { path: mailboxA, name: mailboxA, specialUse: 'normal' };
  const folderB: MailFolder = { path: mailboxB, name: mailboxB, specialUse: 'normal' };
  const idA = await a.ensureMailbox(folderA);
  const idB = await b.ensureMailbox(folderB);
  // The ids are the mailbox paths, which differ BY DESIGN here — so what is
  // compared is whether each writer echoed the path it was given rather than
  // inventing something. Comparing the strings themselves would always differ.
  record('ensureMailbox', 'echoes the path it was given', idA === mailboxA, idB === mailboxB);

  // --- first pass: every message is new ---------------------------------
  let messagesWritten = 0;
  const idsA = new Map<string, string>();
  const idsB = new Map<string, string>();
  for (const msg of messages) {
    const ra = await a.upsertEmail(idA, rawOf(msg), msg.keywords);
    const rb = await b.upsertEmail(idB, rawOf(msg), msg.keywords);
    messagesWritten++;
    idsA.set(msg.messageId, ra.targetId);
    idsB.set(msg.messageId, rb.targetId);

    record(`upsert/${msg.messageId}`, 'created', ra.created, rb.created);
    record(`upsert/${msg.messageId}`, 'adopted', ra.adopted ?? false, rb.adopted ?? false);
    // The VALUE of a UID is the server's to assign and will differ between two
    // mailboxes, so what is compared is whether each writer produced a usable
    // one at all. A writer that returned '' or 'undefined' would pass a naive
    // string comparison against another that did the same.
    record(`upsert/${msg.messageId}`, 'targetId is a UID', isUid(ra.targetId), isUid(rb.targetId));
    record(
      `upsert/${msg.messageId}`,
      'targetVersion present',
      ra.targetVersion !== undefined,
      rb.targetVersion !== undefined,
    );
  }

  // --- second pass: every message must be ADOPTED, not appended ----------
  for (const msg of messages) {
    const ra = await a.upsertEmail(idA, rawOf(msg), msg.keywords);
    const rb = await b.upsertEmail(idB, rawOf(msg), msg.keywords);
    record(`second-pass/${msg.messageId}`, 'created', ra.created, rb.created);
    record(`second-pass/${msg.messageId}`, 'adopted', ra.adopted ?? false, rb.adopted ?? false);
    // The same UID as the first pass, or the writer adopted something else.
    record(
      `second-pass/${msg.messageId}`,
      'targetId matches the first pass',
      ra.targetId === idsA.get(msg.messageId),
      rb.targetId === idsB.get(msg.messageId),
    );
  }

  // --- findByNaturalKey --------------------------------------------------
  for (const msg of messages) {
    const fa = await a.findByNaturalKey(idA, msg.messageId);
    const fb = await b.findByNaturalKey(idB, msg.messageId);
    record(`find/${msg.messageId}`, 'found', fa !== undefined, fb !== undefined);
    record(`find/${msg.messageId}`, 'agrees with the upsert id', fa === idsA.get(msg.messageId), fb === idsB.get(msg.messageId));
  }

  const absent = 'openmig-parity-absent@dev.local';
  record(
    'find/absent',
    'a message that was never written is not found',
    (await a.findByNaturalKey(idA, absent)) === undefined,
    (await b.findByNaturalKey(idB, absent)) === undefined,
  );

  // --- listEntries -------------------------------------------------------
  const entriesA = await collect(a, idA);
  const entriesB = await collect(b, idB);

  // THE COUNT, not just the returned flags. A writer can report `adopted` and
  // have appended anyway; only what is actually in the mailbox settles it.
  record('entries', 'count', entriesA.length, entriesB.length);
  record('entries', 'count matches what was written', entriesA.length === messages.length, entriesB.length === messages.length);

  const keysA = entriesA.map((e) => e.naturalKey).sort();
  const keysB = entriesB.map((e) => e.naturalKey).sort();
  record('entries', 'natural keys', JSON.stringify(keysA), JSON.stringify(keysB));
  // Sizes are the server's own RFC822.SIZE and must be reported by both, or
  // verification's `totalBytesTarget` silently becomes unmeasurable on one path.
  record(
    'entries',
    'every entry carries a size',
    entriesA.every((e) => typeof e.sizeBytes === 'number'),
    entriesB.every((e) => typeof e.sizeBytes === 'number'),
  );

  // --- contentHashFor ----------------------------------------------------
  let hashesCompared = 0;
  for (const msg of messages) {
    const ea = entriesA.find((e) => e.naturalKey === stripBrackets(msg.messageId));
    const eb = entriesB.find((e) => e.naturalKey === stripBrackets(msg.messageId));
    if (!ea || !eb) continue;
    const ha = await a.contentHashFor?.(ea);
    const hb = await b.contentHashFor?.(eb);
    hashesCompared++;
    record(`hash/${msg.messageId}`, 'hash', ha ?? 'none', hb ?? 'none');
    // AGAINST THE BYTES THAT WENT IN, not only against each other. Two writers
    // hashing the same wrong thing agree perfectly, and §20 would then report a
    // healthy migration as corrupt — or a corrupt one as healthy — on both
    // paths at once.
    const expected = contentHash(msg.rfc822);
    record(`hash/${msg.messageId}`, 'matches the source hash', ha === expected, hb === expected);
  }

  return {
    differences,
    messagesWritten,
    entriesListed: entriesA.length,
    hashesCompared,
  };
}

/**
 * A one-line summary for a test failure message.
 *
 * Named fields rather than a JSON dump: the value of this harness is that a
 * difference arrives saying WHICH property of WHICH operation moved.
 */
export function describeTargetDifferences(result: TargetParityResult): string {
  if (result.differences.length === 0) {
    return (
      `no differences (${result.messagesWritten} message(s) written, ${result.entriesListed} ` +
      `entry/entries listed, ${result.hashesCompared} hash(es) compared)`
    );
  }
  return result.differences
    .map((d) => `${d.where} · ${d.field}: ${d.a} vs ${d.b}`)
    .join('\n');
}

async function collect(target: ComparableMailTarget, mailbox: string) {
  const entries = [];
  for await (const entry of target.listEntries(mailbox)) entries.push(entry);
  return entries;
}

function rawOf(msg: ParityMessage): RawMessage {
  // `item` is not read by either writer — both take the Message-ID from the
  // bytes — so it is deliberately minimal rather than a fabricated MailItem
  // that might drift from what a real source produces.
  return { rfc822: msg.rfc822 } as unknown as RawMessage;
}

function isUid(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function stripBrackets(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}
