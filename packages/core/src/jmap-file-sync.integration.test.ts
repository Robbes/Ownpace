// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The file-sync LOOP over a real JMAP target (workplan 0031 T3).
 *
 * `jmap-file-target.integration.test.ts` already exercises the connector
 * against a real Stalwart. This is the gap that left: **the connector was
 * tested, the loop over it was not.** `runFileSync` is where the ledger rows,
 * the cursor, the skip decisions and the version bookkeeping happen, and every
 * one of those can be wrong in a way the connector's own tests cannot see.
 *
 * Deliberately shaped like `jmap-contact-sync.integration.test.ts` — same
 * synthetic in-memory source, so only the untested leg is on trial — with two
 * assertions specific to THIS domain:
 *
 *   1. **The stored-node fingerprint reaches the ledger.** A JMAP FileNode
 *      exposes no ETag, so `JmapFileTarget` invents its version marker by
 *      fingerprinting the node as the server stores it. That marker is only
 *      worth anything if `runDomainSync` persists it — and unlike
 *      `WebDAVTargetWriter`, this one does NOT record its own rows. If the
 *      value never lands, every future rewrite runs with no ownership guard at
 *      all, and nothing fails: hard rule 2 just quietly stops being enforced.
 *
 *   2. **The path the loop keyed by is the path the target reports.** The
 *      source hashes `FileItem.path`; the target rebuilds a path from the
 *      node's parent chain and hashes that. Those two hashes are what make a
 *      mapping switchable between WebDAV and JMAP, and this is the only test
 *      in the repo where both halves are computed by the code that will really
 *      compute them, against a real server, in one pass.
 *
 * Runs under `pnpm test:integration`, which is gated in CI: the global setup
 * provisions Stalwart with Testcontainers and exports the URL and credentials.
 * Nothing needs configuring.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from '../../ledger/src/db.ts';
import { PgLedger } from '../../ledger/src/ledger.ts';
import { JmapFileTarget } from '../../connectors/src/jmap-file-target.ts';
import { runFileSync } from './dav-sync.ts';
import {
  asTenantId,
  asMappingId,
  fileNaturalKeyHash,
  type FileSource,
  type FileFolder,
  type FileItem,
  type RawFileItem,
  type SyncCursor,
} from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

const JMAP_URL = process.env.STALWART_JMAP_URL;
const JMAP_USER = process.env.STALWART_JMAP_USERNAME || 'target@dev.local';
const JMAP_PASSWORD = process.env.STALWART_JMAP_PASSWORD || 'target_password';

const TENANT_ID = asTenantId('5b2b0100-e29b-41d4-a716-446655440001');
const MAPPING_ID = asMappingId('5b2b0100-e29b-41d4-a716-446655440002');
const FILE_COUNT = 3;
/**
 * The folder every file in this suite lives under, and the reason it has a
 * SPACE in it.
 *
 * A space is the character a percent-encoding path reconstruction gets wrong,
 * and gets wrong silently: `Sync files/a.txt` and `Sync%20files/a.txt` are
 * both well-formed keys and only one of them is the one WebDAV produces. Every
 * file in the suite therefore carries the failure mode in its own key.
 */
const FOLDER = 'openmig-jmap-sync/Sync files';

/** Synthetic in-memory source: isolates the target-write path under test. */
class StubFileSource implements FileSource {
  private readonly folder: FileFolder;
  private readonly files: ReadonlyArray<RawFileItem>;
  constructor(
    folder: FileFolder,
    files: ReadonlyArray<RawFileItem>,
  ) {
    this.folder = folder;
    this.files = files;
  }

  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    return [this.folder];
  }

  async listSince(
    _folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    // METADATA ONLY, exactly as a real source answers: the bytes come from
    // `fetch` inside the loop's bounded concurrency. Handing content back here
    // would let the loop pass a test it would fail against every real source.
    return {
      items: this.files.map((f) => ({ item: f.item })),
      nextCursor: { value: String(this.files.length) },
    };
  }

  async fetch(item: FileItem): Promise<RawFileItem> {
    const found = this.files.find((f) => f.item.path === item.path);
    if (!found) throw new Error(`stub source has no bytes for ${item.path}`);
    return found;
  }
}

function buildStubFiles(count: number, offset = 0): RawFileItem[] {
  const files: RawFileItem[] = [];
  for (let n = 1; n <= count; n++) {
    const i = offset + n;
    const path = `${FOLDER}/report ${i}.txt`;
    const content = new TextEncoder().encode(`openmig jmap file sync fixture ${i}\n`);
    files.push({
      item: {
        path,
        name: `report ${i}.txt`,
        isDirectory: false,
        size: content.byteLength,
        modifiedAt: '2026-08-06T10:00:00.000Z',
        mimeType: 'text/plain',
        etag: `"stub-etag-${i}"`,
        sourceRef: `/dav/files/${path}`,
      },
      content,
    });
  }
  return files;
}

if (!JMAP_URL) {
  console.warn(
    '[jmap-file-sync] NOT RUN: no STALWART_JMAP_URL. Under `pnpm test:integration` the global ' +
      'setup provides one, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('File sync over JMAP — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('File domain sync (real JMAP target) Integration', () => {
    let ledger: InstanceType<typeof PgLedger>;
    let target: JmapFileTarget;

    function freshTarget(): JmapFileTarget {
      return new JmapFileTarget({
        baseUrl: JMAP_URL!,
        username: JMAP_USER,
        password: JMAP_PASSWORD,
      });
    }

    /** Destroy every node this suite wrote, so a re-run starts clean. */
    async function cleanTarget(): Promise<void> {
      const live = freshTarget();
      try {
        for await (const entry of live.listEntries()) {
          if (entry.naturalKey.startsWith('openmig-jmap-sync/')) {
            await live.removeItem(entry.targetId).catch(() => undefined);
          }
        }
      } catch {
        // Nothing on the target yet, or it cannot be listed. Either way there
        // is nothing to clean and the tests below say so far more precisely.
      }
    }

    async function cleanDatabaseState(): Promise<void> {
      const client = createPgDb(PG_CONNECTION_STRING!);
      await client.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT_ID}`);
      await client.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${TENANT_ID}`);
      await client.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${TENANT_ID}`);
      await client.execute(sql`DELETE FROM connection WHERE tenant_id = ${TENANT_ID}`);

      await client.execute(sql`
        INSERT INTO tenant (id, name, status)
        VALUES (${TENANT_ID}, 'JMAP File Sync Test Tenant', 'active')
        ON CONFLICT (id) DO NOTHING
      `);

      const sourceConnId = '5b2b0100-e29b-41d4-a716-446655440003';
      await client.execute(sql`
        INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
        VALUES (${sourceConnId}, ${TENANT_ID}, 'source', 'webdav', 'Stub File Source', '{}', 'connected')
      `);

      // `kind = 'jmap'` on a FILES target, which is the row shape
      // `fileTargetProtocol` dispatches on. Written here rather than assumed:
      // it also proves the DB CHECK accepts it, which is what made this need no
      // migration.
      const targetConnId = '5b2b0100-e29b-41d4-a716-446655440004';
      await client.execute(sql`
        INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
        VALUES (${targetConnId}, ${TENANT_ID}, 'target', 'jmap', 'Stalwart File Target', '{}', 'connected')
      `);

      const sourceMailboxId = '5b2b0100-e29b-41d4-a716-446655440005';
      await client.execute(sql`
        INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
        VALUES (${sourceMailboxId}, ${TENANT_ID}, ${sourceConnId}, 'user', 'stub-files', 'active')
      `);

      const targetMailboxId = '5b2b0100-e29b-41d4-a716-446655440006';
      await client.execute(sql`
        INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
        VALUES (${targetMailboxId}, ${TENANT_ID}, ${targetConnId}, 'user', ${FOLDER}, 'active')
      `);

      await client.execute(sql`
        INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
        VALUES (${MAPPING_ID}, ${TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      `);
    }

    beforeAll(async () => {
      ledger = new PgLedger(createPgDb(PG_CONNECTION_STRING!));
    }, 60_000);

    beforeEach(async () => {
      // A FRESH writer per test. The connector caches the account's file tree
      // for the life of the instance — correct in production, where a pass is
      // one instance — but reusing it across tests would let a snapshot taken
      // before the cleanup decide a later test's adopt/create.
      target = freshTarget();
      await cleanTarget();
      await cleanDatabaseState();
    }, 60_000);

    afterAll(async () => {
      await cleanTarget();
      await cleanDatabaseState();
    }, 60_000);

    it('writes N files, is idempotent on a second pass, and picks up one added later', async () => {
      const folder: FileFolder = { path: FOLDER, name: 'Sync files' };
      const files = buildStubFiles(FILE_COUNT);

      const result1 = await runFileSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubFileSource(folder, files),
        target,
        ledger,
        concurrency: 1,
      });
      expect(result1.scanned).toBe(FILE_COUNT);
      expect(result1.created).toBe(FILE_COUNT);
      expect(result1.failed).toBe(0);

      // On the server, not merely counted. A pass that reported creates while
      // writing nothing is exactly the shape that survives a counter check.
      const onTarget: string[] = [];
      for await (const entry of target.listEntries()) onTarget.push(entry.naturalKey);
      for (const f of files) expect(onTarget).toContain(f.item.path);

      // SECOND PASS, through a fresh writer so the in-process tree snapshot
      // cannot be what makes it idempotent. This is the LEDGER's decision,
      // which is the leg the connector's own tests cannot exercise.
      const result2 = await runFileSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubFileSource(folder, files),
        target: freshTarget(),
        ledger,
        concurrency: 1,
      });
      expect(result2.scanned).toBe(FILE_COUNT);
      // A duplicate is a SUCCESSFUL write nobody notices until a drive is
      // twice its size — hard rule 1, and the reason this number matters more
      // than any other in the file.
      expect(result2.created).toBe(0);
      expect(result2.failed).toBe(0);

      // THIRD PASS: the shadow-sync property. The customer keeps using the
      // source for weeks, so an item created AFTER the initial copy must still
      // arrive. Passes 1 and 2 cannot see this — a sync that had stopped taking
      // new work entirely passes both perfectly, because "created 0 on the
      // second pass" is exactly what it would report.
      const added = buildStubFiles(1, FILE_COUNT);
      const result3 = await runFileSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubFileSource(folder, [...files, ...added]),
        target: freshTarget(),
        ledger,
        concurrency: 1,
      });
      expect(result3.scanned).toBe(FILE_COUNT + 1);
      expect(result3.created).toBe(1);
      expect(result3.failed).toBe(0);

      const after: string[] = [];
      for await (const entry of target.listEntries()) after.push(entry.naturalKey);
      expect(after).toContain(added[0]!.item.path);
    }, 180_000);

    it('keys the ledger row by the SAME path the target reconstructs', async () => {
      const folder: FileFolder = { path: FOLDER, name: 'Sync files' };
      const files = buildStubFiles(1);
      await runFileSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubFileSource(folder, files),
        target,
        ledger,
        concurrency: 1,
      });

      // The SOURCE half: what `runFileSync` hashed to key the row.
      const sourceKey = fileNaturalKeyHash(files[0]!.item.path);
      const row = await ledger.find(TENANT_ID, MAPPING_ID, 'file', sourceKey);
      expect(row, 'no ledger row for the file just written').toBeDefined();

      // The TARGET half: what the connector rebuilds from the node's parent
      // chain, with no path field to read anywhere on the wire. These two
      // hashes agreeing is the entire reason a mapping can be switched between
      // WebDAV and JMAP without re-copying — and if they ever disagree, every
      // file re-copies on every pass while every write succeeds (hard rule 1).
      const entries: string[] = [];
      for await (const entry of target.listEntries()) entries.push(entry.naturalKey);
      const reconstructed = entries.find((p) => p === files[0]!.item.path);
      expect(
        reconstructed,
        `the target reconstructed none of ${JSON.stringify(entries)} as ${files[0]!.item.path}`,
      ).toBeDefined();
      expect(fileNaturalKeyHash(reconstructed!)).toBe(sourceKey);
    }, 120_000);

    it('lands the stored-node fingerprint in the ledger, so rewrites keep an ownership guard', async () => {
      const folder: FileFolder = { path: FOLDER, name: 'Sync files' };
      const files = buildStubFiles(1);
      await runFileSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubFileSource(folder, files),
        target,
        ledger,
        concurrency: 1,
      });

      const row = await ledger.find(
        TENANT_ID,
        MAPPING_ID,
        'file',
        fileNaturalKeyHash(files[0]!.item.path),
      );
      expect(row, 'no ledger row for the file just written').toBeDefined();

      // THE assertion this case exists for. A JMAP FileNode exposes no ETag,
      // so `JmapFileTarget` invents its version marker by fingerprinting the
      // node as the server stores it — and unlike `WebDAVTargetWriter`, it does
      // NOT record its own ledger rows, so the value only survives if
      // `runDomainSync` persists what `upsertFile` returned.
      //
      // If it does not, nothing fails. Every future rewrite simply runs with no
      // ownership guard, and hard rule 2 stops being enforced quietly.
      expect(
        row!.targetVersion,
        'the writer returned a version the loop did not persist',
      ).toBeTruthy();
      expect(row!.targetVersion).toMatch(/^[0-9a-f]{64}$/);

      // And the byte count reached the row, which is what §20's total-size
      // comparison measures against. A domain reporting `totalBytesSource: 0`
      // is structurally unable to compare anything.
      expect(row!.sizeBytes).toBe(files[0]!.content!.byteLength);
    }, 120_000);
  });
}
