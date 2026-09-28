// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REMEDY CHOSEN BY SOURCE (workplan 0150 D9, the owner's choice of
 * 2026-09-26: *"open question 4: (a), policy_refused as recommended"*).
 *
 * A Dropbox Paper doc is refused as `policy_refused` (0150 T5): Dropbox hands
 * it over only as an export, and this service does not make exports yet. The
 * Failures page chose a remedy by category alone, and the `policy_refused`
 * sentence is Drive's, naming Drive's own setting, *Export format for Google
 * files*, which a Dropbox migration does not have. So the page chooses by the
 * migration's source as well, in the two places it shows an item's remedy:
 * each row, and the group panel above them.
 *
 * What this holds:
 *
 *  1. `remedyKey` answers Dropbox's sentence for a Dropbox migration's
 *     `policy_refused`, and the category's own everywhere else.
 *  2. That sentence exists in both languages, is not the English one on a
 *     Dutch page, and names no setting.
 *  3. The page reads the queue's `sourceKind`: a Dropbox queue's rows and
 *     group panel say Dropbox's sentence, in English and in Dutch, and a
 *     Google queue's, or one from a server that sends no source, say Drive's.
 *  4. No screen that shows an item's remedy indexes `FAILURE_KEY` itself, so
 *     a new one cannot miss the source. Three screens do, by name, because
 *     they show a data type's category, which never holds `policy_refused`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FAILURE_CATEGORIES, type FailuresResponse, type ItemFailure } from '@openmig/shared';
import { STRINGS, LOCALES, type Locale } from './strings.ts';
import { FAILURE_KEY, remedyKey } from './failure-key.ts';
import { LocaleProvider } from './index.tsx';

const { fetchFailuresMock } = vi.hoisted(() => ({ fetchFailuresMock: vi.fn() }));

vi.mock('../services/operating-service', () => ({
  fetchFailures: fetchFailuresMock,
  retryFailure: vi.fn(),
  acceptFailure: vi.fn(),
  decideFailureGroup: vi.fn(),
  DecisionRefusedError: class extends Error {},
}));

import Failures from '../pages/Failures.tsx';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, '..');

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the key a remedy is read from', () => {
  it('is Dropbox’s own for a Dropbox migration’s policy_refused', () => {
    expect(remedyKey('policy_refused', 'dropbox')).toBe('failure.policyRefused.dropbox');
  });

  it('is the category’s own for every other category on Dropbox, and everywhere else', () => {
    for (const category of FAILURE_CATEGORIES) {
      if (category !== 'policy_refused') expect(remedyKey(category, 'dropbox')).toBe(FAILURE_KEY[category]);
      for (const source of ['google', 'google-drive', 'microsoft', 'webdav', undefined]) {
        expect(remedyKey(category, source), `${category} on ${String(source)}`).toBe(FAILURE_KEY[category]);
      }
    }
  });
});

describe('Dropbox’s sentence', () => {
  const said = (locale: Locale): string => STRINGS[locale]['failure.policyRefused.dropbox'];

  it('is written in both languages, and the Dutch page does not read the English', () => {
    for (const locale of LOCALES) expect(said(locale).trim().length).toBeGreaterThan(30);
    expect(said('nl')).not.toBe(said('en'));
  });

  it('names Paper docs, and no setting: there is none to change until 0150 T3', () => {
    for (const locale of LOCALES) {
      expect(said(locale)).toContain('Paper');
      expect(said(locale)).not.toMatch(/Export format for Google files|Exportformaat voor Google-bestanden/);
    }
    // And Drive's sentence still names its setting, word for word as the
    // owner worded it on 2026-09-22.
    expect(STRINGS.en['failure.policyRefused']).toContain('Export format for Google files');
    expect(STRINGS.nl['failure.policyRefused']).toContain('Exportformaat voor Google-bestanden');
  });
});

/** Two parked Paper docs, so the page shows the group panel above the rows. */
const PAPER_DOCS: ItemFailure[] = [1, 2].map((n) => ({
  naturalKeyHash: `paper-${n}`,
  domain: 'file',
  displayName: `Notes ${n}.paper`,
  attempts: 1,
  lastError: `"Notes ${n}.paper" is a Dropbox Paper doc.`,
  category: 'policy_refused',
  needsDecision: true,
  parkedAt: '2026-09-28T11:00:00Z',
}));

function queue(sourceKind: string | undefined): FailuresResponse {
  return {
    'a-migration': {
      migrationStatus: 'active',
      needsDecision: PAPER_DOCS,
      retrying: [],
      howToResolve: { retry: 'Retry.', accept: 'Accept.', doNothing: 'Nothing.' },
      ...(sourceKind ? { sourceKind } : {}),
    },
  };
}

/** The page, rendered in `locale`, and how many times each sentence is on it. */
async function page(locale: Locale, sourceKind: string | undefined) {
  window.localStorage.setItem('ownpace.locale', locale);
  fetchFailuresMock.mockResolvedValue(queue(sourceKind));
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
  await screen.findByText('Notes 1.paper');
  const text = document.body.textContent ?? '';
  const times = (sentence: string) => text.split(sentence).length - 1;
  return {
    dropbox: times(STRINGS[locale]['failure.policyRefused.dropbox']),
    drive: times(STRINGS[locale]['failure.policyRefused']),
  };
}

describe('the Failures page chooses the remedy by the migration’s source', () => {
  it.each(LOCALES)('%s: a Dropbox migration’s rows and group panel say Dropbox’s sentence', async (locale) => {
    // Two rows and the one group above them.
    expect(await page(locale, 'dropbox')).toEqual({ dropbox: 3, drive: 0 });
  });

  it.each(LOCALES)('%s: a Google migration’s say Drive’s, as the owner worded it', async (locale) => {
    expect(await page(locale, 'google')).toEqual({ dropbox: 0, drive: 3 });
  });

  it('a server that sends no source reads the category alone, as before', async () => {
    expect(await page('en', undefined)).toEqual({ dropbox: 0, drive: 3 });
  });
});

/** Every source file under `apps/web/src`, tests left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('an item’s remedy is always chosen through remedyKey', () => {
  /**
   * The three that index the map themselves, each with its reason. They show
   * `migration_status.last_error_category`, a data type's category, which
   * only `markFailed` writes, from a message with no stated category, and no
   * rule over a message yields `policy_refused` (0150 T5).
   */
  const DOMAIN_LEVEL: Record<string, string> = {
    'pages/Connections.tsx': 'a failed pass standing against a connection, by data type',
    'pages/Support.tsx': 'the operator’s view of a data type’s last error',
    'components/LiveProgress.tsx': 'the progress strip, one line per data type',
  };

  it('found the files, rather than passing over an empty tree', () => {
    const all = sources(WEB_SRC).map((p) => relative(WEB_SRC, p));
    expect(all).toContain('pages/Failures.tsx');
    expect(all).toContain('components/queues/FailureGroupPanel.tsx');
  });

  it('is indexed directly only in failure-key.ts and the three data-type screens', () => {
    const indexing = sources(WEB_SRC)
      .map((p) => relative(WEB_SRC, p))
      // `FAILURE_KEY` itself: `VIEW_FAILURE_KEY` is the progress link's own map.
      .filter((p) => /(?<![A-Z_])FAILURE_KEY\[/.test(readFileSync(join(WEB_SRC, p), 'utf8')))
      .filter((p) => p !== 'i18n/failure-key.ts')
      .sort();
    expect(
      indexing,
      'a screen that shows an ITEM’s remedy must ask remedyKey(category, sourceKind), or a ' +
        'Dropbox migration’s Paper docs are told to use Google’s export setting',
    ).toEqual(Object.keys(DOMAIN_LEVEL).sort());
  });
});
