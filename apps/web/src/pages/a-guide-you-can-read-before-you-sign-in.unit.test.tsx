// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A GUIDE YOU CAN READ BEFORE YOU SIGN IN (workplan 0152; the owner,
 * 2026-10-04: *"Guide links on the Leaving pages: yes, make public"*).
 *
 * The site's *Leaving …* pages link a guide section for each limit they name,
 * such as `https://app…/docs/google#gmail` (`site/sources.mjs`, 0152 T5 (a)).
 * The guides sat in the signed-in tree, so a visitor without an account was
 * sent to `/login`, and the link had to say *sign in first*.
 *
 * This renders the REAL route table, with the real guide page, its public
 * frame (`PublicDocs`) and the real layout, and holds:
 *
 * - without a session, on managed, `/docs` and every guide section a Leaving
 *   page links show the guide in the front door's look (the way back to the
 *   site, its mark), at the address asked for: never the sign-in page;
 * - and no request goes through the app's own clients, whose 401 is a dead
 *   session that sends the browser to the sign-in page;
 * - with a session, the same guide sits inside the layout's menu, and asks
 *   for the deployment's facts as before. That is also the control: it is
 *   what shows the client below is the one the guide's request goes through;
 * - every other page in the tree still sends a visitor without a session to
 *   sign in;
 * - the appliance, which has nobody to sign in, keeps its layout.
 *
 * The edition through `services/edition`, the sanctioned seam; the session
 * through the store, as `AppRoutes.unit.test.tsx` mocks it.
 */
import type { FC } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { editionFlag, authState, api, attention, STAMP } = vi.hoisted(() => {
  /** An answer that never comes: what is under test is whether anybody asked. */
  const never = (): Promise<never> => new Promise<never>(() => {});
  const request = () => vi.fn<(url: string, ...rest: unknown[]) => Promise<never>>(never);
  return {
    editionFlag: { selfhost: false },
    authState: {
      isAuthenticated: false,
      token: null as string | null,
      tenantId: null as string | null,
      user: null as null | { name: string; email: string; role?: string },
      logout: () => {},
      operator: false,
      tenantCount: 0,
    },
    /**
     * The app's client (`services/api.ts`): what a page sends with the
     * session's token, and what turns a 401 into the sign-in page.
     */
    api: { get: request(), post: request(), put: request(), patch: request(), delete: request() },
    /** The layout's one read over the operating client, the other one that does. */
    attention: vi.fn(never),
    STAMP: 'v0.1.0-rc.1 · 72a78d4',
  };
});

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock('../services/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api.ts')>()),
  default: api,
}));

vi.mock('../services/operating-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/operating-service.ts')>()),
  fetchAttention: attention,
}));

// The stamp asks the server what it runs; the frame is what is read here.
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.1.0-rc.1', commit: '72a78d4' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => STAMP,
  shortCommit: (c: string) => c.slice(0, 7),
}));

// A marker: arriving at the sign-in page is the thing that must not happen.
vi.mock('./Login.tsx', () => ({ default: () => <div>screen:login</div> }));

import AppRoutes from '../AppRoutes.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';

/** Where the router is, hash and all: a redirect is read here, not guessed. */
const Where: FC = () => {
  const { pathname, hash } = useLocation();
  return <div data-testid="where">{pathname + hash}</div>;
};

function renderAt(path: string, locale: Locale = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          <Where />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

/** Every request the app's two session clients were asked for. */
const sessionRequests = () => [
  ...Object.values(api).flatMap((method) => method.mock.calls.map(([url]) => url)),
  ...attention.mock.calls.map(() => '/attention'),
];

/** The front door's look (0152 T9): the way back to the site, and its mark. */
function expectTheFrontDoorsLook(container: HTMLElement, locale: Locale = 'en') {
  expect(screen.getByRole('link', { name: 'ownpace.eu' })).toHaveAttribute(
    'href',
    locale === 'nl' ? 'https://www.ownpace.eu/nl/' : 'https://www.ownpace.eu/',
  );
  expect(
    container.querySelector('svg[aria-hidden="true"] rect[fill="#0E4F4A"]'),
    'no site mark on the page',
  ).not.toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: STRINGS[locale]['nav.docs'] })).toBeInTheDocument();
}

/** The guide sections the site's Leaving pages link, read off `site/sources.mjs`. */
const LEAVING_LINKS = [
  ...readFileSync(join(__dirname, '../../../../site/sources.mjs'), 'utf8').matchAll(
    /guide: '([a-z0-9-]+)#([a-z0-9-]+)'/g,
  ),
].map((m) => ({ slug: m[1]!, section: m[2]! }));

let scrolled: string[] = [];

beforeEach(() => {
  editionFlag.selfhost = false;
  Object.assign(authState, {
    isAuthenticated: false,
    token: null,
    tenantId: null,
    user: null,
    operator: false,
    tenantCount: 0,
  });
  for (const method of Object.values(api)) method.mockClear();
  attention.mockClear();
  window.localStorage.clear();
  // jsdom has no layout, so it has no `scrollIntoView`: record which section
  // the guide was asked to scroll to.
  scrolled = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(this: Element) {
      scrolled.push(this.id);
    },
  });
});

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
});

describe('without a session, on managed, the guides are a page of their own (0152)', () => {
  it('/docs lists the guides in the front door’s look, at its own address', async () => {
    const { container } = renderAt('/docs');

    expect(screen.getByRole('heading', { level: 2, name: STRINGS.en['docs.title'] })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Google — / })).toHaveAttribute('href', '/docs/google');
    expectTheFrontDoorsLook(container);
    expect(where()).toBe('/docs');
    expect(screen.queryByText('screen:login')).not.toBeInTheDocument();
    // The checklist's tab belongs to an organisation, and so does the menu.
    expect(screen.queryByRole('link', { name: STRINGS.en['nav.setup'] })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: STRINGS.en['nav.signOut'] })).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionRequests()).toEqual([]);
  });

  it('/docs/google#gmail, as a Leaving page links it: the guide, on its section, and nothing asked', async () => {
    const { container } = renderAt('/docs/google#gmail');

    expect(screen.getByRole('heading', { level: 2, name: /^Google — / })).toBeInTheDocument();
    expect(container.querySelector('article [id="gmail"]')).not.toBeNull();
    expect(scrolled).toEqual(['gmail']);
    expectTheFrontDoorsLook(container);
    expect(
      where(),
      'a visitor without a session was sent elsewhere: the Leaving page’s link no\n' +
        'longer lands on the guide the owner made public',
    ).toBe('/docs/google#gmail');
    expect(screen.queryByText('screen:login')).not.toBeInTheDocument();
    // The own-app section is open: nobody asked whether this deployment
    // carries the app (`Docs.tsx` says why).
    expect(container.querySelector('details')!.open).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      sessionRequests(),
      'the guide asked the API for a visitor without a session. A 401 there is a\n' +
        'dead session to the app’s client, which sends the browser to /login.',
    ).toEqual([]);
  });

  it('opens every section a Leaving page links, on that section', () => {
    // The vacuity check: a scan that found nothing would pass the loop below.
    expect(LEAVING_LINKS.map(({ slug, section }) => `${slug}#${section}`)).toContain('google#gmail');
    for (const { slug, section } of LEAVING_LINKS) {
      scrolled = [];
      const { unmount } = renderAt(`/docs/${slug}#${section}`);
      expect(where(), `${slug}#${section} did not stay where it was opened`).toBe(`/docs/${slug}#${section}`);
      expect(scrolled, `${slug}#${section} did not land on its section`).toEqual([section]);
      expect(screen.getByRole('link', { name: 'ownpace.eu' })).toBeInTheDocument();
      unmount();
    }
    expect(sessionRequests()).toEqual([]);
  });

  it('in Dutch: the Dutch guide, and the way back to the Dutch site', () => {
    const { container } = renderAt('/docs/google#gmail', 'nl');

    expect(container.querySelector('article')).toHaveAttribute('lang', 'nl');
    expect(screen.getByRole('heading', { level: 2, name: /^Google — Drive, Gmail, Agenda/ })).toBeInTheDocument();
    expectTheFrontDoorsLook(container, 'nl');
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens in the language of the site page that linked it, from ?locale=, and ignores one it does not know', () => {
    // A browser set to English, and the Dutch Leaving page's link.
    const dutch = renderAt('/docs/google?locale=nl#gmail', 'en');

    expect(dutch.container.querySelector('article')).toHaveAttribute('lang', 'nl');
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true');
    expect(scrolled[scrolled.length - 1], 'the Dutch guide did not land on the section').toBe('gmail');
    expect(where()).toBe('/docs/google#gmail');
    dutch.unmount();

    const unknown = renderAt('/docs/google?locale=xx#gmail', 'en');
    expect(unknown.container.querySelector('article')).toHaveAttribute('lang', 'en');
  });

  it('offers the way in, a language switch and the build stamp, as the sign-in page does', () => {
    renderAt('/docs/google');

    expect(screen.getByRole('link', { name: STRINGS.en['access.backToSignIn'] })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('group', { name: STRINGS.en['language.label'] })).toBeInTheDocument();
    expect(screen.getByText(STAMP)).toBeInTheDocument();
  });

  it('follows a link to another guide in the same frame, from the top', () => {
    const scrollTo = vi.spyOn(globalThis, 'scrollTo');
    renderAt('/docs/google');

    fireEvent.click(screen.getByRole('link', { name: 'the Microsoft guide' }));

    expect(where()).toBe('/docs/microsoft');
    expect(screen.getByRole('heading', { level: 2, name: /^Microsoft 365 — / })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ownpace.eu' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });
});

describe('with a session, nothing changes', () => {
  it('the guide sits inside the layout’s menu, and asks for the deployment’s facts as before', () => {
    Object.assign(authState, {
      isAuthenticated: true,
      token: 'a-token',
      tenantId: 't-1',
      user: { name: 'Alex', email: 'owner@example.invalid', role: 'owner' },
      tenantCount: 1,
    });
    renderAt('/docs/google#gmail');

    expect(screen.getByRole('heading', { level: 2, name: /^Google — / })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: STRINGS.en['nav.mappings'] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STRINGS.en['nav.signOut'] })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: STRINGS.en['nav.help'] })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ownpace.eu' })).not.toBeInTheDocument();
    expect(where()).toBe('/docs/google#gmail');
    // The control for every "nothing asked" above: the guide's one read goes
    // through the client this file watches.
    expect(api.get).toHaveBeenCalledWith('/provider-clients');
  });
});

describe('every other page still asks a visitor without a session to sign in', () => {
  it.each(['/', '/setup', '/connections', '/mappings'])('%s', (path) => {
    renderAt(path);

    expect(screen.getByText('screen:login')).toBeInTheDocument();
    expect(where()).toBe('/login');
  });
});

describe('the appliance keeps its layout: it has nobody to sign in', () => {
  it('/docs/google is inside its menu, with no front door', () => {
    editionFlag.selfhost = true;
    renderAt('/docs/google');

    expect(screen.getByRole('heading', { level: 2, name: /^Google — / })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: STRINGS.en['nav.docs'] })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: STRINGS.en['nav.setup'] })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ownpace.eu' })).not.toBeInTheDocument();
    expect(where()).toBe('/docs/google');
    // And it asks, as it always did: there is no session to lose.
    expect(api.get).toHaveBeenCalledWith('/provider-clients');
  });
});
