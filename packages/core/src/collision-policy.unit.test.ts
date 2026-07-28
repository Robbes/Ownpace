// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `onCollision` — what happens when the destination already holds an item
 * under our natural key.
 *
 * `skip` (the default) adopts it: recorded as migrated, the destination's copy
 * left exactly as it is. `fail` stops that domain's pass instead, for an
 * operator who would rather look first.
 *
 * There is deliberately no `overwrite`, and one of these tests pins that:
 * `TargetWriter` is specified "NEVER deletes or overwrites (non-destructive)",
 * so source-wins would break a documented invariant of every writer. That is an
 * ADR-and-owner decision, not a config flag someone can set by accident.
 *
 * The forwarding tests exist because the first cut of this plumbing type-checked
 * end to end while doing nothing: `onCollision` reached the deps object and was
 * never passed on to `runDomainSync`, so `fail` silently behaved as `skip`.
 */

import { describe, it, expect } from 'vitest';
import { parseMappingConfig } from '@openmig/shared';
import { runShadowPass } from './reconcile';
import { MemorySource, MemoryTarget } from './__testing__/memory';
import { MemoryLedger } from './__testing__/memory';
import { asTenantId, asMappingId } from '@openmig/shared';

const TENANT = asTenantId('9d360000-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('9d360000-e29b-41d4-a716-446655440002' as never);
const RFC822 = 'Message-ID: <already@example.com>\r\nSubject: s\r\n\r\nbody';

const BASE_CONFIG = {
  tenantId: '9d360000-e29b-41d4-a716-446655440001',
  mappingId: '9d360000-e29b-41d4-a716-446655440002',
  source: { type: 'imap-oauth2', host: 'imap.example.com', port: 993, user: 'a@example.com', auth: { kind: 'login', passwordFromEnv: 'P' } },
  target: { type: 'jmap', baseUrl: 'https://mail.example.net', user: 'a@example.net', auth: { kind: 'basic', passwordFromEnv: 'Q' } },
};

describe('onCollision config', () => {
  it('defaults to absent, which the sync loop reads as skip', () => {
    const config = parseMappingConfig(BASE_CONFIG);
    expect(config.onCollision).toBeUndefined();
  });

  it('accepts skip and fail', () => {
    expect(parseMappingConfig({ ...BASE_CONFIG, onCollision: 'skip' }).onCollision).toBe('skip');
    expect(parseMappingConfig({ ...BASE_CONFIG, onCollision: 'fail' }).onCollision).toBe('fail');
  });

  it('rejects overwrite with a reason, rather than accepting a promise it cannot keep', () => {
    // The value an operator is most likely to reach for. Silently ignoring it,
    // or accepting it and then adopting anyway, would be worse than refusing.
    expect(() => parseMappingConfig({ ...BASE_CONFIG, onCollision: 'overwrite' })).toThrow(
      /non-destructive by specification/,
    );
  });

  it('rejects anything else', () => {
    expect(() => parseMappingConfig({ ...BASE_CONFIG, onCollision: 'merge' })).toThrow(
      /expected 'skip' or 'fail'/,
    );
  });
});

describe('onCollision behaviour, through the real sync loop', () => {
  async function targetHolding(): Promise<MemoryTarget> {
    const target = new MemoryTarget();
    const mailboxId = await target.ensureMailbox({ path: 'INBOX', name: 'INBOX' } as never);
    await target.upsertEmail(
      mailboxId,
      { item: { messageId: '<already@example.com>' }, rfc822: new TextEncoder().encode(RFC822) } as never,
      [],
    );
    return target;
  }

  function sourceWith(): MemorySource {
    const source = new MemorySource();
    source.add({ folderPath: 'INBOX', messageId: '<already@example.com>', rfc822: RFC822 });
    return source;
  }

  it('skip (the default) adopts and completes', async () => {
    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: sourceWith(),
      target: await targetHolding(),
      ledger: new MemoryLedger(),
    });

    expect(result.adopted).toBe(1);
    expect(result.created).toBe(0);
  });

  it('fail stops the pass — and this is what proves the option is wired at all', async () => {
    // The first cut of this plumbing type-checked while `onCollision` never
    // reached `runDomainSync`. A test asserting only the config parse would
    // have passed against that.
    await expect(
      runShadowPass({
        tenantId: TENANT,
        mappingId: MAPPING,
        source: sourceWith(),
        target: await targetHolding(),
        ledger: new MemoryLedger(),
        onCollision: 'fail',
      }),
    ).rejects.toThrow(/already holds an item under this natural key/);
  });

  it('fail does not fire when the destination is empty', async () => {
    const result = await runShadowPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: sourceWith(),
      target: new MemoryTarget(),
      ledger: new MemoryLedger(),
      onCollision: 'fail',
    });

    expect(result.created).toBe(1);
    expect(result.adopted).toBe(0);
  });
});
