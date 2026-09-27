// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOMAIN THAT WAITS ITS TURN (workplan 0143 T5, the owner's choice (c)).
 *
 * Every data type of a pass was handed the same deadline, in the order the
 * mapping listed them. A first copy of a large Microsoft 365 mailbox then took
 * every pass, and the contacts, calendars and files behind it did not start
 * until the mail was done, which can be days. The owner chose: the small data
 * types first, then a fair share of what is left.
 *
 * - `passOrder` takes contacts, calendars and tasks before mail and files,
 *   whatever order they came in;
 * - `domainDeadline` hands a type the time left divided by the types left, so
 *   the first of two gets no more than half, the last gets whatever remains,
 *   and time a type does not use flows to the ones after it;
 * - no type is ever handed a moment past the pass's own deadline.
 *
 * It fails today: neither function exists.
 */

import { describe, it, expect } from 'vitest';
import { passOrder, domainDeadline, PASS_ORDER, passDeadlineFrom } from './pass-deadline.ts';

const MINUTE = 60_000;

describe('the order a pass takes its data types in', () => {
  it('is the small ones first, then mail, then files, whatever order they came in', () => {
    expect(passOrder(['file', 'email', 'calendar', 'contact', 'task'])).toEqual([
      'contact',
      'calendar',
      'task',
      'email',
      'file',
    ]);
    expect(PASS_ORDER).toEqual(['contact', 'calendar', 'task', 'email', 'file']);
  });

  it('keeps only the types it was given', () => {
    expect(passOrder(['file', 'email'])).toEqual(['email', 'file']);
    expect(passOrder(['task'])).toEqual(['task']);
    expect(passOrder([])).toEqual([]);
  });

  it('puts a type it does not know last, in the order it came, and changes nothing it was given', () => {
    const given = ['notes', 'file', 'contact', 'photos'] as const;
    expect(passOrder(given)).toEqual(['contact', 'file', 'notes', 'photos']);
    expect(given).toEqual(['notes', 'file', 'contact', 'photos']);
  });
});

describe('the deadline a data type is handed', () => {
  const start = Date.UTC(2026, 8, 27, 22, 0, 0);
  const pass = passDeadlineFrom(start);

  it('is no later than half-way for the first of two', () => {
    const first = domainDeadline(pass, start, 2);
    expect(first).toBeLessThanOrEqual(start + (pass - start) / 2);
    expect(first).toBeGreaterThan(start);
  });

  it('is the pass deadline itself for the last one', () => {
    expect(domainDeadline(pass, start + 7 * MINUTE, 1)).toBe(pass);
  });

  it('is never past the pass deadline, whenever it is asked and however many are left', () => {
    for (const typesLeft of [0, 1, 2, 3, 4, 5, 9, Number.NaN]) {
      for (const now of [start, start + 13 * MINUTE, pass - 1, pass, pass + MINUTE]) {
        expect(domainDeadline(pass, now, typesLeft), `${typesLeft} left at ${now - start}ms`).toBeLessThanOrEqual(pass);
      }
    }
  });

  it('gives the time a small type did not use to the ones after it', () => {
    // Five types in a 50-minute pass. Contacts, calendars and tasks finish in
    // four minutes between them, so mail and files share the other 46.
    const types = passOrder(['file', 'email', 'calendar', 'contact', 'task']);
    const used: Record<string, number> = { contact: 1 * MINUTE, calendar: 2 * MINUTE, task: 1 * MINUTE };
    let now = start;
    const handed: Record<string, number> = {};
    for (const [index, type] of types.entries()) {
      handed[type] = domainDeadline(pass, now, types.length - index);
      // A small type stops when it is done; mail and files use all they are given.
      now = used[type] !== undefined ? now + used[type]! : handed[type]!;
    }
    expect(handed.contact).toBe(start + 10 * MINUTE);
    expect(handed.email).toBe(start + 4 * MINUTE + 23 * MINUTE);
    expect(handed.file).toBe(pass);
  });
});
