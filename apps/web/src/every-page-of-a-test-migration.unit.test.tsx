// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EVERY PAGE OF A TEST MIGRATION SAYS SO (workplan 0162 T1, §3; ADR-0053).
 *
 * A migration made in a test organisation carries the organisation's marker,
 * copies only the items whose own title contains it, and is never finished.
 * Each page of it shows a banner saying so, with the marker, in the reader's
 * language. The banner is drawn once, by `Layout`, above every page under
 * `/mappings/{id}`, from the read the bar already makes, so a page added under
 * a migration says it without being told.
 *
 * This holds it at the route table: every route `AppRoutes.tsx` declares under
 * `mappings/:…` (read from the file, so a new one is in the list by itself),
 * opened for a test migration, mounts its page AND the banner; for a migration
 * that is not a test, the page and no banner; the list and the wizard's
 * address none. The screens are markers, as in `AppRoutes.unit.test.tsx`:
 * what is under test is where the banner is drawn.
 */
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { editionFlag, reads } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  /** Every migration read the page asked for, by id. */
  reads: [] as string[],
}));

const TEST_ID = '0162c100-e29b-41d4-a716-446655440001';
const PLAIN_ID = '0162c100-e29b-41d4-a716-446655440002';

vi.mock('./services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
  operatingBaseUrl: () => '',
}));

vi.mock('./stores/auth-store', () => {
  const state = { isAuthenticated: true, user: null, logout: () => {}, operator: false, tenantCount: 1 };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

vi.mock('./components/AcceptanceGate', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The migration's own read, as the API serves it: a marker for the test one.
vi.mock('./services/mapping-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/mapping-service.ts')>();
  return {
    ...actual,
    mappingApi: {
      ...actual.mappingApi,
      get: vi.fn(async (id: string) => {
        reads.push(id);
        return {
          id,
          name: id === TEST_ID ? 'A test migration' : 'A real one',
          status: 'active',
          ...(id === TEST_ID ? { testMarker: '[Ownpace-test]' } : {}),
        };
      }),
    },
  };
});

// Markers, not screens: what is under test is the frame around them.
vi.mock('./pages/MappingDetail', () => ({ default: () => <div>screen:mapping-detail</div> }));
vi.mock('./pages/ConfirmMapping', () => ({ default: () => <div>screen:confirm-mapping</div> }));
vi.mock('./pages/Deletions', () => ({ default: () => <div>screen:deletions</div> }));
vi.mock('./pages/Moves', () => ({ default: () => <div>screen:moves</div> }));
vi.mock('./pages/Failures', () => ({ default: () => <div>screen:failures</div> }));
vi.mock('./pages/Sharing', () => ({ default: () => <div>screen:sharing</div> }));
vi.mock('./pages/Verify', () => ({ default: () => <div>screen:verify</div> }));
vi.mock('./pages/Confirmed', () => ({ default: () => <div>screen:confirmed</div> }));
vi.mock('./pages/Report', () => ({ default: () => <div>screen:report</div> }));
vi.mock('./pages/Finish', () => ({ default: () => <div>screen:finish</div> }));
vi.mock('./pages/Mappings', () => ({ default: () => <div>screen:mappings</div> }));
vi.mock('./pages/StartMigration', () => ({ default: () => <div>screen:start-migration</div> }));

import AppRoutes from './AppRoutes.tsx';
import { LocaleProvider } from './i18n/index.tsx';

/** Every route the table declares under one migration, read from the file. */
const MIGRATION_ROUTES = [
  ...readFileSync(join(import.meta.dirname, 'AppRoutes.tsx'), 'utf8').matchAll(/path="(mappings\/:[^"]+)"/g),
].map((m) => m[1]!);

const urlOf = (route: string, id: string) => `/${route.replace(/:(id|mappingId)\b/, id)}`;

const renderAt = (path: string, locale: 'en' | 'nl' = 'en') => {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
};

const BANNER_EN = 'Test: only items whose title contains [Ownpace-test] are copied. This migration cannot be finished.';
const BANNER_NL =
  'Test: alleen items waarvan de titel [Ownpace-test] bevat, worden gemigreerd. Deze migratie kan niet worden afgerond.';

const banner = () => document.querySelector('[data-test-migration]');

beforeEach(() => {
  editionFlag.selfhost = false;
  reads.length = 0;
  window.localStorage.clear();
});

describe('the routes under one migration', () => {
  it('are read from the table, so a page added under a migration is in this list by itself', () => {
    expect(MIGRATION_ROUTES).toEqual(
      expect.arrayContaining([
        'mappings/:id',
        'mappings/:mappingId/confirm',
        'mappings/:mappingId/deletions',
        'mappings/:mappingId/moves',
        'mappings/:mappingId/failures',
        'mappings/:mappingId/sharing',
        'mappings/:mappingId/verify',
        'mappings/:mappingId/confirmed',
        'mappings/:mappingId/report',
        'mappings/:mappingId/finish',
      ]),
    );
    expect(MIGRATION_ROUTES).toHaveLength(10);
  });
});

describe('every page of a test migration shows the banner, with its marker', () => {
  it.each(MIGRATION_ROUTES)('%s', async (route) => {
    renderAt(urlOf(route, TEST_ID));
    expect(await screen.findByText(/^screen:/)).toBeInTheDocument();
    expect(await screen.findByRole('note')).toHaveTextContent(BANNER_EN);
    // The marker as code, verbatim: what a person types into a title.
    expect(banner()!.querySelector('code')).toHaveTextContent(/^\[Ownpace-test\]$/);
  });

  it('in Dutch for a Dutch reader', async () => {
    renderAt(urlOf('mappings/:mappingId/finish', TEST_ID), 'nl');
    expect(await screen.findByText('screen:finish')).toBeInTheDocument();
    expect(await screen.findByRole('note')).toHaveTextContent(BANNER_NL);
  });
});

describe('and nowhere else', () => {
  it.each(MIGRATION_ROUTES)('%s of a migration that is not a test: no banner', async (route) => {
    renderAt(urlOf(route, PLAIN_ID));
    expect(await screen.findByText(/^screen:/)).toBeInTheDocument();
    // The read came back, and said no marker.
    await vi.waitFor(() => expect(reads).toContain(PLAIN_ID));
    await new Promise((r) => setTimeout(r, 0));
    expect(banner()).toBeNull();
  });

  it('not on the list of migrations, nor the wizard’s address: they are no one migration’s pages', async () => {
    renderAt('/mappings');
    expect(await screen.findByText('screen:mappings')).toBeInTheDocument();
    renderAt('/mappings/new');
    expect(await screen.findByText('screen:start-migration')).toBeInTheDocument();
    expect(reads).toEqual([]);
    expect(banner()).toBeNull();
  });

  it('not on the appliance, which has no test migrations and reads none', async () => {
    editionFlag.selfhost = true;
    renderAt(urlOf('mappings/:id', TEST_ID));
    expect(await screen.findByText('screen:mapping-detail')).toBeInTheDocument();
    expect(reads).toEqual([]);
    expect(banner()).toBeNull();
  });
});
