// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GOOGLE CALENDAR DELETION IS REPORTED (workplan 0164 T2), over a real
 * database.
 *
 * The ledger half of `a-google-calendar-deletion-is-reported.unit.test.ts`,
 * which runs the same loop over `MemoryLedger`. What only Postgres can say:
 * that the href `sync-collection` names is the one `PgLedger` records and
 * finds again (`item.source_ref_href`, a plain equality in SQL), that the
 * token lands in the `cursor` table only once the pass has handled what it
 * read, and that the removal reaches the deletions queue as `reported`,
 * which is the evidence the gated apply takes (ADR-0024 gate 3) and the
 * pass itself never acts on.
 *
 * The source is the real `CalDAVSource` over `GoogleLikeCalDav`, a fake
 * that answers as Google did (0164 T1); the target is a fake that keeps
 * what it is given and removes only when it is told to by `applyDeletion`.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  asMappingId,
  asTenantId,
  calendarNaturalKeyHash,
  type CalendarFolder,
  type CalendarTargetWriter,
  type RawCalendarEvent,
  type RemovalResult,
  type UpsertOptions,
  type UpsertResult,
} from '@openmig/shared';
import { createPgDb, type PgDatabase } from '../../ledger/src/db.ts';
import { PgLedger } from '../../ledger/src/ledger.ts';
import { PgCursorStore } from '../../ledger/src/cursor-store.ts';
import { CalDAVSource } from '../../connectors/src/caldav-source.ts';
import { FAKE_CALDAV_URL, FAKE_HOME, GoogleLikeCalDav } from '../../connectors/src/__testing__/google-like-caldav.ts';
import { runCalendarSync } from './dav-sync.ts';
import { applyDeletion } from './apply-deletion.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 0164c2e0 for this file: fixtures that share ids delete each
// other's rows in `beforeEach`.
const TENANT = asTenantId('0164c2e0-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0164c2e0-e29b-41d4-a716-446655440002');

/** A target that keeps what it is given, with a version for each copy, and removes on request. */
class KeepingTarget implements CalendarTargetWriter {
  readonly events = new Map<string, { readonly icalendar: string; readonly version: string }>();
  private versions = 0;

  ensureCalendar(folder: CalendarFolder): Promise<string> {
    return Promise.resolve(`target:${folder.name}`);
  }

  upsertCalendarEvent(calendarId: string, raw: RawCalendarEvent, options?: UpsertOptions): Promise<UpsertResult> {
    const at = `${calendarId}:${raw.item.uid}`;
    const existed = this.events.has(at);
    if (existed && !options?.overwrite) return Promise.resolve({ targetId: at, created: false, adopted: true });
    this.versions += 1;
    const version = `"t${this.versions}"`;
    this.events.set(at, { icalendar: raw.icalendar, version });
    return Promise.resolve(
      existed
        ? { targetId: at, created: false, updated: true, targetVersion: version }
        : { targetId: at, created: true, targetVersion: version },
    );
  }

  findCalendarByNaturalKey(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  /** `TargetRemover`: what `applyDeletion` calls, and nothing else. */
  removeItem(targetId: string, options?: { readonly expectedTargetVersion?: string }): Promise<RemovalResult> {
    const copy = this.events.get(targetId);
    if (copy === undefined) return Promise.resolve({ kind: 'deleted' });
    if (options?.expectedTargetVersion === undefined) return Promise.resolve({ unversioned: true });
    if (options.expectedTargetVersion !== copy.version) return Promise.resolve({ conflicted: true });
    this.events.delete(targetId);
    return Promise.resolve({ kind: 'deleted' });
  }
}

describe('a Google calendar deletion reaches the deletions queue as reported (PgLedger, integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;
  let cursors: PgCursorStore;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);
    cursors = new PgCursorStore(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Google Calendar Deletion Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '0164c2e0-e29b-41d4-a716-446655440011';
    const targetConnId = '0164c2e0-e29b-41d4-a716-446655440012';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${TENANT}, 'source', 'google_calendar', 'Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${TENANT}, 'target', 'caldav', 'Target', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceMailboxId = '0164c2e0-e29b-41d4-a716-446655440021';
    const targetMailboxId = '0164c2e0-e29b-41d4-a716-446655440022';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TENANT}, ${sourceConnId}, 'owner@example.com', 'user', 'Src', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TENANT}, ${targetConnId}, 'owner@example.com', 'user', 'Dst', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${TENANT}`);
  });

  function world() {
    const google = new GoogleLikeCalDav();
    google.pageSize = 15;
    const family = google.addCalendar('family', 'Family');
    const work = google.addCalendar('work', 'Work');
    for (let i = 1; i <= 40; i += 1) google.add(family, `e${i}`);
    for (let i = 1; i <= 5; i += 1) google.add(work, `w${i}`);
    const source = new CalDAVSource(
      { url: FAKE_CALDAV_URL, username: 'owner@example.com', password: 'app-password' },
      { httpClient: google.client },
    );
    (source as unknown as { calendarHomeSet: string }).calendarHomeSet = FAKE_HOME;
    const target = new KeepingTarget();
    const pass = () =>
      runCalendarSync({
        tenantId: TENANT,
        mappingId: MAPPING,
        source,
        target,
        ledger,
        cursors,
        sourceIsAuthorityOnExistence: true,
        stillTheAuthority: async () => true,
      });
    const cursorRow = async (path: string) => {
      const { rows } = await db.execute<{ cursor_value: string }>(sql`
        SELECT cursor_value FROM cursor
         WHERE tenant_id = ${TENANT} AND mapping_id = ${MAPPING} AND folder_path = ${path}
      `);
      return rows[0]?.cursor_value;
    };
    return { google, family, work, target, pass, cursorRow };
  }

  it('records the href sync-collection names, and the token, after the first pass', async () => {
    const w = world();

    const result = await w.pass();

    expect(result.created).toBe(45);
    expect(w.google.askedOf('calendar-query'), 'a calendar was listed whole').toHaveLength(0);
    const { rows } = await db.execute<{ source_ref_href: string }>(sql`
      SELECT source_ref_href FROM item
       WHERE tenant_id = ${TENANT} AND mapping_id = ${MAPPING}
         AND natural_key_hash = ${calendarNaturalKeyHash('e3')}
    `);
    expect(rows[0]?.source_ref_href).toBe(w.google.hrefOf(w.family, 'e3'));
    expect(await w.cursorRow(w.family)).toBe('sync-token:tok:family:40');
    expect(await w.cursorRow(w.work)).toBe('sync-token:tok:work:5');
  });

  it('reports a deletion at Google, removes nothing itself, and the gated apply, by hand, is what removes it', async () => {
    const w = world();
    await w.pass();
    w.google.remove(w.family, 'e3');

    const result = await w.pass();

    const key = calendarNaturalKeyHash('e3');
    expect(result.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([[key, 'reported']]);
    const queued = await ledger.listDeletions(TENANT, MAPPING, 'calendar');
    expect(queued.map((d) => [d.naturalKeyHash, d.evidence, d.confirmed])).toEqual([[key, 'reported', true]]);
    expect(queued[0]?.reportedAt).toBeDefined();
    // The pass removed nothing: the copy is there, the row still says copied.
    expect(w.target.events.has('target:Family:e3')).toBe(true);
    expect((await ledger.find(TENANT, MAPPING, 'calendar', key))?.status).toBe('copied');
    expect(await w.cursorRow(w.family)).toBe('sync-token:tok:family:41');

    // Gate 1 is unchanged: off unless the migration turns it on.
    const off = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target: w.target, stillTheAuthority: async () => true },
      key,
    );
    expect(off).toMatchObject({ ok: false, code: 'not_enabled' });
    expect(w.target.events.has('target:Family:e3')).toBe(true);

    // By hand, behind every gate: the reported removal is what gate 3 takes.
    const applied = await applyDeletion(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'calendar',
        ledger,
        target: w.target,
        allowApplyDeletions: true,
        stillTheAuthority: async () => true,
      },
      key,
    );
    expect(applied).toEqual({ ok: true, kind: 'deleted' });
    expect(w.target.events.has('target:Family:e3')).toBe(false);
    expect((await ledger.find(TENANT, MAPPING, 'calendar', key))?.status).toBe('tombstoned');
  });

  it('reports a 404 a reading with no token lists for a copy the ledger holds, and passes over one never copied', async () => {
    const w = world();
    await w.pass();
    // As the whole listing left an existing Google migration: no token held.
    await cursors.set(TENANT, MAPPING, w.family, { value: '' });
    w.google.remove(w.family, 'e5');
    const never = w.google.rememberRemoval(w.family, 'never-copied');

    const result = await w.pass();

    expect(result.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([
      [calendarNaturalKeyHash('e5'), 'reported'],
    ]);
    expect(await ledger.findBySourceRef(TENANT, MAPPING, 'calendar', never)).toBeUndefined();
    expect(await w.cursorRow(w.family)).toBe('sync-token:tok:family:41');
  });

  it('reports an event moved between two Google calendars as a move, not a deletion', async () => {
    const w = world();
    await w.pass();
    w.google.move('e2', w.family, w.work);

    const result = await w.pass();

    expect(result.deletions).toHaveLength(0);
    expect(await ledger.listDeletions(TENANT, MAPPING, 'calendar')).toHaveLength(0);
    const moves = await ledger.listMoves(TENANT, MAPPING, 'calendar');
    expect(moves.map((m) => [m.naturalKeyHash, m.from, m.to])).toEqual([
      [calendarNaturalKeyHash('e2'), w.family, w.work],
    ]);
  });
});
