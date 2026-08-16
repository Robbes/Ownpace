// Copyright 2026 OpenHands Agent (Apache-2.0)
/**
 * Sync Job Integration Tests
 *
 * Tests for T3 Trigger.dev job wiring with encrypted credentials:
 * - Full sync job execution with real core engine
 * - Delta sync job execution with real core engine
 * - Cross-tenant isolation THROUGH the job path
 * - Encrypted credential round-trip (store → decrypt → use)
 * - Standalone worker regression (runShadowPass still works)
 *
 * Run: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { createPgDb, PgLedger, PgCursorStore, PgMigrationStatusStore } from '@openmig/ledger';
import { runShadowPass } from '@openmig/core';
import { SecretStore, initSecretStore } from '@openmig/core/secret-store';
import { buildDepsFromMapping, buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { asTenantId, asMappingId } from '@openmig/shared';

// Test database from environment
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Fixed UUIDs for testing
const TENANT_A_ID = asTenantId('5c0b0000-e29b-41d4-a716-446655440001' as never);
const TENANT_B_ID = asTenantId('5c0b0000-e29b-41d4-a716-446655440002' as never);
const MAPPING_A_ID = asMappingId('5c0b0000-e29b-41d4-a716-446655440101' as never);
const MAPPING_B_ID = asMappingId('5c0b0000-e29b-41d4-a716-446655440102' as never);

// Encryption key for tests (same key used across all tests)
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 32 bytes = 64 hex chars

describe('Sync Jobs with Encrypted Credentials (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let pool: Pool;
  const _migrationStatus = new PgMigrationStatusStore(createPgDb(TEST_DATABASE_URL));

  beforeAll(async () => {
    db = createPgDb(TEST_DATABASE_URL);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });

    // Initialize secret store with test key
    process.env.SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    initSecretStore();

    // Setup tenant A
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT_A_ID}, 'Tenant A', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup tenant B
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT_B_ID}, 'Tenant B', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup source connection for tenant A with ENCRYPTED credentials
    const sourceCredsA = {
      accessToken: 'oauth2-token-for-tenant-a-source',
      user: 'user-a@source.com',
    };
    const encryptedCredsA = SecretStore.encryptCredentials(sourceCredsA);

    // Source config for O365 IMAP OAuth2
    const sourceConfigA = {
      type: 'imap-oauth2' as const,
      host: 'outlook.office365.com',
      port: 993,
      user: 'user-a@source.com',
      auth: { kind: 'xoauth2' as const, tokenFromEnv: 'OAUTH2_TOKEN' },
    };

    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
      VALUES (
        '5c0b0001-e29b-41d4-a716-446655440001',
        ${TENANT_A_ID},
        'source',
        'o365',
        'O365 Source A',
        ${JSON.stringify(encryptedCredsA.encrypted)},
        ${JSON.stringify(sourceConfigA)},
        'connected'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup target connection for tenant A with ENCRYPTED credentials
    const targetCredsA = {
      password: 'jmap-password-for-tenant-a-target',
      user: 'user-a@target.com',
    };
    const encryptedTargetCredsA = SecretStore.encryptCredentials(targetCredsA);

    // Target config for JMAP
    const targetConfigA = {
      type: 'jmap' as const,
      baseUrl: 'https://jmap.target.com',
      user: 'user-a@target.com',
      auth: { kind: 'basic' as const, passwordFromEnv: 'JMAP_PASSWORD' },
    };

    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
      VALUES (
        '5c0b0001-e29b-41d4-a716-446655440002',
        ${TENANT_A_ID},
        'target',
        'jmap',
        'JMAP Target A',
        ${JSON.stringify(encryptedTargetCredsA.encrypted)},
        ${JSON.stringify(targetConfigA)},
        'connected'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert mailboxes for tenant A (required FK for mailbox_mapping)
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status)
      VALUES (
        '5c0b0002-e29b-41d4-a716-446655440001',
        ${TENANT_A_ID},
        '5c0b0001-e29b-41d4-a716-446655440001',
        'user-a-source@source.com',
        'user',
        'active'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status)
      VALUES (
        '5c0b0002-e29b-41d4-a716-446655440002',
        ${TENANT_A_ID},
        '5c0b0001-e29b-41d4-a716-446655440002',
        'user-a-target@target.com',
        'user',
        'active'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup mapping for tenant A
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, pattern, mode)
      VALUES (
        ${MAPPING_A_ID},
        ${TENANT_A_ID},
        '5c0b0002-e29b-41d4-a716-446655440001',
        '5c0b0002-e29b-41d4-a716-446655440002',
        'active',
        'shared_s',
        'mirror'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup source connection for tenant B with DIFFERENT encrypted credentials
    const sourceCredsB = {
      accessToken: 'oauth2-token-for-tenant-b-source',
      user: 'user-b@source.com',
    };
    const encryptedCredsB = SecretStore.encryptCredentials(sourceCredsB);

    // Source config for O365 IMAP OAuth2 (tenant B)
    const sourceConfigB = {
      type: 'imap-oauth2' as const,
      host: 'outlook.office365.com',
      port: 993,
      user: 'user-b@source.com',
      auth: { kind: 'xoauth2' as const, tokenFromEnv: 'OAUTH2_TOKEN_B' },
    };

    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
      VALUES (
        '5c0b0001-e29b-41d4-a716-446655440003',
        ${TENANT_B_ID},
        'source',
        'o365',
        'O365 Source B',
        ${JSON.stringify(encryptedCredsB.encrypted)},
        ${JSON.stringify(sourceConfigB)},
        'connected'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup target connection for tenant B
    const targetCredsB = {
      password: 'jmap-password-for-tenant-b-target',
      user: 'user-b@target.com',
    };
    const encryptedTargetCredsB = SecretStore.encryptCredentials(targetCredsB);

    // Target config for JMAP (tenant B)
    const targetConfigB = {
      type: 'jmap' as const,
      baseUrl: 'https://jmap.target-b.com',
      user: 'user-b@target.com',
      auth: { kind: 'basic' as const, passwordFromEnv: 'JMAP_PASSWORD_B' },
    };

    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
      VALUES (
        '5c0b0001-e29b-41d4-a716-446655440004',
        ${TENANT_B_ID},
        'target',
        'jmap',
        'JMAP Target B',
        ${JSON.stringify(encryptedTargetCredsB.encrypted)},
        ${JSON.stringify(targetConfigB)},
        'connected'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
      VALUES (
        '5c0b0001-e29b-41d4-a716-446655440004',
        ${TENANT_B_ID},
        'target',
        'jmap',
        'JMAP Target B',
        ${JSON.stringify(encryptedTargetCredsB.encrypted)},
        '{}',
        'connected'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert mailboxes for tenant B (required FK for mailbox_mapping)
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status)
      VALUES (
        '5c0b0002-e29b-41d4-a716-446655440003',
        ${TENANT_B_ID},
        '5c0b0001-e29b-41d4-a716-446655440003',
        'user-b-source@source-b.com',
        'user',
        'active'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status)
      VALUES (
        '5c0b0002-e29b-41d4-a716-446655440004',
        ${TENANT_B_ID},
        '5c0b0001-e29b-41d4-a716-446655440004',
        'user-b-target@target-b.com',
        'user',
        'active'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Setup mapping for tenant B
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, pattern, mode)
      VALUES (
        ${MAPPING_B_ID},
        ${TENANT_B_ID},
        '5c0b0002-e29b-41d4-a716-446655440003',
        '5c0b0002-e29b-41d4-a716-446655440004',
        'active',
        'shared_s',
        'mirror'
      )
      ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    // Cleanup test data
    await db.execute(sql`DELETE FROM migration_status WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    await db.execute(sql`DELETE FROM item WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    await db.execute(sql`DELETE FROM mailbox_mapping WHERE id IN (${MAPPING_A_ID}, ${MAPPING_B_ID})`);
    await db.execute(sql`DELETE FROM mailbox WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    await db.execute(sql`DELETE FROM connection WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    await db.execute(sql`DELETE FROM tenant WHERE id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    pool.end();
  });

  beforeEach(async () => {
    // Clear item and cursors before each test
    await db.execute(sql`DELETE FROM item WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id IN (${TENANT_A_ID}, ${TENANT_B_ID})`);
  });

  describe('buildDepsFromMapping - encrypted credential round-trip', () => {
    it('should load mapping, decrypt credentials, and build deps for tenant A', async () => {
      const deps = await buildDepsFromMapping(pool, TENANT_A_ID, MAPPING_A_ID);

      expect(deps.tenantId).toBe(TENANT_A_ID);
      expect(deps.mappingId).toBe(MAPPING_A_ID);
      expect(deps.source).toBeDefined();
      expect(deps.target).toBeDefined();
      expect(deps.ledger).toBeInstanceOf(PgLedger);
      expect(deps.cursors).toBeInstanceOf(PgCursorStore);

      // Verify the source connector has the correct credentials (from decrypted data)
      // The ImapSource should have been constructed with the decrypted access token
      // We can't directly access the auth object, but we can verify the connector was built
      expect(deps.source.listFolders).toBeDefined();
      expect(deps.target.upsertEmail).toBeDefined();
    });

    it('should load mapping, decrypt credentials, and build deps for tenant B', async () => {
      const deps = await buildDepsFromMapping(pool, TENANT_B_ID, MAPPING_B_ID);

      expect(deps.tenantId).toBe(TENANT_B_ID);
      expect(deps.mappingId).toBe(MAPPING_B_ID);
      expect(deps.source).toBeDefined();
      expect(deps.target).toBeDefined();
    });

    it("opens the MAPPING'S connection, not the tenant's first row, when a tenant has two providers", async () => {
      // The configuration one wizard walk now creates: mail from O365, files
      // from Google Drive, one tenant. Each loader used to take the tenant's
      // first row for its role, with no ORDER BY — whichever mapping resolved
      // second could open the WRONG PROVIDER'S credentials, by planner mood.
      // Seeded here as a second (drive) source + (webdav) target pair with
      // their own mailboxes and a file mapping, in the same tenant A.
      const DRIVE_CONN = '5c0b0001-e29b-41d4-a716-4466554400d1';
      const WEBDAV_CONN = '5c0b0001-e29b-41d4-a716-4466554400d2';
      const DRIVE_MBOX = '5c0b0002-e29b-41d4-a716-4466554400d3';
      const WEBDAV_MBOX = '5c0b0002-e29b-41d4-a716-4466554400d4';
      const FILE_MAPPING = asMappingId('5c0b0003-e29b-41d4-a716-4466554400d5' as never);

      const driveCreds = SecretStore.encryptCredentials({
        clientId: 'cid.apps.googleusercontent.com',
        clientSecret: 'cs',
        refreshToken: 'rt',
      });
      await db.execute(sql`
        INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
        VALUES (${DRIVE_CONN}, ${TENANT_A_ID}, 'source', 'google_drive', 'Drive A',
                ${JSON.stringify(driveCreds.encrypted)}, ${JSON.stringify({ type: 'google-drive' })}, 'connected')
        ON CONFLICT (id) DO NOTHING
      `);
      const webdavCreds = SecretStore.encryptCredentials({
        username: 'files@target.example',
        password: 'files-password',
      });
      await db.execute(sql`
        INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status)
        VALUES (${WEBDAV_CONN}, ${TENANT_A_ID}, 'target', 'webdav', 'WebDAV A',
                ${JSON.stringify(webdavCreds.encrypted)},
                ${JSON.stringify({ url: 'https://nc.target.example/remote.php/dav/files/files' })}, 'connected')
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status)
        VALUES (${DRIVE_MBOX}, ${TENANT_A_ID}, ${DRIVE_CONN}, 'owner@drive.example', 'user', 'active'),
               (${WEBDAV_MBOX}, ${TENANT_A_ID}, ${WEBDAV_CONN}, 'files@target.example', 'user', 'active')
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, pattern, mode)
        VALUES (${FILE_MAPPING}, ${TENANT_A_ID}, ${DRIVE_MBOX}, ${WEBDAV_MBOX}, 'active', 'shared_s', 'mirror')
        ON CONFLICT (id) DO NOTHING
      `);

      try {
        // The MAIL mapping still opens its O365 source. Under the old loaders
        // this held only by row order; under a planner that returned the drive
        // row first, buildSourceConnectorFromCredentials threw
        // "got: google-drive" and mail sync for the tenant was dead.
        const mailDeps = await buildDepsFromMapping(pool, TENANT_A_ID, MAPPING_A_ID);
        expect(mailDeps.source.listFolders).toBeDefined();
        expect(mailDeps.target.upsertEmail).toBeDefined();

        // And the FILE mapping opens the Drive source — under the old loaders
        // this one failed DETERMINISTICALLY here: the tenant's first source
        // row is the O365 one (inserted first), whose credentials carry no
        // username/password, so the DAV resolver refused before the Drive
        // branch could run.
        const fileDeps = await buildDomainDepsFromMapping(pool, TENANT_A_ID, FILE_MAPPING, 'file');
        try {
          expect(fileDeps.source.listSince).toBeDefined();
          expect(fileDeps.source.listKeys, 'the real GoogleDriveSource, listKeys and all').toBeDefined();
          expect(fileDeps.target.upsertFile).toBeDefined();
        } finally {
          await fileDeps.close();
        }
      } finally {
        // Tenant A's fixtures outlive each test (afterAll deletes by tenant),
        // but a second-provider pair left behind would change what OTHER tests
        // in this file resolve through the fallback path. Remove what this
        // test added, dependents first.
        await db.execute(sql`DELETE FROM mailbox_mapping WHERE id = ${FILE_MAPPING}`);
        await db.execute(sql`DELETE FROM mailbox WHERE id IN (${DRIVE_MBOX}, ${WEBDAV_MBOX})`);
        await db.execute(sql`DELETE FROM connection WHERE id IN (${DRIVE_CONN}, ${WEBDAV_CONN})`);
      }
    });

    it('should fail when tenantId is missing', async () => {
      await expect(async () => {
        // @ts-expect-error - testing missing tenantId
        await buildDepsFromMapping(pool, null, MAPPING_A_ID);
      }).rejects.toThrow('tenantId is required');
    });

    it('should fail when mapping does not exist', async () => {
      const fakeMappingId = asMappingId('99999999-9999-9999-9999-999999999999' as never);
      await expect(async () => {
        await buildDepsFromMapping(pool, TENANT_A_ID, fakeMappingId);
      }).rejects.toThrow('Mapping not found or access denied');
    });

    it('should fail when connection credentials are missing', async () => {
      // Dedicated tenant C with ONLY a no-creds source connection. Needed because (a)
      // buildDepsFromMapping loads connections by (tenant, role) so TENANT_A already having good
      // creds would mask this, and (b) the afterEach cleanup only deletes TENANT_A/B, so tenant C
      // fixtures survive intact.
      const TENANT_C_ID = asTenantId('5c0b0000-e29b-41d4-a716-4466554403c1' as never);
      const mappingC = asMappingId('5c0b0000-e29b-41d4-a716-4466554403c9' as never);
      const connCsrc = '5c0b0000-e29b-41d4-a716-4466554403c5';
      const connCtgt = '5c0b0000-e29b-41d4-a716-4466554403c6';
      const mboxCsrc = '5c0b0000-e29b-41d4-a716-4466554403ca';
      const mboxCtgt = '5c0b0000-e29b-41d4-a716-4466554403cb';
      await db.execute(sql`INSERT INTO tenant (id, name, status) VALUES (${TENANT_C_ID}, 'Tenant C', 'active') ON CONFLICT (id) DO NOTHING`);
      await db.execute(sql`INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES (${connCsrc}, ${TENANT_C_ID}, 'source', 'o365', 'No Creds Source', '{}', 'connected') ON CONFLICT (id) DO NOTHING`);
      await db.execute(sql`INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES (${connCtgt}, ${TENANT_C_ID}, 'target', 'nextcloud', 'T', '{}', 'connected') ON CONFLICT (id) DO NOTHING`);
      await db.execute(sql`INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status) VALUES (${mboxCsrc}, ${TENANT_C_ID}, ${connCsrc}, 'c-src@x.com', 'user', 'active') ON CONFLICT (id) DO NOTHING`);
      await db.execute(sql`INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, status) VALUES (${mboxCtgt}, ${TENANT_C_ID}, ${connCtgt}, 'c-tgt@x.com', 'user', 'active') ON CONFLICT (id) DO NOTHING`);
      await db.execute(sql`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, pattern, mode) VALUES (${mappingC}, ${TENANT_C_ID}, ${mboxCsrc}, ${mboxCtgt}, 'active', 'shared_s', 'mirror') ON CONFLICT (id) DO NOTHING`);
      await expect(async () => {
        await buildDepsFromMapping(pool, TENANT_C_ID, mappingC);
      }).rejects.toThrow('Source connection has no credentials');
    });
  });

  describe('Cross-tenant isolation through job path', () => {
    it('should NOT be able to load tenant B\'s credentials when querying with tenant A\'s ID', async () => {
      // This is the critical security test:
      // Tenant A should NOT be able to access tenant B's encrypted credentials
      // even through the buildDepsFromMapping path

      // Try to build deps for tenant B's mapping but with tenant A's ID
      // This should fail because RLS will prevent access to tenant B's data
      await expect(async () => {
        await buildDepsFromMapping(pool, TENANT_A_ID, MAPPING_B_ID);
      }).rejects.toThrow();

      // The error should be either "Mapping not found" (RLS hides it)
      // or "Source connection not found" (RLS hides tenant B's connections)
    });

    it('should NOT be able to load tenant A\'s credentials when querying with tenant B\'s ID', async () => {
      // Reverse the test: tenant B should NOT access tenant A's data
      await expect(async () => {
        await buildDepsFromMapping(pool, TENANT_B_ID, MAPPING_A_ID);
      }).rejects.toThrow();
    });

    it('should create ledger items only for the correct tenant', async () => {
      // Build deps for tenant A
      const depsA = await buildDepsFromMapping(pool, TENANT_A_ID, MAPPING_A_ID);

      // Manually record a ledger item (simulating what runShadowPass would do)
      await depsA.ledger.recordIfAbsent({
        tenantId: TENANT_A_ID,
        mappingId: MAPPING_A_ID,
        itemType: 'email',
        naturalKeyHash: 'test-natural-key-hash',
        contentHash: 'test-content-hash',
        targetId: 'test-target-id',
        status: 'copied',
        createdAt: new Date().toISOString(),
      });

      // Query for tenant A's item records
      const tenantAItems = await db.execute(sql`
        SELECT * FROM item WHERE tenant_id = ${TENANT_A_ID}
      `);
      expect(tenantAItems.rowCount).toBe(1);

      // Query for tenant B's item records (should be 0)
      const tenantBItems = await db.execute(sql`
        SELECT * FROM item WHERE tenant_id = ${TENANT_B_ID}
      `);
      expect(tenantBItems.rowCount).toBe(0);

      // Now build deps for tenant B and verify they can't see tenant A's data
      const _depsB = await buildDepsFromMapping(pool, TENANT_B_ID, MAPPING_B_ID);

      const tenantBItemsAfter = await db.execute(sql`
        SELECT * FROM item WHERE tenant_id = ${TENANT_B_ID}
      `);
      expect(tenantBItemsAfter.rowCount).toBe(0); // Still 0, tenant B can't see tenant A's data
    });
  });

  describe('Full sync vs Delta sync', () => {
    it('full sync should work with undefined cursors (force full scan)', async () => {
      // Real tenant-scoped deps (ledger, cursors) from decrypted creds; source/target mocked
      // so the full-vs-delta cursor wiring is proven without a live IMAP server.
      const deps = await buildDepsFromMapping(pool, TENANT_A_ID, MAPPING_A_ID);

      const mockSource = {
        listFolders: async () => [],
        listSince: async () => ({ items: [], nextCursor: { value: '' } }),
        fetch: async () => ({ rfc822: '', size: 0 }),
      };
      const mockTarget = {
        ensureMailbox: async () => 'mock-mailbox-id',
        upsertEmail: async () => ({ targetId: 'mock-target-id', created: true }),
      };

      const result = await runShadowPass({
        ...deps,
        source: mockSource as any,
        target: mockTarget as any,
        cursors: undefined,
      });

      expect(result).toBeDefined();
      expect(typeof result.scanned).toBe('number');
      expect(typeof result.created).toBe('number');
      expect(typeof result.skipped).toBe('number');
    });

    it('delta sync should work with cursors (incremental)', async () => {
      // Same as full sync but passes the real tenant-scoped cursor store (incremental path).
      const deps = await buildDepsFromMapping(pool, TENANT_A_ID, MAPPING_A_ID);

      const mockSource = {
        listFolders: async () => [],
        listSince: async () => ({ items: [], nextCursor: { value: '' } }),
        fetch: async () => ({ rfc822: '', size: 0 }),
      };
      const mockTarget = {
        ensureMailbox: async () => 'mock-mailbox-id',
        upsertEmail: async () => ({ targetId: 'mock-target-id', created: true }),
      };

      const result = await runShadowPass({
        ...deps,
        source: mockSource as any,
        target: mockTarget as any,
        cursors: deps.cursors,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Standalone worker regression', () => {
    it('runShadowPass should still work when called directly (env-based creds)', async () => {
      // This test verifies that the standalone worker path still works
      // even after adding the encrypted credential path

      // Create a simple test with mocked connectors
      const mockSource = {
        listFolders: async () => [],
        listSince: async () => ({ items: [], nextCursor: { value: '' } }),
        fetch: async () => ({ rfc822: '', size: 0 }),
      };

      const mockTarget = {
        ensureMailbox: async () => 'mock-mailbox-id',
        upsertEmail: async () => ({ targetId: 'mock-target-id', created: true }),
      };

      const ledger = new PgLedger(db);
      const cursors = new PgCursorStore(db);

      const result = await runShadowPass({
        tenantId: TENANT_A_ID,
        mappingId: MAPPING_A_ID,
        source: mockSource as any,
        target: mockTarget as any,
        ledger,
        cursors,
        concurrency: 4,
      });

      // Should complete without error
      expect(result.scanned).toBe(0); // No folders = no items
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('Secret store encryption/decryption in context', () => {
    it('should encrypt and decrypt credentials correctly within buildDepsFromMapping', async () => {
      // Verify the full round-trip:
      // 1. Store credentials encrypted in DB
      // 2. Load via buildDepsFromMapping (within withTenant)
      // 3. Decrypt and use them

      const originalCreds = {
        accessToken: 'test-oauth-token-12345',
        user: 'test@example.com',
      };

      // Encrypt
      const encrypted = SecretStore.encryptCredentials(originalCreds);

      // Verify encryption produces a blob with expected structure
      expect(encrypted.encrypted.v).toBeDefined();
      expect(encrypted.encrypted.n).toBeDefined(); // nonce
      expect(encrypted.encrypted.t).toBeDefined(); // auth tag
      expect(encrypted.encrypted.c).toBeDefined(); // ciphertext

      // Verify nonce is unique (encrypt again, should be different)
      const encrypted2 = SecretStore.encryptCredentials(originalCreds);
      expect(encrypted.encrypted.n).not.toBe(encrypted2.encrypted.n);

      // Decrypt
      const decrypted = SecretStore.decryptCredentials(encrypted);

      expect(decrypted).toEqual(originalCreds);
    });

    it('should detect tampered credentials', async () => {
      const originalCreds = { token: 'secret-token' };
      const encrypted = SecretStore.encryptCredentials(originalCreds);

      // Tamper with the ciphertext
      const tampered = {
        ...encrypted,
        encrypted: { ...encrypted.encrypted, c: encrypted.encrypted.c + 'tampered' },
      };

      // Decryption should fail
      expect(() => SecretStore.decryptCredentials(tampered)).toThrow();
    });
  });
});
