// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The key of mail without a Message-ID changed how it is made, and nothing
 * already copied is copied again (ADR-0020's amendment of 2026-10-03, the
 * owner's option C; hard rule 1).
 *
 * Until then the key was a hash of the message's raw bytes. A server that
 * builds a message's MIME when it is asked for it (Exchange, Microsoft 365's
 * IMAP) can serve other bytes for the same message after an upgrade or a
 * restore, and the key moved with them: the next pass copied the message a
 * second time. The key is now a hash of the message normalised, so a pass that
 * is served other bytes finds the copy it made.
 *
 * Changing how a key is made is itself the defect this repository fears most:
 * every message keyed the old way would read as new and be copied again. So a
 * pass that misses on the new key asks the old one before it writes anything:
 * the ledger, and then the target, because an empty ledger must never
 * duplicate either and the target's own check knows only the id a copy
 * carries. A message found under the old key is that copy's: handled under
 * its key, and written, if it must be, as it was written then, so the ledger,
 * the target and verification keep naming each copy by one key.
 */

import { describe, it, expect } from 'vitest';
import {
  asMappingId,
  asTenantId,
  contentHash,
  ensureMessageId,
  generateMessageId,
  legacyGeneratedMessageId,
  naturalKeyHash,
  normalizeMessageId,
  type LedgerRecord,
  type MailFolder,
} from '@openmig/shared';
import { MemoryLedger, MemorySource, MemoryTarget } from './__testing__/memory.ts';
import { runShadowPass } from './reconcile.ts';

const TENANT = asTenantId('7a140001-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('7a140001-e29b-41d4-a716-4466554400d1' as never);

const BOUNDARY_A = '----=_Part_1_111';
const BOUNDARY_B = '_000_rebuilt_by_the_server_';

/** One message with no Message-ID, as a server that keeps its bytes serves it. */
const AS_SENT = [
  'Date: Fri, 3 Oct 2026 09:00:00 +0200',
  'From: Anna <anna@example.com>',
  'To: Bas <bas@example.com>',
  'Subject: the minutes',
  `Content-Type: multipart/mixed; boundary="${BOUNDARY_A}"`,
  '',
  `--${BOUNDARY_A}`,
  'Content-Type: text/plain; charset=utf-8',
  '',
  'See the attached minutes.',
  `--${BOUNDARY_A}--`,
  '',
].join('\r\n');

/**
 * The same message as a server that rebuilds MIME serves it: bare LF, headers
 * in another order, a header added on the way, a new boundary, trailing spaces.
 */
const AS_REBUILT = [
  'Received: from mx.example.net by store.example.net; Fri, 3 Oct 2026 09:00:05 +0200',
  'Subject: the minutes',
  'From: Anna <anna@example.com>',
  'X-MS-Exchange-Organization-AuthAs: Anonymous',
  'To: Bas <bas@example.com>',
  'Date: Fri, 3 Oct 2026 09:00:00 +0200',
  `Content-Type: multipart/mixed;\n\tboundary="${BOUNDARY_B}"`,
  '',
  `--${BOUNDARY_B}`,
  'Content-Type: text/plain; charset=utf-8',
  '',
  'See the attached minutes.   ',
  `--${BOUNDARY_B}--`,
  '',
  '',
].join('\n');

function source(rfc822: string): MemorySource {
  const s = new MemorySource();
  s.add({ folderPath: 'INBOX', messageId: '', rfc822 });
  return s;
}

function pass(src: MemorySource, target: MemoryTarget, ledger: MemoryLedger) {
  return runShadowPass({
    sourceIsAuthorityOnExistence: true,
    tenantId: TENANT,
    mappingId: MAPPING,
    source: src,
    target,
    ledger,
  });
}

const enc = (s: string) => new TextEncoder().encode(s);

describe('the normalised key', () => {
  it('finds the copy it made when the server serves the same message as other bytes', async () => {
    const ledger = new MemoryLedger();
    const target = new MemoryTarget();

    const first = await pass(source(AS_SENT), target, ledger);
    expect(first.created).toBe(1);

    const second = await pass(source(AS_REBUILT), target, ledger);
    expect(second.created).toBe(0);
    expect(target.size()).toBe(1);
  });

  it('still tells two messages apart by their date', async () => {
    const ledger = new MemoryLedger();
    const target = new MemoryTarget();
    await pass(source(AS_SENT), target, ledger);

    const later = AS_SENT.replace('09:00:00', '09:30:00');
    const second = await pass(source(later), target, ledger);
    expect(second.created).toBe(1);
    expect(target.size()).toBe(2);
  });
});

describe('a message copied under the key it had before 2026-10-03', () => {
  /** What a pass before the switch wrote: the bytes the source served, under their raw-bytes id. */
  const OLD_ID = legacyGeneratedMessageId(enc(AS_SENT));
  const OLD_COPY = enc(`Message-ID: ${OLD_ID}\r\n${AS_SENT}`);
  /** The key that pass recorded, derived from that copy the way a pass derives one from any. */
  const OLD_KEY = naturalKeyHash(ensureMessageId(OLD_COPY).messageId);
  const NEW_ID = generateMessageId(enc(AS_SENT));
  const NEW_KEY = naturalKeyHash(NEW_ID);
  const folder: MailFolder = { path: 'INBOX', specialUse: 'inbox' };

  /** The target as the pass before the switch left it: that one copy, in INBOX. */
  async function targetHoldingTheOldCopy(target = new MemoryTarget()) {
    const mailboxId = await target.ensureMailbox(folder);
    const written = await target.upsertEmail(
      mailboxId,
      {
        item: { messageId: '', folder, keywords: [], receivedAt: '2026-10-03T07:00:00.000Z', sourceRef: 'INBOX:1' },
        rfc822: OLD_COPY,
      },
      [],
    );
    return { target, mailboxId, targetId: written.targetId };
  }

  /**
   * A row under the old key, as a pass records one. Its other fields are taken
   * from a real pass, so it is what a pass writes; only its key, its text, its
   * copy and that copy's hash are the old ones.
   */
  async function rowUnderTheOldKey(fields: Partial<LedgerRecord>): Promise<LedgerRecord> {
    const made = new MemoryLedger();
    await pass(source(AS_SENT), new MemoryTarget(), made);
    const row = await made.find(TENANT, MAPPING, 'email', NEW_KEY);
    expect(row, 'the first pass recorded no row under the new key').toBeDefined();
    return {
      ...row!,
      naturalKeyHash: OLD_KEY,
      naturalKey: normalizeMessageId(OLD_ID),
      contentHash: contentHash(OLD_COPY),
      ...fields,
    };
  }

  /** The ids the copies on the target carry. */
  async function idsOnTarget(target: MemoryTarget): Promise<string[]> {
    const ids: string[] = [];
    for await (const entry of target.listEntries()) ids.push(entry.naturalKey);
    return ids;
  }

  it("is invisible to the target's own check, which asks for the id the message is given now", async () => {
    // Why both lookups below exist: the writer is create-if-absent by the id
    // in the bytes it is handed, and the copy carries the other one.
    const { target, mailboxId, targetId } = await targetHoldingTheOldCopy();
    expect(await target.findByNaturalKey(mailboxId, NEW_ID)).toBeUndefined();
    expect(await target.findByNaturalKey(mailboxId, OLD_ID)).toBe(targetId);
  });

  it('is found by the key the ledger holds for it, and not copied again', async () => {
    const { target, targetId } = await targetHoldingTheOldCopy();
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(await rowUnderTheOldKey({ targetId }));

    const result = await pass(source(AS_SENT), target, ledger);
    expect(result.created).toBe(0);
    expect(target.size()).toBe(1);
    // As the row it is, a copy of ours: skipped, not found again on the
    // target and adopted as if the ledger had never heard of it.
    expect(result.skipped).toBe(1);
    expect(result.adopted).toBe(0);
    // Handled under its own key: no second row was made for it.
    expect(await ledger.find(TENANT, MAPPING, 'email', NEW_KEY)).toBeUndefined();
    expect(await ledger.find(TENANT, MAPPING, 'email', OLD_KEY)).toBeDefined();
  });

  it('is found on the target when the ledger has forgotten it — an empty ledger never duplicates (ADR-0020)', async () => {
    const { target, targetId } = await targetHoldingTheOldCopy();
    const ledger = new MemoryLedger();

    const result = await pass(source(AS_SENT), target, ledger);
    expect(result.created).toBe(0);
    expect(result.adopted).toBe(1);
    expect(target.size()).toBe(1);

    // Recorded under the key its copy carries, as a reindex would record it,
    // so the ledger and the target name it alike and verification pairs them.
    const row = await ledger.find(TENANT, MAPPING, 'email', OLD_KEY);
    expect(row?.targetId).toBe(targetId);
    expect(row?.contentHash).toBe(contentHash(OLD_COPY));
    expect(await ledger.find(TENANT, MAPPING, 'email', NEW_KEY)).toBeUndefined();

    // And from then on it is a row the ledger holds.
    const again = await pass(source(AS_SENT), target, ledger);
    expect(again.created).toBe(0);
    expect(target.size()).toBe(1);
  });

  it('is written as it was then when it failed then, so its row and its copy keep one key', async () => {
    // A pass before the switch recorded a failure under the old key and wrote
    // nothing. The retry writes the message under the old id: the row's key,
    // which verification looks for on the target.
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await ledger.recordFailure(
      await rowUnderTheOldKey({ status: 'failed', targetId: '', sizeBytes: 0 }),
      'timed out',
    );

    const result = await pass(source(AS_SENT), target, ledger);
    expect(result.created).toBe(1);
    expect(await idsOnTarget(target)).toEqual([OLD_ID]);
    const row = await ledger.find(TENANT, MAPPING, 'email', OLD_KEY);
    expect(row?.status).toBe('copied');
    expect(row?.contentHash).toBe(contentHash(OLD_COPY));
    expect(await ledger.find(TENANT, MAPPING, 'email', NEW_KEY)).toBeUndefined();
  });

  it('is not read as absent when the target cannot say: nothing is written, no row is guessed, and the next pass asks again', async () => {
    class UnsureTarget extends MemoryTarget {
      unsure = true;
      override findByNaturalKey(mailboxId: string, naturalKey: string): Promise<string | undefined> {
        if (this.unsure && naturalKey === OLD_ID) return Promise.reject(new Error('Email/query timed out'));
        return super.findByNaturalKey(mailboxId, naturalKey);
      }
    }
    const unsure = new UnsureTarget();
    const { target, targetId } = await targetHoldingTheOldCopy(unsure);
    const ledger = new MemoryLedger();

    const first = await pass(source(AS_SENT), target, ledger);
    expect(first.created).toBe(0);
    expect(target.size()).toBe(1);
    // A failure recorded under the new key would be retried under it, and
    // that retry would write beside the copy the target does hold.
    expect(await ledger.find(TENANT, MAPPING, 'email', NEW_KEY)).toBeUndefined();
    expect(await ledger.find(TENANT, MAPPING, 'email', OLD_KEY)).toBeUndefined();

    unsure.unsure = false;
    const second = await pass(source(AS_SENT), target, ledger);
    expect(second.created).toBe(0);
    expect(target.size()).toBe(1);
    expect((await ledger.find(TENANT, MAPPING, 'email', OLD_KEY))?.targetId).toBe(targetId);
  });

  it('leaves no row under the new key while the old one is unasked, whatever fails first', async () => {
    // The ledger this time: a read that fails before the old key is asked
    // would otherwise record the failure under the new key, and its retry
    // would ask nothing more before writing.
    class UnsureLedger extends MemoryLedger {
      unsure = true;
      override find(...args: Parameters<MemoryLedger['find']>) {
        if (this.unsure && args[3] === NEW_KEY) return Promise.reject(new Error('connection reset'));
        return super.find(...args);
      }
    }
    const { target, targetId } = await targetHoldingTheOldCopy();
    const ledger = new UnsureLedger();

    const first = await pass(source(AS_SENT), target, ledger);
    expect(first.created).toBe(0);
    ledger.unsure = false;
    expect(await ledger.find(TENANT, MAPPING, 'email', NEW_KEY)).toBeUndefined();

    const second = await pass(source(AS_SENT), target, ledger);
    expect(second.created).toBe(0);
    expect(target.size()).toBe(1);
    expect((await ledger.find(TENANT, MAPPING, 'email', OLD_KEY))?.targetId).toBe(targetId);
  });
});
