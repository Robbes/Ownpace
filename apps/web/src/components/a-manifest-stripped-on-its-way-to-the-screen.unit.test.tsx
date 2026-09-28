// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MANIFEST STRIPPED ON ITS WAY TO THE SCREEN (workplan 0153 T1 (a)).
 *
 * On managed, the confirm screen confirmed a Google Drive migration under
 * "SharePoint extras", "Teams chat & calls", "Planner" and "InfoPath", and
 * never opened a single *More* fold. Three things combined:
 *
 *  1. `ScopeManifestEntrySchema` named `item` and `detail` alone, and z.object
 *     strips what it does not name, so `appliesTo` and `more` never arrived.
 *  2. The detail route answers `sourceType` with the CONNECTION KIND
 *     (`google_drive`), and the screen looked it up among source TYPES
 *     (`google-drive`), so the migration had no family.
 *  3. `scopeManifestFor` then kept every row whose `appliesTo` was undefined,
 *     which after (1) was every row.
 *
 * `ConfirmMigration.unit.test.tsx` could not see any of it: it mocks the
 * service module whole, so no schema ever runs, and its migration's kind is
 * `google`, one of the few words that is a kind and a type at once. So this
 * file mocks nothing but the HTTP client. The manifest is shared's own
 * `SCOPE_MANIFEST`, round-tripped through JSON exactly as
 * `apps/api/src/routes/scope-manifest.ts` serves it (`res.json`). The
 * migration is the detail route's shape (`apps/api/src/routes/migrations/
 * index.ts`, `sourceType: sourceConn?.kind`), for a Drive migration, whose kind
 * `a-source-kind-with-no-scope-family.unit.test.ts` pins as `google_drive`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SCOPE_MANIFEST } from '@openmig/shared';

// The hold the banner reads, asked only when a count is refused; open here.
vi.mock('../services/platform-service', () => ({
  fetchPlatformPause: vi.fn().mockResolvedValue({ held: false }),
}));

import apiClient from '../services/api.ts';
import { ScopeManifestSchema } from '../services/mapping-service.ts';
import { ConfirmMigration } from './ConfirmMigration.tsx';
import { STRINGS } from '../i18n/strings.ts';

/** What the route puts on the wire: the constant, through `res.json`. */
const MANIFEST_ON_THE_WIRE: unknown = JSON.parse(JSON.stringify(SCOPE_MANIFEST));

/** GET /migrations/:id for a Google Drive → Nextcloud migration, as the detail route answers it. */
const DRIVE_MIGRATION = {
  id: 'm1',
  tenantId: 't1',
  name: 'Anna — Drive to Nextcloud',
  sourceType: 'google_drive',
  targetType: 'nextcloud',
  sourceConnection: { id: 'c1', name: 'anna@example.nl', kind: 'google_drive' },
  targetConnection: { id: 'c2', name: 'Nextcloud', kind: 'nextcloud' },
  sourceConfig: {},
  targetConfig: {},
  syncConfig: { domains: ['file'], schedule: '0 2 * * *' },
  status: 'paused',
  mode: 'mirror',
  pattern: null,
  domainStatus: [],
  createdAt: '2026-09-28T00:00:00Z',
  updatedAt: '2026-09-28T00:00:00Z',
};

const DISCOVERY = {
  mappingId: 'm1',
  discovered: true,
  domains: [{ domain: 'file', collections: 3, items: 12, bytes: 4096, discoveredAt: '2026-09-28T00:00:00Z' }],
};

type Get = (url: string) => Promise<{ data: unknown }>;

function answering(manifest: Get): Get {
  return (url) => {
    if (url === '/scope-manifest') return manifest(url);
    if (url === '/migrations/m1') return Promise.resolve({ data: DRIVE_MIGRATION });
    if (url === '/migrations/m1/discovery') return Promise.resolve({ data: DISCOVERY });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  };
}

function renderConfirm(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmMigration mappingId="m1" onStarted={vi.fn()} />
    </QueryClientProvider>,
  );
}

const rowsFor = (family: string) =>
  [...SCOPE_MANIFEST.migrates, ...SCOPE_MANIFEST.partial, ...SCOPE_MANIFEST.doesNotMigrate].filter(
    (e) => e.appliesTo !== undefined && e.appliesTo.includes(family as never),
  );

describe('the manifest reaches the screen whole', () => {
  it('loses no key between the wire and the screen', () => {
    // Any field shared adds to a row and this schema does not name is dropped
    // silently by z.object; this is where that stops being silent.
    expect(ScopeManifestSchema.parse(MANIFEST_ON_THE_WIRE)).toEqual(SCOPE_MANIFEST);
  });
});

describe('a Google Drive migration is confirmed under its own promises', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'get').mockImplementation(
      answering(() => Promise.resolve({ data: MANIFEST_ON_THE_WIRE })) as never,
    );
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows no row that is only about Microsoft', async () => {
    renderConfirm();
    const google = rowsFor('google');
    // Wait for the manifest to land, on a row that must be there.
    const driveRow = google.find((e) => e.detail.startsWith('Google Drive:'));
    expect(driveRow, 'the manifest has no Google Drive row to wait for').toBeDefined();
    expect(await screen.findByText(driveRow!.detail, { exact: false })).toBeInTheDocument();

    // The words only a Microsoft row says. Two rows can share a sentence (both
    // Permissions rows open with the same line), and that sentence is rightly
    // on screen for Google, so a row is recognised by its own words: its line
    // or its fold, whichever no Google row also carries.
    const googleWords = new Set(google.flatMap((e) => [e.detail, e.more]));
    const microsoftOnlyWords = rowsFor('microsoft')
      .filter((e) => !e.appliesTo!.includes('google'))
      .flatMap((e) => [e.detail, e.more].map((words) => ({ item: e.item, words })))
      .filter((w): w is { item: string; words: string } => w.words !== undefined && !googleWords.has(w.words));
    // Vacuity guard: the manifest still has Microsoft-only rows to hide.
    expect(microsoftOnlyWords.length).toBeGreaterThan(5);
    for (const { item, words } of microsoftOnlyWords) {
      // Substring: a row's line shares its text node with the dash before it.
      expect(
        screen.queryByText(words, { exact: false }),
        `"${item}: ${words}" is a Microsoft row, shown on a Google Drive migration`,
      ).toBeNull();
    }
    expect(screen.queryByText('Teams chat & calls')).toBeNull();
  });

  it('renders the folded More of its rows', async () => {
    renderConfirm();
    const withMore = rowsFor('google').filter((e) => e.more !== undefined);
    expect(withMore.length).toBeGreaterThan(0);
    for (const row of withMore) {
      expect(await screen.findByText(row.more!), `${row.item} lost its fold`).toBeInTheDocument();
    }
  });
});

describe('a manifest that could not be read', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says so, instead of leaving the list out without a word', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(
      answering(() => Promise.reject(new Error('Network Error'))) as never,
    );
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never);
    renderConfirm();
    const alert = await screen.findByText(STRINGS.en['confirm.manifestError'], { exact: false });
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toContain('Network Error');
  });
});
