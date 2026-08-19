// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Migrating into an account that is NOT empty must be visible.
 *
 * When the target already holds an item under our natural key, the sync adopts
 * it: records it in the ledger and writes nothing. That is the right default —
 * non-destructive, hard rule 2 — but it is a decision about the customer's data
 * and it used to be invisible. Adoption and an ordinary ledger skip both return
 * `created: false` and both landed as `status: 'updated'`, so:
 *
 *   - a FIRST migration into an account the customer is already using, and
 *   - a clean re-run of an already-finished migration
 *
 * reported exactly the same "0 created, N skipped". Nobody could tell that N
 * items had been left as the destination happened to have them, which is the
 * one case where the copy might not be what the source holds.
 *
 * The two facts are now counted apart and recorded apart (`status: 'adopted'`,
 * migration 0017).
 *
 * UUID Family: 7c250000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, PgLedger } from '@openmig/ledger';
import { asTenantId, asMappingId } from '@openmig/shared';
import { MemorySource, MemoryTarget } from './__testing__/memory.ts';
import { runShadowPass } from './reconcile.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7c250000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const SRC_CONN = `${P}c1`;
const TGT_CONN = `${P}c2`;
const SRC_BOX = `${P}b1`;
const TGT_BOX = `${P}b2`;
const MAPPING = `${P}d1`;

const RFC822 = 'Message-ID: <already-there@example.com>\r\nSubject: hi\r\n\r\nbody';
const OTHER_RFC822 = 'Message-ID: <fresh@example.com>\r\nSubject: new\r\n\r\nbody';

describe('adoption is counted and recorded apart from a skip (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Adoption', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${SRC_CONN}, ${TENANT}, 'source', 'imap', 'src', '{}', 'connected'),
             (${TGT_CONN}, ${TENANT}, 'target', 'jmap', 'tgt', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
      VALUES (${SRC_BOX}, ${TENANT}, ${SRC_CONN}, 'user', 'src-primary'),
             (${TGT_BOX}, ${TENANT}, ${TGT_CONN}, 'user', 'tgt-primary')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${SRC_BOX}, ${TGT_BOX}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING`);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM item WHERE mapping_id = ${MAPPING}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM item WHERE mapping_id = ${MAPPING}`);
  });

  function sourceWith(messages: Array<{ messageId: string; rfc822: string }>): MemorySource {
    const source = new MemorySource();
    for (const m of messages) {
      source.add({ folderPath: 'INBOX', messageId: m.messageId, rfc822: m.rfc822 });
    }
    return source;
  }

  function pass(source: MemorySource, target: MemoryTarget) {
    return runShadowPass({
      tenantId: asTenantId(TENANT as never),
      mappingId: asMappingId(MAPPING as never),
      source,
      target,
      ledger,
    });
  }

  /**
   * A destination that already holds the message — written with NO ledger row,
   * which is what "the customer was already using this account" looks like.
   *
   * It must go into the same mailbox the pass will resolve: `ensureMailbox`
   * mints its own ids, so seeding under the literal folder path would land in a
   * different bucket and the pass would create rather than adopt.
   */
  async function targetAlreadyHolding(rfc822: string): Promise<MemoryTarget> {
    const target = new MemoryTarget();
    const mailboxId = await target.ensureMailbox({ path: 'INBOX', name: 'INBOX' } as never);
    await target.upsertEmail(
      mailboxId,
      { item: { messageId: '<already-there@example.com>' }, rfc822: new TextEncoder().encode(rfc822) } as never,
      [],
    );
    return target;
  }

  it('counts an item the target already had as adopted, not as created or skipped', async () => {
    const target = await targetAlreadyHolding(RFC822);

    const result = await pass(sourceWith([{ messageId: '<already-there@example.com>', rfc822: RFC822 }]), target);

    expect(result.created, 'nothing should have been written').toBe(0);
    expect(result.adopted, 'the destination already held it — that must be reported').toBe(1);
    expect(result.skipped, 'our ledger was empty, so this is not a skip').toBe(0);
  });

  it('records it in the ledger as adopted, so it is answerable after the fact', async () => {
    const target = await targetAlreadyHolding(RFC822);
    await pass(sourceWith([{ messageId: '<already-there@example.com>', rfc822: RFC822 }]), target);

    const rows = await db.execute(
      sql`SELECT status FROM item WHERE mapping_id = ${MAPPING}`,
    );
    expect(rows.rows[0]!.status).toBe('adopted');
  });

  it('a second pass is a SKIP, not another adoption — the two are distinguishable', async () => {
    // The distinction that was missing. Pass 1: the target had it, we did not.
    // Pass 2: our own ledger has it, so the fast-path takes over before the
    // target is ever consulted. Same `created: 0` both times, different reason.
    const target = await targetAlreadyHolding(RFC822);
    const messages = [{ messageId: '<already-there@example.com>', rfc822: RFC822 }];

    const first = await pass(sourceWith(messages), target);
    const second = await pass(sourceWith(messages), target);

    expect(first.adopted).toBe(1);
    expect(first.skipped).toBe(0);

    expect(second.adopted, 'the second pass never reached the target').toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('separates created from adopted in a mixed pass', async () => {
    // The realistic shape: some of the customer's mail is already on the
    // destination, some is not.
    const target = await targetAlreadyHolding(RFC822);

    const result = await pass(
      sourceWith([
        { messageId: '<already-there@example.com>', rfc822: RFC822 },
        { messageId: '<fresh@example.com>', rfc822: OTHER_RFC822 },
      ]),
      target,
    );

    expect(result.created).toBe(1);
    expect(result.adopted).toBe(1);

    const rows = await db.execute(
      sql`SELECT status, count(*)::int AS n FROM item WHERE mapping_id = ${MAPPING} GROUP BY status ORDER BY status`,
    );
    expect(rows.rows).toEqual([
      { status: 'adopted', n: 1 },
      { status: 'copied', n: 1 },
    ]);
  });

  it('an empty destination adopts nothing', async () => {
    // Guards against the counter firing on the ordinary path.
    const result = await pass(
      sourceWith([{ messageId: '<fresh@example.com>', rfc822: OTHER_RFC822 }]),
      new MemoryTarget(),
    );

    expect(result.created).toBe(1);
    expect(result.adopted).toBe(0);
  });
});
