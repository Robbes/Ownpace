// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NEXT STEP YOU CAN FIND (the UX sweep, `journey-step-pages-no-next`).
 *
 * A migration's hub lists seven steps in cutover order, and each opens a
 * page of its own. None of those pages led on: Check said *"Deze migratie is
 * klaar voor overstap."* and stopped, and the only way to the next step was
 * back up to the hub. Now every step page under a migration ends with a link
 * to the next one, named as the hub names it. Finish is the last step and has
 * none; Review and the report are not steps of that list and have none either.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import type { Locale } from '../i18n/strings.ts';

const { authState } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    user: { name: 'Someone', email: 'someone@example.invalid', role: 'owner' },
    logout: () => {},
    operator: false,
    tenantCount: 1,
    token: null,
  },
}));

vi.mock('../services/edition', () => ({ isSelfHost: () => false, operatingBaseUrl: () => '' }));
vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('../services/mapping-service', () => ({
  mappingApi: { get: vi.fn(() => new Promise<never>(() => {})) },
}));
vi.mock('../services/operating-service', () => ({
  fetchAttention: vi.fn(() => new Promise<never>(() => {})),
}));

import Layout from './Layout.tsx';
import NextStepLink from './NextStepLink.tsx';

beforeEach(() => {
  globalThis.localStorage.clear();
});
afterEach(() => {
  globalThis.localStorage.clear();
});

function renderAt(path: string, locale: Locale = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  return render(
    <LocaleProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route path="*" element={<div>page-body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('the step pages under a migration', () => {
  it('end Check with a link on to Confirmed, after the page', () => {
    renderAt('/mappings/x/verify');
    const main = screen.getByRole('main');
    const next = within(main).getByRole('link', { name: 'Next step: Confirmed →' });
    expect(next).toHaveAttribute('href', '/mappings/x/confirmed');
    // After what the page says, not above it.
    expect(within(main).getByText('page-body').compareDocumentPosition(next)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('say it in Dutch for a Dutch reader', () => {
    renderAt('/mappings/x/verify', 'nl');
    expect(screen.getByRole('link', { name: 'Volgende stap: Bevestigd →' })).toHaveAttribute(
      'href',
      '/mappings/x/confirmed',
    );
  });

  it.each(['finish', 'confirm', 'report'])('have no next step on %s', (path) => {
    renderAt(`/mappings/x/${path}`);
    expect(screen.queryByRole('link', { name: /^Next step/ })).not.toBeInTheDocument();
  });

  it('have none on the hub, or on a page that is not under a migration', () => {
    const hub = renderAt('/mappings/x');
    expect(screen.queryByRole('link', { name: /^Next step/ })).not.toBeInTheDocument();
    hub.unmount();
    renderAt('/deletions');
    expect(screen.queryByRole('link', { name: /^Next step/ })).not.toBeInTheDocument();
  });
});

describe('NextStepLink follows the hub’s order', () => {
  it.each([
    ['deletions', 'Moves', 'moves'],
    ['moves', 'Failures', 'failures'],
    ['failures', 'Sharing', 'sharing'],
    ['sharing', 'Check', 'verify'],
    ['verify', 'Confirmed', 'confirmed'],
    ['confirmed', 'Finish', 'finish'],
  ] as const)('from %s, on to %s', (from, name, path) => {
    render(
      <MemoryRouter>
        <NextStepLink mappingId="a b" screen={from} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: `Next step: ${name} →` })).toHaveAttribute(
      'href',
      `/mappings/a%20b/${path}`,
    );
  });
});
