// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ABSENCE THAT WAS A FAILURE (workplan 0149 T2).
 *
 * When a collection cannot be listed up front, each DAV writer asks about each
 * item on its own: `findCalendarByNaturalKey`, `findContactByNaturalKey` and
 * `findFileByNaturalKey`. All three answered `undefined`, "not on the target",
 * for anything but a 207: a busy Nextcloud's 500, an expired login's 401, a
 * refusal's 403. The WebDAV one also caught every thrown error as *"File
 * doesn't exist"*. None of them went through the retry the writes use.
 *
 * "Not there" is the answer that decides whether to write, and since 0149 T1,
 * whether a 412 is adopted. Hard rule 9: no null-fallbacks that turn failures
 * into empty results. The JMAP and IMAP lookups already refuse, in the words
 * these now use: *refusing to treat this as "not present"*. So each lookup
 * gives one of three answers:
 *
 *  - 207 (and 200, for WebDAV) is read as before;
 *  - 404 is absent: for a REPORT, the collection is gone, and the item with it;
 *  - anything else throws, after the retries a write would get. The item fails
 *    this pass and is asked again on the next.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { asTenantId, asMappingId, classifyFailure, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';

// UUID family 0149a200-…, unused elsewhere in the repo.
const TENANT = asTenantId('0149a200-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0149a200-e29b-41d4-a716-446655440002' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';
const UID = 'asked-about@example.invalid';

const emptyLedger = { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Backoff made instant, as dav-retry.unit.test.ts makes it. */
function instantRetries(): void {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as never);
}

type Answer = { status: number; body?: string } | Error;

/** A server that gives `answers` in turn, the last one for good, and counts the asking. */
function answering(...answers: Answer[]) {
  let asked = 0;
  const client = {
    async request() {
      const answer = answers[Math.min(asked, answers.length - 1)]!;
      asked += 1;
      if (answer instanceof Error) throw answer;
      return { status: answer.status, body: answer.body ?? '', headers: {} };
    },
  } as unknown as HttpClient;
  return { client, asked: () => asked };
}

const holding = (element: 'cal:calendar-data' | 'card:address-data', uid: string) => {
  const data =
    element === 'cal:calendar-data'
      ? `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${uid}\nEND:VEVENT\nEND:VCALENDAR`
      : `BEGIN:VCARD\nVERSION:3.0\nUID:${uid}\nFN:n\nEND:VCARD`;
  const ext = element === 'cal:calendar-data' ? 'ics' : 'vcf';
  return (
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" ' +
    'xmlns:card="urn:ietf:params:xml:ns:carddav">' +
    `<d:response><d:href>/remote.php/dav/c/x.${ext}</d:href><d:propstat><d:prop>` +
    `<${element}>${data}</${element}></d:prop></d:propstat></d:response></d:multistatus>`
  );
};

const aFile =
  '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice/report.pdf</d:href>' +
  '<d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>';

/** Each lookup, asked about one item, behind a server answering `answers`. */
const LOOKUPS = [
  {
    name: 'CalDAV',
    found: holding('cal:calendar-data', UID),
    notMatching: holding('cal:calendar-data', `${UID}-other`),
    ask: (client: HttpClient) =>
      new CalDAVTargetWriter(
        { url: BASE, username: 'alice', password: 'pw' },
        { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
      ).findCalendarByNaturalKey('/c/', UID),
  },
  {
    name: 'CardDAV',
    found: holding('card:address-data', UID),
    notMatching: holding('card:address-data', `${UID}-other`),
    ask: (client: HttpClient) =>
      new CardDAVTargetWriter(
        { url: BASE, username: 'alice', password: 'pw' },
        { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
      ).findContactByNaturalKey('/c/', UID),
  },
  {
    name: 'WebDAV',
    found: aFile,
    notMatching: undefined,
    ask: (client: HttpClient) =>
      new WebDAVTargetWriter(
        { url: `${BASE}/files/alice/`, username: 'alice', password: 'pw' },
        { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
      ).findFileByNaturalKey('', 'report.pdf'),
  },
] as const;

for (const lookup of LOOKUPS) {
  describe(`the ${lookup.name} per-item lookup`, () => {
    it('throws on a 500 that lasts through the retries, rather than saying "not there"', async () => {
      instantRetries();
      const { client, asked } = answering({ status: 500, body: 'database is locked' });

      await expect(lookup.ask(client)).rejects.toThrow(
        /refusing to treat this as "not present".*Cause: status 500: database is locked/,
      );
      expect(asked(), 'asked as often as a write would be').toBe(5);
    });

    it('rides out a busy server, as the writes do', async () => {
      instantRetries();
      const { client } = answering({ status: 503 }, { status: 207, body: lookup.found });

      expect(await lookup.ask(client)).toBeDefined();
    });

    it('throws on a 401 and on a 403, asking once, in words the failure categories read', async () => {
      for (const [status, category] of [
        [401, 'auth_expired'],
        [403, 'target_refused'],
      ] as const) {
        const { client, asked } = answering({ status, body: 'no' });
        const thrown = await lookup.ask(client).catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect(asked()).toBe(1);
        expect(classifyFailure((thrown as Error).message, 'target')).toBe(category);
      }
    });

    it('says "not there" on a 404', async () => {
      const { client } = answering({ status: 404 });
      expect(await lookup.ask(client)).toBeUndefined();
    });

    if (lookup.notMatching !== undefined) {
      it('says "not there" on a 207 that names no object with this UID', async () => {
        const { client } = answering({ status: 207, body: lookup.notMatching });
        expect(await lookup.ask(client)).toBeUndefined();
      });
    }
  });
}

describe('the WebDAV per-item lookup, when the request itself fails', () => {
  it('lets a transport error through, where it used to read as "File doesn\'t exist"', async () => {
    const { client } = answering(new Error('socket hang up'));
    await expect(LOOKUPS[2].ask(client)).rejects.toThrow(/socket hang up/);
  });

  it('still reads 200 as found, beside 207', async () => {
    const { client } = answering({ status: 200, body: aFile });
    expect(await LOOKUPS[2].ask(client)).toBe('report.pdf');
  });
});
