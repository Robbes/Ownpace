// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A HINT THAT KNOWS THE SERVICE HAS AN APP (workplan 0148 T2 (a) and (b)).
 *
 * The readiness review of 2026-09-23 read the wizard the way a tester on
 * `ownpace-live` would meet it. With the deployment's Google client
 * configured, the client pair folded away under *Use your own Google client*
 * with the line "This deployment has its own Google client" — and beside that
 * fold the same screen said "Uses your own Google OAuth client and a read-only
 * token". After *Connect with Google* it said "Register this exact address in
 * your Google client", about a client the tester does not have. And the setup
 * checklist opened on *Create a Google OAuth client*. The owner (D2): "self-
 * hosters need to make those, but endusers dont, or not in the ownpace-managed
 * deployment. Stop the false hints on managed."
 *
 * The rule reads ONE fact, the one the fold already read: which applications
 * this deployment carries, from `/api/provider-clients`. Not the edition's
 * name. So a managed deployment without a provider's app, and the appliance,
 * which serves no such route, keep every line and every step.
 *
 * What is pinned, in English and in Dutch:
 *  1. the redirect line under the button shows only when the consent used a
 *     client the person typed in, in the consent panel the Accounts page and
 *     *Start a migration* share;
 *  2. a checklist the deployment emptied names the button, not "Nothing to
 *     set up".
 *
 * The wizard's about-line after a card, which read the same fact, retired
 * with the wizard (0153 D5).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { clients, dropboxAuthorize, googleAuthorize, setupGet } = vi.hoisted(() => ({
  clients: vi.fn(),
  dropboxAuthorize: vi.fn(),
  googleAuthorize: vi.fn(),
  setupGet: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    googleAuthorize,
    dropboxAuthorize,
    microsoftAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  },
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({ ok: false, reason: 'not in this test' }),
    rotate: vi.fn(),
    test: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: { get: clients },
  setupApi: { get: setupGet, setStep: vi.fn() },
}));

import Setup from './Setup.tsx';
import { ProviderConsentPanel, useProviderConsent } from '../components/ProviderConsent.tsx';

type Locale = 'en' | 'nl';
type Fact = 'deployment' | 'connection';

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

const facts = (google: Fact, dropbox: Fact) => ({ google, dropbox, microsoft: 'connection' });

function wrap(locale: Locale, node: React.ReactNode, path: string, route: string) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  googleAuthorize.mockResolvedValue({
    url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=x',
    redirectUri: 'https://app.example.test/api/migrations/google/callback',
    scope: 'x',
  });
  dropboxAuthorize.mockResolvedValue({
    url: 'https://www.dropbox.com/oauth2/authorize?client_id=x',
    redirectUri: 'https://app.example.test/api/migrations/dropbox/callback',
  });
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('the redirect line under the button (0148 T2 (a))', () => {
  const connect = () => screen.getByRole('button', { name: /Connect with Dropbox/i });
  const ADDRESS = 'https://app.example.test/api/migrations/dropbox/callback';

  /** The Connections page's consent, without the page around it. */
  const Panel: React.FC<{ values: Record<string, string> }> = ({ values }) => {
    const consent = useProviderConsent({
      role: 'source',
      type: 'dropbox',
      fields: credentialFieldsFor('source', 'dropbox'),
      values,
      onToken: () => {},
      refusalText: (e) => String(e),
    });
    return <ProviderConsentPanel consent={consent} />;
  };

  for (const [fact, values, shown] of [
    ['deployment', { username: 'owner@example.invalid' }, false],
    [
      'connection',
      { username: 'owner@example.invalid', clientId: 'own-key', clientSecret: 'own-secret' },
      true,
    ],
  ] as const) {
    it(`in the consent panel: ${shown ? 'present' : 'absent'} when the consent used ${
      fact === 'deployment' ? "the service's app" : 'an app the person typed in'
    }`, async () => {
      clients.mockResolvedValue(facts('connection', fact));
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      try {
        wrap('en', <Panel values={values} />, '/connections', '/connections');
        await waitFor(() => expect(connect()).toBeEnabled());
        fireEvent.click(connect());
        await waitFor(() => expect(open).toHaveBeenCalled());
        if (shown) {
          expect(await screen.findByText(/Register this exact address/)).toBeTruthy();
        } else {
          expect(screen.queryByText(/Register this exact address/)).toBeNull();
          expect(screen.queryByText(ADDRESS)).toBeNull();
        }
      } finally {
        open.mockRestore();
      }
    });
  }
});

describe('a checklist the deployment emptied names the button (0148 T2 (b))', () => {
  const emptied = (provider: string) => ({
    side: 'source',
    provider,
    steps: [],
    progress: { total: 0, done: 0, skipped: 0, open: 0, blockedOnOthers: 0, complete: false },
  });

  for (const locale of ['en', 'nl'] as const) {
    for (const [type, name] of [
      ['google-drive', 'Google'],
      ['google', 'Google'],
      ['dropbox', 'Dropbox'],
    ] as const) {
      it(`${locale}: ${type}`, async () => {
        setupGet.mockResolvedValue(emptied(type));
        wrap(locale, <Setup />, `/setup/source/${type}`, '/setup/:side/:provider');
        const expected = words(locale, 'setup.deploymentApp').replace(/\{provider\}/g, name);
        expect(await screen.findByText(expected)).toBeTruthy();
        expect(screen.queryByText(words(locale, 'setup.nothingToDo'))).toBeNull();
      });
    }
  }

  it('a provider with nothing to prepare still says so', async () => {
    // `microsoft` has no profile yet (0148 T5 (b)); Apple has one since T5 (a).
    setupGet.mockResolvedValue(emptied('microsoft'));
    wrap('en', <Setup />, '/setup/source/microsoft', '/setup/:side/:provider');
    expect(await screen.findByText(words('en', 'setup.nothingToDo'))).toBeTruthy();
  });
});
