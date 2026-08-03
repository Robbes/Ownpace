// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Mail joins the reported-removals channel (0023's recorded follow-up, built
 * as 0026 T1 item 2).
 *
 * The pipeline existed end to end for the DAV domains — connectors return
 * `removed`, rows record a `sourceRef` at copy time, `findBySourceRef` takes a
 * report back to its row — and mail's adapter simply never joined: its
 * connector discarded `@removed` entries and its adapter recorded no
 * sourceRef, so a Graph-reported deletion produced NOTHING. These tests pin
 * the seam at the reconcile level with the same fakes the trash-signal suite
 * uses: a removal report becomes `evidence: 'reported'`, and nothing is ever
 * removed from the target (rule 2).
 */

import { describe, it, expect } from 'vitest';
import { runShadowPass } from './reconcile';
import { MemorySource, MemoryTarget, MemoryLedger, MemoryCursorStore } from './__testing__/memory';
import { asTenantId, asMappingId, naturalKeyHash } from '@openmig/shared';

const TENANT = asTenantId('b7550000-e29b-41d4-a716-4466554403aa');
const MAPPING = asMappingId('b7550000-e29b-41d4-a716-4466554403bb');

function mailbox() {
  const source = new MemorySource();
  source.add({ folderPath: 'INBOX', messageId: '<a@dev.local>', rfc822: 'Subject: a\r\n\r\nbody' });
  source.add({ folderPath: 'INBOX', messageId: '<b@dev.local>', rfc822: 'Subject: b\r\n\r\nbody' });
  return source;
}

const pass = (
  source: MemorySource,
  target: MemoryTarget,
  ledger: MemoryLedger,
  cursors?: MemoryCursorStore,
) =>
  runShadowPass({
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target,
    ledger,
    ...(cursors ? { cursors } : {}),
  });

describe('the source REPORTS a mail deletion (Graph delta @removed)', () => {
  it("becomes a 'reported' deletion, with nothing removed from the target", async () => {
    const source = mailbox();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();

    const first = await pass(source, target, ledger);
    expect(first.created).toBe(2);
    expect(first.deletions).toBeUndefined();

    // Deleted OUTRIGHT (shift-delete / retention), not moved to a bin: the
    // message vanishes and the next delta poll reports its id.
    expect(source.reportRemoved('<a@dev.local>', 'INBOX')).toBe(true);

    const second = await pass(source, target, ledger);
    expect(second.deletions).toEqual([
      {
        domain: 'email',
        naturalKeyHash: naturalKeyHash('<a@dev.local>'),
        collection: 'INBOX',
        absentPasses: 0,
        confirmed: true,
        // The server's own statement — not the trash inference, not
        // absence-counting.
        evidence: 'reported',
      },
    ]);
    // Rule 2: reported or not, nothing leaves the target.
    expect(target.size()).toBe(2);
  });

  it('refuses a report for a message it can still see — a moved item is alive', async () => {
    // A message that reappears under its natural key on the same pass was
    // moved or re-created, not deleted; reporting it would be exactly wrong.
    const source = mailbox();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await pass(source, target, ledger);

    // The same Message-ID arrives in another folder (a move done as
    // delete+create), and the old ref is reported removed.
    source.add({
      folderPath: 'Archive',
      messageId: '<a@dev.local>',
      rfc822: 'Subject: a\r\n\r\nbody',
    });
    expect(source.reportRemoved('<a@dev.local>', 'INBOX')).toBe(true);

    const second = await pass(source, target, ledger);
    expect(second.deletions).toBeUndefined();
  });

  it('ignores a report for a message that was never copied', async () => {
    const source = mailbox();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await pass(source, target, ledger);

    // Arrived and was deleted between our passes: add it and report it
    // removed before any pass ever listed it.
    source.add({ folderPath: 'INBOX', messageId: '<x@dev.local>', rfc822: 'Subject: x\r\n\r\nx' });
    expect(source.reportRemoved('<x@dev.local>', 'INBOX')).toBe(true);

    const second = await pass(source, target, ledger);
    expect(second.deletions).toBeUndefined();
    expect(target.size()).toBe(2);
  });
});
