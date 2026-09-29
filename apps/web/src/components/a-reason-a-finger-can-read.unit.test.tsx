// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REASON A FINGER CAN READ (workplan 0145 T7 (a)).
 *
 * A *Connect with …* button is greyed out until the consent has what it needs:
 * the account address, a tick for what to migrate, or a client pair where the
 * deployment carries none. Why it was greyed out lived only in the button's
 * `title`, a tooltip that shows on a mouse's hover. A phone has no hover, a
 * disabled button takes no focus, and a screen reader is not bound to read a
 * title, so a tester on a phone met a grey button and no reason.
 *
 * Now the reason is text under the button with `role="status"`, the pattern
 * of Next's reason at the foot of the wizard, and the tooltip is gone. What is
 * pinned, in both doors (the Connections page's panel and the wizard's source
 * step), in English and in Dutch:
 *
 * - with nothing ticked, the button is disabled, it carries no `title`, and
 *   the reason is visible text in a status straight under it, heard once;
 * - the reason follows the state: a tick takes it away and the button wakes;
 * - with the deployment carrying no client pair, the other reason is said the
 *   same way.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { list, clients } = vi.hoisted(() => ({
  list: vi.fn(),
  clients: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  },
  connectionsApi: {
    list,
    add: vi.fn(),
    rotate: vi.fn(),
    test: vi.fn(),
    remove: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: { get: clients },
  setupApi: { get: vi.fn(), setStep: vi.fn() },
}));

import CreateMapping from '../pages/CreateMapping.tsx';
import Connections from '../pages/Connections.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

const LIVE = new Set(['alert', 'status', 'log', 'marquee', 'timer']);
const liveAncestor = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (LIVE.has(p.getAttribute('role') ?? '')) return p;
    const live = p.getAttribute('aria-live');
    if (live !== null && live !== 'off') return p;
  }
  return null;
};

function wrap(locale: Locale, node: React.ReactNode, path: string) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

/** The Google account card, with its address typed, in a door that has cards. */
const pickGoogleAccount = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
  fireEvent.change(screen.getByPlaceholderText('someone@example.com'), {
    target: { value: 'owner@gmail.com' },
  });
};

/** Every face box beside the button, unticked, so nothing is asked for. */
const untickEverything = () => {
  for (const box of screen.getAllByRole('checkbox')) {
    if ((box as HTMLInputElement).checked) fireEvent.click(box);
  }
  for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
};

const DOORS: ReadonlyArray<{ readonly name: string; readonly open: (locale: Locale) => Promise<void> }> = [
  {
    name: 'the Connections page’s panel',
    open: async (locale) => {
      wrap(locale, <Connections />, '/connections');
      fireEvent.click(await screen.findByRole('button', { name: words(locale, 'connections.add') }));
      pickGoogleAccount();
    },
  },
  {
    name: 'the wizard’s source step',
    open: async (locale) => {
      wrap(locale, <CreateMapping />, '/mappings/new');
      pickGoogleAccount();
    },
  },
];

/** The reason under `button`, as a finger meets it: visible text in a status, heard once. */
const theReasonUnder = (button: HTMLElement, reason: string): HTMLElement => {
  const status = screen.queryAllByRole('status').find((el) => el.textContent?.includes(reason));
  expect(status, `no role="status" says "${reason}"`).toBeDefined();
  expect(status).toBeVisible();
  expect(status!.previousElementSibling, 'the reason is not straight under its button').toBe(button);
  expect(liveAncestor(status!), 'the reason sits inside another live region and is read twice').toBeNull();
  return status!;
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  list.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('a reason a finger can read (0145 T7 (a))', () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      for (const door of DOORS) {
        describe(door.name, () => {
          it('with nothing ticked, says why Connect is greyed out, as text under it and not in a tooltip', async () => {
            clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
            await door.open(locale);
            const connect = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
            await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
            untickEverything();

            const why = words(locale, 'wizard.google.connect.needsDomains');
            await waitFor(() => expect(connect).toBeDisabled());
            expect(connect, 'the reason is still a tooltip a finger cannot open').not.toHaveAttribute('title');
            const reason = theReasonUnder(connect, why);

            // A tick is what it asked for: the reason goes, the button wakes.
            fireEvent.click(screen.getAllByRole('checkbox')[0]!);
            await waitFor(() => expect(connect).toBeEnabled());
            expect(reason, 'the reason stayed after it was answered').not.toBeInTheDocument();
            expect(screen.queryAllByRole('status').some((el) => el.textContent?.includes(why))).toBe(false);
            expect(connect).not.toHaveAttribute('title');
          });

          it('without the deployment’s client, asks for the pair the same way', async () => {
            clients.mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' });
            await door.open(locale);
            const connect = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
            await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
            if (!screen.getAllByRole('checkbox').some((box) => (box as HTMLInputElement).checked)) {
              fireEvent.click(screen.getAllByRole('checkbox')[0]!);
            }

            await waitFor(() => expect(connect).toBeDisabled());
            expect(connect).not.toHaveAttribute('title');
            theReasonUnder(connect, words(locale, 'wizard.google.connect.needsClient'));
          });
        });
      }
    });
  }
});
