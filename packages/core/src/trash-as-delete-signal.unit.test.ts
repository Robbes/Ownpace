// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Reading the owner's bin as evidence that they deleted something.
 *
 * The mail domain had NO deletion signal at all. IMAP offers no removal report of
 * the kind CalDAV's `sync-collection` gives, and a mailbox cannot be enumerated
 * cheaply enough to run absence-counting on every pass — so a message the owner
 * deleted in the old system produced nothing anywhere. The target kept its copy in
 * silence, and no surface said so.
 *
 * What it does have is a folder whose RFC 6154 role is `\Trash`. An item sitting
 * in it is the source system's own record that the person deleted it: a POSITIVE
 * observation, so it is believable on sight rather than after two passes. And it
 * only became readable because the trash exclusion took those folders out of scope
 * as CONTENT — what the migration no longer copies, it can interpret.
 *
 * Junk is deliberately NOT read the same way. A message in Junk was very likely
 * put there by a filter rather than by a person, and this signal's whole value is
 * that it is unambiguous owner intent.
 */

import { describe, it, expect } from 'vitest';
import { runShadowPass } from './reconcile.ts';
import { MemorySource, MemoryTarget, MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  discardedScanCursorKey,
} from '@openmig/shared';

const TENANT = asTenantId('b7550000-e29b-41d4-a716-4466554403aa');
const MAPPING = asMappingId('b7550000-e29b-41d4-a716-4466554403bb');

const key = (messageId: string) => naturalKeyHash(messageId);

/**
 * An inbox with two messages and a bin that already has something in it.
 *
 * The pre-existing bin message matters: it was in the trash before the migration
 * started, so it was never copied, and it must produce nothing. Most of what is in
 * a real bin is exactly that.
 */
function mailbox() {
  const source = new MemorySource();
  source.add({ folderPath: 'INBOX', messageId: '<a@dev.local>', rfc822: 'Subject: a\r\n\r\nbody' });
  source.add({ folderPath: 'INBOX', messageId: '<b@dev.local>', rfc822: 'Subject: b\r\n\r\nbody' });
  source.add({
    folderPath: 'Trash',
    specialUse: 'trash',
    messageId: '<old@dev.local>',
    rfc822: 'Subject: old\r\n\r\nbody',
  });
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

describe('the owner deletes a message in the old system', () => {
  it('is reported as a deletion, with nothing removed from the target', async () => {
    const source = mailbox();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();

    const first = await pass(source, target, ledger);
    expect(first.created, 'two inbox messages; the bin is out of scope').toBe(2);
    expect(first.deletions).toBeUndefined();

    // The owner presses delete. The client MOVES the message to the bin: same
    // Message-ID, new UID, gone from the inbox.
    expect(source.move('<a@dev.local>', 'INBOX', 'Trash')).toBe(true);

    const second = await pass(source, target, ledger);
    expect(second.deletions).toEqual([
      {
        domain: 'email',
        naturalKeyHash: key('<a@dev.local>'),
        // Where the target's copy is — where it was copied FROM, not the bin it
        // is in now.
        collection: 'INBOX',
        absentPasses: 0,
        confirmed: true,
        evidence: 'trashed',
      },
    ]);
    // Nothing was removed, and nothing was copied out of the bin either.
    expect(target.size()).toBe(2);
    expect(second.created).toBe(0);
  });

  it('is believed on the FIRST pass, without waiting for it to repeat', async () => {
    // An absence has to repeat because it might be a throttled listing or a folder
    // briefly missing from discovery. Looking straight at the item in the bin is
    // not that kind of observation, and making the owner wait would only delay a
    // report they could already act on.
    const source = mailbox();
    const ledger = new MemoryLedger();
    await pass(source, new MemoryTarget(), ledger);
    source.move('<a@dev.local>', 'INBOX', 'Trash');

    const second = await pass(source, new MemoryTarget(), ledger);
    expect(second.deletions?.[0]?.confirmed).toBe(true);

    const queued = await ledger.listDeletions(TENANT, MAPPING, 'email');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.evidence).toBe('trashed');
    expect(queued[0]!.trashedAt).toBeDefined();
    // Nobody counted absences; nothing had to go missing for us to know.
    expect(queued[0]!.absentPasses).toBe(0);
  });

  it('lets the owner close it, and stops reporting once they have', async () => {
    const source = mailbox();
    const ledger = new MemoryLedger();
    await pass(source, new MemoryTarget(), ledger);
    source.move('<a@dev.local>', 'INBOX', 'Trash');
    await pass(source, new MemoryTarget(), ledger);

    // Confirmed on sight, so it is closable at once — a queue whose most certain
    // entries are the only ones nobody can clear is worse than no queue.
    expect(await ledger.resolveDeletion(TENANT, MAPPING, key('<a@dev.local>'), 'keep')).toBe(true);

    const third = await pass(source, new MemoryTarget(), ledger);
    expect(third.deletions).toBeUndefined();
  });

  it('reports it once, however many passes see it sitting there', async () => {
    // The message stays in the bin until the owner empties it, so every later pass
    // finds it again. The first sighting is when the deletion happened.
    const source = mailbox();
    const ledger = new MemoryLedger();
    await pass(source, new MemoryTarget(), ledger);
    source.move('<a@dev.local>', 'INBOX', 'Trash');

    await pass(source, new MemoryTarget(), ledger);
    const first = (await ledger.listDeletions(TENANT, MAPPING, 'email'))[0]!;
    const third = await pass(source, new MemoryTarget(), ledger);

    // Still reported — it is still deleted and nobody has decided — but still one
    // entry, carrying the date we learned rather than the date we last looked.
    expect(third.deletions).toHaveLength(1);
    const queued = await ledger.listDeletions(TENANT, MAPPING, 'email');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.trashedAt).toBe(first.trashedAt);
  });
});

describe('what the bin must NOT be read as', () => {
  it('says nothing about messages that were in the bin before we started', async () => {
    // Most of a real bin is this. We never copied them, so there is nothing on the
    // target to reconcile and nothing to ask anyone about.
    const source = mailbox();
    const ledger = new MemoryLedger();
    await pass(source, new MemoryTarget(), ledger);
    const second = await pass(source, new MemoryTarget(), ledger);

    expect(second.deletions).toBeUndefined();
    expect(await ledger.listDeletions(TENANT, MAPPING, 'email')).toEqual([]);
  });

  it('does not read JUNK as a deletion', async () => {
    // A filter put it there, not a person. Reading it as owner intent would report
    // somebody's mail as thrown away on the strength of a spam classifier.
    const source = new MemorySource();
    source.add({ folderPath: 'INBOX', messageId: '<a@dev.local>', rfc822: 'Subject: a\r\n\r\nb' });
    source.add({
      folderPath: 'Junk',
      specialUse: 'junk',
      messageId: '<seed@dev.local>',
      rfc822: 'Subject: seed\r\n\r\nb',
    });
    const ledger = new MemoryLedger();

    const first = await pass(source, new MemoryTarget(), ledger);
    expect(first.created, 'junk is out of scope as content').toBe(1);

    source.move('<a@dev.local>', 'INBOX', 'Junk');
    const second = await pass(source, new MemoryTarget(), ledger);

    expect(second.deletions).toBeUndefined();
    expect(await ledger.listDeletions(TENANT, MAPPING, 'email')).toEqual([]);
  });

  it('says nothing when the owner brought the bin INTO scope', async () => {
    // `excludeSpecialUse: []` means the trash is being MIGRATED. An item cannot be
    // copied as content and interpreted as a deletion at the same time; reading it
    // both ways would report every message in the bin as deleted the moment after
    // copying it.
    const source = mailbox();
    const ledger = new MemoryLedger();
    const target = new MemoryTarget();

    const first = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger,
      excludeSpecialUse: [],
    });
    expect(first.created, 'inbox + the message already in the bin').toBe(3);

    source.move('<a@dev.local>', 'INBOX', 'Trash');
    const second = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger,
      excludeSpecialUse: [],
    });

    expect(second.deletions).toBeUndefined();
    // It is a MOVE, which is the right answer: both folders are in scope, so this
    // is a topology change and §11.1 leaves that to the owner.
    expect(second.moved).toBe(1);
  });

  it('does not report a message the pass also saw alive', async () => {
    // The same Message-ID genuinely lives in two folders on plenty of servers. A
    // copy in the bin next to a live copy is not a deletion, and the pass has just
    // listed the live one.
    const source = mailbox();
    const ledger = new MemoryLedger();
    await pass(source, new MemoryTarget(), ledger);

    // Copied to the bin rather than moved: the inbox copy stays.
    source.add({
      folderPath: 'Trash',
      specialUse: 'trash',
      messageId: '<a@dev.local>',
      rfc822: 'Subject: a\r\n\r\nbody',
    });

    // No cursors, so the inbox is listed in full and the live copy is seen.
    const second = await pass(source, new MemoryTarget(), ledger);
    expect(second.deletions).toBeUndefined();
  });
});

describe('the owner changes their mind', () => {
  it('drops the claim when the message is dragged back out of the bin', async () => {
    // A stale "the owner deleted this" is the most dangerous kind to leave on a
    // row: it is the evidence class strong enough to act on.
    const source = mailbox();
    const ledger = new MemoryLedger();
    await pass(source, new MemoryTarget(), ledger);

    source.move('<a@dev.local>', 'INBOX', 'Trash');
    expect((await pass(source, new MemoryTarget(), ledger)).deletions).toHaveLength(1);

    source.move('<a@dev.local>', 'Trash', 'INBOX');
    const third = await pass(source, new MemoryTarget(), ledger);

    expect(third.deletions).toBeUndefined();
    expect(await ledger.listDeletions(TENANT, MAPPING, 'email')).toEqual([]);
    // And it was not copied a second time: the natural key still matches the row.
    expect(third.created).toBe(0);
  });
});

describe('the bin scan and the cursors', () => {
  it('keeps its own cursor namespace, so bringing the bin into scope still copies it', async () => {
    // THE TRAP. The scan advances a cursor through a folder whose items are
    // deliberately not being migrated. Sharing the folder's content cursor would
    // mean that an owner who later set `excludeSpecialUse: []` found it already
    // advanced past every message in the bin — never copied, and no ledger row to
    // show it. A silent partial migration produced by a bookkeeping collision.
    const source = mailbox();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    await pass(source, new MemoryTarget(), ledger, cursors);
    source.move('<a@dev.local>', 'INBOX', 'Trash');
    await pass(source, new MemoryTarget(), ledger, cursors);

    // The scan's cursor exists, under its own key...
    expect(await cursors.get(TENANT, MAPPING, discardedScanCursorKey('Trash'))).toBeDefined();
    // ...and the folder's CONTENT cursor was never touched, because nothing in it
    // was ever copied.
    expect(await cursors.get(TENANT, MAPPING, 'Trash')).toBeUndefined();

    // So the owner changing their mind about scope still gets the bin listed and
    // copied, rather than skipped past by a cursor the scan had advanced.
    const adopted = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target: new MemoryTarget(),
      ledger,
      cursors,
      excludeSpecialUse: [],
    });

    // Both messages in the bin are listed — that is the whole point — and the
    // inbox lists nothing new, its own cursor being legitimately up to date.
    expect(adopted.scanned).toBe(2);
    // The one we never copied is copied now.
    expect(adopted.created).toBe(1);
    // The one the owner deleted is reported as a MOVE, not copied again: its row
    // says INBOX and the source now lists it in Trash, and with both folders in
    // scope that is a topology change for the owner to decide about (§11.1).
    expect(adopted.moved).toBe(1);
  });

  it('still reports a deletion on a cursor-limited pass', async () => {
    // In production every pass but the first has a cursor. A signal that only
    // fires on a full scan is one that cannot fire when it matters.
    const source = mailbox();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    await pass(source, new MemoryTarget(), ledger, cursors);
    source.move('<b@dev.local>', 'INBOX', 'Trash');

    const second = await pass(source, new MemoryTarget(), ledger, cursors);
    expect(second.scanned, 'the inbox listed nothing new').toBe(0);
    expect(second.deletions).toHaveLength(1);
    expect(second.deletions?.[0]?.naturalKeyHash).toBe(key('<b@dev.local>'));
  });
});
