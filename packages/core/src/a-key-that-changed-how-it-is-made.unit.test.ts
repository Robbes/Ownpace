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
 * pass that misses on the new key asks the old one before it writes anything,
 * and a hit is that row, handled under its own key.
 */

import { describe, it, expect } from 'vitest';
import {
  asMappingId,
  asTenantId,
  contentHash,
  generateMessageId,
  legacyGeneratedMessageId,
  naturalKeyHash,
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
  /**
   * The ledger and the target as they stood before the switch: one copy on the
   * target carrying the raw-bytes id in its Message-ID, and one row under that
   * key. The row's other fields are taken from a real pass, so it is what a
   * pass records; only its key, its copy and that copy's hash are the old ones.
   */
  async function copiedTheOldWay() {
    const made = new MemoryLedger();
    await pass(source(AS_SENT), new MemoryTarget(), made);
    const newKey = naturalKeyHash(generateMessageId(enc(AS_SENT)));
    const row = await made.find(TENANT, MAPPING, 'email', newKey);
    expect(row, 'the first pass recorded no row under the new key').toBeDefined();

    const oldId = legacyGeneratedMessageId(enc(AS_SENT));
    const oldCopy = enc(`Message-ID: ${oldId}\r\n${AS_SENT}`);
    const target = new MemoryTarget();
    const folder: MailFolder = { path: 'INBOX', specialUse: 'inbox' };
    const mailboxId = await target.ensureMailbox(folder);
    const written = await target.upsertEmail(
      mailboxId,
      {
        item: { messageId: '', folder, keywords: [], receivedAt: '2026-10-03T07:00:00.000Z', sourceRef: 'INBOX:1' },
        rfc822: oldCopy,
      },
      [],
    );
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      ...row!,
      naturalKeyHash: naturalKeyHash(oldId),
      naturalKey: oldId,
      targetId: written.targetId,
      contentHash: contentHash(oldCopy),
    });
    return { ledger, target, newKey, oldKey: naturalKeyHash(oldId) };
  }

  it('is found by that key and not copied again', async () => {
    const { ledger, target, newKey, oldKey } = await copiedTheOldWay();

    const result = await pass(source(AS_SENT), target, ledger);
    expect(result.created).toBe(0);
    expect(target.size()).toBe(1);
    // Handled under its own key: no second row was made for it.
    expect(await ledger.find(TENANT, MAPPING, 'email', newKey)).toBeUndefined();
    expect(await ledger.find(TENANT, MAPPING, 'email', oldKey)).toBeDefined();
  });

  it('would be copied a second time if nothing asked the old key — the defect the lookup prevents', async () => {
    // The same ledger and target, with the lookup taken away by a pass that
    // only knows the new key: the target holds the copy under the OLD id, so
    // its own existence check cannot see it either, and the pass writes.
    const { target } = await copiedTheOldWay();
    const result = await pass(source(AS_SENT), target, new MemoryLedger());
    expect(result.created).toBe(1);
    expect(target.size()).toBe(2);
  });
});
