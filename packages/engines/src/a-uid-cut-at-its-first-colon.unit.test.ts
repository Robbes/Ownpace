// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A UID CUT AT ITS FIRST COLON PUTS TWO PEOPLE IN ONE FILE.
 *
 * Both DAV writers read the UID out of the payload to decide where to write it,
 * and both did it like this:
 *
 *     const parts = uidMatch[0].split(':');
 *     return parts[1]?.trim() ?? '';
 *
 * That is the first colon-separated PIECE of the value, not the value. A UID of
 * `urn:uuid:8f2b…` — the form Apple, Nextcloud and many DAV servers emit —
 * came back as the string `urn`.
 *
 * ## Why that is worse than a failure
 *
 * The filename is `${uid}.vcf` / `${uid}.ics`, so every such item resolved to
 * ONE name: `urn.vcf`. The first card landed. The second got a `412` from the
 * `If-None-Match: *` precondition, and the writers read a 412 as *"something is
 * already there, and it is exactly what we would have written"* — which is true
 * when the filename is derived from the whole UID and false here. So the second
 * card, and the third, and every one after, were recorded as placed on the
 * strength of somebody else's card.
 *
 * A refusal is visible; this was silent, and it was silent for a whole class of
 * source data rather than for an odd item.
 *
 * ## What this file pins
 *
 * The behaviour, through the writers, because the defect was not in the reader:
 * `extractUid` in `dav-multistatus.ts` has always been correct — it takes
 * everything after the FIRST colon, tolerates `UID;VALUE=text:` and unfolds a
 * wrapped line. Both writers kept a private broken copy beside it. So the test
 * that matters is *two items whose UIDs differ only after the first colon land
 * in two different places*, which is exactly what a private copy cannot pass.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

/** A ledger that knows nothing, so every item takes the target path. */
const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

/**
 * A DAV collection that honours `If-None-Match: *` — the whole point being
 * that a second write to the same href is REFUSED rather than silently
 * overwritten, which is what turned this defect into a quiet one.
 */
function server() {
  const puts: string[] = [];
  const present = new Set<string>();
  const client = {
    async request(o: { method: string; url: string; headers?: Record<string, string> }) {
      if (o.method === 'PUT') {
        const href = new URL(o.url).pathname;
        puts.push(href);
        if (present.has(href) && o.headers?.['If-None-Match'] === '*') {
          return { status: 412, body: '', headers: {} };
        }
        present.add(href);
        return { status: 201, body: '', headers: { etag: '"1"' } };
      }
      // Nothing is on the target: an empty multistatus for every query.
      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;
  return { client, puts, present };
}

const event = (uid: string) => ({
  icalendar: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR`,
});
const card = (uid: string) => ({
  vcard: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:Someone\r\nEND:VCARD`,
});

describe('two UIDs that differ only after the first colon', () => {
  it('are two events, in two files, both created', async () => {
    const { client, puts } = server();
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    const first = await writer.upsertCalendarEvent(
      '/calendars/alice/personal/',
      event('urn:uuid:11111111-1111-4111-8111-111111111111') as never,
    );
    const second = await writer.upsertCalendarEvent(
      '/calendars/alice/personal/',
      event('urn:uuid:22222222-2222-4222-8222-222222222222') as never,
    );

    expect(first.created, 'the first event is written').toBe(true);
    expect(
      second.created,
      'the second event is a DIFFERENT event and must be written, not adopted on a 412 ' +
        'about the first one',
    ).toBe(true);
    expect(new Set(puts).size, `both events went to ${puts.join(' and ')}`).toBe(2);
    // And the whole UID is in the name, not the scheme prefix.
    expect(puts[0]).toContain('11111111-1111-4111-8111-111111111111');
    expect(puts.every((p) => !p.endsWith('/urn.ics'))).toBe(true);
  });

  it('are two contacts, in two files, both created', async () => {
    const { client, puts } = server();
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    const first = await writer.upsertContact(
      '/addressbooks/alice/contacts/',
      card('urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as never,
    );
    const second = await writer.upsertContact(
      '/addressbooks/alice/contacts/',
      card('urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as never,
    );

    expect(first.created).toBe(true);
    expect(
      second.created,
      'two people, and the second was recorded as already present on a 412 about the first',
    ).toBe(true);
    expect(new Set(puts).size, `both cards went to ${puts.join(' and ')}`).toBe(2);
    expect(puts.every((p) => !p.endsWith('/urn.vcf'))).toBe(true);
  });

  it('keeps the whole UID as the item’s natural key, which is what names it later', async () => {
    // The confirmed list, the failure queue and every move report say WHICH
    // item by this string. `urn` names nothing, and names it identically for
    // every item in the account.
    const { client } = server();
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );
    const result = await writer.upsertContact(
      '/addressbooks/alice/contacts/',
      card('urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc') as never,
    );
    expect(result.targetId).toContain('urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });
});

describe('the shapes the shared reader already handled and the copies did not', () => {
  it('takes a UID carrying a parameter', async () => {
    const { client, puts } = server();
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );
    await writer.upsertCalendarEvent('/calendars/alice/personal/', {
      icalendar: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID;VALUE=TEXT:plain-uid-1\r\nEND:VEVENT\r\nEND:VCALENDAR',
    } as never);
    expect(puts[0]).toContain('plain-uid-1');
  });

  it('unfolds a UID the server wrapped', async () => {
    const { client, puts } = server();
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );
    await writer.upsertCalendarEvent('/calendars/alice/personal/', {
      icalendar:
        'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:the-first-half-\r\n and-the-second\r\nEND:VEVENT\r\nEND:VCALENDAR',
    } as never);
    expect(puts[0]).toContain('the-first-half-and-the-second');
  });

  it('still refuses a payload with no UID at all', async () => {
    // The one behaviour that must not change: an item we cannot name is an
    // item we cannot write idempotently, and writing it anyway is how
    // duplicates arrive on a re-run.
    const { client } = server();
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );
    await expect(
      writer.upsertContact('/addressbooks/alice/contacts/', {
        vcard: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:No UID\r\nEND:VCARD',
      } as never),
    ).rejects.toThrow(/missing UID/);
  });
});
