// Copyright 2026 The Ownpace authors (Apache-2.0)
import { describe, it, expect } from 'vitest';
import { asMappingId, asTenantId, type ReindexDeps } from '@openmig/shared';
import { reindexFromTarget } from './reindex.ts';
import { runShadowPass } from './reconcile.ts';
import { MemoryLedger, MemorySource, MemoryTarget } from './__testing__/memory.ts';

describe('reindexFromTarget (lost-ledger recovery)', () => {
  it('adopts existing target items into an empty ledger; a later pass creates nothing', async () => {
    // Populate the target via a normal pass.
    const source = new MemorySource();
    source.add({ folderPath: 'INBOX', messageId: '<a@x>', rfc822: 'Subject: A\r\n\r\nhello' });
    source.add({ folderPath: 'INBOX', messageId: '<b@x>', rfc822: 'Subject: B\r\n\r\nworld' });
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    const id = { tenantId: asTenantId('t1'), mappingId: asMappingId('m1') };
    await runShadowPass({ ...id, source, target, ledger });
    expect(target.size()).toBe(2);

    // Simulate a lost ledger, then reindex from the target.
    ledger.clear();
    const reindexDeps: ReindexDeps = { ...id, reindexer: target, ledger };
    const r = await reindexFromTarget(reindexDeps);
    expect(r).toMatchObject({ scanned: 2, adopted: 2, alreadyKnown: 0 });
    expect(ledger.size()).toBe(2);

    // A subsequent pass creates nothing (everything already adopted).
    const pass = await runShadowPass({ ...id, source, target, ledger });
    expect(pass.created).toBe(0);

    // Reindexing again is a no-op.
    const r2 = await reindexFromTarget(reindexDeps);
    expect(r2).toMatchObject({ adopted: 0, alreadyKnown: 2 });
  });

  it('adopts into the domain it was given, not always email (the CLI doorway needs this)', async () => {
    // The reindexer was mail-only by hard-coded 'email' until the doorway
    // existed (0026 T1 item 5); the CLI runs one reindex per domain whose
    // target can enumerate itself, so the domain must be injectable.
    const source = new MemorySource();
    source.add({ folderPath: 'INBOX', messageId: '<a@x>', rfc822: 'Subject: A\r\n\r\nhello' });
    const target = new MemoryTarget();
    const ledger = new MemoryLedger();
    const id = { tenantId: asTenantId('t1'), mappingId: asMappingId('m1') };
    await runShadowPass({ ...id, source, target, ledger });
    ledger.clear();

    const r = await reindexFromTarget({ ...id, reindexer: target, ledger, domain: 'calendar' });
    expect(r).toMatchObject({ scanned: 1, adopted: 1 });

    // The row landed under 'calendar': an email-domain pass does NOT see it
    // and creates its copy afresh — which is exactly why the CLI must pair
    // each reindexer with its own domain.
    const pass = await runShadowPass({ ...id, source, target, ledger });
    expect(pass.created + (pass.adopted ?? 0)).toBe(1);
  });
});
