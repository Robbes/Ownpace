// Copyright 2026 The Ownpace authors (Apache-2.0)
import { describe, it, expect } from 'vitest';
import { asMappingId, asTenantId, type ReconcileDeps } from '@openmig/shared';
import { runShadowPass } from './reconcile.ts';
import { MemoryCursorStore, MemoryLedger, MemorySource, MemoryTarget } from './__testing__/memory.ts';

function seededSource(): MemorySource {
  const s = new MemorySource();
  s.add({ folderPath: 'INBOX', messageId: '<a@x>', rfc822: 'Subject: A\r\n\r\nhello', keywords: ['$seen'] });
  s.add({ folderPath: 'INBOX', messageId: '<b@x>', rfc822: 'Subject: B\r\n\r\nworld' });
  s.add({ folderPath: 'Sent', messageId: '<c@x>', rfc822: 'Subject: C\r\n\r\nsent', keywords: ['$seen'] });
  return s;
}

function deps(source: MemorySource, target: MemoryTarget, ledger: MemoryLedger): ReconcileDeps {
  return { tenantId: asTenantId('t1'), mappingId: asMappingId('m1'), source, target, ledger };
}

describe('runShadowPass (idempotent one-way shadow)', () => {
  it('mirrors the source on the first pass and is a no-op on the second', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();

    const r1 = await runShadowPass(deps(source, target, ledger));
    expect(r1).toMatchObject({ scanned: 3, created: 3, skipped: 0 });
    expect(target.size()).toBe(3);

    const r2 = await runShadowPass(deps(source, target, ledger));
    expect(r2).toMatchObject({ scanned: 3, created: 0, skipped: 3 });
    expect(target.size()).toBe(3); // no duplicates
  });

  it('creates only the new message on a delta pass', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await runShadowPass(deps(source, target, ledger));

    source.add({ folderPath: 'INBOX', messageId: '<d@x>', rfc822: 'Subject: D\r\n\r\nnew' });
    const r = await runShadowPass(deps(source, target, ledger));
    expect(r.created).toBe(1);
    expect(target.size()).toBe(4);
  });

  it('does not duplicate after the ledger is wiped (lost-ledger recovery)', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await runShadowPass(deps(source, target, ledger));
    expect(target.size()).toBe(3);

    ledger.clear(); // simulate a fresh reinstall with an empty ledger
    const r = await runShadowPass(deps(source, target, ledger));
    expect(r.created).toBe(0); // create-if-absent on the target prevents duplicates
    expect(target.size()).toBe(3);
    expect(ledger.size()).toBe(3); // ledger re-adopted from the target
  });
});

describe('firstCopyBytes — the pass statistic ADR-0014\'s data axis reads (0109 T3)', () => {
  // The engine weighs the NORMALISED message it writes (ensured rfc822), not
  // the seed string — header normalisation adds a fixed overhead per message.
  // So exactness is proved by SENSITIVITY (extra body bytes surface 1:1) and
  // by DIFFERENCE (a delta pass weighs what a full pass gains), never by
  // hardcoding the normaliser's overhead into this file.

  async function freshPassBytes(extra?: { body: string }): Promise<number> {
    const source = seededSource();
    if (extra) {
      source.add({ folderPath: 'INBOX', messageId: '<d@x>', rfc822: `Subject: D\r\n\r\n${extra.body}` });
    }
    const r = await runShadowPass(deps(source, new MemoryTarget(), new MemoryLedger()));
    return r.firstCopyBytes ?? 0;
  }

  it('the first pass weighs what it created; the second weighs nothing', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();

    const r1 = await runShadowPass(deps(source, target, ledger));
    expect(r1.firstCopyBytes).toBeGreaterThan(0);

    // Idempotency is what makes summing this across passes safe: a re-run
    // creates nothing, so it weighs nothing.
    const r2 = await runShadowPass(deps(source, target, ledger));
    expect(r2.firstCopyBytes).toBe(0);
  });

  it('extra body bytes surface one-for-one — the accumulation is byte-exact', async () => {
    const small = await freshPassBytes({ body: 'x' });
    const big = await freshPassBytes({ body: `x${'y'.repeat(100)}` });
    expect(big - small).toBe(100);
  });

  it('a delta pass weighs exactly what a full pass would have gained', async () => {
    const threeOnly = await freshPassBytes();
    const withFourth = await freshPassBytes({ body: 'new' });

    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await runShadowPass(deps(source, target, ledger));
    source.add({ folderPath: 'INBOX', messageId: '<d@x>', rfc822: 'Subject: D\r\n\r\nnew' });
    const r = await runShadowPass(deps(source, target, ledger));

    expect(r.firstCopyBytes).toBe(withFourth - threeOnly);
  });

  it('adopted items weigh nothing — the target already held those bytes', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await runShadowPass(deps(source, target, ledger));

    // Lost-ledger recovery: everything is re-found on the target and adopted,
    // and nothing moved — so the meter must see zero, or a reinstall would
    // double-charge a family for bytes that never travelled again.
    ledger.clear();
    const r = await runShadowPass(deps(source, target, ledger));
    expect(r.created).toBe(0);
    expect(r.firstCopyBytes).toBe(0);
  });
});

describe('runShadowPass with incremental cursors', () => {
  it('lists only changed items on steady-state passes and persists cursors per folder', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const d = { ...deps(source, target, ledger), cursors };

    const r1 = await runShadowPass(d);
    expect(r1).toMatchObject({ scanned: 3, created: 3 });

    // Steady state: cursor skips everything — nothing is even listed.
    const r2 = await runShadowPass(d);
    expect(r2).toMatchObject({ scanned: 0, created: 0 });

    // Delta: only the new message is listed and created.
    source.add({ folderPath: 'INBOX', messageId: '<d@x>', rfc822: 'Subject: D\r\n\r\nnew' });
    const r3 = await runShadowPass(d);
    expect(r3).toMatchObject({ scanned: 1, created: 1 });
    expect(target.size()).toBe(4);
  });

  it('a lost cursor store forces a full re-scan that stays idempotent', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const d = { ...deps(source, target, ledger), cursors };
    await runShadowPass(d);

    await cursors.clear(); // lost cursors -> full re-scan; ledger keeps it a no-op
    const r = await runShadowPass(d);
    expect(r).toMatchObject({ scanned: 3, created: 0, skipped: 3 });
    expect(target.size()).toBe(3);
  });
});

describe('targetFolderPrefix — the merge-or-subfolder choice (owner decision 2026-08-16)', () => {
  it('creates every target mailbox under the prefix, and stays idempotent there', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    const d = { ...deps(source, target, ledger), targetFolderPrefix: 'Gmail' };

    const r1 = await runShadowPass(d);
    expect(r1).toMatchObject({ created: 3 });
    // The mailboxes exist ONLY under the prefix — a copy landing in the bare
    // path would be the merge nobody asked for on this mapping.
    expect(target.mailboxNames().sort()).toEqual(['Gmail/INBOX', 'Gmail/Sent']);

    const r2 = await runShadowPass(d);
    expect(r2, 'the second pass creates nothing under a prefix either').toMatchObject({
      created: 0,
      skipped: 3,
    });
  });

  it('the DEFAULT is merge: no prefix, bare paths — the philosophy, not an accident', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    await runShadowPass(deps(source, target, new MemoryLedger()));

    expect(target.mailboxNames().sort()).toEqual(['INBOX', 'Sent']);
  });

  it('the ledger goes on recording SOURCE collections — move detection depends on it', async () => {
    const source = seededSource();
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    await runShadowPass({ ...deps(source, target, ledger), targetFolderPrefix: 'Gmail' });

    const row = await ledger.find(asTenantId('t1'), asMappingId('m1'), 'email', await (async () => {
      const rows = await ledger.placedItems(asTenantId('t1'), asMappingId('m1'), 'email');
      return rows[0]!.naturalKeyHash;
    })());
    expect(['INBOX', 'Sent']).toContain(row!.collection);
    expect(row!.collection!.startsWith('Gmail'), 'never the target spelling').toBe(false);
  });
});
