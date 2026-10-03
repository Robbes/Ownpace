// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S LINES IN DUTCH (workplan 0154 T1 (b)): the sentence under each
 * stage is built from parts, so its digits and its word order have to come out
 * of the dictionary in the reader's language, not English's. The rules are
 * `stage-line.ts`'s; the pages' tests hold them in English.
 */
import { render, screen } from '@testing-library/react';
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
