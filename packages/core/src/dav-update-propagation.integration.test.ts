// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Update propagation against REAL CalDAV/CardDAV/WebDAV targets.
 *
 * `update-propagation.unit.test.ts` proves the decision — which items are
 * eligible to be rewritten, and that adopted items never are. It cannot prove
 * the other half: that the writers' overwrite branch actually replaces the
 * bytes on a real server. A PUT that silently created a second object under a
 * different href, or that a server answered 412 for, would satisfy every unit
 * assertion and still leave the customer looking at week-one data at cutover.
 *
 * So each domain here does the whole round trip: copy, then change the item on
 * the source and re-run, then READ THE TARGET BACK and check the new content
 * is what is actually stored — with a second, unchanged item alongside it to
 * show the pass rewrites only what moved.
 *
 * The sources are stubs, as in dav-sync.integration.test.ts, so that the leg on
 * trial is run*Sync -> *TargetWriter -> Nextcloud and nothing else. The ETags
 * are the stub's, which is exactly right: the point is what the sync loop does
 * with a version that changed, not how a particular server mints one.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from '../../ledger/src/db';
import { PgLedger } from '../../ledger/src/ledger';
import { CalDAVSource } from '../../connectors/src/caldav-source';
import { CarddavSource } from '../../connectors/src/carddav-source';
import { CalDAVTargetWriter } from '../../engines/src/caldav-target-writer';
import { CardDAVTargetWriter } from '../../engines/src/carddav-target-writer';
import { WebDAVTargetWriter } from '../../engines/src/webdav-target-writer';
import { runCalendarSync, runContactSync, runFileSync } from './dav-sync';
import {
  asTenantId,
  asMappingId,
  type TenantId,
  type MappingId,
  type CalendarSource,
  type CalendarFolder,
  type RawCalendarEvent,
  type ContactSource,
  type ContactFolder,
  type RawContact,
  type FileSource,
  type FileFolder,
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

const NEXTCLOUD_WEBDAV_URL = process.env.NEXTCLOUD_WEBDAV_URL;
const NEXTCLOUD_USERNAME = process.env.NEXTCLOUD_USERNAME || 'testadmin';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'testadmin_password';
const AUTH_HEADER = `Basic ${Buffer.from(`${NEXTCLOUD_USERNAME}:${NEXTCLOUD_PASSWORD}`).toString('base64')}`;

if (!NEXTCLOUD_WEBDAV_URL) {
  console.warn(
    '[dav-update-propagation] Skipping tests: Nextcloud not available. Set NEXTCLOUD_WEBDAV_URL to enable.',
  );
  describe.skip('DAV update propagation (real targets) Integration', () => {
    it('skipped - Nextcloud not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {

const BASE = NEXTCLOUD_WEBDAV_URL.replace(/\/$/, '');

/**
 * Tenant/connection/mailbox/mapping rows for one domain.
 *
 * Every DAV integration file in this package rolls its own copy of this SQL;
 * this one is parameterised because it needs three near-identical sets and
 * three more copy-pastes would be three more places to drift.
 */
async function seedMappingRows(opts: {
  tenantId: TenantId;
  mappingId: MappingId;
  idPrefix: string;
  kind: 'caldav' | 'carddav' | 'webdav';
  sourceName: string;
  targetName: string;
}): Promise<void> {
  const db = createPgDb(PG_CONNECTION_STRING!);
  const { tenantId, mappingId, idPrefix, kind, sourceName, targetName } = opts;

  await db.execute(sql`DELETE FROM item WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM connection WHERE tenant_id = ${tenantId}`);

  await db.execute(sql`
    INSERT INTO tenant (id, name, status)
    VALUES (${tenantId}, 'Update Propagation Test Tenant', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  const sourceConnId = `${idPrefix}0003`;
  const targetConnId = `${idPrefix}0004`;
  const sourceMailboxId = `${idPrefix}0005`;
  const targetMailboxId = `${idPrefix}0006`;

  await db.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${sourceConnId}, ${tenantId}, 'source', ${kind}, 'Stub Source', '{}', 'connected')
  `);
  await db.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${targetConnId}, ${tenantId}, 'target', ${kind}, 'Nextcloud Target', '{}', 'connected')
  `);
  await db.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${sourceMailboxId}, ${tenantId}, ${sourceConnId}, 'user', ${sourceName}, 'active')
  `);
  await db.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${targetMailboxId}, ${tenantId}, ${targetConnId}, 'user', ${targetName}, 'active')
  `);
  await db.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
    VALUES (${mappingId}, ${tenantId}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
  `);
}

/** DELETE a collection or file; a 404 is the normal case on a first run. */
async function remove(url: string): Promise<void> {
  try {
    await fetch(url, { method: 'DELETE', headers: { Authorization: AUTH_HEADER } });
  } catch {
    // Never existed — fine.
  }
}

// ============================== Calendar (CalDAV) ==============================

const CAL_TENANT = asTenantId('6c0b0100-e29b-41d4-a716-446655440001');
const CAL_MAPPING = asMappingId('6c0b0100-e29b-41d4-a716-446655440002');
const CAL_COLLECTION = 'openmig-update-target';
const CAL_PATH = `calendars/${NEXTCLOUD_USERNAME}/${CAL_COLLECTION}`;

function icalendar(uid: string, summary: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMig//UpdateTest//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20240101T000000Z',
    'DTSTART:20240115T100000Z',
    'DTEND:20240115T110000Z',
    `SUMMARY:${summary}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function calendarEvent(uid: string, summary: string, etag: string): RawCalendarEvent {
  const ics = icalendar(uid, summary);
  return {
    item: {
      uid,
      type: 'event',
      summary,
      start: '2024-01-15T10:00:00Z',
      etag,
      sourcePath: 'stub-calendar',
      icalendar: ics,
    },
    icalendar: ics,
  };
}

class StubCalendarSource implements CalendarSource {
  constructor(
    private readonly folder: CalendarFolder,
    private readonly events: ReadonlyArray<RawCalendarEvent>,
  ) {}
  async listFolders(): Promise<ReadonlyArray<CalendarFolder>> {
    return [this.folder];
  }
  async listSince(
    _folder: CalendarFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawCalendarEvent>; nextCursor: SyncCursor }> {
    return { items: this.events, nextCursor: { value: String(this.events.length) } };
  }
}

describe('Calendar update propagation (real CalDAV target) Integration', () => {
  let ledger: PgLedger;
  let target: CalDAVTargetWriter;
  let readBack: CalDAVSource;
  const folder: CalendarFolder = { path: CAL_PATH, name: CAL_COLLECTION };

  beforeAll(() => {
    ledger = new PgLedger(createPgDb(PG_CONNECTION_STRING!));
    readBack = new CalDAVSource({
      url: `${NEXTCLOUD_WEBDAV_URL}/`,
      username: NEXTCLOUD_USERNAME,
      passwordEnv: 'NEXTCLOUD_PASSWORD',
    });
    process.env.NEXTCLOUD_PASSWORD = NEXTCLOUD_PASSWORD;
  }, 60000);

  // Writers are constructed PER TEST, not once for the describe.
  //
  // Each DAV writer memoises a snapshot of what the target collection already
  // holds (`collectionKeys` / `rootKeys`) — one listing reused for every item,
  // which is what made these writers fast. It is never invalidated, because in
  // production a writer lives exactly one pass.
  //
  // A writer shared across tests breaks that assumption: `beforeEach` deletes
  // the collection on the server, and the next test's existence check is then
  // answered from a snapshot of a collection that no longer exists. The
  // adoption test seeds an item directly onto the target and the writer could
  // not see it, so it created instead of adopting — reported as `adopted: 0`.
  beforeEach(async () => {
    target = new CalDAVTargetWriter(
      { url: NEXTCLOUD_WEBDAV_URL!, username: NEXTCLOUD_USERNAME, password: NEXTCLOUD_PASSWORD },
      { ledger, tenantId: CAL_TENANT, mappingId: CAL_MAPPING },
    );
    await remove(`${BASE}/${CAL_PATH}/`);
    await seedMappingRows({
      tenantId: CAL_TENANT,
      mappingId: CAL_MAPPING,
      idPrefix: '6c0b0100-e29b-41d4-a716-44665544',
      kind: 'caldav',
      sourceName: 'stub-calendar',
      targetName: CAL_COLLECTION,
    });
  });

  afterAll(async () => {
    await remove(`${BASE}/${CAL_PATH}/`);
  });

  it('rewrites an event edited on the source, and leaves the untouched one alone', async () => {
    const uidA = 'update-test-a@dev.local';
    const uidB = 'update-test-b@dev.local';

    const first = await runCalendarSync({
      tenantId: CAL_TENANT,
      mappingId: CAL_MAPPING,
      source: new StubCalendarSource(folder, [
        calendarEvent(uidA, 'Original A', 'etag-a-1'),
        calendarEvent(uidB, 'Original B', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(first.created).toBe(2);
    expect(first.updated).toBe(0);

    // Event A is edited on the source; B is untouched, ETag and all.
    const second = await runCalendarSync({
      tenantId: CAL_TENANT,
      mappingId: CAL_MAPPING,
      source: new StubCalendarSource(folder, [
        calendarEvent(uidA, 'Rescheduled A', 'etag-a-2'),
        calendarEvent(uidB, 'Original B', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });

    expect(second.updated, 'only the edited event may be rewritten').toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
    expect(second.failed).toBe(0);

    // The claim that matters: the SERVER holds the new text, and still holds
    // exactly two events — a rewrite that created a second object under a
    // different href would also report `updated: 1`.
    const folders = await readBack.listFolders();
    const landed = folders.find((f) => f.name === CAL_COLLECTION || f.path.includes(CAL_COLLECTION));
    expect(landed).toBeDefined();
    const { items } = await readBack.listSince(landed!);
    expect(items).toHaveLength(2);

    const a = items.find((i) => i.item.uid.toLowerCase() === uidA.toLowerCase());
    expect(a?.icalendar).toContain('Rescheduled A');
    expect(a?.icalendar).not.toContain('Original A');

    const b = items.find((i) => i.item.uid.toLowerCase() === uidB.toLowerCase());
    expect(b?.icalendar).toContain('Original B');

    // A third pass at the settled version writes nothing: the ledger took the
    // new ETag, so this does not rewrite on every pass forever.
    const third = await runCalendarSync({
      tenantId: CAL_TENANT,
      mappingId: CAL_MAPPING,
      source: new StubCalendarSource(folder, [
        calendarEvent(uidA, 'Rescheduled A', 'etag-a-2'),
        calendarEvent(uidB, 'Original B', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(third.updated).toBe(0);
    expect(third.skipped).toBe(2);
  }, 120000);

  /**
   * Hard rule 2, end to end against a real server.
   *
   * The destination already holds this item and we never wrote it — what "the
   * customer was already using this account" looks like. The source then moves
   * on. Their copy must survive untouched, however far the source has gone.
   *
   * Only reachable with a real target: adoption is decided by the writer's
   * own existence check against the server, and the `adopted` status it then
   * records is exactly what the rewrite rule reads. A writer that omitted that
   * status (they all did) made the customer's data look like ours.
   */
  it('never rewrites an event the destination already had, however far the source moves', async () => {
    const uid = 'adopted-event@dev.local';

    // Put THEIR copy on the target directly, with no ledger row.
    await fetch(`${BASE}/${CAL_PATH}/`, { method: 'MKCALENDAR', headers: { Authorization: AUTH_HEADER } });
    const theirs = icalendar(uid, 'THEIR VERSION — do not touch');
    const put = await fetch(`${BASE}/${CAL_PATH}/${uid}.ics`, {
      method: 'PUT',
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'text/calendar; charset=utf-8' },
      body: theirs,
    });
    expect([201, 204]).toContain(put.status);

    const first = await runCalendarSync({
      tenantId: CAL_TENANT,
      mappingId: CAL_MAPPING,
      source: new StubCalendarSource(folder, [calendarEvent(uid, 'Our version', 'etag-1')]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(first.adopted, 'the destination already held it').toBe(1);
    expect(first.created).toBe(0);

    // The source now changes. This is the case that must NOT write.
    const second = await runCalendarSync({
      tenantId: CAL_TENANT,
      mappingId: CAL_MAPPING,
      source: new StubCalendarSource(folder, [calendarEvent(uid, 'Our NEWER version', 'etag-2')]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(second.updated, 'hard rule 2: their copy is not ours to replace').toBe(0);
    expect(second.changedButAdopted, 'and the divergence must be reported, not silent').toBe(1);

    // Read the server: still THEIR text.
    const folders = await readBack.listFolders();
    const landed = folders.find((f) => f.name === CAL_COLLECTION || f.path.includes(CAL_COLLECTION));
    const { items } = await readBack.listSince(landed!);
    const found = items.find((i) => i.item.uid.toLowerCase() === uid.toLowerCase());
    expect(found?.icalendar).toContain('THEIR VERSION');
    expect(found?.icalendar).not.toContain('Our NEWER version');
  }, 120000);
});

// ============================== Contacts (CardDAV) ==============================

const CON_TENANT = asTenantId('6c0b0200-e29b-41d4-a716-446655440001');
const CON_MAPPING = asMappingId('6c0b0200-e29b-41d4-a716-446655440002');
const CON_COLLECTION = 'openmig-update-target';
const CON_PATH = `addressbooks/users/${NEXTCLOUD_USERNAME}/${CON_COLLECTION}`;

function contact(uid: string, fn: string, etag: string): RawContact {
  const vcard = ['BEGIN:VCARD', 'VERSION:4.0', `UID:${uid}`, `FN:${fn}`, 'END:VCARD'].join('\r\n');
  return {
    item: {
      uid,
      type: 'person',
      name: fn,
      etag,
      sourcePath: 'stub-addressbook',
      vcard,
      version: '4.0',
    },
    vcard,
  };
}

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

describe('Contact update propagation (real CardDAV target) Integration', () => {
  let ledger: PgLedger;
  let target: CardDAVTargetWriter;
  let readBack: CarddavSource;
  const folder: ContactFolder = { path: CON_PATH, name: CON_COLLECTION };

  beforeAll(() => {
    ledger = new PgLedger(createPgDb(PG_CONNECTION_STRING!));
    readBack = new CarddavSource({
      url: `${NEXTCLOUD_WEBDAV_URL}/`,
      username: NEXTCLOUD_USERNAME,
      passwordEnv: 'NEXTCLOUD_PASSWORD',
    });
    process.env.NEXTCLOUD_PASSWORD = NEXTCLOUD_PASSWORD;
  }, 60000);

  // Fresh writer per test — see the CalDAV describe for why.
  beforeEach(async () => {
    target = new CardDAVTargetWriter(
      { url: NEXTCLOUD_WEBDAV_URL!, username: NEXTCLOUD_USERNAME, password: NEXTCLOUD_PASSWORD },
      { ledger, tenantId: CON_TENANT, mappingId: CON_MAPPING },
    );
    await remove(`${BASE}/${CON_PATH}/`);
    await seedMappingRows({
      tenantId: CON_TENANT,
      mappingId: CON_MAPPING,
      idPrefix: '6c0b0200-e29b-41d4-a716-44665544',
      kind: 'carddav',
      sourceName: 'stub-addressbook',
      targetName: CON_COLLECTION,
    });
  });

  afterAll(async () => {
    await remove(`${BASE}/${CON_PATH}/`);
  });

  it('rewrites a contact edited on the source, and leaves the untouched one alone', async () => {
    const uidA = 'update-contact-a@dev.local';
    const uidB = 'update-contact-b@dev.local';

    const first = await runContactSync({
      tenantId: CON_TENANT,
      mappingId: CON_MAPPING,
      source: new StubContactSource(folder, [
        contact(uidA, 'Original Person A', 'etag-a-1'),
        contact(uidB, 'Original Person B', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(first.created).toBe(2);

    const second = await runContactSync({
      tenantId: CON_TENANT,
      mappingId: CON_MAPPING,
      source: new StubContactSource(folder, [
        contact(uidA, 'Renamed Person A', 'etag-a-2'),
        contact(uidB, 'Original Person B', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });

    expect(second.updated).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
    expect(second.failed).toBe(0);

    const folders = await readBack.listFolders();
    const landed = folders.find((f) => f.name === CON_COLLECTION || f.path.includes(CON_COLLECTION));
    expect(landed).toBeDefined();
    const { items } = await readBack.listSince(landed!);
    expect(items).toHaveLength(2);

    const a = items.find((i) => i.item.uid.toLowerCase() === uidA.toLowerCase());
    expect(a?.vcard).toContain('Renamed Person A');
    expect(a?.vcard).not.toContain('Original Person A');
  }, 120000);

  /**
   * Hard rule 2, end to end against a real server.
   *
   * The destination already holds this item and we never wrote it — what "the
   * customer was already using this account" looks like. The source then moves
   * on. Their copy must survive untouched, however far the source has gone.
   *
   * Only reachable with a real target: adoption is decided by the writer's
   * own existence check against the server, and the `adopted` status it then
   * records is exactly what the rewrite rule reads. A writer that omitted that
   * status (they all did) made the customer's data look like ours.
   */
  it('never rewrites a contact the destination already had, however far the source moves', async () => {
    const uid = 'adopted-contact@dev.local';

    await fetch(`${BASE}/${CON_PATH}/`, {
      method: 'MKCOL',
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/xml; charset=utf-8' },
      body:
        '<?xml version="1.0" encoding="utf-8" ?>' +
        '<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">' +
        '<D:set><D:prop><D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>' +
        '</D:prop></D:set></D:mkcol>',
    });
    const theirs = ['BEGIN:VCARD', 'VERSION:4.0', `UID:${uid}`, 'FN:THEIR PERSON', 'END:VCARD'].join('\r\n');
    const put = await fetch(`${BASE}/${CON_PATH}/${uid}.vcf`, {
      method: 'PUT',
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'text/vcard; charset=utf-8' },
      body: theirs,
    });
    expect([201, 204]).toContain(put.status);

    const first = await runContactSync({
      tenantId: CON_TENANT,
      mappingId: CON_MAPPING,
      source: new StubContactSource(folder, [contact(uid, 'Our Person', 'etag-1')]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(first.adopted).toBe(1);
    expect(first.created).toBe(0);

    const second = await runContactSync({
      tenantId: CON_TENANT,
      mappingId: CON_MAPPING,
      source: new StubContactSource(folder, [contact(uid, 'Our NEWER Person', 'etag-2')]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(second.updated, 'hard rule 2: their copy is not ours to replace').toBe(0);
    expect(second.changedButAdopted).toBe(1);

    const folders = await readBack.listFolders();
    const landed = folders.find((f) => f.name === CON_COLLECTION || f.path.includes(CON_COLLECTION));
    const { items } = await readBack.listSince(landed!);
    const found = items.find((i) => i.item.uid.toLowerCase() === uid.toLowerCase());
    expect(found?.vcard).toContain('THEIR PERSON');
    expect(found?.vcard).not.toContain('Our NEWER Person');
  }, 120000);
});

// ================================ Files (WebDAV) ================================

const FILE_TENANT = asTenantId('6c0b0300-e29b-41d4-a716-446655440001');
const FILE_MAPPING = asMappingId('6c0b0300-e29b-41d4-a716-446655440002');
const FILE_DIR = 'openmig-update-target';

function fileItem(name: string, body: string, etag: string): RawFileItem {
  const content = new TextEncoder().encode(body);
  return {
    item: {
      path: `${FILE_DIR}/${name}`,
      name,
      isDirectory: false,
      size: content.length,
      modifiedAt: new Date().toISOString(),
      mimeType: 'text/plain',
      etag,
      sourceRef: `stub:${FILE_DIR}/${name}`,
    },
    content,
  };
}

class StubFileSource implements FileSource {
  constructor(
    private readonly folder: FileFolder,
    private readonly files: ReadonlyArray<RawFileItem>,
  ) {}
  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    return [this.folder];
  }
  async listSince(
    _folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    return { items: this.files, nextCursor: { value: String(this.files.length) } };
  }
  async fetch(item: RawFileItem['item']): Promise<RawFileItem> {
    const found = this.files.find((f) => f.item.path === item.path);
    if (!found) throw new Error(`StubFileSource has no file at ${item.path}`);
    return found;
  }
}

/** The file's bytes as the server actually holds them. */
async function readTargetFile(name: string): Promise<string> {
  const response = await fetch(`${BASE}/files/${NEXTCLOUD_USERNAME}/${FILE_DIR}/${name}`, {
    headers: { Authorization: AUTH_HEADER },
  });
  if (!response.ok) throw new Error(`GET ${name} -> ${response.status}`);
  return response.text();
}

describe('File update propagation (real WebDAV target) Integration', () => {
  let ledger: PgLedger;
  let target: WebDAVTargetWriter;
  const folder: FileFolder = { path: FILE_DIR, name: FILE_DIR };

  beforeAll(() => {
    ledger = new PgLedger(createPgDb(PG_CONNECTION_STRING!));
  }, 60000);

  // Fresh writer per test — see the CalDAV describe for why.
  beforeEach(async () => {
    target = new WebDAVTargetWriter(
      {
        url: `${BASE}/files/${NEXTCLOUD_USERNAME}/`,
        username: NEXTCLOUD_USERNAME,
        password: NEXTCLOUD_PASSWORD,
      },
      { ledger, tenantId: FILE_TENANT, mappingId: FILE_MAPPING },
    );
    await remove(`${BASE}/files/${NEXTCLOUD_USERNAME}/${FILE_DIR}`);
    await seedMappingRows({
      tenantId: FILE_TENANT,
      mappingId: FILE_MAPPING,
      idPrefix: '6c0b0300-e29b-41d4-a716-44665544',
      kind: 'webdav',
      sourceName: 'stub-files',
      targetName: FILE_DIR,
    });
  });

  afterAll(async () => {
    await remove(`${BASE}/files/${NEXTCLOUD_USERNAME}/${FILE_DIR}`);
  });

  it('rewrites a file edited on the source, and leaves the untouched one alone', async () => {
    const first = await runFileSync({
      tenantId: FILE_TENANT,
      mappingId: FILE_MAPPING,
      source: new StubFileSource(folder, [
        fileItem('a.txt', 'original A body', 'etag-a-1'),
        fileItem('b.txt', 'original B body', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(first.created).toBe(2);

    const second = await runFileSync({
      tenantId: FILE_TENANT,
      mappingId: FILE_MAPPING,
      source: new StubFileSource(folder, [
        fileItem('a.txt', 'EDITED A body', 'etag-a-2'),
        fileItem('b.txt', 'original B body', 'etag-b-1'),
      ]),
      target,
      ledger,
      concurrency: 1,
    });

    expect(second.updated).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
    expect(second.failed).toBe(0);

    // Read the bytes off the server, not the report.
    expect(await readTargetFile('a.txt')).toBe('EDITED A body');
    expect(await readTargetFile('b.txt')).toBe('original B body');

    // And the ledger's recorded size follows the new body, so §20's byte
    // totals do not drift away from what is actually stored.
    const rows = await createPgDb(PG_CONNECTION_STRING!).execute(
      sql`SELECT size_bytes FROM item WHERE tenant_id = ${FILE_TENANT} AND size_bytes = ${BigInt(
        'EDITED A body'.length,
      )}`,
    );
    expect(rows.rows.length).toBe(1);
  }, 120000);

  /**
   * Hard rule 2, end to end against a real server.
   *
   * The destination already holds this item and we never wrote it — what "the
   * customer was already using this account" looks like. The source then moves
   * on. Their copy must survive untouched, however far the source has gone.
   *
   * Only reachable with a real target: adoption is decided by the writer's
   * own existence check against the server, and the `adopted` status it then
   * records is exactly what the rewrite rule reads. A writer that omitted that
   * status (they all did) made the customer's data look like ours.
   */
  it('never rewrites a file the destination already had, however far the source moves', async () => {
    await fetch(`${BASE}/files/${NEXTCLOUD_USERNAME}/${FILE_DIR}`, {
      method: 'MKCOL',
      headers: { Authorization: AUTH_HEADER },
    });
    const put = await fetch(`${BASE}/files/${NEXTCLOUD_USERNAME}/${FILE_DIR}/theirs.txt`, {
      method: 'PUT',
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'THEIR FILE — do not touch',
    });
    expect([201, 204]).toContain(put.status);

    const first = await runFileSync({
      tenantId: FILE_TENANT,
      mappingId: FILE_MAPPING,
      source: new StubFileSource(folder, [fileItem('theirs.txt', 'our body', 'etag-1')]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(first.adopted).toBe(1);
    expect(first.created).toBe(0);

    const second = await runFileSync({
      tenantId: FILE_TENANT,
      mappingId: FILE_MAPPING,
      source: new StubFileSource(folder, [fileItem('theirs.txt', 'our NEWER body', 'etag-2')]),
      target,
      ledger,
      concurrency: 1,
    });
    expect(second.updated, 'hard rule 2: their copy is not ours to replace').toBe(0);
    expect(second.changedButAdopted).toBe(1);

    expect(await readTargetFile('theirs.txt')).toBe('THEIR FILE — do not touch');
  }, 120000);
});
}
