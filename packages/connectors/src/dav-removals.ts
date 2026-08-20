// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Objects a CalDAV/CardDAV server has told us are GONE.
 *
 * RFC 6578 `sync-collection` does not only report what changed — it reports what
 * was removed, as a `<response>` carrying the object's href and a 404 status:
 *
 *   <d:response>
 *     <d:href>/calendars/alice/personal/evt-1.ics</d:href>
 *     <d:status>HTTP/1.1 404 Not Found</d:status>
 *   </d:response>
 *
 * Both DAV sources have been issuing that REPORT and throwing these away
 * (`if (!calendarDataMatch) continue`), which meant the strongest deletion signal
 * available anywhere in the product was arriving on every incremental pass and
 * being discarded. Everything else has to INFER deletion from absence, which has
 * a dozen innocent causes and can never be trusted enough to act on. This is the
 * source saying it outright.
 *
 * Shared by both sources rather than written twice, because the one subtlety
 * below is easy to get wrong and a difference between the two would be a
 * difference in when data is reported as deleted.
 */

/**
 * The hrefs a multistatus body reports as removed.
 *
 * THE SUBTLETY: a 404 means two completely different things depending on where
 * it sits.
 *
 *   - Directly under `<response>`, it is about the RESOURCE: it is gone.
 *   - Inside `<propstat>`, it is about a PROPERTY: the resource is fine, the
 *     server just has no value for something we asked about. Servers do this
 *     routinely — ask for `calendar-data` on a collection and you get exactly
 *     that shape.
 *
 * Reading the second as the first would report every object whose property
 * lookup partially failed as deleted. So propstat blocks are stripped before
 * looking for a status at all.
 *
 * Deliberately tolerant of namespace prefixes: a server is never obliged to echo
 * back the prefixes we sent, and Nextcloud/sabre-dav demonstrably does not (see
 * `extractHrefProperty` in caldav-source.ts, which this project already had to
 * learn once).
 */
export function parseRemovedHrefs(body: string): string[] {
  const removed: string[] = [];
  const responseRegex = /<[A-Za-z][\w-]*:response[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:response>/gi;

  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(body)) !== null) {
    const responseXml = match[1];
    if (!responseXml) continue;

    // Strip every propstat first. What is left is the response's own level, so a
    // status found below is about the RESOURCE and not about one property of it.
    const responseLevel = responseXml.replace(
      /<[A-Za-z][\w-]*:propstat[^>]*>[\s\S]*?<\/[A-Za-z][\w-]*:propstat>/gi,
      '',
    );

    const statusMatch = responseLevel.match(
      /<[A-Za-z][\w-]*:status[^>]*>([^<]*)<\/[A-Za-z][\w-]*:status>/i,
    );
    if (!statusMatch?.[1]) continue;
    // 404 specifically, not "any 4xx". A 403 means we may not look at it, which
    // says nothing about whether it exists; a 410 Gone would be a removal too but
    // no DAV server in scope sends it for this, and guessing at statuses nobody
    // sends is how a parser acquires behaviour nothing tests.
    if (!/\b404\b/.test(statusMatch[1])) continue;

    const hrefMatch = responseXml.match(
      /<[A-Za-z][\w-]*:href>([^<]+)<\/[A-Za-z][\w-]*:href>/i,
    );
    const href = hrefMatch?.[1]?.trim();
    // A removal report with no href is unusable — there is nothing to match it
    // against — so it is dropped rather than turned into a guess.
    if (href) removed.push(href);
  }

  return removed;
}
