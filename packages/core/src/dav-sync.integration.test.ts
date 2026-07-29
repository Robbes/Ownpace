// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
// Integration tests proving the calendar/contact/file (CalDAV/CardDAV/WebDAV) domain-sync
// paths actually write to a real target and are idempotent — closes the coverage gap in
// issue #114: no test previously exercised *TargetWriter.upsert* against a live server for
// these domains. (jmap-target and imap-dav-target had the same "never actually connected"
// gap, fixed in #112/#113; these tests are the calendar/contact/file equivalent for the
// target-write path, using a synthetic in-memory source per domain so only the untested leg
// — run*Sync -> *TargetWriter -> Nextcloud — is on trial.)
//
// DoD (issue #114): seed a known N>0 into the source, run the domain sync to a real target,
// assert the target received N, then run a second pass and assert 0 creates.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from '../../ledger/src/db';
import { PgLedger } from '../../ledger/src/ledger';
import { CalDAVSource } from '../../connectors/src/caldav-source';
import { CarddavSource } from '../../connectors/src/carddav-source';
import { WebdavFileSource } from '../../connectors/src/webdav-source';
import { CalDAVTargetWriter } from '../../engines/src/caldav-target-writer';
import { CardDAVTargetWriter } from '../../engines/src/carddav-target-writer';
import { WebDAVTargetWriter } from '../../engines/src/webdav-target-writer';
import { runCalendarSync, runContactSync, runFileSync } from './dav-sync';
import {
  asTenantId,
  asMappingId,
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
    'Run: pnpm test:integration'
  );
}

const NEXTCLOUD_WEBDAV_URL = process.env.NEXTCLOUD_WEBDAV_URL;
const NEXTCLOUD_USERNAME = process.env.NEXTCLOUD_USERNAME || 'testadmin';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'testadmin_password';

if (!NEXTCLOUD_WEBDAV_URL) {
  console.warn('[dav-sync] Skipping tests: Nextcloud not available. Set NEXTCLOUD_WEBDAV_URL to enable.');
  describe.skip('DAV domain sync (real CalDAV/CardDAV/WebDAV targets) Integration', () => {
    it('skipped - Nextcloud not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {

const CALENDAR_TENANT_ID = asTenantId('5e0b0100-e29b-41d4-a716-446655440001');
const CALENDAR_MAPPING_ID = asMappingId('5e0b0100-e29b-41d4-a716-446655440002');
const TARGET_CALENDAR_PATH = `calendars/${NEXTCLOUD_USERNAME}/openmig-e2e-target`;
const EVENT_COUNT = 3;
const AUTH_HEADER = `Basic ${Buffer.from(`${NEXTCLOUD_USERNAME}:${NEXTCLOUD_PASSWORD}`).toString('base64')}`;

function buildIcalendar(uid: string, summary: string, startDate: string): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenMig//DavSyncTest//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20240101T000000Z
DTSTART:${startDate}
DTEND:${startDate}
SUMMARY:${summary}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
}

/** Synthetic in-memory calendar source: isolates the target-write path under test. */
class StubCalendarSource implements CalendarSource {
  constructor(private readonly folder: CalendarFolder, private readonly events: ReadonlyArray<RawCalendarEvent>) {}

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

/**
 * `count` events numbered from `offset + 1`.
 *
 * The offset exists for the delta pass: UIDs are the natural key, so an event
 * built with an index the ledger has already seen is by design not a new item.
 */
function buildStubEvents(count: number, offset = 0): RawCalendarEvent[] {
  const events: RawCalendarEvent[] = [];
  for (let n = 1; n <= count; n++) {
    const i = offset + n;
    const uid = `dav-sync-test-${i}@dev.local`;
    // Padded rather than the old `2024011${i}`, which produced the invalid date
    // 202401110 the moment an index reached 10 — reachable now that the delta
    // pass numbers past the initial corpus.
    const day = String(10 + i).padStart(2, '0');
    const icalendar = buildIcalendar(uid, `Dav Sync Test Event ${i}`, `202401${day}T100000Z`);
    events.push({
      item: {
        uid,
        type: 'event',
        summary: `Dav Sync Test Event ${i}`,
        start: `2024-01-${day}T10:00:00Z`,
        sourcePath: 'stub-calendar',
        icalendar,
      },
      icalendar,
    });
  }
  return events;
}

async function cleanTargetCalendar(): Promise<void> {
  const base = NEXTCLOUD_WEBDAV_URL!.replace(/\/$/, '');
  const calendarUrl = `${base}/${TARGET_CALENDAR_PATH}/`;
  try {
    await fetch(calendarUrl, { method: 'DELETE', headers: { Authorization: AUTH_HEADER } });
  } catch {
    // Calendar may not exist yet - fine.
  }
}

async function cleanDatabaseState(): Promise<void> {
  const client = createPgDb(PG_CONNECTION_STRING!);

  await client.execute(sql`DELETE FROM item WHERE tenant_id = ${CALENDAR_TENANT_ID}`);
  await client.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${CALENDAR_TENANT_ID}`);
  await client.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${CALENDAR_TENANT_ID}`);
  await client.execute(sql`DELETE FROM connection WHERE tenant_id = ${CALENDAR_TENANT_ID}`);

  await client.execute(sql`
    INSERT INTO tenant (id, name, status)
    VALUES (${CALENDAR_TENANT_ID}, 'Dav Sync Test Tenant', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  const sourceConnId = '5e0b0100-e29b-41d4-a716-446655440003';
  await client.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${sourceConnId}, ${CALENDAR_TENANT_ID}, 'source', 'caldav', 'Stub Calendar Source', '{}', 'connected')
  `);

  const targetConnId = '5e0b0100-e29b-41d4-a716-446655440004';
  await client.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${targetConnId}, ${CALENDAR_TENANT_ID}, 'target', 'caldav', 'Nextcloud Calendar Target', '{}', 'connected')
  `);

  const sourceMailboxId = '5e0b0100-e29b-41d4-a716-446655440005';
  await client.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${sourceMailboxId}, ${CALENDAR_TENANT_ID}, ${sourceConnId}, 'user', 'stub-calendar', 'active')
  `);

  const targetMailboxId = '5e0b0100-e29b-41d4-a716-446655440006';
  await client.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${targetMailboxId}, ${CALENDAR_TENANT_ID}, ${targetConnId}, 'user', 'openmig-e2e-target', 'active')
  `);

  await client.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
    VALUES (${CALENDAR_MAPPING_ID}, ${CALENDAR_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
  `);
}

describe('Calendar domain sync (real CalDAV target) Integration', () => {
  let ledger: InstanceType<typeof PgLedger>;
  let target: InstanceType<typeof CalDAVTargetWriter>;
  let readBackSource: CalDAVSource;

  beforeAll(async () => {
    const db = createPgDb(PG_CONNECTION_STRING!);
    ledger = new PgLedger(db);

    target = new CalDAVTargetWriter(
      { url: NEXTCLOUD_WEBDAV_URL!, username: NEXTCLOUD_USERNAME, password: NEXTCLOUD_PASSWORD },
      { ledger, tenantId: CALENDAR_TENANT_ID, mappingId: CALENDAR_MAPPING_ID },
    );

    readBackSource = new CalDAVSource({
      url: `${NEXTCLOUD_WEBDAV_URL}/`,
      username: NEXTCLOUD_USERNAME,
      passwordEnv: 'NEXTCLOUD_PASSWORD',
    });
    process.env.NEXTCLOUD_PASSWORD = NEXTCLOUD_PASSWORD;
  }, 60000);

  beforeEach(async () => {
    await cleanTargetCalendar();
    await cleanDatabaseState();
  });

  afterAll(async () => {
    await cleanTargetCalendar();
    await cleanDatabaseState();
  });

  it('writes N seeded events, is idempotent on a second pass, and picks up one added later', async () => {
    const folder: CalendarFolder = { path: TARGET_CALENDAR_PATH, name: 'openmig-e2e-target' };
    const events = buildStubEvents(EVENT_COUNT);
    const source = new StubCalendarSource(folder, events);

    // NOTE: intentionally no target.connect() call — CalDAVTargetWriter is stateless HTTP
    // (no connect() on the CalendarTargetWriter interface), matching production wiring
    // (dav-factories.ts / runCalendarSync). This is the path that was previously unproven.
    // concurrency: 1 — the test Nextcloud container writes to a fresh SQLite-backed collection;
    // concurrent PUTs into a just-created calendar can silently lose one under lock contention.
    const result1 = await runCalendarSync({
      tenantId: CALENDAR_TENANT_ID,
      mappingId: CALENDAR_MAPPING_ID,
      source,
      target,
      ledger,
      concurrency: 1,
    });

    expect(result1.scanned).toBe(EVENT_COUNT);
    expect(result1.created).toBe(EVENT_COUNT);
    expect(result1.failed).toBe(0);

    // Verify the events actually landed on Nextcloud (read-back via the real CalDAV source).
    const folders = await readBackSource.listFolders();
    const landedFolder = folders.find((f) => f.name === 'openmig-e2e-target' || f.path.includes('openmig-e2e-target'));
    expect(landedFolder).toBeDefined();

    const { items } = await readBackSource.listSince(landedFolder!);
    const landedUids = items.map((i) => i.item.uid.toLowerCase());
    for (const event of events) {
      expect(landedUids).toContain(event.item.uid.toLowerCase());
    }

    // Second pass: same source, same target — must create 0 new items (idempotent).
    const result2 = await runCalendarSync({
      tenantId: CALENDAR_TENANT_ID,
      mappingId: CALENDAR_MAPPING_ID,
      source,
      target,
      ledger,
      concurrency: 1,
    });

    expect(result2.scanned).toBe(EVENT_COUNT);
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(EVENT_COUNT);
    expect(result2.failed).toBe(0);

    // Third pass: the SHADOW-SYNC property.
    //
    // The product is not a one-shot copy — the customer keeps using the source
    // for weeks while the target is kept current, and cuts over when they
    // choose. So an item created on the source AFTER the initial copy must
    // still arrive. Passes 1 and 2 above cannot see that: a sync that had
    // stopped taking new work entirely — a cursor stuck at "done", a listSince
    // that always returned nothing — passes both of them perfectly, because
    // "created 0 on the second pass" is exactly what it would report.
    //
    // Mail had this covered at the ledger level; calendar, contacts and files
    // had it at no level at all.
    const added = buildStubEvents(1, EVENT_COUNT);
    const grownSource = new StubCalendarSource(folder, [...events, ...added]);

    const result3 = await runCalendarSync({
      tenantId: CALENDAR_TENANT_ID,
      mappingId: CALENDAR_MAPPING_ID,
      source: grownSource,
      target,
      ledger,
      concurrency: 1,
    });

    expect(result3.scanned).toBe(EVENT_COUNT + 1);
    // Exactly one: the new event created, every previously-migrated one skipped.
    // A number above 1 would mean the ledger re-copied settled items.
    expect(result3.created).toBe(1);
    expect(result3.skipped).toBe(EVENT_COUNT);
    expect(result3.failed).toBe(0);

    // And it is really on the server, not merely counted.
    const after = await readBackSource.listSince(landedFolder!);
    const afterUids = after.items.map((i) => i.item.uid.toLowerCase());
    expect(afterUids).toContain(added[0]!.item.uid.toLowerCase());
    expect(afterUids.length).toBe(EVENT_COUNT + 1);
  });
});

// ============================= Contacts (CardDAV) =============================

const CONTACT_TENANT_ID = asTenantId('5e0b0200-e29b-41d4-a716-446655440001');
const CONTACT_MAPPING_ID = asMappingId('5e0b0200-e29b-41d4-a716-446655440002');
const TARGET_ADDRESSBOOK_PATH = `addressbooks/users/${NEXTCLOUD_USERNAME}/openmig-e2e-target`;
const CONTACT_COUNT = 3;

function buildVcard(uid: string, fn: string): string {
  return `BEGIN:VCARD
VERSION:4.0
UID:${uid}
FN:${fn}
END:VCARD`;
}

/** Synthetic in-memory contact source: isolates the target-write path under test. */
class StubContactSource implements ContactSource {
  constructor(private readonly folder: ContactFolder, private readonly contacts: ReadonlyArray<RawContact>) {}

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

/** `count` contacts numbered from `offset + 1` — see `buildStubEvents`. */
function buildStubContacts(count: number, offset = 0): RawContact[] {
  const contacts: RawContact[] = [];
  for (let n = 1; n <= count; n++) {
    const i = offset + n;
    const uid = `dav-sync-contact-${i}@dev.local`;
    const fn = `Dav Sync Test Contact ${i}`;
    const vcard = buildVcard(uid, fn);
    contacts.push({
      item: {
        uid,
        type: 'person',
        name: fn,
        sourcePath: 'stub-addressbook',
        vcard,
        version: '4.0',
      },
      vcard,
    });
  }
  return contacts;
}

async function cleanTargetAddressBook(): Promise<void> {
  const base = NEXTCLOUD_WEBDAV_URL!.replace(/\/$/, '');
  const addressBookUrl = `${base}/${TARGET_ADDRESSBOOK_PATH}/`;
  try {
    await fetch(addressBookUrl, { method: 'DELETE', headers: { Authorization: AUTH_HEADER } });
  } catch {
    // Address book may not exist yet - fine.
  }
}

async function cleanContactDatabaseState(): Promise<void> {
  const client = createPgDb(PG_CONNECTION_STRING!);

  await client.execute(sql`DELETE FROM item WHERE tenant_id = ${CONTACT_TENANT_ID}`);
  await client.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${CONTACT_TENANT_ID}`);
  await client.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${CONTACT_TENANT_ID}`);
  await client.execute(sql`DELETE FROM connection WHERE tenant_id = ${CONTACT_TENANT_ID}`);

  await client.execute(sql`
    INSERT INTO tenant (id, name, status)
    VALUES (${CONTACT_TENANT_ID}, 'Dav Sync Contact Test Tenant', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  const sourceConnId = '5e0b0200-e29b-41d4-a716-446655440003';
  await client.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${sourceConnId}, ${CONTACT_TENANT_ID}, 'source', 'carddav', 'Stub Contact Source', '{}', 'connected')
  `);

  const targetConnId = '5e0b0200-e29b-41d4-a716-446655440004';
  await client.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${targetConnId}, ${CONTACT_TENANT_ID}, 'target', 'carddav', 'Nextcloud Contact Target', '{}', 'connected')
  `);

  const sourceMailboxId = '5e0b0200-e29b-41d4-a716-446655440005';
  await client.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${sourceMailboxId}, ${CONTACT_TENANT_ID}, ${sourceConnId}, 'user', 'stub-addressbook', 'active')
  `);

  const targetMailboxId = '5e0b0200-e29b-41d4-a716-446655440006';
  await client.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${targetMailboxId}, ${CONTACT_TENANT_ID}, ${targetConnId}, 'user', 'openmig-e2e-target', 'active')
  `);

  await client.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
    VALUES (${CONTACT_MAPPING_ID}, ${CONTACT_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
  `);
}

describe('Contact domain sync (real CardDAV target) Integration', () => {
  let ledger: InstanceType<typeof PgLedger>;
  let target: InstanceType<typeof CardDAVTargetWriter>;
  let readBackSource: CarddavSource;

  beforeAll(async () => {
    const db = createPgDb(PG_CONNECTION_STRING!);
    ledger = new PgLedger(db);

    target = new CardDAVTargetWriter(
      { url: NEXTCLOUD_WEBDAV_URL!, username: NEXTCLOUD_USERNAME, password: NEXTCLOUD_PASSWORD },
      { ledger, tenantId: CONTACT_TENANT_ID, mappingId: CONTACT_MAPPING_ID },
    );

    readBackSource = new CarddavSource({
      url: `${NEXTCLOUD_WEBDAV_URL}/`,
      username: NEXTCLOUD_USERNAME,
      passwordEnv: 'NEXTCLOUD_PASSWORD',
    });
    process.env.NEXTCLOUD_PASSWORD = NEXTCLOUD_PASSWORD;
  }, 60000);

  beforeEach(async () => {
    await cleanTargetAddressBook();
    await cleanContactDatabaseState();
  });

  afterAll(async () => {
    await cleanTargetAddressBook();
    await cleanContactDatabaseState();
  });

  it('writes N seeded contacts, is idempotent on a second pass, and picks up one added later', async () => {
    const folder: ContactFolder = { path: TARGET_ADDRESSBOOK_PATH, name: 'openmig-e2e-target' };
    const contacts = buildStubContacts(CONTACT_COUNT);
    const source = new StubContactSource(folder, contacts);

    // NOTE: intentionally no target.connect() call — CardDAVTargetWriter is stateless HTTP
    // (no connect() on the ContactTargetWriter interface), matching production wiring.
    // concurrency: 1 — the test Nextcloud container writes to a fresh SQLite-backed collection;
    // concurrent PUTs into a just-created address book can silently lose one under lock contention.
    const result1 = await runContactSync({
      tenantId: CONTACT_TENANT_ID,
      mappingId: CONTACT_MAPPING_ID,
      source,
      target,
      ledger,
      concurrency: 1,
    });

    expect(result1.scanned).toBe(CONTACT_COUNT);
    expect(result1.created).toBe(CONTACT_COUNT);
    expect(result1.failed).toBe(0);

    // Verify the contacts actually landed on Nextcloud (read-back via the real CardDAV source).
    const folders = await readBackSource.listFolders();
    const landedFolder = folders.find((f) => f.name === 'openmig-e2e-target' || f.path.includes('openmig-e2e-target'));
    expect(landedFolder).toBeDefined();

    const { items } = await readBackSource.listSince(landedFolder!);
    const landedUids = items.map((i) => i.item.uid.toLowerCase());
    for (const contact of contacts) {
      expect(landedUids).toContain(contact.item.uid.toLowerCase());
    }

    // Second pass: same source, same target — must create 0 new items (idempotent).
    const result2 = await runContactSync({
      tenantId: CONTACT_TENANT_ID,
      mappingId: CONTACT_MAPPING_ID,
      source,
      target,
      ledger,
      concurrency: 1,
    });

    expect(result2.scanned).toBe(CONTACT_COUNT);
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(CONTACT_COUNT);
    expect(result2.failed).toBe(0);

    // Third pass: shadow sync — a contact added to the source after the initial
    // copy must still arrive. See the calendar test for why passes 1 and 2 are
    // blind to a sync that has stopped taking new work.
    const added = buildStubContacts(1, CONTACT_COUNT);
    const grownSource = new StubContactSource(folder, [...contacts, ...added]);

    const result3 = await runContactSync({
      tenantId: CONTACT_TENANT_ID,
      mappingId: CONTACT_MAPPING_ID,
      source: grownSource,
      target,
      ledger,
      concurrency: 1,
    });

    expect(result3.scanned).toBe(CONTACT_COUNT + 1);
    expect(result3.created).toBe(1);
    expect(result3.skipped).toBe(CONTACT_COUNT);
    expect(result3.failed).toBe(0);

    const after = await readBackSource.listSince(landedFolder!);
    const afterUids = after.items.map((i) => i.item.uid.toLowerCase());
    expect(afterUids).toContain(added[0]!.item.uid.toLowerCase());
    expect(afterUids.length).toBe(CONTACT_COUNT + 1);
  });
});

// =============================== Files (WebDAV) ================================

const FILE_TENANT_ID = asTenantId('5e0b0300-e29b-41d4-a716-446655440001');
const FILE_MAPPING_ID = asMappingId('5e0b0300-e29b-41d4-a716-446655440002');
// Root-relative to the target writer's own configured root (see WebDAVTargetWriter.ensureDirectory
// and WebdavFileSource.toRelativePath) -- the writer's config.url is itself pre-resolved to the
// Nextcloud files/{username}/ root below, matching how production wires it via fileEndpointFromCreds.
const TARGET_FILES_DIR_NAME = 'openmig-e2e-target';
const FILE_COUNT = 3;

/** Synthetic in-memory file source: isolates the target-write path under test. */
class StubFileSource implements FileSource {
  constructor(private readonly folder: FileFolder, private readonly files: ReadonlyArray<RawFileItem>) {}

  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    return [this.folder];
  }

  async listSince(
    _folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    return { items: this.files, nextCursor: { value: String(this.files.length) } };
  }

  /**
   * This stub inlines content in `listSince`, so the sync loop never needs to
   * call this — but the port requires it, and a stub that throws here would
   * silently pass while a real source's fetch path went untested. Serve the
   * same bytes.
   */
  async fetch(item: RawFileItem['item']): Promise<RawFileItem> {
    const found = this.files.find((f) => f.item.path === item.path);
    if (!found) throw new Error(`StubFileSource has no file at ${item.path}`);
    return found;
  }
}

/** `count` files numbered from `offset + 1` — see `buildStubEvents`. */
function buildStubFiles(count: number, offset = 0): RawFileItem[] {
  const files: RawFileItem[] = [];
  for (let n = 1; n <= count; n++) {
    const i = offset + n;
    const name = `dav-sync-test-file-${i}.txt`;
    // Root-relative and self-contained (includes the folder), matching the real
    // WebdavFileSource contract -- the target writer resolves this directly, with no
    // separate parentId concatenation.
    const path = `${TARGET_FILES_DIR_NAME}/${name}`;
    const content = new TextEncoder().encode(`Dav sync test file ${i} content.`);
    files.push({
      item: {
        path,
        name,
        isDirectory: false,
        size: content.length,
        modifiedAt: new Date().toISOString(),
        mimeType: 'text/plain',
        sourceRef: `stub:${path}`,
      },
      content,
    });
  }
  return files;
}

async function cleanTargetFilesDir(): Promise<void> {
  const base = NEXTCLOUD_WEBDAV_URL!.replace(/\/$/, '');
  const dirUrl = `${base}/files/${NEXTCLOUD_USERNAME}/${TARGET_FILES_DIR_NAME}`;
  try {
    await fetch(dirUrl, { method: 'DELETE', headers: { Authorization: AUTH_HEADER } });
  } catch {
    // Directory may not exist yet - fine.
  }
}

async function cleanFileDatabaseState(): Promise<void> {
  const client = createPgDb(PG_CONNECTION_STRING!);

  await client.execute(sql`DELETE FROM item WHERE tenant_id = ${FILE_TENANT_ID}`);
  await client.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${FILE_TENANT_ID}`);
  await client.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${FILE_TENANT_ID}`);
  await client.execute(sql`DELETE FROM connection WHERE tenant_id = ${FILE_TENANT_ID}`);

  await client.execute(sql`
    INSERT INTO tenant (id, name, status)
    VALUES (${FILE_TENANT_ID}, 'Dav Sync File Test Tenant', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  const sourceConnId = '5e0b0300-e29b-41d4-a716-446655440003';
  await client.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${sourceConnId}, ${FILE_TENANT_ID}, 'source', 'webdav', 'Stub File Source', '{}', 'connected')
  `);

  const targetConnId = '5e0b0300-e29b-41d4-a716-446655440004';
  await client.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES (${targetConnId}, ${FILE_TENANT_ID}, 'target', 'webdav', 'Nextcloud File Target', '{}', 'connected')
  `);

  const sourceMailboxId = '5e0b0300-e29b-41d4-a716-446655440005';
  await client.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${sourceMailboxId}, ${FILE_TENANT_ID}, ${sourceConnId}, 'user', 'stub-files', 'active')
  `);

  const targetMailboxId = '5e0b0300-e29b-41d4-a716-446655440006';
  await client.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, display_name, status)
    VALUES (${targetMailboxId}, ${FILE_TENANT_ID}, ${targetConnId}, 'user', 'openmig-e2e-target', 'active')
  `);

  await client.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
    VALUES (${FILE_MAPPING_ID}, ${FILE_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
  `);
}

describe('File domain sync (real WebDAV target) Integration', () => {
  let ledger: InstanceType<typeof PgLedger>;
  let target: InstanceType<typeof WebDAVTargetWriter>;
  let readBackSource: WebdavFileSource;

  beforeAll(async () => {
    const db = createPgDb(PG_CONNECTION_STRING!);
    ledger = new PgLedger(db);

    // Pre-resolved to the Nextcloud files/{username}/ root, matching how production wires the
    // file domain via apps/worker/src/dav-endpoint.ts's fileEndpointFromCreds -- plain WebDAV has
    // no discovery, so a combined Nextcloud connection's config.url isn't itself the file root.
    const targetFilesBaseUrl = `${NEXTCLOUD_WEBDAV_URL!.replace(/\/$/, '')}/files/${NEXTCLOUD_USERNAME}/`;
    target = new WebDAVTargetWriter(
      { url: targetFilesBaseUrl, username: NEXTCLOUD_USERNAME, password: NEXTCLOUD_PASSWORD },
      { ledger, tenantId: FILE_TENANT_ID, mappingId: FILE_MAPPING_ID },
    );

    readBackSource = new WebdavFileSource({
      url: NEXTCLOUD_WEBDAV_URL!,
      username: NEXTCLOUD_USERNAME,
      passwordEnv: 'NEXTCLOUD_PASSWORD',
      rootPath: `/files/${NEXTCLOUD_USERNAME}/`,
    });
    process.env.NEXTCLOUD_PASSWORD = NEXTCLOUD_PASSWORD;
  }, 60000);

  beforeEach(async () => {
    await cleanTargetFilesDir();
    await cleanFileDatabaseState();
  });

  afterAll(async () => {
    await cleanTargetFilesDir();
    await cleanFileDatabaseState();
  });

  it('writes N seeded files, is idempotent on a second pass, and picks up one added later', async () => {
    const folder: FileFolder = { path: TARGET_FILES_DIR_NAME, name: TARGET_FILES_DIR_NAME };
    const files = buildStubFiles(FILE_COUNT);
    const source = new StubFileSource(folder, files);

    // NOTE: intentionally no target.connect() call — WebDAVTargetWriter is stateless HTTP
    // (no connect() on the FileTargetWriter interface), matching production wiring.
    const result1 = await runFileSync({
      tenantId: FILE_TENANT_ID,
      mappingId: FILE_MAPPING_ID,
      source,
      target,
      ledger,
    });

    expect(result1.scanned).toBe(FILE_COUNT);
    expect(result1.created).toBe(FILE_COUNT);
    expect(result1.failed).toBe(0);

    // Verify the files actually landed on Nextcloud (read-back via the real WebDAV source).
    const folders = await readBackSource.listFolders();
    const landedFolder = folders.find((f) => f.name === TARGET_FILES_DIR_NAME);
    expect(landedFolder).toBeDefined();

    const { items } = await readBackSource.listSince(landedFolder!);
    const landedNames = items.map((i) => i.item.name);
    for (const file of files) {
      expect(landedNames).toContain(file.item.name);
    }

    // Second pass: same source, same target — must create 0 new items (idempotent).
    const result2 = await runFileSync({
      tenantId: FILE_TENANT_ID,
      mappingId: FILE_MAPPING_ID,
      source,
      target,
      ledger,
    });

    expect(result2.scanned).toBe(FILE_COUNT);
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(FILE_COUNT);
    expect(result2.failed).toBe(0);

    // Third pass: shadow sync — a file added to the source after the initial
    // copy must still arrive. See the calendar test for why passes 1 and 2 are
    // blind to a sync that has stopped taking new work.
    const added = buildStubFiles(1, FILE_COUNT);
    const grownSource = new StubFileSource(folder, [...files, ...added]);

    const result3 = await runFileSync({
      tenantId: FILE_TENANT_ID,
      mappingId: FILE_MAPPING_ID,
      source: grownSource,
      target,
      ledger,
    });

    expect(result3.scanned).toBe(FILE_COUNT + 1);
    expect(result3.created).toBe(1);
    expect(result3.skipped).toBe(FILE_COUNT);
    expect(result3.failed).toBe(0);

    const after = await readBackSource.listSince(landedFolder!);
    const afterNames = after.items.map((i) => i.item.name);
    expect(afterNames).toContain(added[0]!.item.name);
    expect(afterNames.length).toBe(FILE_COUNT + 1);
  });

  /**
   * `listKeys` must describe the same files, in the same words, as `listSince`.
   *
   * Move detection compares the ledger's natural keys against the keys this
   * returns, and both sides are `fileNaturalKeyHash(path)`. If the two listings
   * spelled a path differently — absolute href versus root-relative, encoded
   * versus decoded — the sets would never intersect and EVERY file in the
   * collection would read as vanished. The pass would then report a healthy
   * corpus as mass deletion, which is the most alarming thing this product
   * could say and it would be entirely wrong.
   *
   * Only a real server settles it: the difference lives in how Nextcloud writes
   * its hrefs, not in anything a stub would reproduce.
   */
  it('lists exactly the keys listSince reports, so a full listing and a cursor one agree', async () => {
    const folder: FileFolder = { path: TARGET_FILES_DIR_NAME, name: TARGET_FILES_DIR_NAME };
    const files = buildStubFiles(3);
    await runFileSync({
      tenantId: FILE_TENANT_ID,
      mappingId: FILE_MAPPING_ID,
      source: new StubFileSource(folder, files),
      target,
      ledger,
    });

    const folders = await readBackSource.listFolders();
    const landed = folders.find((f) => f.name === TARGET_FILES_DIR_NAME);
    expect(landed).toBeDefined();

    const { items } = await readBackSource.listSince(landed!);
    const fromListing = items.map((i) => i.item.path).sort();
    const fromKeys = [...(await readBackSource.listKeys!(landed!))].sort();

    expect(fromKeys).toEqual(fromListing);
    expect(fromKeys.length).toBe(3);
  });
});
}
