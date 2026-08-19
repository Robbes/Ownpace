// Copyright 2026 OpenHands Agent (Apache-2.0)
// Integration tests for shared mailbox migration (Pattern-S, B-T5).
// Tests that the shared mailbox's mail including its Sent folder mirrors idempotently to the dedicated target.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  withImapTestClient,
  seedMailbox,
  countMessages,
  listMailboxPaths,
  ensureMailbox,
  type ImapTestClientConfig,
} from '../../../packages/testing/src/imap-test-client.ts';
import { createPgDb } from '../../../packages/ledger/src/db.ts';
import { PgLedger } from '../../../packages/ledger/src/ledger.ts';
import { PgCursorStore } from '../../../packages/ledger/src/cursor-store.ts';
import { ImapFlowSource } from '../../../packages/connectors/src/imapflow-source.ts';
import { JmapTargetWriter } from '../../../packages/connectors/src/jmap-target.ts';
import { runShadowPass } from '../../../packages/core/src/reconcile.ts';
import { asTenantId, asMappingId } from '@openmig/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connection string from Testcontainers
const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Stalwart configuration from Testcontainers
const STALWART_IMAP_HOST = process.env.STALWART_IMAP_HOST;
const STALWART_IMAP_PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
const STALWART_JMAP_URL = process.env.STALWART_JMAP_URL;
const _STALWART_JMAP_USERNAME = process.env.STALWART_JMAP_USERNAME || 'target-shared@dev.local';
const _STALWART_JMAP_PASSWORD = process.env.STALWART_JMAP_PASSWORD || 'target-shared_password';

// Skip tests if Stalwart is not available (for faster iteration without full stack)
if (!STALWART_IMAP_HOST || !STALWART_JMAP_URL) {
  console.warn('[shared-mailbox] Skipping tests: Stalwart not available. Set STALWART_IMAP_HOST and STALWART_JMAP_URL to enable.');
  describe.skip('Shared Mailbox Integration', () => {
    it('skipped - Stalwart not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {

// Test accounts for shared mailbox - must match the accounts provisioned in testcontainers-setup.ts
const SHARED_ACCOUNT = 'shared@dev.local';
const SHARED_PASSWORD = 'shared_password';
const TARGET_SHARED_ACCOUNT = 'target-shared@dev.local';
const TARGET_SHARED_PASSWORD = 'target-shared_password';

// Retry configuration for IMAP connection
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 2000;

/**
 * Box interface for IMAP mailbox (unused, kept for reference)
 */
interface _ImMapBox {
  name: string;
  readOnly?: boolean;
  newKeywords: boolean;
  uidvalidity: number;
  uidnext: number;
  flags: string[];
  permFlags: string[];
  persistentUIDs: boolean;
  messages: {
    total: number;
    new: number;
    unseen?: number;
  };
  highestmodseq?: string;
}

/**
 * Wait for IMAP server to be available with retry logic.
 */
async function waitForImap(host: string, port: number): Promise<void> {
  const net = await import('node:net');
  
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new net.Socket();
        const timeout = setTimeout(() => {
          client.destroy();
          reject(new Error('Connection timeout'));
        }, 5000);
        
        client.connect(port, host, () => {
          clearTimeout(timeout);
          client.destroy();
          resolve();
        });
        
        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      return;
    } catch (err) {
      if (i < MAX_RETRIES - 1) {
        console.log(`[IMAP] Connection attempt ${i + 1}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
}

// Fixed UUIDs for shared mailbox testing
const SHARED_TENANT_ID = asTenantId('5f1b0000-e29b-41d4-a716-446655440011' as never);
const SHARED_MAPPING_ID = asMappingId('5f1b0000-e29b-41d4-a716-446655440012' as never);

/**
 * Database type for drizzle.
 */
type DbClient = ReturnType<typeof createPgDb>;

/** The shared account, as a test observer reaches it. */
const SHARED_IMAP: ImapTestClientConfig = {
  host: STALWART_IMAP_HOST,
  port: STALWART_IMAP_PORT,
  user: SHARED_ACCOUNT,
  password: SHARED_PASSWORD,
};

/**
 * The Sent folder's real name on this server, or the name to create.
 *
 * Stalwart calls it "Sent Items". Matched case-insensitively on the substring
 * rather than assumed, because the whole point of this file is a folder OTHER
 * than INBOX being mirrored, and a hard-coded name that the server spells
 * differently would make that test pass against an empty folder it created
 * itself.
 */
function sentFolderIn(paths: string[]): string | undefined {
  return paths.find((p) => p.toLowerCase().includes('sent'));
}

/**
 * Seed test messages into the shared IMAP account, including Sent folder.
 *
 * Goes through `imap-test-client`, NOT through the connector under test — a
 * connector that misreads a folder list would otherwise seed and verify through
 * the same mistake. That independence is why this observer was ported to
 * `imapflow` in workplan 0032 T3b rather than deleted with `imap-simple`.
 */
async function seedSharedMessages(): Promise<void> {
  await withImapTestClient(SHARED_IMAP, async (client) => {
    const paths = await listMailboxPaths(client);
    console.log('[seedShared] Existing folders:', paths);

    const sentFolder = sentFolderIn(paths) ?? 'Sent Items';
    await ensureMailbox(client, sentFolder);

    await seedMailbox(
      client,
      [
        {
          messageId: '<shared-message-1@dev.local>',
          subject: 'Shared Message 1',
          body: 'This is the first shared message.',
          from: 'shared@dev.local',
          to: 'target-shared@dev.local',
        },
        {
          messageId: '<shared-message-2@dev.local>',
          subject: 'Shared Message 2',
          body: 'This is the second shared message.',
          from: 'shared@dev.local',
          to: 'target-shared@dev.local',
        },
      ],
      'INBOX',
    );

    await seedMailbox(
      client,
      [
        {
          messageId: '<shared-sent-1@dev.local>',
          subject: 'Sent Message 1',
          body: 'This is the first sent message.',
          from: 'shared@dev.local',
          to: 'recipient@example.com',
        },
        {
          messageId: '<shared-sent-2@dev.local>',
          subject: 'Sent Message 2',
          body: 'This is the second sent message.',
          from: 'shared@dev.local',
          to: 'recipient@example.com',
        },
      ],
      sentFolder,
    );

    console.log('[seedShared] Seeded messages in INBOX and', sentFolder);
  });
}

// Shared mailbox tests require Stalwart (JMAP/IMAP)
describe('Shared Mailbox Integration (Pattern-S, B-T5)', () => {
  let db: DbClient;
  let ledger: PgLedger;
  let cursorStore: PgCursorStore;
  let source: ImapFlowSource;
  let target: JmapTargetWriter;

  beforeAll(async () => {
    // Wait for IMAP server to be available
    console.log('[SharedMailbox] Waiting for IMAP server...');
    await waitForImap(STALWART_IMAP_HOST, STALWART_IMAP_PORT);
    console.log('[SharedMailbox] IMAP server is ready');
    
    // Clean up any leftover state from previous tests
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);
    cursorStore = new PgCursorStore(db);
    
    console.log('[SharedMailbox] Cleaning up leftover state...');
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${SHARED_TENANT_ID}`);
    console.log('[SharedMailbox] Cleanup complete.');
    
    // Setup connectors for shared mailbox
    source = new ImapFlowSource({
      host: STALWART_IMAP_HOST,
      port: STALWART_IMAP_PORT,
      tls: true,
      auth: {
        user: SHARED_ACCOUNT,
        password: SHARED_PASSWORD,
      },
      authType: 'LOGIN',
      // The test container's certificate is self-signed. Explicit since
      // 2026-08-09, when the connector stopped skipping verification for
      // everyone -- a test opting out is fine; production defaulting out was
      // the bug.
      rejectUnauthorized: false,
    });
    
    target = new JmapTargetWriter({
      baseUrl: STALWART_JMAP_URL,
      username: TARGET_SHARED_ACCOUNT,
      password: TARGET_SHARED_PASSWORD,
    });
    
    // Connect target
    await target.connect();
    
    // Seed source messages
    await seedSharedMessages();
    
    // Create test data (tenant, connection, mailbox, mapping)
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${SHARED_TENANT_ID}, 'Shared Test Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    const sourceConnId = '5f1b0000-e29b-41d4-a716-446655440011';
    const targetConnId = '5f1b0000-e29b-41d4-a716-446655440012';
    
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${SHARED_TENANT_ID}, 'source', 'imap', 'Shared IMAP Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${SHARED_TENANT_ID}, 'target', 'selfhosted_mail', 'Shared Target (JMAP)', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);

    const sourceMailboxId = '5f1b0000-e29b-41d4-a716-446655440011';
    const targetMailboxId = '5f1b0000-e29b-41d4-a716-446655440012';
    
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${SHARED_TENANT_ID}, ${sourceConnId}, 'INBOX', 'user', 'Shared INBOX', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${SHARED_TENANT_ID}, ${targetConnId}, 'INBOX', 'user', 'Target INBOX', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${SHARED_MAPPING_ID}, ${SHARED_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  }, 60000);

  afterAll(async () => {
    // Cleanup: delete test data
    if (db) {
      await db.execute(sql`DELETE FROM item WHERE tenant_id = ${SHARED_TENANT_ID}`);
      await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${SHARED_TENANT_ID}`);
      await db.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${SHARED_TENANT_ID}`);
      await db.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${SHARED_TENANT_ID}`);
      await db.execute(sql`DELETE FROM connection WHERE tenant_id = ${SHARED_TENANT_ID}`);
      await db.execute(sql`DELETE FROM tenant WHERE id = ${SHARED_TENANT_ID}`);
    }
    if (target) {
      await target.disconnect();
    }
  });

  it('should mirror shared mailbox messages idempotently (first run creates all, second run creates 0)', async () => {
    // First run
    const result1 = await runShadowPass({
      tenantId: SHARED_TENANT_ID,
      mappingId: SHARED_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // First run should create every seeded message: 2 in INBOX, 2 in Sent Items.
    // (Previously asserted 2 here, on the belief that the source only ever saw
    // INBOX. That was a real bug in the old `ImapSource.listFolders()`: it
    // called the raw callback-only node-imap `getBoxes(namespace, cb)` with zero
    // arguments and cast the result to a promise, so it always awaited
    // `undefined` regardless of the server. That connector is gone (workplan
    // 0032 T3b) and `ImapFlowSource` issues a real LIST, but the expectation is
    // kept at 4 with its history, because a 4 that quietly became a 2 again is
    // the thing worth noticing.)
    expect(result1.scanned).toBe(4);
    expect(result1.created).toBe(4);
    expect(result1.skipped).toBe(0);

    // Second run should create 0 (idempotent)
    const result2 = await runShadowPass({
      tenantId: SHARED_TENANT_ID,
      mappingId: SHARED_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // With cursor-based delta scan, second run should scan 0 messages
    expect(result2.scanned).toBe(0);
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(0);
  }, 120000);

  it('should mirror Sent folder correctly', async () => {
    // Verify that Sent folder exists in the source, directly over IMAP,
    // independent of the appliance's own `listFolders()`.
    await withImapTestClient(SHARED_IMAP, async (client) => {
      const sentFolder = sentFolderIn(await listMailboxPaths(client));
      expect(sentFolder).toBeDefined();
      expect(sentFolder).toContain('Sent');
      expect(await countMessages(client, sentFolder!)).toBeGreaterThanOrEqual(2);
    });
    
    // Run shadow pass - INBOX and Sent Items are both already fully synced by
    // the previous test's two passes, so this is just an idempotency check.
    const result = await runShadowPass({
      tenantId: SHARED_TENANT_ID,
      mappingId: SHARED_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // Should not error and should handle available folders correctly
    expect(result).toBeDefined();
  }, 120000);

  it('should handle delta correctly for shared mailbox (adding one message creates exactly 1)', async () => {
    // Seed one more message in the shared account
    await withImapTestClient(SHARED_IMAP, (client) =>
      seedMailbox(
        client,
        [
          {
            messageId: '<shared-message-3-delta@dev.local>',
            subject: 'Shared Message 3 (Delta Test)',
            body: 'This is the third shared message for delta testing.',
            from: 'shared@dev.local',
            to: 'target-shared@dev.local',
          },
        ],
        'INBOX',
      ),
    );

    // Run shadow pass again - should only create the new message
    const result = await runShadowPass({
      tenantId: SHARED_TENANT_ID,
      mappingId: SHARED_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // Should create exactly 1 new message
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
  }, 120000);
});
}
