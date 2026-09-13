// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The CalDAV REPORT that lists a calendar when `sync-collection` will not.
 *
 * RFC 6578 `sync-collection` is an OPTIMISATION: it answers "what changed
 * since this token". RFC 4791 §7.8 `calendar-query` is the enumeration every
 * CalDAV server must support, and it answers "everything that matches". The
 * source had only the first, so a server that answered it with nothing left
 * the domain reporting an empty calendar — which is what happened to five real
 * Google calendars on 2026-09-12, while the sibling CardDAV source, which HAS
 * this fallback, read 1,227 cards from the same account on the same pass.
 *
 * Two traps are already paid for elsewhere in this repo and are not paid again
 * here:
 *
 *  1. **`<C:filter>` is not optional.** RFC 4791 §9.5's content model is
 *     `(prop?, filter, timezone?)` — no question mark. The CardDAV sibling
 *     shipped without its filter and Google answered `400 … Request contains
 *     an invalid argument`, which is how a connection card came to read
 *     "Contacts — not measured".
 *  2. **Sibling `comp-filter`s are a CONJUNCTION, not a union.** RFC 4791
 *     §9.7.1. Naming VEVENT, VTODO and VJOURNAL together describes "a
 *     VCALENDAR containing all three", which is no object anybody has. Sabre's
 *     PDO backend indexes on the FIRST child and so appears to work, which hid
 *     it for four domains and one workplan until the task domain met a real
 *     server and every migrated VTODO was reported missing
 *     (`caldav-target-writer.ts` records that run).
 *
 * So: exactly one component per query, the caller's own.
 */

import type { CalendarComponent } from './calendar.ts';

/**
 * A CALDAV:filter matching every object of one component kind.
 *
 * `prefix` is the caller's namespace prefix for `urn:ietf:params:xml:ns:caldav`
 * — passed rather than assumed, because the request document chooses it and a
 * filter carrying a prefix the document never declared is not well-formed.
 */
export function caldavComponentFilter(component: CalendarComponent, prefix: string): string {
  const p = `${prefix}:`;
  return `<${p}filter>
          <${p}comp-filter name="VCALENDAR">
            <${p}comp-filter name="${component}"/>
          </${p}comp-filter>
        </${p}filter>`;
}
