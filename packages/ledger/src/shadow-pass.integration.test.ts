// Copyright 2026 OpenHands Agent (Apache-2.0)
// Integration tests for the shadow pass (T4) against real IMAP source + JMAP target + SQL ledger.
// Tests idempotency: running twice creates 0 duplicates; delta: adding one message creates exactly 1.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  withImapTestClient,
  purgeMailbox,
  seedMailbox,
  countMessages,
  mailboxState,
  type ImapTestClientConfig,
} from '../../testing/src/imap-test-client.ts';
import { createPgDb } from './db.ts';
import { PgLedger } from './ledger.ts';
import { PgCursorStore } from './cursor-store.ts';
import { ImapFlowSource } from '../../connectors/src/imapflow-source.ts';
import { JmapTargetWriter } from '../../connectors/src/jmap-target.ts';
import { runShadowPass } from '../../core/src/reconcile.ts';
import { asTenantId, asMappingId } from '@openmig/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connection string from Testcontainers (set by vitest.global-setup.ts)
// Fails loudly if TEST_DATABASE_URL is not set, rather than silently using wrong defaults.
const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Stalwart configuration from Testcontainers (set by vitest.global-setup.ts)
// Stalwart is a REQUIRED dependency for shadow pass tests
// NOTE: Using IMAPS (port 993) with TLS - Stalwart v0.16.10 auto-binds TLS listeners but NOT plaintext 143
const STALWART_IMAP_HOST = process.env.STALWART_IMAP_HOST;
const STALWART_IMAP_PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
const STALWART_JMAP_URL = process.env.STALWART_JMAP_URL;
const STALWART_JMAP_USERNAME = process.env.STALWART_JMAP_USERNAME || 'target@dev.local';
const STALWART_JMAP_PASSWORD = process.env.STALWART_JMAP_PASSWORD || 'target_password';

// Skip tests if Stalwart is not available (for faster iteration without full stack)
if (!STALWART_IMAP_HOST || !STALWART_JMAP_URL) {
  console.warn('[shadow-pass] Skipping tests: Stalwart not available. Set STALWART_IMAP_HOST and STALWART_JMAP_URL to enable.');
  describe.skip('Shadow Pass Verification', () => {
    it('skipped - Stalwart not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {

// Test accounts - must match the accounts provisioned in testcontainers-setup.ts
const SOURCE_ACCOUNT = 'source@dev.local';
const SOURCE_PASSWORD = 'source_password';

// Retry configuration for IMAP connection
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 2000;


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
      // Success - IMAP is available
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

// Fixed UUIDs for testing
const TEST_TENANT_ID = asTenantId('5b0b0000-e29b-41d4-a716-446655440001' as never);
const TEST_MAPPING_ID = asMappingId('5b0b0000-e29b-41d4-a716-446655440002' as never);

/**
 * Database type for drizzle.
 */
type DbClient = ReturnType<typeof createPgDb>;

/** The source account, as a test observer reaches it. */
const SOURCE_IMAP: ImapTestClientConfig = {
  host: STALWART_IMAP_HOST,
  port: STALWART_IMAP_PORT,
  user: SOURCE_ACCOUNT,
  password: SOURCE_PASSWORD,
};

/** The three messages every test in this file starts from. */
const SEED_MESSAGES = [
  {
    messageId: '<test-message-1@dev.local>',
    subject: 'Test Message 1',
    body: 'This is the first test message.',
  },
  {
    messageId: '<test-message-2@dev.local>',
    subject: 'Test Message 2',
    body: 'This is the second test message.',
  },
  {
    messageId: '<test-message-3@dev.local>',
    subject: 'Test Message 3',
    body: 'This is the third test message.',
  },
];

/**
 * Seed test messages into the source IMAP account.
 * First cleans the INBOX to ensure test isolation.
 *
 * Goes through `imap-test-client` rather than through `ImapFlowSource` — the
 * connector under test must not be the thing that says what is on the server,
 * or a connector that misreads a mailbox agrees with itself and this file
 * passes. That separation is why the observer was ported to `imapflow` in
 * workplan 0032 T3b rather than deleted with `imap-simple`.
 */
async function seedSourceMessages(): Promise<void> {
  await withImapTestClient(SOURCE_IMAP, async (client) => {
    const purged = await purgeMailbox(client, 'INBOX');
    console.log(`[seedSource] Cleaned ${purged} existing message(s) from INBOX`);
    await seedMailbox(client, SEED_MESSAGES, 'INBOX');
    console.log(`[seedSource] Successfully seeded ${SEED_MESSAGES.length} messages to INBOX`);
  });
}

/** Read the source INBOX's message count, from the server, not the connector. */
async function sourceInboxCount(): Promise<number> {
  return withImapTestClient(SOURCE_IMAP, (client) => countMessages(client, 'INBOX'));
}

// Shadow pass tests require Stalwart (JMAP/IMAP)
describe('Shadow Pass Integration (T4)', () => {
  let db: DbClient;
  let ledger: PgLedger;
  let cursorStore: PgCursorStore;
  let source: ImapFlowSource;
  let target: JmapTargetWriter;

  beforeAll(async () => {
    // Wait for IMAP server to be available
    console.log('[ShadowPass] Waiting for IMAP server...');
    await waitForImap(STALWART_IMAP_HOST, STALWART_IMAP_PORT);
    console.log('[ShadowPass] IMAP server is ready');
    
    // CRITICAL: Clean up any leftover cursor state from previous tests
    // Both ledger.integration.test.ts and shadow-pass.integration.test.ts use the same
    // TEST_TENANT_ID and TEST_MAPPING_ID, so cursors can leak between tests
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);
    cursorStore = new PgCursorStore(db);
    
    console.log('[ShadowPass] Cleaning up leftover cursor state...');
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${TEST_TENANT_ID}`);
    console.log('[ShadowPass] Cursor cleanup complete.');
    
    // Setup connectors
    source = new ImapFlowSource({
      host: STALWART_IMAP_HOST,
      port: STALWART_IMAP_PORT,
      tls: true,
      auth: {
        user: SOURCE_ACCOUNT,
        password: SOURCE_PASSWORD,
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
      username: STALWART_JMAP_USERNAME,
      password: STALWART_JMAP_PASSWORD,
    });
    
    // Connect target
    await target.connect();
    
    console.log('[ShadowPass] Test setup complete');
  }, 60000);

  beforeEach(async () => {
    // Clean and re-seed source INBOX before each test to ensure test isolation
    // This prevents cross-contamination from parallel test runs (e.g., jmap-reindex test)
    console.log('[ShadowPass] Cleaning and re-seeding source INBOX...');
    await seedSourceMessages();
    console.log('[ShadowPass] Source INBOX ready for test');
    
    // Clean database items but PRESERVE cursor state for delta tests
    // The cursor is needed to track which messages have already been processed
    console.log('[ShadowPass] Deleting items for tenant:', TEST_TENANT_ID);
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TEST_TENANT_ID}`);
    // NOTE: Do NOT delete cursor - it must persist across tests for delta semantics
    
    // Recreate test data (tenant, connection, mailbox, mapping)
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TEST_TENANT_ID}, 'Test Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    const sourceConnId = '5b0b0000-e29b-41d4-a716-446655440001';
    const targetConnId = '5b0b0000-e29b-41d4-a716-446655440002';
    
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${TEST_TENANT_ID}, 'source', 'imap', 'IMAP Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${TEST_TENANT_ID}, 'target', 'selfhosted_mail', 'Self-hosted Mail (JMAP)', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);

    const sourceMailboxId = '5b0b0000-e29b-41d4-a716-446655440001';
    const targetMailboxId = '5b0b0000-e29b-41d4-a716-446655440002';
    
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TEST_TENANT_ID}, ${sourceConnId}, 'INBOX', 'user', 'INBOX', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TEST_TENANT_ID}, ${targetConnId}, 'INBOX', 'user', 'INBOX', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${TEST_MAPPING_ID}, ${TEST_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    
    console.log('[ShadowPass] Database state cleaned (cursor preserved)');
  });

  afterAll(async () => {
    // Cleanup: delete test data
    if (db) {
      await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TEST_TENANT_ID}`);
      await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${TEST_TENANT_ID}`);
      await db.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${TEST_TENANT_ID}`);
      await db.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${TEST_TENANT_ID}`);
      await db.execute(sql`DELETE FROM connection WHERE tenant_id = ${TEST_TENANT_ID}`);
      await db.execute(sql`DELETE FROM tenant WHERE id = ${TEST_TENANT_ID}`);
    }
    if (target) {
      await target.disconnect();
    }
  });

  it('should mirror messages idempotently (first run creates all, second run creates 0)', async () => {
    // First run
    const result1 = await runShadowPass({
      tenantId: TEST_TENANT_ID,
      mappingId: TEST_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // First run should create all 3 messages
    expect(result1.scanned).toBe(3);
    expect(result1.created).toBe(3);
    expect(result1.skipped).toBe(0);

    // REGRESSION GUARD: Verify source INBOX still has exactly 3 messages (no cross-account pollution)
    expect(await sourceInboxCount()).toBe(3);
    console.log('[REGRESSION GUARD] Source INBOX count after first run: 3 ✓');

    // Second run should create 0 (idempotent)
    const result2 = await runShadowPass({
      tenantId: TEST_TENANT_ID,
      mappingId: TEST_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // With cursor-based delta scan, second run should scan 0 messages (all already seen)
    // and skip 0 (nothing new to process)
    expect(result2.scanned).toBe(0);
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(0);

    // REGRESSION GUARD: Verify source INBOX still has exactly 3 messages after second run
    expect(await sourceInboxCount()).toBe(3);
    console.log('[REGRESSION GUARD] Source INBOX count after second run: 3 ✓');
  }, 120000);

  it('should handle delta correctly (adding one more message creates exactly 1)', async () => {
    // The beforeEach re-seeded the messages with new UIDs.
    // We need to reset the cursor to match the re-seeded messages.
    // First, query the IMAP server to get the current UIDs.
    const { uidValidity, maxUid } = await withImapTestClient(SOURCE_IMAP, (client) =>
      mailboxState(client, 'INBOX'),
    );
    console.log(`[Delta Test] Re-seeded INBOX: uidValidity=${uidValidity}, maxUid=${maxUid}`);

    // Reset cursor to uidNext = maxUid + 1, so that only new messages will be processed
    await cursorStore.set(TEST_TENANT_ID, TEST_MAPPING_ID, 'INBOX', {
      value: `${uidValidity}:${maxUid + 1}`,
    });
    console.log(`[Delta Test] Cursor reset to uidNext=${maxUid + 1}`);

    // Now add one more message
    await withImapTestClient(SOURCE_IMAP, (client) =>
      seedMailbox(
        client,
        [
          {
            messageId: '<test-message-4-delta@dev.local>',
            subject: 'Test Message 4 (Delta Test)',
            body: 'This is the fourth test message for delta testing.',
          },
        ],
        'INBOX',
      ),
    );

    // REGRESSION GUARD: Verify source INBOX has exactly 4 messages before delta run
    expect(await sourceInboxCount()).toBe(4);
    console.log('[REGRESSION GUARD] Source INBOX count before delta run: 4 ✓');

    // Run shadow pass again - should only create the new message
    const result = await runShadowPass({
      tenantId: TEST_TENANT_ID,
      mappingId: TEST_MAPPING_ID,
      source,
      target,
      ledger,
      cursors: cursorStore,
      concurrency: 2,
    });

    // Should scan 1 new message (due to cursor) and create 1
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    // REGRESSION GUARD: Verify source INBOX still has exactly 4 messages after delta (no cross-account pollution)
    expect(await sourceInboxCount()).toBe(4);
    console.log('[REGRESSION GUARD] Source INBOX count after delta run: 4 ✓');
  }, 120000);
});
}
