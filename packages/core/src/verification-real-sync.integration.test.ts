// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Verification against a REAL sync — the gate's first end-to-end exercise.
 *
 * Every prior test of `runVerification` hand-seeded both sides. The worst case
 * was `verification.integration.test.ts`, which wrote `naturalKeyHash: 'hash1'`
 * to the ledger AND `naturalKey: 'hash1'` to a fake reindexer — the same literal
 * on both sides, matching by construction. That hid a production bug for the
 * life of the file: the ledger stores sha256('mid:<id>') while the reindexers
 * yield the RAW Message-ID, so the gate could never match an item and would have
 * FAILed every real cutover (fixed in the natural-key PR).
 *
 * This test never writes a ledger row by hand. It runs `runShadowPass` — the
 * real sync path — against a real Postgres ledger, letting production code
 * derive and store the natural keys. It then verifies against the same target
 * the sync just wrote to. `MemoryTarget.listEntries()` yields `naturalKey:
 * messageId` (raw), exactly as `JmapTargetWriter` and `ImapDavMailTarget` do, so
 * the key-shape mismatch this is guarding against is faithfully reproduced.
 *
 * UUID Family: 5f7f0000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, PgLedger, createLedgerVerificationReader } from '@openmig/ledger';
import { asTenantId, asMappingId } from '@openmig/shared';
import { MemorySource, MemoryTarget } from './__testing__/memory';
import { runShadowPass } from './reconcile';
import { runVerification } from './verification';
import { createRealVerificationDeps } from './verification-implementations';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '5f7f0000-e29b-41d4-a716-4466554435';
const TENANT = `${P}01`;
const SRC_CONN = `${P}c1`;
const TGT_CONN = `${P}c2`;
const SRC_MBOX = `${P}b1`;
const TGT_MBOX = `${P}b2`;
const MAPPING = `${P}d1`;

const VERIFY_CONFIG = {
  checksumSamplePercentage: 100,
  minSampleSize: 1,
  maxSampleSize: 1000,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
  verifyMail: true,
  verifyCalendar: false,
  verifyContacts: false,
  verifyFiles: false,
};

/** Three messages, seeded into the source the way a real mailbox presents them. */
const MESSAGES = [
  { messageId: 'real-1@example.com', rfc822: 'Message-ID: <real-1@example.com>\r\n\r\nfirst' },
  { messageId: 'real-2@example.com', rfc822: 'Message-ID: <real-2@example.com>\r\n\r\nsecond' },
  { messageId: 'real-3@example.com', rfc822: 'Message-ID: <real-3@example.com>\r\n\r\nthird' },
];

function seededSource(): MemorySource {
  const source = new MemorySource();
  for (const m of MESSAGES) {
    source.add({ folderPath: 'INBOX', messageId: m.messageId, rfc822: m.rfc822 });
  }
  return source;
}

describe('Verification against a real sync (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Verify Real', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${SRC_CONN}, ${TENANT}, 'source', 'o365', 'src', '{}', 'connected'),
             (${TGT_CONN}, ${TENANT}, 'target', 'jmap', 'tgt', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
      VALUES (${SRC_MBOX}, ${TENANT}, ${SRC_CONN}, 'user', 'src-primary'),
             (${TGT_MBOX}, ${TENANT}, ${TGT_CONN}, 'user', 'tgt-primary')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${SRC_MBOX}, ${TGT_MBOX}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING`);
  });

  beforeEach(async () => {
    // Each test starts from an empty ledger and syncs its own data.
    await db.execute(sql`DELETE FROM item WHERE mapping_id = ${MAPPING}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM item WHERE mapping_id = ${MAPPING}`);
  });

  /** Run the real sync path; returns the target it wrote to. */
  async function syncInto(target: MemoryTarget): Promise<void> {
    const result = await runShadowPass({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      source: seededSource(),
      target,
      ledger,
    });
    expect(result.created).toBe(MESSAGES.length);
  }

  function depsFor(target: MemoryTarget) {
    return createRealVerificationDeps({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      config: VERIFY_CONFIG,
      ledger,
      verificationReader: createLedgerVerificationReader({ connectionString: PG_CONNECTION_STRING! }),
      targetReindexer: target,
    } as never);
  }

  it('PASSES when the target holds exactly what the sync wrote', async () => {
    const target = new MemoryTarget();
    await syncInto(target);

    const result = await runVerification(depsFor(target));

    // The load-bearing assertion. Before the natural-key fix this was FAIL with
    // 3 missing and 3 extra, because ledger hashes were compared against raw
    // Message-IDs. Nothing here is hand-seeded: runShadowPass wrote the ledger
    // rows and MemoryTarget yields raw keys like the real connectors.
    expect(result.mail.status).toBe('PASS');
    expect(result.mail.sourceCount).toBe(MESSAGES.length);
    expect(result.mail.targetCount).toBe(MESSAGES.length);
    expect(result.mail.missingOnTarget).toBe(0);
    expect(result.mail.extraOnTarget).toBe(0);
    expect(result.overallStatus).toBe('PASS');
    expect(result.canProceedToCutover).toBe(true);
  });

  it('FAILS when a message is missing from the target (the gate must catch data loss)', async () => {
    // Build the divergence the way it happens in reality: the ledger records
    // three copied messages, but the target only ever received two. Note the
    // ledger fast-path means a message already recorded is NOT re-written to a
    // target, so the two syncs must go to different targets.
    const damaged = new MemoryTarget();
    const firstTwo = new MemorySource();
    for (const m of MESSAGES.slice(0, 2)) {
      firstTwo.add({ folderPath: 'INBOX', messageId: m.messageId, rfc822: m.rfc822 });
    }
    const pass1 = await runShadowPass({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      source: firstTwo,
      target: damaged,
      ledger,
    });
    expect(pass1.created).toBe(2);

    // The third is copied to somewhere the verification will not look — the
    // ledger now claims three, the damaged target holds two.
    const elsewhere = new MemoryTarget();
    const third = new MemorySource();
    third.add({ folderPath: 'INBOX', messageId: MESSAGES[2]!.messageId, rfc822: MESSAGES[2]!.rfc822 });
    const pass2 = await runShadowPass({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      source: third,
      target: elsewhere,
      ledger,
    });
    expect(pass2.created).toBe(1);

    const result = await runVerification(depsFor(damaged));

    // The ledger knows about 3; the target holds 2.
    expect(result.mail.sourceCount).toBe(MESSAGES.length);
    expect(result.mail.targetCount).toBe(2);
    expect(result.mail.missingOnTarget).toBe(1);
    expect(result.mail.status).toBe('FAIL');
    expect(result.overallStatus).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
  });

  it('reports an item present on the target but absent from the ledger as extra', async () => {
    const target = new MemoryTarget();
    await syncInto(target);

    // A message that exists on the target but was never recorded in the ledger —
    // e.g. written directly by the user after the pass.
    const strayFolder = { path: 'INBOX', specialUse: 'inbox' as const };
    const mailboxId = await target.ensureMailbox(strayFolder);
    await target.upsertEmail(
      mailboxId,
      {
        item: {
          messageId: 'stray@example.com',
          folder: strayFolder,
          keywords: [],
          receivedAt: new Date(0).toISOString(),
          sourceRef: 'INBOX:stray@example.com',
        },
        rfc822: new TextEncoder().encode('Message-ID: <stray@example.com>\r\n\r\nstray'),
      } as never,
      [],
    );

    const result = await runVerification(depsFor(target));

    expect(result.mail.extraOnTarget).toBe(1);
    expect(result.mail.missingOnTarget).toBe(0);
  });

  it('stays PASS across a re-run — verification is as idempotent as the sync', async () => {
    const target = new MemoryTarget();
    await syncInto(target);

    // A second pass creates nothing new (idempotency), so verification must
    // still agree rather than double-counting.
    const second = await runShadowPass({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      source: seededSource(),
      target,
      ledger,
    });
    expect(second.created).toBe(0);

    const result = await runVerification(depsFor(target));

    expect(result.mail.status).toBe('PASS');
    expect(result.mail.sourceCount).toBe(MESSAGES.length);
    expect(result.mail.targetCount).toBe(MESSAGES.length);
  });
});
