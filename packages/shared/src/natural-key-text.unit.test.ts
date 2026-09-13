// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The plain-text natural key and the hashed one describe the SAME item.
 *
 * These functions exist so the confirmed list can name a row (`hash.ts`, and
 * the §17 argument in `confirmed-list.ts`). They are useless — worse, actively
 * misleading — if the text names one item and the key anchors another, which is
 * exactly the drift `caldav-target-writer.ts` already paid for once when two
 * producers of a task key disagreed and every task got two ledger rows.
 *
 * So the pin is a RELATIONSHIP, not an equality: normalising the text the way
 * its own hash function normalises reproduces the hash, for every domain. That
 * survives a later change to either side only if both change together.
 */

import { describe, it, expect } from 'vitest';
import {
  calendarNaturalKeyHash,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
  naturalKeyForCalendar,
  naturalKeyForItem,
  naturalKeyForTask,
  naturalKeyHash,
  naturalKeyTextForCalendar,
  naturalKeyTextForContact,
  naturalKeyTextForFile,
  naturalKeyTextForItem,
  naturalKeyTextForTask,
  taskNaturalKeyHash,
} from './hash.ts';
import type { MailItem } from './mail.ts';
import type { CalendarEvent } from './calendar.ts';
import type { Contact } from './contact.ts';
import type { FileItem } from './file.ts';

const mail = { messageId: '<CAF=Whatever@mail.example.invalid>' } as MailItem;
const event = { uid: 'EVT-ABC-123' } as CalendarEvent;
const exception = { uid: 'EVT-ABC-123', recurrenceId: '20260912T090000Z' } as CalendarEvent;
const card = { uid: 'b3f1c0de-1111-4222-8333-444455556666' } as Contact;
const file = { path: 'Wieke/Foto shoot Emma/DSC_0042.jpg' } as FileItem;

describe('the text reproduces the key it is paired with', () => {
  it('mail: the Message-ID hashes to the same anchor', () => {
    expect(naturalKeyHash(naturalKeyTextForItem(mail))).toBe(naturalKeyForItem(mail));
  });

  it('calendar: series and modified occurrence alike', () => {
    expect(calendarNaturalKeyHash(naturalKeyTextForCalendar(event))).toBe(
      naturalKeyForCalendar(event),
    );
    expect(calendarNaturalKeyHash(naturalKeyTextForCalendar(exception))).toBe(
      naturalKeyForCalendar(exception),
    );
  });

  it('task: through its OWN prefix, not the calendar one', () => {
    expect(taskNaturalKeyHash(naturalKeyTextForTask(exception))).toBe(
      naturalKeyForTask(exception),
    );
    // The thing that would make this vacuous: if `todo:` and `cal:` agreed, a
    // VTODO and a VEVENT sharing a UID would collide in the ledger (0113).
    expect(naturalKeyForTask(event)).not.toBe(naturalKeyForCalendar(event));
  });

  it('contact and file: verbatim, because their hashes are', () => {
    expect(contactNaturalKeyHash(naturalKeyTextForContact(card))).toBe(
      contactNaturalKeyHash(card.uid),
    );
    expect(fileNaturalKeyHash(naturalKeyTextForFile(file))).toBe(fileNaturalKeyHash(file.path));
  });
});

describe('what the text says that the hash cannot', () => {
  it('tells a modified occurrence from its series', () => {
    // Without RECURRENCE-ID every exception in a series would show one
    // identifier, and the list could not tell a person which one is missing.
    expect(naturalKeyTextForCalendar(event)).toBe('EVT-ABC-123');
    expect(naturalKeyTextForCalendar(exception)).toBe('EVT-ABC-123|20260912T090000Z');
  });

  it('keeps the case the server gave, though the calendar hash folds it', () => {
    const shouty = { uid: 'Evt-AbC-123' } as CalendarEvent;
    // What a person searches their old account for is the string they were
    // shown, not a lowercased one.
    expect(naturalKeyTextForCalendar(shouty)).toBe('Evt-AbC-123');
    // And the key still anchors both spellings to one item, per RFC 5545.
    expect(naturalKeyForCalendar(shouty)).toBe(naturalKeyForCalendar(event));
  });

  it('strips the angle brackets a Message-ID is written in', () => {
    expect(naturalKeyTextForItem(mail)).toBe('CAF=Whatever@mail.example.invalid');
  });

  it('gives a task the SAME text as an event — only the hash is prefixed', () => {
    // Deliberate: the row's `domain` column is what says which one this is, and
    // a `todo:` in the text would show somebody a string their calendar server
    // has never heard of.
    expect(naturalKeyTextForTask(exception)).toBe(naturalKeyTextForCalendar(exception));
  });
});
