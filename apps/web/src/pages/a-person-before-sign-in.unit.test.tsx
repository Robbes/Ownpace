// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON TO WRITE TO, BEFORE AND AFTER SIGN-IN (workplan 0144 T6 (a)).
 *
 * A tester who was stuck before signing in had nobody to write to. The report
 * form (0130) sits inside the signed-in layout, and its API requires a
 * session. `/login`, `/request-access`, `/auth/callback` and `/invitations`
 * sit outside the layout, so they had no report link and no address. And a
 * signed-in tester on a stack without a helpdesk had neither: the report link
 * is hidden when it could reach nobody (0144 §1, *Reaching a person*).
 *
 * So, while the deployment names an address:
 *
 *  - the four pages carry one line, in the reader's language, with the
 *    address as a `mailto:` link: EN *"Stuck? Mail {address} and name the page
 *    you are on. Never send a password."*, NL *"Komt u er niet uit? Mail naar
 *    {address} en noem de pagina waarop u bent. Stuur nooit een wachtwoord."*
 *    On `/auth/callback` that is both the no-organisation state and the failed
 *    one; on `/request-access`, the form and the page after it was sent; on
 *    `/login`, also when the API cannot be asked, which is when it is needed;
 *  - the sidebar shows *"Help: {address}"* / *"Hulp: {address}"*, as a
 *    `mailto:` link, where *Report a problem* would be, when the report form
 *    is not available. So a signed-in tester always has one of the two, and
 *    never both.
 *
 * WITHOUT THE SETTING, NONE OF IT. Unset or empty, nothing new is shown
 * anywhere: the OTA stack and every other deployment are unchanged. The
 * address is the owner's (0144 T0, answered in 0133), and it lives in
 * `ownpace-live`'s `.env`, never in the code: every address below is an
 * example.
 *
 * The setting is a build argument, `VITE_SUPPORT_EMAIL`, stubbed here the way
 * Vite would bake it (`supportAddress` in `SupportLine.tsx` reads it directly
 * so this works). `scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts`
 * holds `managed.yml` to handing it to the web build. The edition is mocked
 * through `services/edition`, the sanctioned seam.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { editionFlag, authState, reporting, authMode, signIn, me } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    token: 'a-token' as string | null,
    user: { name: 'tester', email: 'tester@example.test', role: 'owner' } as null | {
      name: string;
      email: string;
      role?: string;
    },
    login: () => {},
    logout: () => {},
    operator: false,
    tenantCount: 1,
  },
  /** What `GET /problem-reports/available` answers: the form on or off. */
  reporting: { answer: (): Promise<boolean> => Promise.resolve(false) },
  /** What the sign-in page learns about the API; by default it is still asking. */
  authMode: { answer: (): Promise<unknown> => new Promise<never>(() => {}) },
  /** The code exchange on `/auth/callback`. */
  signIn: { answer: (): Promise<string> => Promise.resolve('a-token') },
  /** `GET /api/me`, for the callback and the invitation screen. */
  me: { answer: (): Promise<unknown> => new Promise<never>(() => {}) },
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

vi.mock('../services/problem-report-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/problem-report-service.ts')>();
  return { ...actual, fetchReportingAvailable: () => reporting.answer() };
});

vi.mock('../services/auth-mode.ts', () => ({
  fetchAuthMode: () => authMode.answer(),
}));

vi.mock('../services/oidc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/oidc.ts')>();
  return { ...actual, completeSignIn: () => signIn.answer() };
});

vi.mock('../services/session.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/session.ts')>();
  return { ...actual, fetchMe: () => me.answer() };
});

// The pages outside the layout carry the build stamp, which asks the server
// what it runs. Not under test here.
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.1.0-rc.1', commit: '72a78d4' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => 'v0.1.0-rc.1 · 72a78d4',
  shortCommit: (c: string) => c.slice(0, 7),
}));

import Layout from '../components/Layout.tsx';
import Login from './Login.tsx';
import RequestAccess from './RequestAccess.tsx';
import AuthCallback from './AuthCallback.tsx';
import Invitations from './Invitations.tsx';
import apiClient from '../services/api.ts';
import { LocaleProvider } from '../i18n/index.tsx';

/** An example, never the owner's address (0144 T0: it goes in `.env`). */
const ADDRESS = 'support@example.test';

/** 0144 §3 T6's words, with the address filled in. */
const SAID = {
  en: {
    line: `Stuck? Mail ${ADDRESS} and name the page you are on. Never send a password.`,
    sidebar: `Help: ${ADDRESS}`,
  },
  nl: {
    line:
      `Komt u er niet uit? Mail naar ${ADDRESS} en noem de pagina waarop u bent. ` +
      'Stuur nooit een wachtwoord.',
    sidebar: `Hulp: ${ADDRESS}`,
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** A page as the app mounts it: inside the real LocaleProvider, at its own address. */
const mount = (path: string, page: React.ReactNode) =>
  render(
    <QueryClientProvider client={client()}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );

/**
 * The four pages outside the layout, in every state 0144 T6 names. Each
 * resolves once the page has reached that state.
 */
const BEFORE_SIGN_IN = {
  /** While the page asks the API what it accepts. */
  login: async () => {
    mount('/login', <Login />);
    await screen.findByText(/checking how this deployment|controleren hoe deze/i);
  },
  /** Once the API has answered, as a tester on the hosted service sees it. */
  loginAnswered: async () => {
    authMode.answer = () => Promise.resolve({ mode: 'managed', acceptsSeedToken: false });
    mount('/login', <Login />);
    await waitFor(() =>
      expect(document.body.textContent).not.toMatch(/checking how this deployment|controleren hoe deze/i),
    );
  },
  /** When the API cannot be asked: nobody can sign in, so a person is what is left. */
  loginWithoutAnApi: async () => {
    authMode.answer = () => Promise.reject(new Error('Network Error'));
    mount('/login', <Login />);
    await screen.findByRole('alert');
  },
  requestAccess: async () => {
    mount('/request-access', <RequestAccess />);
    await screen.findByRole('textbox', { name: /email|e-mail/i });
  },
  /** The same address once the request has gone. */
  requestAccessSent: async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { received: true } });
    mount('/request-access?email=tester%40example.test', <RequestAccess />);
    fireEvent.click(document.querySelector('form button[type="submit"]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('form')).toBeNull());
  },
  /** A sign-in that worked and found no organisation. */
  callbackNoOrganisation: async () => {
    me.answer = () =>
      Promise.resolve({ userId: 'sub-1', email: 'tester@example.test', tenants: [], invitations: [] });
    mount('/auth/callback', <AuthCallback />);
    await waitFor(() => expect(document.querySelector('a[href^="/request-access"]')).not.toBeNull());
  },
  /** A sign-in that did not complete. */
  callbackFailed: async () => {
    signIn.answer = () => Promise.reject(new Error('The sign-in did not start in this browser tab.'));
    mount('/auth/callback', <AuthCallback />);
    await screen.findByRole('alert');
  },
  /** Signed in, outside `Layout` (0099), with nothing waiting. */
  invitations: async () => {
    me.answer = () => Promise.resolve({ userId: 'sub-1', tenants: [], invitations: [] });
    mount('/invitations', <Invitations />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Nothing is waiting for you|Er wacht niets op u/),
    );
  },
} as const;

type Page = keyof typeof BEFORE_SIGN_IN;
const PAGE_NAMES = Object.keys(BEFORE_SIGN_IN) as Page[];

/** How often the layout asked whether the report form is on. */
let reportingAsked = 0;

/** The signed-in layout, once it knows whether the report form is on. */
const layout = async () => {
  mount(
    '/dashboard',
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="*" element={<div>page-body</div>} />
      </Route>
    </Routes>,
  );
  await screen.findByText('page-body');
  // The report link's question, answered: let the query settle.
  await waitFor(() => expect(reportingAsked).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const inLocale = (locale: Locale) => window.localStorage.setItem('ownpace.locale', locale);

/** Every `mailto:` link on the page. */
const mailLinks = (): HTMLAnchorElement[] =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]'));

/** The one mail link, to this address. */
function theMailLink(): HTMLAnchorElement {
  const links = mailLinks();
  expect(links, 'one mailto: link, not none and not two').toHaveLength(1);
  expect(links[0]!.getAttribute('href')).toBe(`mailto:${ADDRESS}`);
  return links[0]!;
}

/** Nothing on the page is a way to write to anybody, in either language. */
function nobodyToWriteTo(): void {
  expect(mailLinks()).toEqual([]);
  const text = document.body.textContent ?? '';
  expect(text).not.toContain(ADDRESS);
  expect(text).not.toMatch(/Stuck\?|Komt u er niet uit\?|\bHelp:|\bHulp:/);
}

beforeEach(() => {
  editionFlag.selfhost = false;
  authState.token = 'a-token';
  reportingAsked = 0;
  reporting.answer = () => {
    reportingAsked += 1;
    return Promise.resolve(false);
  };
  authMode.answer = () => new Promise<never>(() => {});
  signIn.answer = () => Promise.resolve('a-token');
  me.answer = () => new Promise<never>(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('with an address set', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', ADDRESS);
  });

  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page}: one line, with the address as a mailto: link, in %s`, async (locale) => {
      inLocale(locale);
      await BEFORE_SIGN_IN[page]();
      const link = theMailLink();
      expect(link).toHaveTextContent(ADDRESS);
      // The whole sentence, in the reader's language, around the link.
      expect(link.closest('p')).toHaveTextContent(SAID[locale].line);
    });
  }

  it.each(LOCALES)('the sidebar: "Help" where Report a problem would be, in %s', async (locale) => {
    inLocale(locale);
    await layout();
    const link = theMailLink();
    expect(link).toHaveTextContent(SAID[locale].sidebar);
    // In the sidebar's own foot, beside Sign out, where the report link goes.
    expect(link.closest('aside')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /report a problem|een probleem melden/i })).toBeNull();
  });

  it('the sidebar: not while the form is on, because then the form is the way to a person', async () => {
    reporting.answer = () => {
      reportingAsked += 1;
      return Promise.resolve(true);
    };
    await layout();
    expect(await screen.findByRole('link', { name: /report a problem/i })).toBeInTheDocument();
    nobodyToWriteTo();
  });

  it('the sidebar: not before the answer, so it never swaps for the form', async () => {
    reporting.answer = () => {
      reportingAsked += 1;
      return new Promise<boolean>(() => {});
    };
    await layout();
    nobodyToWriteTo();
  });

  it('an address with spaces around it is the address', async () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', `  ${ADDRESS}\n`);
    await BEFORE_SIGN_IN.login();
    expect(theMailLink()).toHaveTextContent(ADDRESS);
  });
});

describe('without an address', () => {
  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page}: nothing new, in %s`, async (locale) => {
      inLocale(locale);
      await BEFORE_SIGN_IN[page]();
      nobodyToWriteTo();
    });
  }

  it.each(LOCALES)('the sidebar: nothing new with the form off, in %s', async (locale) => {
    inLocale(locale);
    await layout();
    nobodyToWriteTo();
  });

  it.each(['', '   '])('an empty setting (%j) is no setting', async (value) => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', value);
    await BEFORE_SIGN_IN.login();
    nobodyToWriteTo();
    cleanup();
    await layout();
    nobodyToWriteTo();
  });
});

describe('on an appliance, never', () => {
  // Its owner is the person; the address is the hosted service's. The pages
  // before sign-in are managed only by the route table, and the sidebar is
  // held here, even for a bundle built with the setting.
  it('the sidebar says nothing new', async () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', ADDRESS);
    editionFlag.selfhost = true;
    mount(
      '/dashboard',
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="*" element={<div>page-body</div>} />
        </Route>
      </Routes>,
    );
    await screen.findByText('page-body');
    await new Promise((resolve) => setTimeout(resolve, 0));
    nobodyToWriteTo();
  });
});
