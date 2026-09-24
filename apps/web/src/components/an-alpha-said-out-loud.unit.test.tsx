// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ALPHA SAID OUT LOUD (workplan 0131 T1).
 *
 * Nothing told a tester the service was a test. No string in the app or the
 * mails called it an alpha, a beta, a trial or a test (0131 §1). The owner's
 * answer (0131 D1, D4): free, by invitation, a few weeks, no obligations either
 * side, and called an *alpha*.
 *
 * So, while the deployment says so, a note stands at the top of every signed-in
 * page, and under the title of `/login` and `/request-access`, which a tester
 * sees before there is any session: in English and in Dutch. "Every signed-in
 * page" is `Layout`'s AND `/invitations`, which sits outside `Layout` on
 * purpose (0099): an invited member never passes `/request-access` and never
 * receives the grant mail, so that screen is where they first meet the
 * service. And `/request-access` keeps the note after the request is sent. The same words
 * close the access-granted mail, and the last case below holds the two
 * together, because 0139's conditions will change them and a note that says
 * one thing while the mail says another is worse than either alone.
 *
 * WITHOUT THE SETTING, NONE OF IT. The OTA stack and every other deployment
 * carry no note. And an APPLIANCE never does, whatever its bundle was built
 * with: an appliance lets nobody in, so there is no alpha for it to be in.
 *
 * The setting is a build argument, `VITE_OWNPACE_STAGE`, stubbed here the way
 * Vite would bake it (`isAlpha` in `AlphaNote.tsx` reads it directly so this
 * works).
 * The edition is mocked through `services/edition`, the sanctioned seam.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderEvent } from '@openmig/shared';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    user: null as null | { name: string; email: string; role?: string },
    login: () => {},
    logout: () => {},
    operator: false,
    tenantCount: 1,
  },
}));

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

// The layout's header reads a migration's name; nothing here is on one.
vi.mock('../services/mapping-service.ts', () => ({
  mappingApi: { get: () => new Promise<never>(() => {}) },
}));

// The sign-in page asks the API what it accepts before it offers anything. The
// note does not wait for that answer: it is there while the page is checking,
// and it is there when the API cannot be asked at all.
vi.mock('../services/auth-mode.ts', () => ({
  fetchAuthMode: () => new Promise<never>(() => {}),
}));

import Layout from './Layout.tsx';
import Login from '../pages/Login.tsx';
import RequestAccess from '../pages/RequestAccess.tsx';
import Invitations from '../pages/Invitations.tsx';
import apiClient from '../services/api.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

/** 0131 T1's words. They must match 0139's alpha conditions once those exist. */
const SAID = {
  en: {
    lead: 'Alpha: a small invited group is trying this service out.',
    all:
      'Alpha: a small invited group is trying this service out. Nothing is charged, nothing is ' +
      'backed up, and the alpha can end. Keep your old account until you have checked what arrived.',
  },
  nl: {
    lead: 'Alfa: een kleine, uitgenodigde groep probeert deze dienst uit.',
    all:
      'Alfa: een kleine, uitgenodigde groep probeert deze dienst uit. Er wordt niets in rekening ' +
      'gebracht, er worden geen back-ups gemaakt en de alfa kan stoppen. Houd uw oude account tot ' +
      'u hebt gecontroleerd wat er is aangekomen.',
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Each page as the app mounts it: inside the real LocaleProvider, on its own route. */
const PAGES = {
  layout: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route path="*" element={<div>page-body</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  login: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Login />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  requestAccess: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/request-access']}>
            <RequestAccess />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  /** The same page once the request has gone: the form is replaced by a confirmation. */
  requestAccessSent: async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { received: true } });
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/request-access?email=tester%40example.test']}>
            <RequestAccess />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(document.querySelector('form button[type="submit"]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('form')).toBeNull());
  },
  /** Signed in, outside `Layout` (0099). No token in the store, so it asks nothing. */
  invitations: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/invitations']}>
            <Invitations />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
} as const;

type Page = keyof typeof PAGES;
const PAGE_NAMES = Object.keys(PAGES) as Page[];

const inLocale = (locale: Locale) => window.localStorage.setItem('ownpace.locale', locale);

/** The note, found by its first sentence and returned as the element that carries the role. */
function theNote(locale: Locale): HTMLElement {
  const lead = screen.getByText(SAID[locale].lead);
  const note = lead.closest('[role="note"]');
  expect(note, 'the alpha sentence is on the page but not inside a role="note"').not.toBeNull();
  return note as HTMLElement;
}

/** Nothing on the page names an alpha, in either language. */
function noAlphaAnywhere(): void {
  for (const locale of LOCALES) {
    expect(screen.queryByText(SAID[locale].lead)).toBeNull();
  }
  expect(document.body.textContent ?? '').not.toMatch(/\balpha\b|\balfa\b/i);
}

beforeEach(() => {
  editionFlag.selfhost = false;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('with the alpha setting on', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
  });

  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page} says it, whole, in %s`, async (locale) => {
      inLocale(locale);
      await PAGES[page]();
      expect(theNote(locale)).toHaveTextContent(SAID[locale].all);
    });
  }

  it('stands at the top of every signed-in page, above the page itself', () => {
    PAGES.layout();
    const note = theNote('en');
    const body = screen.getByText('page-body');
    expect(note.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // In the page's own column, where the platform hold's banner is, not in
    // the sidebar a phone folds away.
    expect(note.closest('main')).not.toBeNull();
  });

  it.each([
    // What each page shows below its title: the sign-in page's line while it
    // asks the API what it accepts, the request form's first field, the way
    // back to sign-in once the request has gone, and the invitation screen's
    // closing line.
    ['login', 2, () => screen.getByText(/checking how this deployment/i)],
    ['requestAccess', 2, () => screen.getByLabelText(/email address/i)],
    ['requestAccessSent', 2, () => screen.getByRole('link', { name: /sign in/i })],
    ['invitations', 1, () => screen.getByText(/not now changes nothing/i)],
  ] as const)('%s: stands under the title, above the rest of the page', async (page, level, rest) => {
    await PAGES[page]();
    const title = screen.getByRole('heading', { level });
    const note = theNote('en');
    expect(title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(rest()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is a note, never an alarm', () => {
    // A standing fact about the service, not a failure. `role="alert"` would
    // be read out on every page a screen reader opens.
    PAGES.layout();
    expect(theNote('en')).toHaveAttribute('role', 'note');
    expect(theNote('en').closest('[role="alert"]')).toBeNull();
  });
});

describe('without the setting', () => {
  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page} says nothing about an alpha, in %s`, async (locale) => {
      inLocale(locale);
      await PAGES[page]();
      noAlphaAnywhere();
    });
  }

  it('and a value that is not "alpha" is not the alpha', () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'beta');
    PAGES.layout();
    noAlphaAnywhere();
  });
});

describe('on an appliance, never', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    editionFlag.selfhost = true;
  });

  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page} says nothing about an alpha, in %s, even built with the setting`, async (locale) => {
      inLocale(locale);
      await PAGES[page]();
      noAlphaAnywhere();
    });
  }
});

describe('the grant mail says what the pages say', () => {
  /** The mail as the API builds it during the alpha (`accessGrantedEvent`). */
  const grantedInTheAlpha = {
    kind: 'access_granted',
    organisation: 'Familie de Vries',
    appUrl: 'https://app.ownpace.eu',
    email: 'stranger@example.test',
    alpha: true,
  } as const;

  it.each(LOCALES)('in %s, word for word', (locale) => {
    const onScreen = (['alpha.note.lead', 'alpha.note.terms', 'alpha.note.keep'] as const)
      .map((key) => STRINGS[locale][key])
      .join(' ');
    expect(onScreen).toBe(SAID[locale].all);
    expect(renderEvent(grantedInTheAlpha, locale).body).toContain(onScreen);
  });
});
