// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sync loop puts the NAME on the row, beside the identifier.
 *
 * `the-loop-records-which-item.unit.test.ts` proves the loop records what the
 * SOURCE calls an item. That is a path for a file and a Message-ID for mail, and
 * both are things a person can search their old account for. For a calendar
 * event and a contact it is a UID, and the owner said what that is worth on
 * sight (2026-09-17): *"Why not show calander item names and contact names?"*
 *
 * The same evening it cost him an hour. Two of his contacts were refused by a
 * live Nextcloud and every surface that could have told him which two printed
 * `926caf98adce563`: *"I can not find these contacts, or atleast i do no know
 * how."*
 *
 * `packages/ledger/src/a-uid-is-not-a-name.unit.test.ts` proves the ledger
 * stores the name once it is given one. This proves it is GIVEN one — including
 * on the FAILURE branch, which is a different statement from the success one
 * and is the branch the live symptom was on.
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
  DISPLAY_NAME_LIMIT,
  type CalendarEvent,
  type CalendarSource,
  type CalendarTargetWriter,
  type ContactSource,
  type ContactTargetWriter,
  type FileSource,
  type FileTargetWriter,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('6b130000-e29b-41d4-a716-4466554405aa');
const MAPPING = asMappingId('6b130000-e29b-41d4-a716-4466554405bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  id: string;
  name: string;
  body: string;
}

const keyOf = (id: string) => `hash:${id}`;

const CARD: Item = {
  id: 'b3f1c0de-2222-4333-8444-555566667777',
  name: 'Jan Jansen',
  body: 'BEGIN:VCARD',
};

function onePass(
  ledger: MemoryLedger,
  over: {
    displayName?: (i: Item, raw?: unknown) => string | undefined;
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
    naturalKeyText: (i) => i.id,
    ...(over.displayName !== undefined ? { displayName: over.displayName } : {}),
    contentHash: (raw) => `h:${raw as string}`,
    ensureCollection: async (f) => f.path,
  });
}

const storedName = async (ledger: MemoryLedger) =>
  (await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id)))?.displayName;

describe('a copied item carries what it is called', () => {
  it('records what the descriptor returns, beside the identifier', async () => {
    const ledger = new MemoryLedger();
    await onePass(ledger, { displayName: (i) => i.name });
    const row = await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id));
    expect(row?.displayName).toBe('Jan Jansen');
    // Beside, never instead of: the identifier is still what the row is keyed
    // and searched by.
    expect(row?.naturalKey).toBe(CARD.id);
  });

  it('and a domain that supplies none still writes its row', async () => {
    // A file's key IS its name and mail's Subject is not decoded anywhere yet,
    // so the hook is optional and its absence must cost nothing.
    const ledger = new MemoryLedger();
    await onePass(ledger);
    expect(await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id))).toBeDefined();
    expect(await storedName(ledger)).toBeUndefined();
  });
});

describe('a FAILED item carries it too', () => {
  it('so the Failures screen can say whose card could not be written', async () => {
    const ledger = new MemoryLedger();
    const result = await onePass(ledger, {
      displayName: (i) => i.name,
      upsert: async () => {
        throw new Error('the target answered 500');
      },
    });

    expect(result.failed).toBe(1);
    expect(await storedName(ledger)).toBe('Jan Jansen');
  });

  it('and still after a second failing pass, which takes the UPDATE branch', async () => {
    // An item fails repeatedly before anybody goes looking for it: the owner's
    // two cards had five attempts each by the time he read them.
    const ledger = new MemoryLedger();
    const fail = () =>
      onePass(ledger, {
        displayName: (i) => i.name,
        upsert: async () => {
          throw new Error('the target answered 500');
        },
      });
    await fail();
    await fail();
    expect(await storedName(ledger)).toBe('Jan Jansen');
  });
});

describe('each domain names its own items, or honestly names none', () => {
  const EVENT_UID = 'EVT-ABC-123';
  const CARD_UID = 'b3f1c0de-2222-4333-8444-555566667777';
  const FILE_PATH = 'Wieke/Foto shoot Emma/DSC_0042.jpg';

  const event = (uid: string, summary: string) => ({ uid, summary }) as CalendarEvent;

  it('calendar: the SUMMARY the person typed', async () => {
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
              item: event(EVENT_UID, 'Tandarts'),
              icalendar: `BEGIN:VEVENT\nUID:${EVENT_UID}\nSUMMARY:Tandarts\nEND:VEVENT`,
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

    const row = await ledger.find(
      TENANT,
      MAPPING,
      'calendar',
      naturalKeyForCalendar(event(EVENT_UID, 'Tandarts')),
    );
    expect(row?.displayName).toBe('Tandarts');
    expect(row?.naturalKey).toBe(EVENT_UID);
  });

  it('task: the SUMMARY too — a to-do UID is no more readable', async () => {
    const ledger = new MemoryLedger();
    await runTaskSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: '/tasks/', name: 'Tasks' }],
        listSince: async () => ({
          items: [
            {
              item: event(EVENT_UID, 'Belastingaangifte'),
              icalendar: `BEGIN:VTODO\nUID:${EVENT_UID}\nEND:VTODO`,
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

    const row = await ledger.find(
      TENANT,
      MAPPING,
      'task',
      naturalKeyForTask(event(EVENT_UID, 'Belastingaangifte')),
    );
    expect(row?.displayName).toBe('Belastingaangifte');
  });

  it('contact: the FN — the domain the live failure was in', async () => {
    const ledger = new MemoryLedger();
    await runContactSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: '/contacts/', name: 'Contacts' }],
        listSince: async () => ({
          items: [
            {
              item: { uid: CARD_UID, name: 'Jan Jansen' },
              vcard: `BEGIN:VCARD\nUID:${CARD_UID}\nFN:Jan Jansen\nEND:VCARD`,
            },
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
    expect(row?.displayName).toBe('Jan Jansen');
  });

  it('file: NO name, because its identifier already is one', async () => {
    // Not an oversight and not a gap: a second copy of the path on the same row
    // is noise, and the screen falls back to the identifier when there is no
    // name — which for a file is exactly what a reader wants to see.
    const ledger = new MemoryLedger();
    await runFileSync({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: {
        listFolders: async () => [{ path: 'Wieke/Foto shoot Emma', name: 'Foto shoot Emma' }],
        listSince: async () => ({ items: [{ item: { path: FILE_PATH, size: 3 } }] }),
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
    expect(row?.displayName).toBeUndefined();
  });

  it('a name arrives bounded, so one pathological title cannot bloat a row', async () => {
    const long = 'z'.repeat(DISPLAY_NAME_LIMIT + 100);
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
              item: event('EVT-LONG', long),
              icalendar: 'BEGIN:VEVENT\nUID:EVT-LONG\nEND:VEVENT',
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

    const row = await ledger.find(
      TENANT,
      MAPPING,
      'calendar',
      naturalKeyForCalendar(event('EVT-LONG', long)),
    );
    expect([...(row?.displayName ?? '')]).toHaveLength(DISPLAY_NAME_LIMIT + 1);
  });
});
