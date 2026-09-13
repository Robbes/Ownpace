// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The CalDAV filter, held to the two rules that cost something when broken.
 *
 * Both were paid for by the sibling code before this helper existed, which is
 * why they are asserted on the string rather than trusted to a reviewer:
 *
 *  1. RFC 4791 §9.5's content model is `(prop?, filter, timezone?)` — no
 *     question mark on `filter`. The CardDAV sibling shipped without one and
 *     Google answered `400 … Request contains an invalid argument`.
 *  2. RFC 4791 §9.7.1 makes sibling `comp-filter`s a CONJUNCTION. Naming three
 *     components describes a VCALENDAR containing all three, which is no
 *     object anybody has — and Sabre's PDO backend indexes on the first child,
 *     so it appears to work right up until a server that does not.
 */

import { describe, it, expect } from 'vitest';
import { caldavComponentFilter } from './caldav-query.ts';
import { CALENDAR_COMPONENTS } from './calendar.ts';

describe('the component filter matches one kind of object', () => {
  const filter = caldavComponentFilter('VEVENT', 'C');

  it('is a filter element at all — §9.5 does not make it optional', () => {
    expect(filter).toContain('<C:filter>');
    expect(filter).toContain('</C:filter>');
  });

  it('nests the component inside VCALENDAR, as §9.7 requires', () => {
    const names = [...filter.matchAll(/comp-filter name="(\w+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['VCALENDAR', 'VEVENT']);
  });

  it('names exactly ONE component, never a list of them', () => {
    for (const component of CALENDAR_COMPONENTS) {
      const names = [...caldavComponentFilter(component, 'C').matchAll(/comp-filter name="(\w+)"/g)]
        .map((m) => m[1]);
      // Two: the VCALENDAR wrapper and the component. A third would be the
      // conjunction bug.
      expect(names).toHaveLength(2);
      expect(names[1]).toBe(component);
    }
  });

  it('uses the prefix it was given, because the document declares it', () => {
    // A filter carrying a prefix the request never declared is not
    // well-formed, and the caller owns the declaration.
    expect(caldavComponentFilter('VTODO', 'CAL')).toContain('<CAL:comp-filter name="VTODO"/>');
    expect(caldavComponentFilter('VTODO', 'CAL')).not.toContain('<C:');
  });
});
