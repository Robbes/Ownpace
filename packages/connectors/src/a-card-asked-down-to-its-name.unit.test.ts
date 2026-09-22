// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CARD ASKED DOWN TO ITS NAME.
 *
 * `carddav-source` built its sync-collection REPORT like this:
 *
 *     const vcardVersionElement = ctag
 *       ? `<A:address-data …><A:prop>FN</A:prop><A:prop>UID</A:prop></A:address-data>`
 *       : '';
 *
 * The name says it declares a vCard version. The value asks the server for a
 * display name and an identifier AND NOTHING ELSE — no mail address, no phone
 * number, no postal address, no photo. It was emitted whenever the stored
 * cursor was a `ctag` rather than a sync-token.
 *
 * WHY THAT IS DATA LOSS AND NOT A THIN READ. `carddav-target-writer` PUTs
 * `raw.vcard` back verbatim — that is deliberate and it is why a migrated card
 * keeps every property this codebase has no model for. A card that arrives
 * carrying two properties is therefore WRITTEN carrying two properties, over a
 * card on the target that had twenty. The pass reports success, because
 * copying what it was given is exactly what it did.
 *
 * WHY NOBODY SAW IT. A first sync has no cursor, so it took the empty branch
 * and pulled whole cards. Every migration anybody watched was a first one, and
 * every one of them was right. The restriction could only reach a LATER pass —
 * over contacts already on the target, which is precisely where an incomplete
 * answer stops looking incomplete and starts looking like an update.
 *
 * The nesting was not valid CardDAV either (an `address-data` inside an
 * `address-data`), so the servers this ran against were free to ignore it, and
 * evidently did. That is luck, not a design: the request asked for something
 * the connector cannot use, and a stricter server would have been within its
 * rights to answer it exactly.
 *
 * SO THE RULE IS ABOUT THE REQUEST, NOT ABOUT ONE VARIABLE. Which cursor we
 * hold decides what we SEND as a token; it must never decide which fields we
 * ask for. Both passes are asserted to request the same thing, so the next
 * attempt to make a delta "cheaper" by narrowing the read has to come past
 * this test.
 */

import { describe, it, expect, vi } from 'vitest';
import { CarddavSource } from './carddav-source.ts';
import type { CardDAVSourceConfig } from './carddav-source.types.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import type { ContactFolder, SyncCursor } from '@openmig/shared';

const HOME = '/dav/addressbooks/user/test/';
const COLLECTION = `${HOME}default/`;

/** A card with rather more on it than a name. */
const FULL_CARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:card-1',
  'FN:Harm Cranenbroek',
  'EMAIL;TYPE=INTERNET:harm@example.invalid',
  'TEL;TYPE=CELL:+31600000000',
  'PHOTO;ENCODING=B:/9j/4AAQSkZJRg==',
  'END:VCARD',
].join('\r\n');

function multistatus(): HttpResponse {
  return {
    status: 207,
    body: `<?xml version="1.0" encoding="utf-8"?>
      <D:multistatus xmlns:D="DAV:" xmlns:A="urn:ietf:params:xml:ns:carddav">
        <D:response>
          <D:href>${COLLECTION}card-1.vcf</D:href>
          <D:propstat>
            <D:prop>
              <D:getetag>"etag-1"</D:getetag>
              <A:address-data>${FULL_CARD}</A:address-data>
            </D:prop>
            <D:status>HTTP/1.1 200 OK</D:status>
          </D:propstat>
        </D:response>
      </D:multistatus>`,
    headers: {},
  };
}

/** Every request body the connector sends, in order. */
function recordingClient(): { client: HttpClient; bodies: string[] } {
  const bodies: string[] = [];
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      if (typeof options.body === 'string') bodies.push(options.body);
      return multistatus();
    }),
  };
  return { client, bodies };
}

function sourceFor(client: HttpClient): CarddavSource {
  const config: CardDAVSourceConfig = {
    url: 'https://carddav.example.invalid/',
    username: 'test',
    password: 'test',
  } as CardDAVSourceConfig;
  const source = new CarddavSource(config, { httpClient: client });
  // The home set is discovery's job and has its own tests; this one is about
  // what the REPORT asks for.
  (source as unknown as { addressBookHomeSet: string }).addressBookHomeSet = HOME;
  return source;
}

const FOLDER: ContactFolder = { id: 'default', name: 'default', path: COLLECTION } as ContactFolder;

/** The sync-collection REPORT among everything the connector sent. */
function syncReport(bodies: readonly string[]): string {
  const report = bodies.find((b) => b.includes('sync-collection'));
  expect(report, 'the connector sent no sync-collection REPORT at all').toBeDefined();
  return report!;
}

describe('a card asked down to its name', () => {
  it('asks for the whole card on a first pass, with no cursor', async () => {
    const { client, bodies } = recordingClient();
    await sourceFor(client).listSince(FOLDER, undefined);
    expect(syncReport(bodies)).not.toMatch(/<[A-Za-z]+:prop>(FN|UID)<\//);
  });

  it('asks for the whole card on a CTAG pass too — the branch that lost data', async () => {
    const { client, bodies } = recordingClient();
    const cursor: SyncCursor = { value: `ctag:${COLLECTION}:"ctag-1"` };
    await sourceFor(client).listSince(FOLDER, cursor);
    const report = syncReport(bodies);
    expect(
      report,
      'a ctag pass asked for a property SUBSET. Whatever it leaves out is ' +
        'overwritten out of the card on the target, because the writer PUTs ' +
        'raw.vcard verbatim.',
    ).not.toMatch(/<[A-Za-z]+:prop>(FN|UID)<\//);
    // And not by nesting one address-data inside another, which is how the
    // restriction used to arrive.
    expect(report.match(/address-data/g) ?? []).toHaveLength(1);
  });

  it('sends the same request whichever cursor it holds', async () => {
    // The strongest form of the rule: the cursor changes the TOKEN, never the
    // fields. A future "cheaper delta" has to come past this.
    const first = recordingClient();
    await sourceFor(first.client).listSince(FOLDER, undefined);
    const ctag = recordingClient();
    await sourceFor(ctag.client).listSince(FOLDER, { value: `ctag:${COLLECTION}:"c"` });

    const strip = (b: string): string => b.replace(/<D:sync-token[^]*?\/?>/g, '').replace(/\s+/g, ' ');
    expect(strip(syncReport(ctag.bodies))).toBe(strip(syncReport(first.bodies)));
  });

  it('still brings the whole card through, so the rule is not vacuous', async () => {
    // Without this, a REPORT that asked for everything and a parser that kept
    // nothing would pass all three tests above.
    const { client } = recordingClient();
    const { items } = await sourceFor(client).listSince(FOLDER, undefined);
    expect(items).toHaveLength(1);
    const vcard = (items[0] as unknown as { vcard: string }).vcard;
    for (const property of ['EMAIL', 'TEL', 'PHOTO']) {
      expect(vcard, `the card reached the writer without ${property}`).toContain(property);
    }
  });
});
