// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sync loop puts the item's own identifier on the row it writes.
 *
 * `a-list-that-cannot-say-which-item.unit.test.ts` (packages/ledger) proves the
 * ledger stores `naturalKey` once it is given one. This proves it is GIVEN one
 * — the other half, and the half that was actually missing for the life of the
 * product: `LedgerRecord` had no such field, so the loop had nothing to pass
 * and the column held `''` on every row in every domain.
 *
 * Two of these assertions are about the failure path, deliberately. The live
 * symptom that started this was two contact failures nobody could identify on
 * the Failures page, and a failure row is written by a different branch from a
 * successful one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { runCalendarSync, runContactSync, runFileSync, runTaskSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
  naturalKeyForCalendar,
  naturalKeyForTask,
  type CalendarEvent,
  type CalendarSource,
  type CalendarTargetWriter,
  type ContactSource,
  type ContactTargetWriter,
  type FileSource,
  type FileTargetWriter,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('6b120000-e29b-41d4-a716-4466554405aa');
const MAPPING = asMappingId('6b120000-e29b-41d4-a716-4466554405bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  /** The plain identifier — a UID, a path. */
  id: string;
  body: string;
}

/** The ledger key, as every domain computes one: a hash OF the identifier. */
const keyOf = (id: string) => `hash:${id}`;

const CARD = { id: 'b3f1c0de-1111-4222-8333-444455556666', body: 'BEGIN:VCARD' };

function onePass(
  ledger: MemoryLedger,
  over: {
    naturalKeyText?: (i: Item, raw?: unknown) => string | undefined;
    upsert?: () => Promise<UpsertResult>;
  } = {},
) {
  return runDomainSync<unknown, unknown, Item, { path: string }>({
    sourceIsAuthorityOnExistence: true,
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'contact',
    source: {},
    target: {},
    ledger,
    listFolders: async () => [{ path: 'Contacts' }],
    listSince: async () => ({ items: [CARD], nextCursor: { value: '1' } }),
    fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
    upsert: over.upsert ?? (async (): Promise<UpsertResult> => ({ targetId: 't', created: true })),
    naturalKey: (i) => keyOf(i.id),
    ...(over.naturalKeyText !== undefined ? { naturalKeyText: over.naturalKeyText } : {}),
    contentHash: (raw) => `h:${raw as string}`,
    ensureCollection: async (f) => f.path,
  });
}

const stored = async (ledger: MemoryLedger) =>
  (await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id)))?.naturalKey;

/** WHERE the row says it is — the other half of identifying a failure. */
const where = async (ledger: MemoryLedger) =>
  (await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id)))?.collection;

describe('a copied item carries its identifier', () => {
  it('records what naturalKeyText returns, beside the hash', async () => {
    const ledger = new MemoryLedger();
    await onePass(ledger, { naturalKeyText: (i) => i.id });
    expect(await stored(ledger)).toBe(CARD.id);
  });

  it('and a domain that supplies none still writes its row', async () => {
    // The field is optional: a source that cannot name its items is no worse
    // off than before this existed, and nothing about the pass depends on it.
    const ledger = new MemoryLedger();
    await onePass(ledger);
    expect(await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id))).toBeDefined();
    expect(await stored(ledger)).toBeUndefined();
  });
});

describe('a FAILED item carries it too', () => {
  it('so the Failures page can say which contact could not be written', async () => {
    const ledger = new MemoryLedger();
    const result = await onePass(ledger, {
      naturalKeyText: (i) => i.id,
      upsert: async () => {
        throw new Error('the target answered 500');
      },
    });

    expect(result.failed).toBe(1);
    expect(await stored(ledger)).toBe(CARD.id);
  });

  it('and the row still names it after a second failing pass', async () => {
    // `recordFailure` takes its UPDATE branch the second time, which is a
    // different statement from the insert and was the half that mattered live:
    // an item fails repeatedly before anybody goes looking for it.
    const ledger = new MemoryLedger();
    const fail = () =>
      onePass(ledger, {
        naturalKeyText: (i) => i.id,
        upsert: async () => {
          throw new Error('the target answered 500');
        },
      });
    await fail();
    await fail();
    expect(await stored(ledger)).toBe(CARD.id);
  });
});

/**
 * WHERE it is, beside what it is called.
 *
 * `recordFailure` learned on 2026-09-13 to repair both identifier columns, and
 * the identifier half worked at once because this call site passes one. The
 * COLLECTION half did nothing — the failure record carried no collection, so
 * the repair was a conditional that never fired, and the Failures screen kept
 * a blank WHERE on exactly the rows somebody was trying to act on.
 *
 * Safe on this path specifically, and it is worth being precise about why: a
 * MOVED item never reaches the write. `classifyKnownItem` returns 'moved' when
 * the stored collection differs from the one being walked, and that branch
 * does nothing to the target and returns — deliberately leaving the row
 * pointing at the OLD collection, because that is still where the target copy
 * is. So by the time a failure can happen, the stored value is either already
 * this collection or blank.
 */
describe('a failed row says WHERE, not only what', () => {
  it('records the collection it was walking when the write failed', async () => {
    const ledger = new MemoryLedger();
    await onePass(ledger, {
      naturalKeyText: (i) => i.id,
      upsert: async () => {
        throw new Error('the target answered 500');
      },
    });

    expect(await where(ledger)).toBe('Contacts');
  });

  it('still says it after a second failing pass, which takes the UPDATE branch', async () => {
    // The half that mattered live: an item fails repeatedly before anybody
    // goes looking, so the insert's copy of this is never the one they read.
    const ledger = new MemoryLedger();
    const fail = () =>
      onePass(ledger, {
        naturalKeyText: (i) => i.id,
        upsert: async () => {
          throw new Error('the target answered 500');
        },
      });
    await fail();
    await fail();

    expect(await where(ledger)).toBe('Contacts');
    // And the name is still there beside it — one repair must not cost the
    // other.
    expect(await stored(ledger)).toBe(CARD.id);
  });

  it('fills a blank left by an older pass, on a row that only ever failed', async () => {
    // The live shape, seeded the way it actually arises: a row written by an
    // older worker that recorded no collection, which then kept failing and so
    // never reached the success path that would have repaired it.
    //
    // Seeded through `recordFailure` rather than `recordIfAbsent`, because a
    // `copied` row whose version has not moved is SKIPPED before any write —
    // the first draft of this test did that and proved nothing, reporting
    // `skipped: 1` and a blank column the pass had never been asked to fill.
    const ledger = new MemoryLedger();
    await ledger.recordFailure(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        itemType: 'contact',
        naturalKeyHash: keyOf(CARD.id),
        collection: '',
        contentHash: 'h:old',
        targetId: '',
        createdAt: new Date().toISOString(),
        sizeBytes: 0,
        status: 'failed',
      },
      'an older worker, before either column was recorded',
    );
    expect(await where(ledger)).toBe('');
    expect(await stored(ledger)).toBeUndefined();

    await onePass(ledger, {
      naturalKeyText: (i) => i.id,
      upsert: async () => {
        throw new Error('the target answered 500');
      },
    });

    // Both columns repaired by the failure itself — which is the only path
    // this row will ever take.
    expect(await where(ledger)).toBe('Contacts');
    expect(await stored(ledger)).toBe(CARD.id);
  });
});

describe('an item whose key is its own content', () => {
  it('takes its identifier from the raw body, like its key does', async () => {
    // Mail with no Message-ID: `naturalKey` returns undefined from the listing
    // and `naturalKeyFromRaw` derives the key after the fetch. The text has to
    // follow the same way in, or these items alone stay unnamed.
    const ledger = new MemoryLedger();
    await runDomainSync<unknown, unknown, Item, { path: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'email',
      source: {},
      target: {},
      ledger,
      listFolders: async () => [{ path: 'INBOX' }],
      listSince: async () => ({
        items: [{ id: '', body: 'derived-mid' }],
        nextCursor: { value: '1' },
      }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
      upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
      naturalKey: () => undefined,
      naturalKeyFromRaw: (_i, raw) => keyOf(raw as string),
      naturalKeyText: (_i, raw) => (raw === undefined ? undefined : (raw as string)),
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (f) => f.path,
    });

    expect(
      (await ledger.find(TENANT, MAPPING, 'email', keyOf('derived-mid')))?.naturalKey,
    ).toBe('derived-mid');
  });
});

/**
 * EVERY DOMAIN THE PRODUCT CARRIES, through its real runner.
 *
 * The tests above prove the generic loop records whatever it is handed. These
 * prove each domain actually hands it something — which is the half a sixth
 * domain would silently skip. That is not hypothetical here: the task domain
 * was added as the fifth in 2026-09, and the first thing it got wrong was a
 * natural key it had inherited rather than been given (0113).
 *
 * Asserted through `runCalendarSync` and its three siblings, not against the
 * config objects, because the config is private to `dav-sync.ts` and a test
 * that reconstructed it would be asserting its own copy.
 */
describe('each domain names its own items', () => {
  const EVENT_UID = 'EVT-ABC-123';
  const CARD_UID = 'b3f1c0de-1111-4222-8333-444455556666';
  const FILE_PATH = 'Wieke/Foto shoot Emma/DSC_0042.jpg';

  const event = (uid: string) => ({ uid }) as CalendarEvent;

  it('calendar: the event UID', async () => {
    const ledger = new MemoryLedger();
    await runCalendarSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: '/events/', name: 'Events' }],
        listSince: async () => ({
          items: [
            {
              item: event(EVENT_UID),
              icalendar: `BEGIN:VEVENT\nUID:${EVENT_UID}\nEND:VEVENT`,
            },
          ],
        }),
      } as unknown as CalendarSource,
      target: {
        ensureCalendar: async (f: { path: string }) => f.path,
        upsertCalendarEvent: async () => ({ targetId: 't', created: true }),
      } as unknown as CalendarTargetWriter,
      ledger,
    });

    const row = await ledger.find(TENANT, MAPPING, 'calendar', naturalKeyForCalendar(event(EVENT_UID)));
    expect(row?.naturalKey).toBe(EVENT_UID);
  });

  it('task: the UID too, unprefixed — only its HASH wears `todo:`', async () => {
    const ledger = new MemoryLedger();
    await runTaskSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: '/tasks/', name: 'Tasks' }],
        listSince: async () => ({
          items: [
            { item: event(EVENT_UID), icalendar: `BEGIN:VTODO\nUID:${EVENT_UID}\nEND:VTODO` },
          ],
        }),
      } as unknown as CalendarSource,
      target: {
        ensureCalendar: async (f: { path: string }) => f.path,
        upsertCalendarEvent: async () => ({ targetId: 't', created: true }),
      } as unknown as CalendarTargetWriter,
      ledger,
    });

    const row = await ledger.find(TENANT, MAPPING, 'task', naturalKeyForTask(event(EVENT_UID)));
    expect(row?.naturalKey).toBe(EVENT_UID);
  });

  it('contact: the vCard UID — the domain the live failure was in', async () => {
    const ledger = new MemoryLedger();
    await runContactSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: '/contacts/', name: 'Contacts' }],
        listSince: async () => ({
          items: [
            { item: { uid: CARD_UID }, vcard: `BEGIN:VCARD\nUID:${CARD_UID}\nEND:VCARD` },
          ],
        }),
      } as unknown as ContactSource,
      target: {
        ensureContactFolder: async (f: { path: string }) => f.path,
        upsertContact: async () => ({ targetId: 't', created: true }),
      } as unknown as ContactTargetWriter,
      ledger,
    });

    const row = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash(CARD_UID));
    expect(row?.naturalKey).toBe(CARD_UID);
  });

  it('file: the root-relative path', async () => {
    const ledger = new MemoryLedger();
    await runFileSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: 'Wieke/Foto shoot Emma', name: 'Foto shoot Emma' }],
        listSince: async () => ({
          items: [{ item: { path: FILE_PATH, size: 3 } }],
        }),
        getFileContent: async () => Buffer.from('jpg'),
      } as unknown as FileSource,
      target: {
        ensureDirectory: async (f: { path: string }) => f.path,
        upsertFile: async () => ({ targetId: 't', created: true }),
      } as unknown as FileTargetWriter,
      ledger,
    });

    const row = await ledger.find(TENANT, MAPPING, 'file', fileNaturalKeyHash(FILE_PATH));
    expect(row?.naturalKey).toBe(FILE_PATH);
  });
});
