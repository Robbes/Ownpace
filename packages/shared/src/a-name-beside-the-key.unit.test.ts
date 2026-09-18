// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The name a person calls an item, bounded and beside the key.
 *
 * The owner, on sight of the confirmed list (2026-09-17): *"Why not show
 * calander item names and contact names?"* — and, the same evening, chasing two
 * contacts a live Nextcloud had refused: *"I can not find these contacts, or
 * atleast i do no know how."* Both screens were showing him a UID.
 *
 * `displayNameFor*` is the answer and it is deliberately small: field
 * selection, plus one bounding rule. What is worth pinning is the bounding
 * rule, because every way it can go wrong shows up on a table somebody
 * reconciles their old account against.
 */

import { describe, it, expect } from 'vitest';
import {
  DISPLAY_NAME_LIMIT,
  boundDisplayName,
  displayNameForCalendar,
  displayNameForContact,
  displayNameForTask,
  naturalKeyTextForCalendar,
  naturalKeyTextForContact,
} from './hash.ts';
import type { CalendarEvent } from './calendar.ts';
import type { Contact } from './contact.ts';

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    uid: 'urn:uuid:8f2bc0de-1111-4222-8333-444455556666',
    summary: 'Tandarts',
    start: '2026-09-18T09:00:00.000Z',
    end: '2026-09-18T09:30:00.000Z',
    ...over,
  }) as CalendarEvent;

const contact = (over: Partial<Contact> = {}): Contact =>
  ({
    uid: '926caf98adce563',
    name: 'Jan Jansen',
    vcard: 'BEGIN:VCARD\r\nEND:VCARD',
    ...over,
  }) as Contact;

describe('the name is the one the person typed', () => {
  it('a calendar event answers with its SUMMARY', () => {
    expect(displayNameForCalendar(event())).toBe('Tandarts');
  });

  it('a task answers the same way — a to-do UID is no more readable', () => {
    expect(displayNameForTask(event({ summary: 'Belastingaangifte' }))).toBe('Belastingaangifte');
  });

  it("a contact answers with its FN", () => {
    expect(displayNameForContact(contact())).toBe('Jan Jansen');
  });
});

describe('beside the key, never instead of it', () => {
  it('the key is untouched, and the two are different strings', () => {
    // The whole design: the key identifies the row, the name labels it. A
    // helper that returned the name where the key was expected would break
    // every lookup in the product.
    const e = event();
    expect(naturalKeyTextForCalendar(e)).toBe(e.uid);
    expect(displayNameForCalendar(e)).not.toBe(naturalKeyTextForCalendar(e));

    const c = contact();
    expect(naturalKeyTextForContact(c)).toBe(c.uid);
    expect(displayNameForContact(c)).not.toBe(naturalKeyTextForContact(c));
  });

  it('two people with the same name keep two different keys', () => {
    // A name is not unique and must never be treated as one.
    const a = contact({ uid: 'aaa', name: 'Jan Jansen' });
    const b = contact({ uid: 'bbb', name: 'Jan Jansen' });
    expect(displayNameForContact(a)).toBe(displayNameForContact(b));
    expect(naturalKeyTextForContact(a)).not.toBe(naturalKeyTextForContact(b));
  });
});

describe('nothing to say is said as nothing', () => {
  it('undefined stays undefined', () => {
    expect(boundDisplayName(undefined)).toBeUndefined();
  });

  it('an empty or whitespace-only name is not a name', () => {
    // `undefined` rather than `''` so the ledger leaves the column alone: `''`
    // travelling down would blank a name an earlier pass recorded.
    expect(boundDisplayName('')).toBeUndefined();
    expect(boundDisplayName('   ')).toBeUndefined();
    expect(boundDisplayName('\r\n\t ')).toBeUndefined();
  });
});

describe('one line, however it arrived', () => {
  it('collapses a newline a badly un-folded SUMMARY carried in', () => {
    // RFC 5545 folds long lines, and more than one source in this repo un-folds
    // them with a line-anchored regex. A name that breaks a table row is a name
    // that makes the table harder to read than the UID it replaced.
    expect(boundDisplayName('Tandarts\r\n  controle')).toBe('Tandarts controle');
  });

  it('collapses runs of spaces and tabs, and trims the ends', () => {
    expect(boundDisplayName('  Jan\t\tJansen  ')).toBe('Jan Jansen');
  });
});

describe('bounded, and cut where a character ends', () => {
  it('keeps a name that fits, exactly as it is', () => {
    const fits = 'x'.repeat(DISPLAY_NAME_LIMIT);
    expect(boundDisplayName(fits)).toBe(fits);
  });

  it('cuts a longer one and says it was cut', () => {
    const long = 'y'.repeat(DISPLAY_NAME_LIMIT + 50);
    const bounded = boundDisplayName(long)!;
    expect([...bounded]).toHaveLength(DISPLAY_NAME_LIMIT + 1);
    expect(bounded.endsWith('…')).toBe(true);
  });

  it('never leaves half a character behind', () => {
    // An emoji in a calendar title is ordinary, and it is two code UNITS. A
    // `slice` at the limit can land between them and produce a lone surrogate,
    // which renders as a replacement box on the one document somebody
    // reconciles their old account against.
    const emoji = '\u{1F382}'; // birthday cake, one code point, two code units
    const bounded = boundDisplayName(emoji.repeat(DISPLAY_NAME_LIMIT + 10))!;
    expect(bounded).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    expect(bounded).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    expect([...bounded]).toHaveLength(DISPLAY_NAME_LIMIT + 1);
  });
});
