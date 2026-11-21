// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `MarkedOnly`, on its own (workplan 0162 T2): the rule, the titles it reads,
 * what a listing keeps and counts, and every optional method a caller asks for
 * by name.
 *
 * Through the real domain passes, where the cursor, the collections and the
 * deletions are decided, it is `a-test-migration-copies-only-what-is-marked`;
 * a file renamed out of the marker, through the real Drive source, is
 * `a-file-renamed-out-of-the-marker`. This file holds the parts that need
 * neither a loop nor a server.
 */

import { describe, it, expect } from 'vitest';
import type {
  CalendarFolder,
  CalendarSource,
  ContactFolder,
  ContactSource,
  FileFolder,
  FileSource,
  MailFolder,
  MailItem,
  PermissionGrant,
  PermissionListing,
  RawCalendarEvent,
  RawContact,
  RawFileItem,
  SourceConnector,
  TrashListing,
} from '@openmig/shared';
import {
  MarkedOnlyCalendar,
  MarkedOnlyContacts,
  MarkedOnlyFiles,
  MarkedOnlyMail,
  calendarTitles,
  carriesMarker,
  contactTitle,
  fileTitle,
  isMarkedOnly,
  markedOnlyCalendar,
  markedOnlyContacts,
  markedOnlyFiles,
  markedOnlyMail,
  markedSharesOnly,
} from './marked-only.ts';

const MARKER = '[Ownpace-test]';

describe('the rule: the marker anywhere in the item’s own title, ignoring case (§2 (a))', () => {
  it('finds it at the start, inside, and after a reply’s prefix', () => {
    expect(carriesMarker('[Ownpace-test] Plan', MARKER)).toBe(true);
    expect(carriesMarker('Plan [Ownpace-test] v2', MARKER)).toBe(true);
    expect(carriesMarker('Re: [Ownpace-test] Plan', MARKER)).toBe(true);
    expect(carriesMarker('Fwd: Re: [Ownpace-test]', MARKER)).toBe(true);
  });

  it('ignores case, in the title and in the marker', () => {
    expect(carriesMarker('[OWNPACE-TEST] Plan', MARKER)).toBe(true);
    expect(carriesMarker('[ownpace-test] plan', MARKER)).toBe(true);
    expect(carriesMarker('[Ownpace-test] Plan', '[OWNPACE-test]')).toBe(true);
  });

  it('reads a composed and a decomposed letter as the same letter', () => {
    expect(carriesMarker('Café [Test-é]', '[test-é]')).toBe(true);
  });

  it('is not fooled by a near miss, and reads no title as no marker', () => {
    expect(carriesMarker('Ownpace-test Plan', MARKER)).toBe(false);
    expect(carriesMarker('[Ownpace test] Plan', MARKER)).toBe(false);
    expect(carriesMarker('', MARKER)).toBe(false);
    expect(carriesMarker(undefined, MARKER)).toBe(false);
  });

  it('refuses a marker that would select nearly everything, rather than using it', () => {
    const inner = { listFolders: async () => [], listSince: async () => ({ items: [], nextCursor: { value: '' } }) };
    for (const marker of ['', 'ab', '   ', ' a ']) {
      expect(() => new MarkedOnlyCalendar(inner, marker), JSON.stringify(marker)).toThrow(/fewer than three/);
    }
  });

  it('leaves a source as it is when the mapping carries no marker', () => {
    const mail = { listFolders: async () => [], listSince: async () => ({ items: [], nextCursor: { value: '' } }), fetch: async () => ({}) } as unknown as SourceConnector;
    expect(markedOnlyMail(mail, null)).toBe(mail);
    expect(markedOnlyMail(mail, undefined)).toBe(mail);
    const cal = mail as unknown as CalendarSource;
    expect(markedOnlyCalendar(cal, null)).toBe(cal);
    expect(markedOnlyContacts(cal as unknown as ContactSource, null)).toBe(cal);
    expect(markedOnlyFiles(cal as unknown as FileSource, null)).toBe(cal);
    expect(isMarkedOnly(markedOnlyMail(mail, MARKER))).toBe(true);
    expect(isMarkedOnly(mail)).toBe(false);
  });
});

/** A calendar object, CRLF and all, from its components' lines. */
const ics = (...components: string[][]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//example.test//EN', ...components.flat(), 'END:VCALENDAR'].join('\r\n') + '\r\n';
const vevent = (...lines: string[]): string[] => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const raw = (uid: string, icalendar: string, extra: Partial<RawCalendarEvent['item']> = {}): RawCalendarEvent => ({
  item: { uid, type: 'event', summary: 'as the source read it', start: '2026-11-20T10:00:00Z', sourcePath: `/cal/${uid}.ics`, icalendar, ...extra },
  icalendar,
});

describe('an event’s title is its SUMMARY, and a series is its master’s', () => {
  it('reads a SUMMARY with parameters, folded across lines, and escaped', () => {
    const titles = calendarTitles([
      raw('a', ics(vevent('UID:a', 'SUMMARY;LANGUAGE=en:Plan \\, with [Ownpace-test]'))),
      raw('b', ics(vevent('UID:b', 'SUMMARY:A long title that a server folded [Ownpace-t', ' est] at seventy-five octets'))),
      raw('c', ics(vevent('UID:c', 'SUMMARY;X-PARAM="a:b":[Ownpace-test] quoted colon'))),
    ]);
    expect(titles).toEqual([
      'Plan , with [Ownpace-test]',
      'A long title that a server folded [Ownpace-test] at seventy-five octets',
      '[Ownpace-test] quoted colon',
    ]);
  });

  it('does not take an alarm’s SUMMARY for the event’s', () => {
    const [title] = calendarTitles([
      raw('a', ics(vevent('UID:a', 'BEGIN:VALARM', 'ACTION:EMAIL', 'SUMMARY:[Ownpace-test] reminder', 'END:VALARM', 'SUMMARY:Dentist'))),
    ]);
    expect(title).toBe('Dentist');
  });

  it('decides a series in one object by its master, wherever the master stands, and its override goes with it', () => {
    const series = (master: string, moved: string, masterFirst: boolean) => {
      const m = vevent('UID:weekly', `SUMMARY:${master}`, 'RRULE:FREQ=WEEKLY');
      const o = vevent('UID:weekly', 'RECURRENCE-ID:20261127T100000Z', `SUMMARY:${moved}`);
      return raw('weekly', masterFirst ? ics(m, o) : ics(o, m));
    };
    expect(calendarTitles([series('[Ownpace-test] Standup', 'Standup (moved)', true)])).toEqual(['[Ownpace-test] Standup']);
    expect(calendarTitles([series('Standup', '[Ownpace-test] moved', true)])).toEqual(['Standup']);
    expect(calendarTitles([series('[Ownpace-test] Standup', 'moved', false)])).toEqual(['[Ownpace-test] Standup']);
  });

  it('gives an exception listed apart from its series its series’ title, when its series is in the listing', () => {
    // Microsoft's calendar lists an exception as an item of its own.
    const master = raw('Series-1', ics(vevent('UID:Series-1', 'SUMMARY:[Ownpace-test] Standup', 'RRULE:FREQ=WEEKLY')));
    const exception = raw('series-1', ics(vevent('UID:series-1', 'RECURRENCE-ID:20261127T100000Z', 'SUMMARY:Standup moved')), {
      recurrenceId: '20261127T100000Z',
    });
    expect(calendarTitles([exception, master])).toEqual(['[Ownpace-test] Standup', '[Ownpace-test] Standup']);
  });

  it('decides an override listed without its series by its own SUMMARY, the only title there is', () => {
    const lone = raw('lone', ics(vevent('UID:lone', 'RECURRENCE-ID:20261127T100000Z', 'SUMMARY:[Ownpace-test] one occurrence')));
    expect(calendarTitles([lone])).toEqual(['[Ownpace-test] one occurrence']);
  });

  it('takes the source’s own reading where the text holds no component', () => {
    expect(calendarTitles([raw('x', 'not a calendar', { summary: '[Ownpace-test] from the API' })])).toEqual([
      '[Ownpace-test] from the API',
    ]);
  });
});

const card = (uid: string, vcard: string, name = 'as the source read it'): RawContact => ({
  item: { uid, type: 'person', name, sourcePath: `/ab/${uid}.vcf`, vcard, version: '3.0' },
  vcard,
});

describe('a contact’s title is its FN', () => {
  it('reads FN with parameters, a group, folding and escapes, and nothing else', () => {
    const vcard = (...lines: string[]) => ['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].join('\r\n');
    expect(contactTitle(card('a', vcard('UID:a', 'N:Contact;Example;;;', 'FN;CHARSET=UTF-8:Example Contact [Ownpace-test]')))).toBe('Example Contact [Ownpace-test]');
    expect(contactTitle(card('b', vcard('UID:b', 'item1.FN:Grouped [Ownpace-test]')))).toBe('Grouped [Ownpace-test]');
    expect(contactTitle(card('c', vcard('UID:c', 'FN:Folded [Own', ' pace-test]')))).toBe('Folded [Ownpace-test]');
    expect(contactTitle(card('d', vcard('UID:d', 'FN:Contact\\, Example', 'NOTE:[Ownpace-test]')))).toBe('Contact, Example');
  });

  it('falls back to the source’s own name when the card has no FN', () => {
    expect(contactTitle(card('e', 'BEGIN:VCARD\r\nUID:e\r\nEND:VCARD', '[Ownpace-test] Named'))).toBe('[Ownpace-test] Named');
  });
});

describe('a file’s title is its own name, never its folder’s (§2 (a), open question 2)', () => {
  it('reads the name, or the path’s last segment', () => {
    const file = (path: string, name?: string) =>
      ({ path, isDirectory: false, size: 1, modifiedAt: '', sourceRef: path, ...(name !== undefined ? { name } : {}) });
    expect(fileTitle(file('[Ownpace-test] folder/plain.pdf', 'plain.pdf'))).toBe('plain.pdf');
    expect(fileTitle(file('Docs/[Ownpace-test] plan.pdf'))).toBe('[Ownpace-test] plan.pdf');
    expect(carriesMarker(fileTitle(file('[Ownpace-test] folder/plain.pdf')), MARKER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const INBOX: MailFolder = { path: 'INBOX', specialUse: 'inbox' };
const message = (n: number, subject: string | undefined, messageId = `<m${n}@example.test>`): MailItem => ({
  messageId,
  folder: INBOX,
  keywords: [],
  receivedAt: '2026-11-20T10:00:00.000Z',
  sourceRef: `INBOX:${n}`,
  ...(subject !== undefined ? { subject } : {}),
});

describe('mail', () => {
  const inner = (items: MailItem[], extra: Record<string, unknown> = {}) =>
    ({
      listFolders: async () => [INBOX],
      listSince: async () => ({ items, nextCursor: { value: 'c' }, ...extra }),
      fetch: async (item: MailItem) => ({ item, rfc822: new Uint8Array() }),
    }) as SourceConnector;

  it('keeps the marked messages, hands back the rest, and passes removals and the unlisted through untouched', async () => {
    const source = new MarkedOnlyMail(
      inner([message(1, '[Ownpace-test] a'), message(2, 'private'), message(3, undefined), message(4, 'Re: [ownpace-TEST] b')], {
        removed: ['INBOX:9', 'INBOX:10'],
        unlisted: 2,
      }),
      MARKER,
    );
    const listed = await source.listSince(INBOX);
    expect(listed.items.map((i) => i.sourceRef)).toEqual(['INBOX:1', 'INBOX:4']);
    // Handed back for their keys, which the loop asks of a removal or the bin.
    expect(listed.unmarked?.map((i) => i.sourceRef)).toEqual(['INBOX:2', 'INBOX:3']);
    expect(listed.removed).toEqual(['INBOX:9', 'INBOX:10']);
    expect(listed.unlisted).toBe(2);
    expect(listed.nextCursor).toEqual({ value: 'c' });
  });

  it('counts a message without an id only when it is kept, since it is promised a copy', async () => {
    const source = new MarkedOnlyMail(
      inner([message(1, '[Ownpace-test] a', ''), message(2, 'private', '')], { unkeyable: 2 }),
      MARKER,
    );
    const listed = await source.listSince(INBOX);
    expect(listed.unkeyable).toBe(1);
    const none = await new MarkedOnlyMail(inner([message(2, 'private', '')], { unkeyable: 1 }), MARKER).listSince(INBOX);
    expect(none.unkeyable).toBeUndefined();
    expect(none.unmarked?.map((i) => i.sourceRef)).toEqual(['INBOX:2']);
  });

  it('says nothing about setting aside when nothing was set aside', async () => {
    const listed = await new MarkedOnlyMail(inner([message(1, '[Ownpace-test] a')]), MARKER).listSince(INBOX);
    expect(listed).not.toHaveProperty('unmarked');
  });

  it('forwards the measures a caller asks for by name, bound to the source, and only those it has', async () => {
    class Measured {
      readonly folders = 7;
      listFolders = async () => [INBOX];
      listSince = async () => ({ items: [], nextCursor: { value: '' } });
      fetch = async (item: MailItem) => ({ item, rfc822: new Uint8Array() });
      async measureMailbox(options?: { sampleSize?: number }) {
        return { folders: this.folders, messages: 1, bytes: options?.sampleSize ?? 0, estimated: false };
      }
      async countMessages() {
        return { messages: 3 };
      }
    }
    const wrapped = new MarkedOnlyMail(new Measured(), MARKER);
    expect(await wrapped.measureMailbox?.({ sampleSize: 5 })).toEqual({ folders: 7, messages: 1, bytes: 5, estimated: false });
    expect(await wrapped.countMessages?.()).toEqual({ messages: 3 });

    const bare = new MarkedOnlyMail(inner([]), MARKER);
    expect('measureMailbox' in bare).toBe(false);
    expect('countMessages' in bare).toBe(false);
    expect(bare.markedOnly).toBe(true);
    expect(bare.marker).toBe(MARKER);
  });
});

describe('events and tasks', () => {
  const FOLDER: CalendarFolder = { path: '/cal/work/' };
  const inner = (items: RawCalendarEvent[], extra: Record<string, unknown> = {}): CalendarSource => ({
    listFolders: async () => [FOLDER],
    listSince: async () => ({ items, nextCursor: { value: 'token' }, ...extra }),
  });

  it('keeps the marked, hands back the rest, and passes removals and the unreadable through', async () => {
    const source = new MarkedOnlyCalendar(
      inner(
        [
          raw('a', ics(vevent('UID:a', 'SUMMARY:[Ownpace-test] Lunch'))),
          raw('b', ics(vevent('UID:b', 'SUMMARY:Dentist'))),
          raw('c', ics(['BEGIN:VTODO', 'UID:c', 'SUMMARY:[OWNPACE-TEST] a task', 'END:VTODO'])),
        ],
        { removed: ['/cal/work/gone.ics'], unreadable: 1 },
      ),
      MARKER,
    );
    const listed = await source.listSince(FOLDER);
    expect(listed.items.map((i) => i.item.uid)).toEqual(['a', 'c']);
    expect(listed.unmarked?.map((i) => i.item.uid)).toEqual(['b']);
    expect(listed.removed).toEqual(['/cal/work/gone.ics']);
    expect(listed.unreadable).toBe(1);
    expect(source.markedOnly).toBe(true);
  });
});

describe('contacts', () => {
  const FOLDER: ContactFolder = { path: '/ab/' };
  const vcard = (uid: string, fn: string) => `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:${fn}\r\nEND:VCARD`;

  it('keeps the marked cards and forwards `fetch` only when the source has one', async () => {
    const base: ContactSource = {
      listFolders: async () => [FOLDER],
      listSince: async () => ({
        items: [card('a', vcard('a', '[Ownpace-test] Jo')), card('b', vcard('b', 'Private Person'))],
        nextCursor: { value: 't' },
        removed: ['/ab/gone.vcf'],
      }),
    };
    const without = new MarkedOnlyContacts(base, MARKER);
    const listed = await without.listSince(FOLDER);
    expect(listed.items.map((i) => i.item.uid)).toEqual(['a']);
    expect(listed.unmarked?.map((i) => i.item.uid)).toEqual(['b']);
    expect(listed.removed).toEqual(['/ab/gone.vcf']);
    // The loop asks `source.fetch ? …`: a fetch with nothing behind it would
    // fail every card.
    expect(without.fetch).toBeUndefined();
    expect('fetch' in without).toBe(false);

    class WithPhotos {
      readonly photo = 'PHOTO';
      listFolders = base.listFolders;
      listSince = base.listSince;
      async fetch(item: RawContact) {
        return { ...item, vcard: `${item.vcard}\r\n${this.photo}` };
      }
    }
    const withFetch = new MarkedOnlyContacts(new WithPhotos(), MARKER);
    const full = await withFetch.fetch!(card('a', vcard('a', '[Ownpace-test] Jo')));
    expect(full.vcard.endsWith('PHOTO')).toBe(true);
  });

  it('carries what an inner wrapper set aside, beside its own, rather than dropping it', async () => {
    const base: ContactSource = {
      listFolders: async () => [FOLDER],
      listSince: async () => ({
        items: [card('a', vcard('a', '[Ownpace-test] Jo')), card('b', vcard('b', 'Private Person'))],
        nextCursor: { value: 't' },
      }),
    };
    const twice = new MarkedOnlyContacts(new MarkedOnlyContacts(base, MARKER), 'test] Jo');
    const listed = await twice.listSince(FOLDER);
    expect(listed.items.map((i) => i.item.uid)).toEqual(['a']);
    expect(listed.unmarked?.map((i) => i.item.uid)).toEqual(['b']);
    const narrower = await new MarkedOnlyContacts(new MarkedOnlyContacts(base, MARKER), 'Annabel').listSince(FOLDER);
    expect(narrower.items).toEqual([]);
    expect(narrower.unmarked?.map((i) => i.item.uid)).toEqual(['b', 'a']);
  });
});

describe('files', () => {
  const FOLDER: FileFolder = { path: 'Docs' };
  const file = (path: string): RawFileItem => ({
    item: { path, name: path.split('/').pop()!, isDirectory: false, size: 1, modifiedAt: '', sourceRef: `id:${path}` },
  });
  const listing = {
    items: [file('Docs/[Ownpace-test] plan.pdf'), file('Docs/taxes.pdf')],
    nextCursor: { value: 'full' },
    removed: ['id:gone'],
    listedElsewhere: 4,
  };

  class FullSource {
    readonly snapshot = true as const;
    listFolders = async () => [FOLDER];
    listSince = async () => listing;
    fetch = async (item: RawFileItem['item']) => ({ item, content: new Uint8Array([1]) });
    readonly keys = ['Docs/[Ownpace-test] plan.pdf', 'Docs/taxes.pdf'];
    async listKeys(_folder: FileFolder) {
      return this.keys;
    }
    async listTrashedPaths(): Promise<TrashListing> {
      return { paths: ['Docs/[Ownpace-test] old.pdf', 'Docs/private.pdf'], unnameable: 2, reason: 'no parent' };
    }
    nativeRefusals() {
      return { presentation: 2 };
    }
    async storageUsage() {
      return { bytes: 42 };
    }
    async listTopLevelFolders() {
      return { folders: [FOLDER], truncated: false };
    }
  }

  it('keeps the marked files, hands back the rest, and passes removals and what other folders yield through', async () => {
    const listed = await new MarkedOnlyFiles(new FullSource(), MARKER).listSince(FOLDER);
    expect(listed.items.map((i) => i.item.path)).toEqual(['Docs/[Ownpace-test] plan.pdf']);
    expect(listed.unmarked?.map((i) => i.item.path)).toEqual(['Docs/taxes.pdf']);
    expect(listed.removed).toEqual(['id:gone']);
    expect(listed.listedElsewhere).toBe(4);
  });

  it('answers `listKeys` with every path the folder holds, unfiltered', async () => {
    const wrapped = new MarkedOnlyFiles(new FullSource(), MARKER);
    expect(await wrapped.listKeys!(FOLDER)).toEqual(['Docs/[Ownpace-test] plan.pdf', 'Docs/taxes.pdf']);
  });

  it('reads the bin by name like a listing, and carries what it could not name as it came', async () => {
    const wrapped = new MarkedOnlyFiles(new FullSource(), MARKER);
    expect(await wrapped.listTrashedPaths!()).toEqual({
      paths: ['Docs/[Ownpace-test] old.pdf'],
      unnameable: 2,
      reason: 'no parent',
    });
  });

  it('forwards the snapshot, the refusal count and the measures, bound to the source', async () => {
    const wrapped = new MarkedOnlyFiles(new FullSource(), MARKER);
    expect(wrapped.snapshot).toBe(true);
    expect(wrapped.nativeRefusals!()).toEqual({ presentation: 2 });
    expect(await wrapped.storageUsage!()).toEqual({ bytes: 42 });
    expect(await wrapped.listTopLevelFolders!()).toEqual({ folders: [FOLDER], truncated: false });
  });

  it('has none of them where the source has none, so nothing asks a capability that is not there', () => {
    const bare = new MarkedOnlyFiles(
      { listFolders: async () => [FOLDER], listSince: async () => listing, fetch: async (item) => ({ item }) },
      MARKER,
    );
    for (const name of ['snapshot', 'listKeys', 'listTrashedPaths', 'nativeRefusals', 'storageUsage', 'listTopLevelFolders']) {
      expect(name in bare, name).toBe(false);
    }
    expect(bare.markedOnly).toBe(true);
  });
});

/**
 * A TEST MIGRATION'S SHARING (workplan 0162, the first thing T1 settles): the
 * grants on things whose own name carries the marker, by the same rule as a
 * listing, and a refusal where a grant names nothing.
 */
describe('markedSharesOnly', () => {
  const grant = (on: string, ownName: string | undefined, over: Partial<PermissionGrant> = {}): PermissionGrant => ({
    subject: 'drive_item',
    on,
    role: 'reader',
    raw: '{}',
    ...(ownName === undefined ? {} : { ownName }),
    ...over,
  });
  const listed = (...grants: PermissionGrant[]): PermissionListing => ({ kind: 'listed', grants });

  it('keeps a grant on a thing whose own name carries the marker, ignoring case, and drops the rest', () => {
    const kept = markedSharesOnly(
      listed(
        grant('[Ownpace-test] plan.pdf', '[Ownpace-test] plan.pdf'),
        grant('Taxes.pdf', 'Taxes.pdf', { grantee: 'bram@example.com' }),
        grant('Re [OWNPACE-TEST] notes', 'Re [OWNPACE-TEST] notes', { viaLink: true }),
      ),
      MARKER,
    );
    expect(kept).toEqual({
      listing: listed(
        grant('[Ownpace-test] plan.pdf', '[Ownpace-test] plan.pdf'),
        grant('Re [OWNPACE-TEST] notes', 'Re [OWNPACE-TEST] notes', { viaLink: true }),
      ),
    });
  });

  it('reads the thing\u2019s own name, never the folder or the address around it', () => {
    const kept = markedSharesOnly(
      listed(
        grant('[Ownpace-test] Folder/budget.xlsx', 'budget.xlsx'),
        grant('Family/[Ownpace-test] notes.txt', '[Ownpace-test] notes.txt'),
        grant('[Ownpace-test]@example.com — Family', 'Family', { subject: 'calendar' }),
        grant('someone@example.com — [Ownpace-test] Agenda', '[Ownpace-test] Agenda', { subject: 'calendar' }),
      ),
      MARKER,
    );
    expect(kept).toEqual({
      listing: listed(
        grant('Family/[Ownpace-test] notes.txt', '[Ownpace-test] notes.txt'),
        grant('someone@example.com — [Ownpace-test] Agenda', '[Ownpace-test] Agenda', { subject: 'calendar' }),
      ),
    });
  });

  it('refuses the whole listing for a grant whose thing has no name, marked label or not', () => {
    expect(
      markedSharesOnly(listed(grant('[Ownpace-test] plan.pdf', '[Ownpace-test] plan.pdf'), grant('[Ownpace-test]', undefined)), MARKER),
    ).toEqual({ untied: 1 });
    expect(markedSharesOnly(listed(grant('x', ''), grant('y', undefined)), MARKER)).toEqual({ untied: 2 });
  });

  it('passes a listing that read nothing as it came, and an empty one as empty', () => {
    const unread: PermissionListing = { kind: 'not_discoverable', reason: 'not read', reasonNl: 'niet gelezen' };
    expect(markedSharesOnly(unread, MARKER)).toEqual({ listing: unread });
    expect(markedSharesOnly(listed(), MARKER)).toEqual({ listing: listed() });
  });

  it('refuses a marker the database would not have stored, as the wrappers do', () => {
    expect(() => markedSharesOnly(listed(grant('a', 'a')), ' x ')).toThrow(/fewer than three characters/);
  });
});
