// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROMISE TO A SOURCE THAT CARRIES NONE OF IT (workplan 0013, 2026-10-16).
 *
 * *What migrates, and what does not* is filtered by the source's family, and a
 * row with no `appliesTo` is shown to every family. Until 2026-10-16 four rows
 * had none: Email, Calendar, Contacts and *Mail with no Message-ID*. So a
 * Dropbox migration, a Box migration and a Takeout export of photos were each
 * confirmed under
 *
 *     Email — Every folder, Sent, Drafts and Archive included, with flags,
 *     tags and dates.
 *
 * while the code reads files and nothing else from all three
 * (`SOURCE_TYPE_DOMAINS`: `dropbox`, `box` and `archive` are `['file']`, the
 * archive's by owner decision D5).
 *
 * And the other way round: the code reads Microsoft To Do (`graph-todo-source`)
 * and Apple Reminders (task lists in the calendar account), and the only Tasks
 * row on the screen was Google's. A Microsoft or Apple migration with Tasks
 * ticked was told nothing about them.
 *
 * So this holds each data row to the families whose sources carry that data,
 * read from the code's own tables rather than typed again here: a family that
 * carries a type has its row, and a family that does not is never shown one.
 */

import { describe, it, expect } from 'vitest';
import {
  SCOPE_MANIFEST,
  SCOPE_FAMILIES,
  scopeFamilyOf,
  scopeFamilyOfConnectionKind,
  scopeFamilyOfSourceCard,
  scopeManifestFor,
  type ScopeFamily,
  type ScopeManifestEntry,
} from './scope-manifest.ts';
import { SOURCE_TYPE_DOMAINS, type WizardSourceType } from './target-domains.ts';
import { connectableTypes } from './credential-fields.ts';
import type { DiscoveryDomain } from './discovery.ts';

const COLUMNS = ['migrates', 'partial', 'doesNotMigrate'] as const;

const rowsOf = (families: ReadonlyArray<ScopeFamily>): ScopeManifestEntry[] => {
  const scoped = scopeManifestFor(SCOPE_MANIFEST, families);
  return COLUMNS.flatMap((c) => [...scoped[c]]);
};

/**
 * The cards with no row in `SOURCE_TYPE_DOMAINS`, because what they read is the
 * protocol's: one mailbox's mail (`docs/guides/en/imap.md`, and
 * `microsoft.md`'s *"Both cards read one mailbox's mail"*). The same three the
 * site's guard names (`leaving-pages-say-what-the-app-says`).
 */
const MAIL_ONLY = ['imap', 'graph', 'oauth2'];

/** What a source card carries, as the app decides it. */
const carries = (card: string): ReadonlyArray<DiscoveryDomain> =>
  SOURCE_TYPE_DOMAINS[card as WizardSourceType] ?? (MAIL_ONLY.includes(card) ? ['email'] : []);

/** The data a row is about, by its English item: the rows that promise one type each. */
const ROW_DOMAIN: Readonly<Record<string, DiscoveryDomain>> = {
  Email: 'email',
  'Mail with no Message-ID': 'email',
  Calendar: 'calendar',
  Contacts: 'contact',
  Tasks: 'task',
};

/** The families a row is shown to: its `appliesTo`, or every family where it has none. */
const familiesOf = (entry: ScopeManifestEntry): ReadonlyArray<ScopeFamily> => entry.appliesTo ?? SCOPE_FAMILIES;

describe('each data row is shown to the families whose sources carry that data', () => {
  it('knows what every source card carries, and its family', () => {
    for (const card of connectableTypes('source')) {
      expect(carries(card).length, `${card}: this guard does not know what the card reads`).toBeGreaterThan(0);
      expect(scopeFamilyOfSourceCard(card), `${card}: no family`).toBeDefined();
    }
  });

  it.each(['email', 'calendar', 'contact', 'task'] as const)(
    'shows a %s row to exactly the families that carry it',
    (domain) => {
      const carrying = new Set(
        connectableTypes('source')
          .filter((card) => carries(card).includes(domain))
          .map((card) => scopeFamilyOfSourceCard(card)!),
      );
      const items = Object.entries(ROW_DOMAIN).filter(([, d]) => d === domain).map(([item]) => item);
      for (const item of items) {
        const rows = COLUMNS.flatMap((c) => SCOPE_MANIFEST[c].filter((e) => e.item === item));
        expect(rows.length, `no "${item}" row`).toBeGreaterThan(0);
        const shownTo = new Set(rows.flatMap(familiesOf));
        expect([...shownTo].sort(), `"${item}" is shown to`).toEqual([...carrying].sort());
      }
    },
  );

  it('shows the Files rows to every family that carries files', () => {
    const carrying = new Set(
      connectableTypes('source')
        .filter((card) => carries(card).includes('file'))
        .map((card) => scopeFamilyOfSourceCard(card)!),
    );
    const shownTo = new Set(SCOPE_MANIFEST.migrates.filter((e) => e.item === 'Files').flatMap(familiesOf));
    for (const family of carrying) expect(shownTo, `${family} carries files`).toContain(family);
  });
});

describe('a files-only source is told about files only', () => {
  it.each([
    ['Dropbox', scopeFamilyOfConnectionKind('dropbox')],
    ['Box', scopeFamilyOfConnectionKind('box')],
    ['a Takeout export', scopeFamilyOfConnectionKind('archive')],
  ])('%s: no Email, Calendar, Contacts or Tasks row', (_name, family) => {
    expect(family).toBeDefined();
    const items = rowsOf([family!]).map((e) => e.item);
    for (const item of Object.keys(ROW_DOMAIN)) expect(items, item).not.toContain(item);
    expect(items).toContain('Files');
  });
});

/**
 * An IMAP server holds mail and nothing else (2026-10-16). The IMAP card, the
 * `imap` connection kind and the appliance's `imap-oauth2` type shared the
 * `standards` family with an Apple account, so a migration from a bare IMAP
 * server was shown Calendar, Contacts, Files and Apple's Tasks rows it can
 * never carry.
 */
describe('a mail-only source is told about mail only', () => {
  const MAIL_ROWS = ['Email', 'Mail with no Message-ID'];
  const NOT_MAIL = ['Calendar', 'Contacts', 'Tasks', 'Files'];

  it.each([
    ['the IMAP card', scopeFamilyOfSourceCard('imap')],
    ['the imap connection kind', scopeFamilyOfConnectionKind('imap')],
    ['the appliance’s imap-oauth2 type', scopeFamilyOf('imap-oauth2')],
  ])('%s: Email and Message-ID, and no Calendar, Contacts, Tasks or Files row', (_name, family) => {
    expect(family).toBeDefined();
    const items = rowsOf([family!]).map((e) => e.item);
    for (const item of MAIL_ROWS) expect(items, item).toContain(item);
    for (const item of NOT_MAIL) expect(items, item).not.toContain(item);
  });

  it.each([
    ['the Apple card', scopeFamilyOfSourceCard('apple')],
    ['the apple connection kind', scopeFamilyOfConnectionKind('apple')],
  ])('%s keeps its mail, calendar, contacts and Reminders rows', (_name, family) => {
    expect(family).toBeDefined();
    const items = rowsOf([family!]).map((e) => e.item);
    for (const item of [...MAIL_ROWS, 'Calendar', 'Contacts', 'Tasks']) expect(items, item).toContain(item);
  });

  it('shows an appliance with an IMAP and a calendar source what it showed before', () => {
    // An Apple account on the appliance is three mappings, `imap-oauth2`,
    // `caldav` and `carddav`; the confirm page shows the union of their rows.
    const families = [scopeFamilyOf('imap-oauth2')!, scopeFamilyOf('caldav')!];
    expect(rowsOf(families)).toEqual(rowsOf([scopeFamilyOf('caldav')!]));
  });
});

describe('tasks, for each source that reads them', () => {
  const tasks = (family: ScopeFamily) => rowsOf([family]).filter((e) => e.item === 'Tasks');

  it('tells a Microsoft migration about Microsoft To Do, in both languages', () => {
    const rows = tasks(scopeFamilyOfConnectionKind('microsoft')!);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatch(/^Microsoft To Do:/);
    expect(rows[0]!.nl?.detail).toMatch(/^Microsoft To Do:/);
    // Said where something stays behind.
    expect(rows[0]!.more).toMatch(/attached to a task do not come across/);
    expect(rows[0]!.nl?.more).toMatch(/komen niet mee/);
  });

  it('tells an Apple migration about its Reminders, and links the guide that says the rest', () => {
    const rows = tasks(scopeFamilyOfConnectionKind('apple')!);
    expect(rows).toHaveLength(1);
    // Said as what it is: upgraded Reminders (iOS 13 and later) live where only
    // Apple's apps read them, so the row is Partial and says so.
    expect(rows[0]!.detail).toMatch(/upgraded Apple Reminders cannot be read/);
    expect(rows[0]!.nl?.detail).toMatch(/bijgewerkte Apple-herinneringen zijn onleesbaar/);
    expect(rows[0]!.more).toMatch(/iOS 13/);
    expect(rows[0]!.nl?.more).toMatch(/iOS 13/);
    expect(SCOPE_MANIFEST.partial).toContain(rows[0]);
    expect(rows[0]!.guide).toBe('apple#reminders');
  });

  it('still tells a Google migration about Google Tasks, and nobody else', () => {
    expect(tasks('google').map((e) => e.detail)).toEqual([expect.stringMatching(/^Google Tasks:/)]);
    for (const family of ['microsoft', 'standards', 'imap'] as const) {
      expect(tasks(family).some((e) => /Google/.test(e.detail)), family).toBe(false);
    }
  });
});

describe('a source card names the family the other two vocabularies do', () => {
  it('agrees with the source type and the connection kind wherever they name the same thing', () => {
    for (const card of connectableTypes('source')) {
      const family = scopeFamilyOfSourceCard(card);
      const asType = scopeFamilyOf(card);
      if (asType !== undefined) expect(family, `${card} as a source type`).toBe(asType);
      const asKind = scopeFamilyOfConnectionKind(card);
      if (asKind !== undefined) expect(family, `${card} as a connection kind`).toBe(asKind);
    }
    // The cards Start a migration makes that neither of the others knows.
    expect(scopeFamilyOfSourceCard('apple')).toBe('standards');
    expect(scopeFamilyOfSourceCard('imap')).toBe('imap');
    expect(scopeFamilyOfSourceCard('graph')).toBe('microsoft');
    expect(scopeFamilyOfSourceCard('oauth2')).toBe('microsoft');
  });

  it('answers undefined for a card it does not know, rather than guessing', () => {
    for (const notACard of ['', 'jmap', 'soverin', 'constructor', 'google_drive']) {
      expect(scopeFamilyOfSourceCard(notACard), notACard).toBeUndefined();
    }
  });
});
