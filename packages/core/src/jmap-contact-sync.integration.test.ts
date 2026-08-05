// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The contact-sync LOOP over a real JMAP target (workplan 0031 T2.3).
 *
 * `jmap-contact-target.integration.test.ts` already exercises the connector
 * against a real Stalwart. This is the gap that left: **the connector was
 * tested, the loop over it was not.** `runContactSync` is where the ledger
 * rows, the cursor, the skip decisions and the version bookkeeping happen, and
 * every one of those can be wrong in a way the connector's own tests cannot
 * see.
 *
 * Deliberately shaped like `dav-sync.integration.test.ts` — same synthetic
 * in-memory source, so only the untested leg is on trial — with two assertions
 * that file does not make, because they are specific to this transport:
 *
 *   1. **The stored-card fingerprint reaches the ledger.** JMAP contacts
 *      expose no ETag, so `JmapContactTarget` invents its version marker by
 *      fingerprinting the card as the server stores it. That marker is only
 *      worth anything if `runDomainSync` persists it — and unlike the DAV
 *      writers, this one does NOT record its own rows. If the value never
 *      lands, every future rewrite runs with no ownership guard at all, and
 *      nothing fails: hard rule 2 just quietly stops being enforced.
 *
 *   2. **The RFC 9555 escape hatch survives a full pass.** The connector's own
 *      test proves a direct `upsertContact` keeps `X-OPENMIG-PROBE`. This
 *      proves the loop does not lose it on the way — the properties our own
 *      normalised `Contact` model cannot carry are exactly the ones nobody
 *      would notice going missing.
 *
 * Runs under `pnpm test:integration`, which is gated in CI: the global setup
 * provisions Stalwart with Testcontainers and exports the URL and credentials.
 * Nothing needs configuring.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from '../../ledger/src/db';
import { PgLedger } from '../../ledger/src/ledger';
import { JmapContactTarget } from '../../connectors/src/jmap-contact-target';
import { runContactSync } from './dav-sync';
import {
  asTenantId,
  asMappingId,
  contactNaturalKeyHash,
  type ContactSource,
  type ContactFolder,
  type RawContact,
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

const TENANT_ID = asTenantId('5e0b0300-e29b-41d4-a716-446655440001');
const MAPPING_ID = asMappingId('5e0b0300-e29b-41d4-a716-446655440002');
const CONTACT_COUNT = 3;
const BOOK = 'openmig-jmap-sync';

/**
 * A vCard carrying a property JSContact has no home for.
 *
 * `X-OPENMIG-PROBE` is the canary: it can only survive by riding the RFC 9555
 * `vCard` escape hatch, which is the one thing route (2) buys over converting
 * from our own normalised model. If a future change starts building the card
 * here instead of letting the server parse it, everything else in this file
 * still passes and only this property disappears.
 */
function buildVcard(uid: string, fn: string): string {
  return [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${uid}`,
    `FN:${fn}`,
    'EMAIL;TYPE=work:' + uid,
    'X-OPENMIG-PROBE:this property has no JSContact equivalent',
    'END:VCARD',
    '',
  ].join('\r\n');
}

/** Synthetic in-memory source: isolates the target-write path under test. */
class StubContactSource implements ContactSource {
  constructor(
    private readonly folder: ContactFolder,
    private readonly contacts: ReadonlyArray<RawContact>,
  ) {}

  async listFolders(): Promise<ReadonlyArray<ContactFolder>> {
    return [this.folder];
  }

  async listSince(
    _folder: ContactFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawContact>; nextCursor: SyncCursor }> {
    return { items: this.contacts, nextCursor: { value: String(this.contacts.length) } };
  }
}

function buildStubContacts(count: number, offset = 0): RawContact[] {
  const contacts: RawContact[] = [];
  for (let n = 1; n <= count; n++) {
    const i = offset + n;
    const uid = `jmap-sync-contact-${i}@dev.local`;
    const fn = `Jmap Sync Test Contact ${i}`;
    const vcard = buildVcard(uid, fn);
    contacts.push({
      item: {
        uid,
        type: 'person',
        name: fn,
        sourcePath: BOOK,
        vcard,
        version: '4.0',
      },
      vcard,
    });
  }
  return contacts;
}

if (!JMAP_URL) {
  console.warn(
    '[jmap-contact-sync] NOT RUN: no STALWART_JMAP_URL. Under `pnpm test:integration` the ' +
      'global setup provides one, so seeing this means the harness did not start Stalwart.',
  );
  describe.skip('Contact sync over JMAP — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('Contact domain sync (real JMAP target) Integration', () => {
    let ledger: InstanceType<typeof PgLedger>;
    let target: JmapContactTarget;

    /** Destroy every card this suite wrote, so a re-run starts clean. */
    async function cleanTarget(): Promise<void> {
      const live = new JmapContactTarget({
        baseUrl: JMAP_URL!,
        username: JMAP_USER,
        password: JMAP_PASSWORD,
      });
      try {
        for await (const entry of live.listEntries()) {
          if (entry.naturalKey.startsWith('jmap-sync-contact-')) {
            await live.removeItem(entry.targetId).catch(() => undefined);
          }
        }
      } catch {
        // Nothing on the target yet, or it cannot be listed. Either way there is
        // nothing to clean and the test below will say so far more precisely.
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
        VALUES (${TENANT_ID}, 'JMAP Contact Sync Test Tenant', 'active')
        ON CONFLICT (id) DO NOTHING
      `);

      const sourceConnId = '5e0b0300-e29b-41d4-a716-446655440003';
      await client.execute(sql`
        INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
        VALUES (${sourceConnId}, ${TENANT_ID}, 'source', 'carddav', 'Stub Contact Source', '{}', 'connected')
      `);

      // `kind = 'jmap'` on a CONTACTS target, which is the row shape
      // `contactTargetProtocol` dispatches on. Written here rather than assumed:
      // it also proves the DB CHECK accepts it, which is what made this need no
      // migration.
      const targetConnId = '5e0b0300-e29b-41d4-a716-446655440004';
      await client.execute(sql`
        INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
        VALUES (${targetConnId}, ${TENANT_ID}, 'target', 'jmap', 'Stalwart Contact Target', '{}', 'connected')
      `);

      const sourceMailboxId = '5e0b0300-e29b-41d4-a716-446655440005';
      await client.execute(sql`
        INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
        VALUES (${sourceMailboxId}, ${TENANT_ID}, ${sourceConnId}, 'user', 'stub-addressbook', 'active')
      `);

      const targetMailboxId = '5e0b0300-e29b-41d4-a716-446655440006';
      await client.execute(sql`
        INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
        VALUES (${targetMailboxId}, ${TENANT_ID}, ${targetConnId}, 'user', ${BOOK}, 'active')
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
      // A FRESH writer per test. The connector caches an account-wide key
      // snapshot for the life of the instance — correct in production, where a
      // pass is one instance — but reusing it across tests would let a snapshot
      // taken before the cleanup decide a later test's adopt/create.
      target = new JmapContactTarget({
        baseUrl: JMAP_URL!,
        username: JMAP_USER,
        password: JMAP_PASSWORD,
      });
      await cleanTarget();
      await cleanDatabaseState();
    }, 60_000);

    afterAll(async () => {
      await cleanTarget();
      await cleanDatabaseState();
    }, 60_000);

    it('writes N contacts, is idempotent on a second pass, and picks up one added later', async () => {
      const folder: ContactFolder = { path: BOOK, name: BOOK };
      const contacts = buildStubContacts(CONTACT_COUNT);

      const result1 = await runContactSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubContactSource(folder, contacts),
        target,
        ledger,
        concurrency: 1,
      });
      expect(result1.scanned).toBe(CONTACT_COUNT);
      expect(result1.created).toBe(CONTACT_COUNT);
      expect(result1.failed).toBe(0);

      // On the server, not merely counted. A pass that reported creates while
      // writing nothing is exactly the shape that survives a counter check.
      const onTarget: string[] = [];
      for await (const entry of target.listEntries()) onTarget.push(entry.naturalKey);
      for (const c of contacts) expect(onTarget).toContain(c.item.uid);

      // SECOND PASS, through a fresh writer so the in-process snapshot cannot
      // be what makes it idempotent. This is the LEDGER's decision, which is
      // the leg the connector's own tests cannot exercise.
      const result2 = await runContactSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubContactSource(folder, contacts),
        target: new JmapContactTarget({
          baseUrl: JMAP_URL!,
          username: JMAP_USER,
          password: JMAP_PASSWORD,
        }),
        ledger,
        concurrency: 1,
      });
      expect(result2.scanned).toBe(CONTACT_COUNT);
      // A duplicate is a SUCCESSFUL write nobody notices until an address book
      // is twice its size — hard rule 1, and the reason this number matters
      // more than any other in the file.
      expect(result2.created).toBe(0);
      expect(result2.failed).toBe(0);

      // THIRD PASS: the shadow-sync property. The customer keeps using the
      // source for weeks, so an item created AFTER the initial copy must still
      // arrive. Passes 1 and 2 cannot see this — a sync that had stopped taking
      // new work entirely passes both perfectly, because "created 0 on the
      // second pass" is exactly what it would report.
      const added = buildStubContacts(1, CONTACT_COUNT);
      const result3 = await runContactSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubContactSource(folder, [...contacts, ...added]),
        target: new JmapContactTarget({
          baseUrl: JMAP_URL!,
          username: JMAP_USER,
          password: JMAP_PASSWORD,
        }),
        ledger,
        concurrency: 1,
      });
      expect(result3.scanned).toBe(CONTACT_COUNT + 1);
      expect(result3.created).toBe(1);
      expect(result3.failed).toBe(0);

      const after: string[] = [];
      for await (const entry of target.listEntries()) after.push(entry.naturalKey);
      expect(after).toContain(added[0]!.item.uid);
    }, 120_000);

    it('lands the stored-card fingerprint in the ledger, so rewrites keep an ownership guard', async () => {
      const folder: ContactFolder = { path: BOOK, name: BOOK };
      const contacts = buildStubContacts(1);
      await runContactSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubContactSource(folder, contacts),
        target,
        ledger,
        concurrency: 1,
      });

      const row = await ledger.find(
        TENANT_ID,
        MAPPING_ID,
        'contact',
        contactNaturalKeyHash(contacts[0]!.item.uid),
      );
      expect(row, 'no ledger row for the contact just written').toBeDefined();

      // THE assertion this file exists for. JMAP contacts expose no ETag, so
      // `JmapContactTarget` invents its version marker by fingerprinting the
      // card as the server stores it — and unlike the DAV writers, it does NOT
      // record its own ledger rows, so the value only survives if
      // `runDomainSync` persists what `upsertContact` returned.
      //
      // If it does not, nothing fails. Every future rewrite simply runs with no
      // ownership guard, and hard rule 2 stops being enforced quietly — which
      // is the precise failure this repo keeps finding, applied to the one rule
      // that protects a customer's own edits.
      expect(row!.targetVersion, 'the writer returned a version the loop did not persist').toBeTruthy();
      expect(row!.targetVersion).toMatch(/^[0-9a-f]{64}$/);
    }, 120_000);

    it('keeps the properties JSContact has no home for, all the way through a pass', async () => {
      const folder: ContactFolder = { path: BOOK, name: BOOK };
      const contacts = buildStubContacts(1);
      await runContactSync({
        tenantId: TENANT_ID,
        mappingId: MAPPING_ID,
        source: new StubContactSource(folder, contacts),
        target,
        ledger,
        concurrency: 1,
      });

      // Read the raw card off the server rather than through the connector: a
      // helper sharing the connector's assumptions could agree with it while
      // both were wrong.
      const auth = `Basic ${Buffer.from(`${JMAP_USER}:${JMAP_PASSWORD}`).toString('base64')}`;
      const session = (await fetch(`${JMAP_URL}/.well-known/jmap`, {
        headers: { Authorization: auth },
      }).then((r) => r.json())) as { primaryAccounts?: Record<string, string> };
      const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:contacts'];
      expect(accountId, 'the session advertises no contacts account').toBeTruthy();

      const response = (await fetch(`${JMAP_URL}/jmap`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'],
          methodCalls: [
            // `vCard` NAMED. ContactCard/get does not volunteer it, and a read
            // that omits it would fail this assertion for a reason that has
            // nothing to do with what the server stored.
            ['ContactCard/get', { accountId, ids: null, properties: ['uid', 'vCard'] }, '0'],
          ],
        }),
      }).then((r) => r.json())) as {
        methodResponses?: Array<[string, { list?: Array<Record<string, unknown>> }, string]>;
      };

      // ISOLATE OUR CARD before asserting anything about it. Grepping the whole
      // response body would pass on somebody else's card:
      // `jmap-contact-target.integration.test.ts` plants an identical
      // `X-OPENMIG-PROBE` against the same Stalwart account, so a body-wide
      // `toContain` would go green even if this pass had written nothing at
      // all. That is the vacuous shape this repo keeps finding, and it would
      // have been invisible — the assertion only fails when BOTH suites are
      // broken at once.
      const first = response.methodResponses?.[0];
      expect(first?.[0], `ContactCard/get returned ${JSON.stringify(first?.[0])}`).toBe(
        'ContactCard/get',
      );
      const mine = (first?.[1]?.list ?? []).find((c) => c.uid === contacts[0]!.item.uid);
      expect(mine, `no card on the server with uid ${contacts[0]!.item.uid}`).toBeDefined();

      // The canary, ON OUR CARD. It can only be there by riding the RFC 9555
      // escape hatch, which is the one thing letting the SERVER parse the vCard
      // buys over building the card from our own normalised model. If someone
      // later changes that, every other assertion in this file still passes and
      // only this one goes red.
      expect(JSON.stringify(mine!.vCard ?? {}).toLowerCase()).toContain('x-openmig-probe');
    }, 120_000);
  });
}
