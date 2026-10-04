// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A WAY BACK TO THE SITE (workplan 0152 T9).
 *
 * The site's *Sign in* leads to `/login`, and its *Request access* to
 * `/request-access`. Both pages were the app's own blue, with a lucide icon,
 * and had no way back but the browser's. Now each draws the site's mark and
 * *← ownpace.eu*, which leads to the site's home page in the reader's
 * language: the English home, or the Dutch one under `/nl/`.
 *
 * Where the address comes from, the deployment's own site setting, is
 * `services/site-home.ts`'s, held by
 * `scripts/one-look-from-the-site-to-the-app.unit.test.ts`. This file holds
 * what a person meets: a link named for the site, going home, in their
 * language, beside the mark. The setting is unset here, so the site is the
 * production one.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Login from './Login.tsx';
import RequestAccess from './RequestAccess.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

// The sign-in page asks which way in the API takes; the header is drawn while
// it asks, which is all this file reads.
vi.mock('../services/oidc.ts', () => ({ oidcConfig: vi.fn(() => null), beginSignIn: vi.fn() }));
vi.mock('../services/auth-mode.ts', () => ({ fetchAuthMode: vi.fn(() => new Promise(() => {})) }));
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.1.0-rc.1', commit: '72a78d4' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => 'v0.1.0-rc.1 · 72a78d4',
  shortCommit: (c: string) => c.slice(0, 7),
}));
vi.mock('../services/api.ts', () => ({ default: { post: vi.fn() } }));

const PAGES = [
  ['the sign-in page', '/login', <Login key="login" />],
  ['the request page', '/request-access', <RequestAccess key="request" />],
] as const;

function renderIn(locale: 'en' | 'nl', path: string, page: React.ReactElement) {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('the front door leads back to the site, in the reader’s language (0152 T9)', () => {
  it.each(PAGES)('%s: “← ownpace.eu” goes to the English home', (_name, path, page) => {
    renderIn('en', path, page);
    const back = screen.getByRole('link', { name: 'ownpace.eu' });
    expect(back).toHaveAttribute('href', 'https://www.ownpace.eu/');
    // The arrow is drawn, not read.
    expect(back.textContent).toBe('←ownpace.eu');
  });

  it.each(PAGES)('%s: in Dutch it goes to the Dutch home', (_name, path, page) => {
    renderIn('nl', path, page);
    expect(screen.getByRole('link', { name: 'ownpace.eu' })).toHaveAttribute('href', 'https://www.ownpace.eu/nl/');
  });

  it.each(PAGES)('%s draws the site’s mark, and hides it from a screen reader', (_name, path, page) => {
    const { container } = renderIn('en', path, page);
    const mark = container.querySelector('svg[aria-hidden="true"] rect[fill="#0E4F4A"]');
    expect(mark, 'no site mark on the page').not.toBeNull();
    // The page's title stands under it, so the mark adds nothing to read.
    expect(screen.queryByRole('img')).toBeNull();
  });
});
