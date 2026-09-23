// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE LOOP WRITES THE CARD THE SOURCE COMPLETED (owner's report, 2026-09-23).
 *
 * A Microsoft contact reached Nextcloud with every field and no photo. The
 * Graph listing leaves photos out, because each is a request of its own, and
 * its `fetch` was written to add them. But `runContactSync` wrote `item.vcard`,
 * the LISTED card, for every source, and `fetch` was not on `ContactSource`,
 * so nothing ever called it.
 *
 * The connectors half (`a-contact-that-arrived-without-its-photo`) holds what
 * the Graph source adds and how. This half holds that the loop asks, what it
 * writes when it has asked, and what it costs:
 *
 *  - a source with `fetch` has its completed card written, not its listed one;
 *  - it is asked once per card the pass WRITES, never for one already copied;
 *  - a source without it writes the listed card, exactly as before;
 *  - a `fetch` that throws fails that card on the source side, and the next
 *    pass asks again.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContactSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asMappingId,
  asTenantId,
  contactNaturalKeyHash,
  resetLogLevel,
  setLogLevel,
  type ContactSource,
  type ContactTargetWriter,
  type RawContact,
} from '@openmig/shared';

const TENANT = asTenantId('0e2f0000-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0e2f0000-e29b-41d4-a716-446655440002');
const UID = 'c-photo-1';

const LISTED_CARD = `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${UID}\r\nFN:Ada Lovelace\r\nEND:VCARD`;
const COMPLETED_CARD = `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${UID}\r\nFN:Ada Lovelace\r\nPHOTO:data:image/jpeg;base64,/9j/4A==\r\nEND:VCARD`;

const LISTED: RawContact = {
  item: { uid: UID, type: 'person', name: 'Ada Lovelace', sourcePath: `/contacts/${UID}`, vcard: LISTED_CARD },
  vcard: LISTED_CARD,
} as RawContact;

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** A source that lists one card, and completes it when asked, if it can. */
function sourceWith(fetch?: (item: RawContact) => Promise<RawContact>): ContactSource & { asked: number } {
  const source = {
    asked: 0,
    listFolders: async () => [{ path: '/contacts', name: 'Contacts' }],
    listSince: async () => ({ items: [LISTED], nextCursor: { value: '' } }),
    ...(fetch
      ? {
          fetch: async (item: RawContact) => {
            source.asked += 1;
            return fetch(item);
          },
        }
      : {}),
  };
  return source as unknown as ContactSource & { asked: number };
}

/** A target that keeps every card it was handed. */
function recordingTarget(): ContactTargetWriter & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_folderId: string, raw: RawContact) => {
      written.push(raw.vcard);
      return { targetId: `t-${written.length}`, created: true };
    },
  } as unknown as ContactTargetWriter & { written: string[] };
}

const pass = (source: ContactSource, target: ContactTargetWriter, ledger: MemoryLedger) =>
  runContactSync({ sourceIsAuthorityOnExistence: true, tenantId: TENANT, mappingId: MAPPING, source, target, ledger });

describe('a source that completes its cards', () => {
  it('has the completed card written, photo and all', async () => {
    const target = recordingTarget();

    await pass(sourceWith(async () => ({ ...LISTED, vcard: COMPLETED_CARD })), target, new MemoryLedger());

    expect(target.written).toEqual([COMPLETED_CARD]);
  });

  it('is asked once for a card it writes, and not again once the card is copied', async () => {
    // The photo is a request per contact. Asked for a card the pass skips, it
    // would be a request per contact per pass, for nothing.
    const source = sourceWith(async () => ({ ...LISTED, vcard: COMPLETED_CARD }));
    const target = recordingTarget();
    const ledger = new MemoryLedger();

    await pass(source, target, ledger);
    await pass(source, target, ledger);

    expect(source.asked).toBe(1);
    expect(target.written).toHaveLength(1);
  });

  it('fails the card on the source side when it cannot complete it, and asks again next pass', async () => {
    let failing = true;
    const source = sourceWith(async () => {
      if (failing) throw new Error('Failed to read a contact photo: 403 Forbidden');
      return { ...LISTED, vcard: COMPLETED_CARD };
    });
    const target = recordingTarget();
    const ledger = new MemoryLedger();

    await pass(source, target, ledger);
    const failed = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash(UID));
    expect(failed?.status).toBe('failed');
    // The source side: the old account would not hand it over, and the
    // destination, which was never sent anything, is not the place to look.
    expect(failed?.lastErrorCategory).toBe('source_refused');
    expect(target.written).toEqual([]);

    failing = false;
    await pass(source, target, ledger);
    expect(source.asked).toBe(2);
    expect(target.written).toEqual([COMPLETED_CARD]);
  });
});

describe('a source whose listing is the whole card', () => {
  it('writes the listed card, exactly as before', async () => {
    const target = recordingTarget();

    await pass(sourceWith(), target, new MemoryLedger());

    expect(target.written).toEqual([LISTED_CARD]);
  });
});
