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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import { MigrationLines } from './MigrationLines.tsx';
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
    expect(screen.getByText('1.204 gekopieerd · totaal niet bekend')).toBeInTheDocument();
  });

  it('says when the check passed, in Dutch word order', () => {
    inDutch(progress({ state: 'passed', at: ago(86_400_000) }));
    expect(screen.getByText('Klaar om over te stappen')).toBeInTheDocument();
    expect(screen.getByText('De verificatie is gisteren geslaagd')).toBeInTheDocument();
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
