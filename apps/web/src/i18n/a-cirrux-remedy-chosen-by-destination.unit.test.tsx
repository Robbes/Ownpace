// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CIRRUX ACCOUNT'S REMEDIES, CHOSEN BY THE DESTINATION (workplan 0160, T2b).
 *
 * The owner's live test of Cirrux Drive left two of these on the screens:
 *
 *  1. A file refused because Cirrux Drive already held one whose name differs
 *     only in capitals was headed by `target_refused`'s sentence, *"The
 *     destination refused to accept this. Common causes are no space left…"*,
 *     none of which was the cause. The writer now states `format_refused`, a
 *     name the destination will not store, and on a Cirrux migration the page
 *     says it in Cirrux's terms, capitals and accents, and names the button.
 *  2. After *Disconnect Cirrux Drive*, the migration's *Live progress* said
 *     *"press Reconnect or Replace credentials"*, and the row's button is
 *     **Connect Cirrux Drive**. On a Cirrux account's files the strip names
 *     that one, by the words on it.
 *
 * Both are chosen by `remedyKey`, from the destination's kind, as Dropbox's
 * Paper sentence is chosen from the source's (0150 D9).
 */
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FailuresResponse, ItemFailure } from '@openmig/shared';
import { STRINGS, LOCALES, type Locale } from './strings.ts';
import { FAILURE_KEY, remedyKey } from './failure-key.ts';
import { LocaleProvider } from './index.tsx';
import LiveProgress, { type LiveProgressRow } from '../components/LiveProgress.tsx';

const { fetchFailuresMock } = vi.hoisted(() => ({ fetchFailuresMock: vi.fn() }));

vi.mock('../services/operating-service', () => ({
  fetchFailures: fetchFailuresMock,
  retryFailure: vi.fn(),
  acceptFailure: vi.fn(),
  decideFailureGroup: vi.fn(),
  DecisionRefusedError: class extends Error {},
}));

import Failures from '../pages/Failures.tsx';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the key a Cirrux account’s remedy is read from', () => {
  it('is Cirrux’s own for a name Cirrux will not store', () => {
    expect(remedyKey('format_refused', 'dropbox', { targetKind: 'cirrux' })).toBe('failure.formatRefused.cirrux');
    expect(remedyKey('format_refused', 'dropbox', { targetKind: 'nextcloud' })).toBe(FAILURE_KEY.format_refused);
    expect(remedyKey('format_refused', 'dropbox')).toBe(FAILURE_KEY.format_refused);
  });

  it('names Connect Cirrux Drive for its files, and never for a failure at the source', () => {
    const cirruxFiles = { targetKind: 'cirrux', domain: 'file' } as const;
    expect(remedyKey('auth_expired', undefined, cirruxFiles)).toBe('failure.authExpired.cirruxDrive');
    expect(remedyKey('auth_expired', undefined, { ...cirruxFiles, side: 'target' })).toBe('failure.authExpired.cirruxDrive');
    // The source's sign-in is another account's, with its own button.
    expect(remedyKey('auth_expired', undefined, { ...cirruxFiles, side: 'source' })).toBe(FAILURE_KEY.auth_expired);
    // Its mail and calendars sign in with the app password.
    expect(remedyKey('auth_expired', undefined, { targetKind: 'cirrux', domain: 'email' })).toBe(FAILURE_KEY.auth_expired);
    expect(remedyKey('auth_expired', undefined, { targetKind: 'nextcloud', domain: 'file' })).toBe(FAILURE_KEY.auth_expired);
  });
});

describe('the two sentences', () => {
  it.each(LOCALES)('%s: name the buttons by their own words, and none of target_refused’s causes', (locale) => {
    const s = STRINGS[locale];
    expect(s['failure.authExpired.cirruxDrive']).toContain(s['account.cirrux.connect']);
    expect(s['failure.authExpired.cirruxDrive']).not.toContain(s['connections.rotate']);
    expect(s['failure.formatRefused.cirrux']).toContain(s['failures.retry']);
    expect(s['failure.formatRefused.cirrux']).toMatch(locale === 'nl' ? /hoofdletters/ : /capitals/);
  });

  it('are Dutch on a Dutch page', () => {
    expect(STRINGS.nl['failure.formatRefused.cirrux']).not.toBe(STRINGS.en['failure.formatRefused.cirrux']);
    expect(STRINGS.nl['failure.authExpired.cirruxDrive']).not.toBe(STRINGS.en['failure.authExpired.cirruxDrive']);
  });
});

/** Two files Cirrux will not store under their names, so the group panel shows. */
const CLASHES: ItemFailure[] = [1, 2].map((n) => ({
  naturalKeyHash: `clash-${n}`,
  domain: 'file',
  displayName: `Report ${n}.pdf`,
  attempts: 1,
  lastError: `Cirrux Drive already holds “report ${n}.pdf” where Report ${n}.pdf goes.`,
  category: 'format_refused',
  needsDecision: true,
  parkedAt: '2026-11-24T09:46:00Z',
}));

async function failuresPage(locale: Locale, targetKind: string | undefined) {
  window.localStorage.setItem('ownpace.locale', locale);
  const body: FailuresResponse = {
    'a-migration': {
      migrationStatus: 'active',
      needsDecision: CLASHES,
      retrying: [],
      howToResolve: { retry: 'Retry.', accept: 'Accept.', doNothing: 'Nothing.' },
      sourceKind: 'dropbox',
      ...(targetKind ? { targetKind } : {}),
    },
  };
  fetchFailuresMock.mockResolvedValue(body);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LocaleProvider>
          <Failures />
        </LocaleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Report 1.pdf');
  const text = document.body.textContent ?? '';
  const times = (sentence: string) => text.split(sentence).length - 1;
  return {
    cirrux: times(STRINGS[locale]['failure.formatRefused.cirrux']),
    general: times(STRINGS[locale]['failure.formatRefused']),
    targetRefused: times(STRINGS[locale]['failure.targetRefused']),
  };
}

describe('the Failures page, on a migration into Cirrux', () => {
  it.each(LOCALES)('%s: its rows and group panel say what Cirrux would not store', async (locale) => {
    // Two rows and the one group above them.
    expect(await failuresPage(locale, 'cirrux')).toEqual({ cirrux: 3, general: 0, targetRefused: 0 });
  });

  it('a server that sends no destination reads the category alone, as before', async () => {
    expect(await failuresPage('en', undefined)).toEqual({ cirrux: 0, general: 3, targetRefused: 0 });
  });
});

const disconnected: LiveProgressRow = {
  domain: 'file',
  state: 'failed',
  itemsSynced: 2,
  itemsFailed: 0,
  itemsRetrying: 0,
  lastErrorCategory: 'auth_expired',
};

function strip(locale: Locale, targetKind: string | undefined) {
  window.localStorage.setItem('ownpace.locale', locale);
  render(
    <MemoryRouter>
      <LocaleProvider>
        <LiveProgress domains={[disconnected]} {...(targetKind ? { targetKind } : {})} />
      </LocaleProvider>
    </MemoryRouter>,
  );
  return document.body.textContent ?? '';
}

describe('Live progress, after Disconnect Cirrux Drive', () => {
  it.each(LOCALES)('%s: names Connect Cirrux Drive, and not Reconnect or Replace credentials', (locale) => {
    const text = strip(locale, 'cirrux');
    expect(text).toContain(STRINGS[locale]['failure.authExpired.cirruxDrive']);
    expect(text).not.toContain(STRINGS[locale]['failure.authExpired']);
  });

  it('another destination keeps the category’s sentence', () => {
    expect(strip('en', 'nextcloud')).toContain(STRINGS.en['failure.authExpired']);
  });
});
