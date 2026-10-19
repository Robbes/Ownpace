// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S LINES IN DUTCH (workplan 0154 T1 (b)): the sentence under each
 * stage is built from parts, so its digits and its word order have to come out
 * of the dictionary in the reader's language, not English's. The rules are
 * `stage-line.ts`'s; the pages' tests hold them in English.
 *
 * And an export's line (0153 open question 5, item 2): its files are its
 * photos, and before it starts it says it waits for the export, with how to
 * make one, in either language.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import { MigrationLines, MigrationTiles } from './MigrationLines.tsx';
import type { LinesProgress } from '../services/stage-line.ts';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const MAIL = {
  sourceType: 'gmail',
  targetType: 'soverin',
  status: 'active' as const,
  domains: ['email', 'calendar'] as ('email' | 'calendar')[],
  lastSyncAt: ago(120_000),
};

const progress = (check: LinesProgress['report']['check']): LinesProgress => ({
  report: {
    mappingId: 'm',
    domains: [
      { domain: 'email', state: 'completed', phase: 'active', itemsSynced: 18_234, itemsFound: 19_000, bytesTransferred: 0, lastSyncedAt: ago(120_000) },
      { domain: 'calendar', state: 'in_progress', phase: 'active', itemsSynced: 1_204, bytesTransferred: 0 },
    ],
    check,
  },
  failuresWaiting: 0,
});

const inDutch = (lines: LinesProgress) => {
  window.localStorage.setItem('ownpace.locale', 'nl');
  render(
    <LocaleProvider>
      <MigrationLines migration={MAIL} progress={lines} />
    </LocaleProvider>,
  );
};

afterEach(() => window.localStorage.removeItem('ownpace.locale'));

describe('a migration’s lines, in Dutch', () => {
  it('says how far, with Dutch digits, and the last round', () => {
    inDutch(progress({ state: 'not_run' }));
    expect(screen.getByText('Wordt bijgehouden')).toBeInTheDocument();
    expect(screen.getByText('18.234 van ~19.000 · laatste ronde 2 minuten geleden')).toBeInTheDocument();
    expect(screen.getByText('1.204 gemigreerd · totaal niet bekend')).toBeInTheDocument();
  });

  it('says when the check passed, in Dutch word order', () => {
    inDutch(progress({ state: 'passed', at: ago(86_400_000) }));
    expect(screen.getByText('Klaar om over te stappen')).toBeInTheDocument();
    expect(screen.getByText('De verificatie is gisteren geslaagd')).toBeInTheDocument();
  });
});

describe('a line says which way it goes, to a screen reader too', () => {
  // The arrow is drawn (aria-hidden) and each tile's letter is hidden, so the
  // line was heard as *Gmail Soverin*: nothing said which was the source.
  const line = () => {
    const arrows = document.querySelectorAll('[data-domain="email"] span[aria-hidden="true"]');
    return [...arrows].find((a) => a.textContent === '→')!.parentElement!;
  };

  it('en: Gmail to Soverin', () => {
    render(
      <LocaleProvider>
        <MigrationLines migration={MAIL} />
      </LocaleProvider>,
    );
    expect(line().textContent).toBe('GGmail→toSSoverin');
  });

  it('nl: Gmail naar Soverin', () => {
    inDutch(progress({ state: 'not_run' }));
    expect(line().textContent).toBe('GGmail→naarSSoverin');
  });
});

describe('an export’s line (0153 open question 5, item 2)', () => {
  const EXPORT = {
    sourceType: 'archive',
    targetType: 'nextcloud',
    status: 'paused' as const,
    domains: ['file'] as 'file'[],
    lastSyncAt: null,
  };
  const draw = (migration: typeof EXPORT | (Omit<typeof EXPORT, 'status' | 'lastSyncAt'> & { status: 'active'; lastSyncAt: string })) =>
    render(
      <LocaleProvider>
        <MemoryRouter>
          <MigrationLines migration={migration} />
        </MemoryRouter>
      </LocaleProvider>,
    );

  it('names its files as photos, and says before it starts that it waits for the export, with how', () => {
    draw(EXPORT);
    expect(screen.getByText('Photos')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the Takeout export/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'how to make one →' })).toHaveAttribute('href', '/docs/archive#from-the-flow');
    expect(screen.queryByText('No pass yet')).not.toBeInTheDocument();
  });

  it('waits no longer once it has run', () => {
    draw({ ...EXPORT, status: 'active', lastSyncAt: ago(120_000) });
    expect(screen.queryByText(/Waiting for the Takeout export/)).not.toBeInTheDocument();
    expect(screen.getByText('Photos')).toBeInTheDocument();
  });

  it('says it in Dutch', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    draw(EXPORT);
    expect(screen.getByText("Foto's")).toBeInTheDocument();
    expect(screen.getByText(/Wacht op de Takeout-export/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'zo maakt u er een →' })).toBeInTheDocument();
  });
});

/**
 * A MAIL SERVER'S LINE, IN WORDS A PERSON HAS (the owner, 2026-10-18). Pieter's
 * KPN line read *IMAP → JMAP*, where *Start a migration* had called the same
 * account *Another mail provider*. The line names both sides in plain words,
 * the protocol in brackets, as the Microsoft pair keeps its own.
 */
describe('a mail server’s line names both sides in plain words (2026-10-18)', () => {
  const KPN = {
    sourceType: 'imap',
    targetType: 'jmap',
    status: 'active' as const,
    domains: ['email'] as 'email'[],
    lastSyncAt: ago(120_000),
  };
  const draw = (locale: 'en' | 'nl') => {
    window.localStorage.setItem('ownpace.locale', locale);
    render(
      <LocaleProvider>
        <MigrationLines migration={KPN} />
      </LocaleProvider>,
    );
  };

  it('en: Other mail provider (IMAP) to Mail server (JMAP)', () => {
    draw('en');
    expect(screen.getByText('Other mail provider (IMAP)')).toBeInTheDocument();
    expect(screen.getByText('Mail server (JMAP)')).toBeInTheDocument();
    expect(screen.queryByText('IMAP')).toBeNull();
    expect(screen.queryByText('JMAP')).toBeNull();
  });

  it('nl: Andere mailaanbieder (IMAP) naar Mailserver (JMAP)', () => {
    draw('nl');
    expect(screen.getByText('Andere mailaanbieder (IMAP)')).toBeInTheDocument();
    expect(screen.getByText('Mailserver (JMAP)')).toBeInTheDocument();
  });
});

/**
 * ON A PHONE, A MIGRATION DRAWS ITS TWO TILES ONCE, UNDER ITS NAME (the owner,
 * 2026-10-19, workplan 0159 round 2). Below `sm` every line repeated *Gmail →
 * Soverin* under a migration whose name already said it, three rows a line.
 * There the page draws the pair once (`MigrationTiles`), and each line keeps
 * its data type, stage and sentence; from `sm` up each line draws the pair, as
 * it always did. Only CSS chooses, which jsdom does not apply, so these read
 * the classes: the copy not shown is `display: none`, so a screen reader hears
 * the pair once per migration on a phone, and once per line on a computer.
 */
describe('on a phone, a migration draws its two tiles once, under its name (2026-10-19)', () => {
  /** Every pair of tiles in `root`: the arrow's parent. */
  const pairsIn = (root: ParentNode) =>
    [...root.querySelectorAll('span[aria-hidden="true"]')].filter((a) => a.textContent === '→').map((a) => a.parentElement!);

  it('draws a line’s tiles from sm up only, and the rest of the line at every width', () => {
    render(
      <LocaleProvider>
        <MigrationLines migration={MAIL} progress={progress({ state: 'not_run' })} />
      </LocaleProvider>,
    );
    const lines = [...document.querySelectorAll('li[data-domain]')];
    expect(lines).toHaveLength(2);
    for (const li of lines) {
      const pairs = pairsIn(li);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.classList, 'a line’s tiles still show on a phone').toContain('hidden');
      expect(pairs[0]!.classList, 'a line’s tiles are gone on a computer').toContain('sm:flex');
      expect(pairs[0]!.classList).not.toContain('flex');
      // Nothing else of the line is hidden at any width: its data type, stage
      // and sentence are what a phone reads of it.
      expect([...li.querySelectorAll('.hidden, .sm\\:hidden')]).toEqual(pairs);
    }
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('18,234 of ~19,000 · last pass 2 minutes ago')).toBeInTheDocument();
  });

  it('draws the migration’s pair below sm only, naming where from and where to, heard as such', () => {
    render(
      <LocaleProvider>
        <MigrationTiles migration={MAIL} />
      </LocaleProvider>,
    );
    const pairs = pairsIn(document.body);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.classList, 'the migration’s pair is not drawn on a phone').toContain('flex');
    expect(pairs[0]!.classList, 'the migration’s pair shows on a computer too').toContain('sm:hidden');
    expect(pairs[0]!.classList).not.toContain('hidden');
    expect(pairs[0]!.textContent).toBe('GGmail→toSSoverin');
    expect(within(pairs[0]!).getByText('to')).toHaveClass('sr-only');
  });

  it('nl: Gmail naar Soverin, in the words a line says it with', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    render(
      <LocaleProvider>
        <MigrationTiles migration={MAIL} />
        <MigrationLines migration={MAIL} />
      </LocaleProvider>,
    );
    const [once, ...lines] = pairsIn(document.body);
    expect(once!.textContent).toBe('GGmail→naarSSoverin');
    expect(within(once!).getByText('naar')).toHaveClass('sr-only');
    // The same words at both widths: only which copy is drawn changes.
    expect(lines.map((l) => l.textContent)).toEqual(['GGmail→naarSSoverin', 'GGmail→naarSSoverin']);
  });
});
