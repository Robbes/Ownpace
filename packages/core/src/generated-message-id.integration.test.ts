// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Mail with no Message-ID, end to end through the real sync path.
 *
 * These messages were previously dropped by the source: never copied, and
 * invisible to both halves of the verification gate at once. They are now
 * given a Message-ID derived from their own bytes, written into the copy, and
 * keyed by it.
 *
 * That touches the idempotency anchor (AGENTS.md hard rule 1), and the anchor's
 * one non-negotiable property is that a second pass creates NOTHING. These
 * messages cannot use the pre-fetch ledger fast-path — their key is their
 * content — so they take a different route through the loop than every other
 * item, and that route has to be proven, not assumed.
 *
 * Nothing here is hand-seeded: `runShadowPass` writes the ledger, and the
 * target is keyed off the RFC822 bytes exactly as the real writers key it.
 *
 * UUID Family: 7a140000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, PgLedger } from '@openmig/ledger';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  generateMessageId,
  readMessageId,
  isGeneratedMessageId,
} from '@openmig/shared';
import { MemorySource, MemoryTarget } from './__testing__/memory';
import { runShadowPass } from './reconcile';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7a140000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const SRC_CONN = `${P}c1`;
const TGT_CONN = `${P}c2`;
const SRC_BOX = `${P}b1`;
const TGT_BOX = `${P}b2`;
const MAPPING = `${P}d1`;

/** A message with no Message-ID header at all — the case under test. */
const NO_ID_RFC822 = 'Subject: no id here\r\nFrom: a@example.com\r\n\r\nthe body';
const NO_ID_2_RFC822 = 'Subject: also no id\r\nFrom: b@example.com\r\n\r\nanother body';
const WITH_ID_RFC822 = 'Message-ID: <has-one@example.com>\r\n\r\nbody';

describe('mail with no Message-ID (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Generated Ids', 'active')
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

  /** A source presenting messages the way IMAP does when there is no Message-ID. */
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

  it('migrates a message that has no Message-ID', async () => {
    const target = new MemoryTarget();
    // `messageId: ''` is what ImapSource now emits for these.
    const result = await pass(sourceWith([{ messageId: '', rfc822: NO_ID_RFC822 }]), target);

    expect(result.created).toBe(1);
    expect(target.size()).toBe(1);
  });

  it('creates NOTHING on a second pass — the anchor holds without the fast-path', async () => {
    // The load-bearing test. These items skip the pre-fetch ledger lookup (their
    // key is their content), so idempotency rests entirely on the second,
    // post-fetch check. If that were missing, every pass would copy them again.
    const target = new MemoryTarget();
    const messages = [{ messageId: '', rfc822: NO_ID_RFC822 }];

    const first = await pass(sourceWith(messages), target);
    const second = await pass(sourceWith(messages), target);

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(target.size()).toBe(1);
  });

  it('keys two different unkeyable messages apart', async () => {
    // Both arrive with the same empty messageId. Keyed by anything other than
    // their content they would collide, and the second would be silently
    // treated as already-migrated — data loss dressed as idempotency.
    const target = new MemoryTarget();
    const result = await pass(
      sourceWith([
        { messageId: '', rfc822: NO_ID_RFC822 },
        { messageId: '', rfc822: NO_ID_2_RFC822 },
      ]),
      target,
    );

    expect(result.created).toBe(2);
    expect(target.size()).toBe(2);
  });

  it('writes the generated id into the copy, where the reindexer can read it', async () => {
    const target = new MemoryTarget();
    await pass(sourceWith([{ messageId: '', rfc822: NO_ID_RFC822 }]), target);

    const entries = [];
    for await (const e of target.listEntries()) entries.push(e);

    expect(entries).toHaveLength(1);
    expect(isGeneratedMessageId(entries[0]!.naturalKey)).toBe(true);
    // The key the target exposes must be the key the ledger stored, or
    // verification compares disjoint sets and calls a complete migration data
    // loss — the failure #139 fixed for ordinary mail.
    const expected = generateMessageId(new TextEncoder().encode(NO_ID_RFC822));
    expect(entries[0]!.naturalKey).toBe(expected);

    const rows = await db.execute(
      sql`SELECT natural_key_hash FROM item WHERE mapping_id = ${MAPPING}`,
    );
    expect(rows.rows[0]!.natural_key_hash).toBe(naturalKeyHash(expected));
  });

  it('records the hash of the bytes it WROTE, not the bytes it read', async () => {
    // The copy carries an added header, so it is not byte-identical to the
    // source. §20 checksum sampling compares the ledger's content hash against
    // what the target actually holds; hashing the original would flag every one
    // of these messages as corrupt.
    const target = new MemoryTarget();
    await pass(sourceWith([{ messageId: '', rfc822: NO_ID_RFC822 }]), target);

    const original = new TextEncoder().encode(NO_ID_RFC822);
    const { createHash } = await import('node:crypto');
    const originalHash = createHash('sha256').update(original).digest('hex');

    const rows = await db.execute(
      sql`SELECT content_hash, size_bytes FROM item WHERE mapping_id = ${MAPPING}`,
    );
    expect(rows.rows[0]!.content_hash).not.toBe(originalHash);
    // And the recorded size is the written size, which is larger.
    expect(Number(rows.rows[0]!.size_bytes)).toBeGreaterThan(original.byteLength);
  });

  it('records the real byte size for an ordinary message, not the listing figure', async () => {
    // `MailItem.size` is optional and depends on the source having asked IMAP
    // for RFC822.SIZE. This used to fall back to `item.size ?? 0`, and since it
    // fell back for every message the ledger's whole mail total came out 0 —
    // §20 then compared a source total of 0 against a measured target total,
    // observed live as `mail bytes: source=0 target=7695`.
    //
    // MemorySource emits no `size`, which is exactly the condition that
    // produced it.
    const target = new MemoryTarget();
    await pass(sourceWith([{ messageId: '<has-one@example.com>', rfc822: WITH_ID_RFC822 }]), target);

    const rows = await db.execute(sql`SELECT size_bytes FROM item WHERE mapping_id = ${MAPPING}`);
    expect(Number(rows.rows[0]!.size_bytes)).toBe(
      new TextEncoder().encode(WITH_ID_RFC822).byteLength,
    );
  });

  it('leaves a message that already has a Message-ID completely alone', async () => {
    // The overwhelmingly common path must stay a verbatim copy.
    const target = new MemoryTarget();
    await pass(sourceWith([{ messageId: '<has-one@example.com>', rfc822: WITH_ID_RFC822 }]), target);

    const entries = [];
    for await (const e of target.listEntries()) entries.push(e);

    expect(entries[0]!.naturalKey).toBe('<has-one@example.com>');
    expect(isGeneratedMessageId(entries[0]!.naturalKey)).toBe(false);
    expect(readMessageId(new TextEncoder().encode(WITH_ID_RFC822))).toBe('<has-one@example.com>');
  });

  it('mixes keyed and unkeyable messages in one pass without interference', async () => {
    const target = new MemoryTarget();
    const messages = [
      { messageId: '<has-one@example.com>', rfc822: WITH_ID_RFC822 },
      { messageId: '', rfc822: NO_ID_RFC822 },
    ];

    const first = await pass(sourceWith(messages), target);
    const second = await pass(sourceWith(messages), target);

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(target.size()).toBe(2);
  });
});
