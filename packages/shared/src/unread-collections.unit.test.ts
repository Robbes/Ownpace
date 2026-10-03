// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LINE A STATUS ROW CARRIES FOR A FOLDER THE PASS COULD NOT LIST
 * (2026-09-29; workplan 0055 T3 (e), the owner's "2a").
 *
 * One builder for both editions, so the appliance and the managed worker say
 * the same thing. What it must say is what the owner chose: which folder, what
 * the source answered, that the next pass asks again, and that nothing in it
 * is counted as deleted meanwhile.
 */

import { describe, it, expect } from 'vitest';
import {
  UNREAD_NOTE_NAMES,
  UNREAD_NOTE_PREFIX,
  unreadCollectionsNote,
  type UnreadCollection,
} from './unread-collections.ts';

const DROPBOX_500 = 'Dropbox answered 500 on files/list_folder: unexpected error occurred';

const unread = (name: string, over: Partial<UnreadCollection> = {}): UnreadCollection => ({
  collection: `/${name}`,
  name,
  error: DROPBOX_500,
  category: 'unknown',
  reference: 'aaaa1111',
  ...over,
});

describe('the note for collections a pass could not list', () => {
  it('is nothing when every collection was listed, which is what clears an earlier one', () => {
    expect(unreadCollectionsNote('file', [])).toBeUndefined();
  });

  it('names the one folder, quotes the source, and says what happens next', () => {
    expect(unreadCollectionsNote('file', [unread('Tax returns 2024')])).toEqual({
      note:
        'Not read on the last pass: the folder "Tax returns 2024". The source answered: ' +
        `${DROPBOX_500}. The next pass asks for it again, and nothing in it is counted as ` +
        'deleted until it is read.',
      category: 'unknown',
      reference: 'aaaa1111',
    });
  });

  it('counts several, names them, and carries the first one’s category and reference', () => {
    const said = unreadCollectionsNote('calendar', [
      unread('Team', { error: '403 Forbidden', category: 'source_refused', reference: 'bbbb2222' }),
      unread('Holidays', { reference: 'cccc3333' }),
    ]);
    expect(said).toEqual({
      note:
        'Not read on the last pass: 2 calendars, "Team" and "Holidays". The source answered: ' +
        '403 Forbidden. The next pass asks for them again, and nothing in them is counted as ' +
        'deleted until they are read.',
      category: 'source_refused',
      reference: 'bbbb2222',
    });
  });

  it('lists three with commas and an "and"', () => {
    const said = unreadCollectionsNote('contact', [unread('A'), unread('B'), unread('C')]);
    expect(said?.note).toContain('3 address books, "A", "B" and "C". ');
  });

  it(`names ${UNREAD_NOTE_NAMES} and counts the rest, from the first one past them`, () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const note = (n: number) => unreadCollectionsNote('email', names.slice(0, n).map((x) => unread(x)))?.note;
    expect(note(7)).toContain('7 folders, "A", "B", "C", "D", "E" and 2 more. ');
    expect(note(7)).not.toContain('"F"');
    expect(note(6)).toContain('6 folders, "A", "B", "C", "D", "E" and 1 more. ');
    expect(note(5)).toContain('5 folders, "A", "B", "C", "D" and "E". ');
  });

  it.each([
    ['email', 'the folder'],
    ['file', 'the folder'],
    ['calendar', 'the calendar'],
    ['contact', 'the address book'],
    ['task', 'the task list'],
  ] as const)('calls a %s collection %s', (domain, words) => {
    expect(unreadCollectionsNote(domain, [unread('X')])?.note).toContain(`: ${words} "X". `);
  });

  it('closes the source’s words with one full stop, and says so when it said nothing', () => {
    expect(unreadCollectionsNote('file', [unread('X', { error: 'It broke.' })])?.note).toContain(
      'The source answered: It broke. The next pass',
    );
    expect(unreadCollectionsNote('file', [unread('X', { error: '  ' })])?.note).toContain(
      'The source answered: nothing. The next pass',
    );
  });

  it('always begins the same way, which is how a later pass finds it to clear it', () => {
    for (const n of [1, 2, 9]) {
      const said = unreadCollectionsNote('task', Array.from({ length: n }, (_, i) => unread(`L${i}`)));
      expect(said?.note.startsWith(UNREAD_NOTE_PREFIX)).toBe(true);
    }
    // No LIKE wildcard in it, so the store's `LIKE prefix%` matches only itself.
    expect(UNREAD_NOTE_PREFIX).not.toMatch(/[%_\\]/);
  });
});
