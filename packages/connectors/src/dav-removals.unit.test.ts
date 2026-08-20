// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Reading RFC 6578 removal reports out of a `sync-collection` response.
 *
 * This is the strongest deletion signal the product has access to, and it has
 * been arriving on every incremental CalDAV/CardDAV pass and being discarded.
 * Everything else infers deletion from absence, which has a dozen innocent
 * causes; this is the source saying so outright.
 *
 * Which makes the one distinction below load-bearing: a 404 under `<response>`
 * says the RESOURCE is gone, and a 404 inside `<propstat>` says a PROPERTY has no
 * value. Servers send the second routinely. Confusing them would report live
 * objects as deleted.
 */

import { describe, it, expect } from 'vitest';
import { parseRemovedHrefs } from './dav-removals.ts';

/** A response for an object that is still there, with its data. */
function present(href: string): string {
  return `<d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1"</d:getetag>
        <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt
END:VEVENT
END:VCALENDAR</cal:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
}

/** A response for an object the server says is gone. */
function removed(href: string): string {
  return `<d:response>
    <d:href>${href}</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>`;
}

function multistatus(...responses: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  ${responses.join('\n')}
  <d:sync-token>http://example.com/ns/sync/42</d:sync-token>
</d:multistatus>`;
}

describe('parseRemovedHrefs', () => {
  it('finds the removed object and ignores the live one', () => {
    const body = multistatus(present('/cal/alice/personal/a.ics'), removed('/cal/alice/personal/b.ics'));
    expect(parseRemovedHrefs(body)).toEqual(['/cal/alice/personal/b.ics']);
  });

  it('does NOT read a 404 inside propstat as a removal', () => {
    // The one that matters. A server asked for a property it has no value for
    // answers 404 INSIDE propstat — the resource is perfectly fine. Reading that
    // as a deletion would report live objects as gone, which is the single worst
    // thing this parser could do.
    const body = multistatus(`<d:response>
      <d:href>/cal/alice/personal/alive.ics</d:href>
      <d:propstat>
        <d:prop><cal:calendar-data/></d:prop>
        <d:status>HTTP/1.1 404 Not Found</d:status>
      </d:propstat>
      <d:propstat>
        <d:prop><d:getetag>"e1"</d:getetag></d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`);
    expect(parseRemovedHrefs(body)).toEqual([]);
  });

  it('finds a removal even when the same response also carries a propstat', () => {
    // Belt and braces on the stripping: the response-level 404 must still be
    // found after the propstat has been removed, not lost with it.
    const body = multistatus(`<d:response>
      <d:href>/cal/alice/personal/gone.ics</d:href>
      <d:propstat>
        <d:prop><cal:calendar-data/></d:prop>
        <d:status>HTTP/1.1 404 Not Found</d:status>
      </d:propstat>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:response>`);
    expect(parseRemovedHrefs(body)).toEqual(['/cal/alice/personal/gone.ics']);
  });

  it('tolerates whatever namespace prefix the server chose', () => {
    // A server is never obliged to echo back the prefixes we sent, and
    // Nextcloud/sabre-dav demonstrably does not — a lesson this project already
    // paid for once in `extractHrefProperty`.
    const body = `<?xml version="1.0"?>
      <D:multistatus xmlns:D="DAV:">
        <D:response>
          <D:href>/cards/alice/contacts/x.vcf</D:href>
          <D:status>HTTP/1.1 404 Not Found</D:status>
        </D:response>
      </D:multistatus>`;
    expect(parseRemovedHrefs(body)).toEqual(['/cards/alice/contacts/x.vcf']);
  });

  it('ignores statuses that are not 404', () => {
    // A 403 means we may not look at it, which says nothing about whether it
    // exists. Treating "any 4xx" as a deletion would turn a permissions change
    // into a report that the owner's data is gone.
    const body = multistatus(`<d:response>
      <d:href>/cal/alice/private/secret.ics</d:href>
      <d:status>HTTP/1.1 403 Forbidden</d:status>
    </d:response>`);
    expect(parseRemovedHrefs(body)).toEqual([]);
  });

  it('drops a removal report with no href', () => {
    // Unusable: there is nothing to match it against. Dropped rather than turned
    // into a guess about which item was meant.
    const body = multistatus(`<d:response>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:response>`);
    expect(parseRemovedHrefs(body)).toEqual([]);
  });

  it('returns nothing for a body with no removals at all', () => {
    expect(parseRemovedHrefs(multistatus(present('/cal/a.ics'), present('/cal/b.ics')))).toEqual([]);
    expect(parseRemovedHrefs('')).toEqual([]);
  });

  it('finds every removal in a batch', () => {
    const body = multistatus(
      removed('/cal/a.ics'),
      present('/cal/b.ics'),
      removed('/cal/c.ics'),
      removed('/cal/d.ics'),
    );
    expect(parseRemovedHrefs(body)).toEqual(['/cal/a.ics', '/cal/c.ics', '/cal/d.ics']);
  });
});
