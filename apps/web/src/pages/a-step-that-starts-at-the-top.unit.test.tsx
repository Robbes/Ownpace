// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A STEP THAT STARTS AT THE TOP (workplan 0145 T3 (a)).
 *
 * The wizard's Next sat at the bottom of each step, and pressing it only
 * changed which step rendered. On a phone the next step therefore opened
 * scrolled to where the last one ended, and a screen reader stayed on "Next"
 * and heard nothing. And the router neither reset nor restored the scroll, so
 * a page opened from further down a list opened part of the way down. Found by
 * the readiness review of 2026-09-23 (`a11ym-wizard-focus-scroll-status`);
 * checked again in 0145 §1. The wizard retired since (0153 D5), and *Start a
 * migration* keeps the same rule, so these cases walk it now.
 *
 * What now holds:
 *
 * - every screen opens with its heading, *"Which account are you leaving?"* /
 *   *"Welk account verlaat u?"*, under the line that says which screen of six
 *   it is;
 * - Next and Back scroll the page to the top and put focus on that heading,
 *   so a screen reader reads the new screen without a live region. The first
 *   render moves nothing;
 * - the scroll is smooth only when the browser says the reader has no
 *   preference about motion, and instant otherwise;
 * - a new page, reached by a link or by the app, starts at the top. Back and
 *   Forward do not: there the browser restores the scroll, which is what a
 *   person expects. A new query or a new `#section` on the same page is not a
 *   new page. An address that names a section on a new page
 *   (`/docs/<guide>#<section>`) starts at the top too, and the guide then
 *   scrolls to the section, so the reader lands on it; where the guide has no
 *   such section, the reader lands at the top and not at the old page's
 *   offset;
 * - none of this takes focus from the phone menu or gives it back, which is
 *   the menu's own business (T1, `a-menu-that-gives-focus-back`).
 *
 * jsdom has no layout, so `window.scrollTo` is spied and asked what it was
 * told, and `scrollIntoView`, which jsdom lacks, is stubbed to say which
 * section it was asked for. Whether the page really lands at the top on a
 * phone is 0145 T8 (a) and the walk in T10.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { FC, ReactElement } from 'react';
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

vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

// What Start a migration reads on opening, and the one read the layout's
// header makes.
vi.mock('../services/operating-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/operating-service.ts')>()),
  fetchPeople: vi.fn().mockResolvedValue({ people: [], unassigned: [] }),
}));
vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    get: vi.fn(() => new Promise<never>(() => {})),
    create: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
  },
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    rotate: vi.fn(),
    test: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' }),
  },
}));

import StartMigration from './StartMigration.tsx';
import Docs from './Docs.tsx';
import { STRINGS } from '../i18n/strings.ts';
import Layout from '../components/Layout.tsx';

/**
 * A `matchMedia` whose answers the test sets: the phone menu asks whether the
 * screen is wide (T1), and *Start a migration* asks whether the reader has a
 * preference about motion.
 */
const media = {
  wide: false,
  motionOk: true,
  listeners: new Set<() => void>(),
};

let scrollTo: MockInstance<typeof window.scrollTo>;

/**
 * Every scroll, in the order it happened: `top` for the page sent to the top,
 * `section:<id>` for a heading scrolled into view. The order is the point: a
 * guide scrolls to its section in a passive effect, after the layout's scroll
 * to the top, and it has to stay that way round.
 */
let scrolls: string[] = [];

beforeEach(() => {
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
  media.wide = false;
  media.motionOk = true;
  media.listeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      if (query.includes('prefers-reduced-motion')) {
        return query.includes('no-preference') ? media.motionOk : !media.motionOk;
      }
      return media.wide;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => media.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => media.listeners.delete(listener),
    addListener: (listener: () => void) => media.listeners.add(listener),
    removeListener: (listener: () => void) => media.listeners.delete(listener),
    dispatchEvent: () => false,
  }));
  scrolls = [];
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
    scrolls.push(toTheTop(args) ? 'top' : 'elsewhere');
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(this: Element) {
      scrolls.push(`section:${this.id}`);
    },
  });
});

afterEach(() => {
  scrollTo.mockRestore();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
  globalThis.localStorage.clear();
});

function renderAt(path: string, routes: ReactElement, locale: Locale = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes}</Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const renderStart = (locale: Locale = 'en') =>
  renderAt('/start', <Route path="/start" element={<StartMigration />} />, locale);

/** Screen 1 answered with a name, and on to screen 2 with Next. */
async function passWho(locale: Locale = 'en'): Promise<void> {
  fireEvent.change(await screen.findByLabelText(STRINGS[locale]['people.new.name']), {
    target: { value: 'Anna Jansen' },
  });
  fireEvent.click(screen.getByRole('button', { name: STRINGS[locale]['wizard.next'] }));
}

/** Whether a call to `scrollTo` asked for the top, in either of its two forms. */
function toTheTop(args: unknown[]): boolean {
  const [first, second] = args;
  if (typeof first === 'number') return first === 0 && second === 0;
  const options = first as ScrollToOptions | undefined;
  return options?.top === 0 && (options.left ?? 0) === 0;
}

/** What the last call to `scrollTo` asked for. */
function lastScroll(): unknown {
  const calls = scrollTo.mock.calls as unknown[][];
  return calls[calls.length - 1]?.[0];
}

/** How many times the page was sent to the top. */
const scrollsToTheTop = (): number => scrollTo.mock.calls.filter(toTheTop).length;

/** The step heading focus is on, with what it says. */
function focusedHeading(): { level: string; text: string | null; tabIndex: number } {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || !/^H[1-6]$/.test(focused.tagName)) {
    throw new Error(`focus is on <${focused?.tagName.toLowerCase() ?? 'nothing'}>, not on a heading`);
  }
  return { level: focused.tagName, text: focused.textContent, tabIndex: focused.tabIndex };
}

describe('a screen of Start a migration starts at the top', () => {
  it('opens on screen 1 with its heading, and moves neither the page nor the focus', async () => {
    renderStart();

    expect(await screen.findByRole('heading', { level: 2, name: 'Who is it for?' })).toBeVisible();
    expect(scrollsToTheTop()).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  it('Next scrolls to the top and puts focus on the heading of screen 2', async () => {
    renderStart();
    await passWho();

    expect(scrollsToTheTop()).toBe(1);
    expect(focusedHeading()).toEqual({ level: 'H2', text: 'Which account are you leaving?', tabIndex: -1 });
  });

  it('says the screen in Dutch for a Dutch reader', async () => {
    renderStart('nl');
    expect(await screen.findByRole('heading', { level: 2, name: 'Voor wie?' })).toBeVisible();

    await passWho('nl');

    expect(scrollsToTheTop()).toBe(1);
    expect(focusedHeading()).toEqual({ level: 'H2', text: 'Welk account verlaat u?', tabIndex: -1 });
  });

  it('Back does the same for the screen it returns to', async () => {
    renderStart();
    await passWho();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(scrollsToTheTop()).toBe(2);
    expect(focusedHeading().text).toBe('Who is it for?');
  });

  it('scrolls smoothly only when the reader has no preference about motion', async () => {
    renderStart();
    await passWho();
    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'smooth' });

    media.motionOk = false;
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'instant' });
  });

  it('scrolls instantly in a browser that cannot say', async () => {
    vi.stubGlobal('matchMedia', undefined);
    renderStart();
    await passWho();

    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'instant' });
  });

  it('does not let the browser scroll the heading into view on its own', async () => {
    // Focus scrolls the focused element into view unless told not to. That
    // jump would come before the scroll to the top, so the page would jump to
    // the heading and then glide the rest of the way.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      renderStart();
      await passWho();
      const onHeading = focus.mock.contexts.findIndex(
        (element) => (element as HTMLElement).tagName === 'H2',
      );
      expect(onHeading, 'nothing focused the screen heading').toBeGreaterThanOrEqual(0);
      expect(focus.mock.calls[onHeading]?.[0]).toMatchObject({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });
});

/** A page with the ways out of it that the cases below take. */
const Page: FC = () => {
  const navigate = useNavigate();
  return (
    <div>
      <Link to="/mappings">to-mappings</Link>
      <Link to="/start">to-start</Link>
      <Link to="/connections?filter=failed">to-same-page-query</Link>
      <Link to="/connections#later">to-same-page-section</Link>
      <Link to="/docs/google#connect">to-a-section</Link>
      <Link to="/docs/google#no-such-section">to-a-missing-section</Link>
      <button onClick={() => void navigate(-1)}>history-back</button>
      <button onClick={() => void navigate(1)}>history-forward</button>
    </div>
  );
};

const renderLayout = (path = '/connections') =>
  renderAt(
    path,
    <Route path="/" element={<Layout />}>
      <Route path="start" element={<StartMigration />} />
      <Route path="docs/:slug" element={<Docs />} />
      <Route path="*" element={<Page />} />
    </Route>,
  );

describe('a new page starts at the top', () => {
  it('a link to another page scrolls to the top, at once', () => {
    renderLayout('/connections');
    expect(scrollsToTheTop()).toBe(0);

    fireEvent.click(screen.getByRole('link', { name: 'to-mappings' }));

    expect(scrollsToTheTop()).toBe(1);
    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'instant' });
  });

  it('Back and Forward leave the scroll to the browser', () => {
    renderLayout('/connections');
    fireEvent.click(screen.getByRole('link', { name: 'to-mappings' }));
    expect(scrollsToTheTop()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'history-forward' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Migrations' })).toBeInTheDocument();

    expect(scrollsToTheTop()).toBe(1);
  });

  it('a new query or a new section on the same page is not a new page', () => {
    renderLayout('/connections');
    fireEvent.click(screen.getByRole('link', { name: 'to-same-page-query' }));
    fireEvent.click(screen.getByRole('link', { name: 'to-same-page-section' }));

    expect(scrollsToTheTop()).toBe(0);
  });

  it('a link to a section of a guide starts at the top, and the guide then scrolls to the section', () => {
    // The real guide page, whose `GuideArticle` scrolls to `#section` in a
    // passive effect. The layout's scroll is a layout effect, so it comes
    // first and the section wins: the reader lands on the section.
    renderLayout('/connections');
    fireEvent.click(screen.getByRole('link', { name: 'to-a-section' }));

    expect(document.getElementById('connect')).not.toBeNull();
    expect(scrolls).toEqual(['top', 'section:connect']);
  });

  it('a link to a section the guide does not have lands at the top, not at the old offset', () => {
    // A renamed or mistyped anchor: nothing scrolls to the section, so the
    // new page would otherwise open where the old one was left.
    renderLayout('/connections');
    fireEvent.click(screen.getByRole('link', { name: 'to-a-missing-section' }));

    expect(document.getElementById('connect')).not.toBeNull();
    expect(scrolls).toEqual(['top']);
  });
});

describe('with the phone menu (0145 T1)', () => {
  it('a link in the drawer scrolls the new page to the top and closes the drawer as before', () => {
    renderLayout('/connections');
    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('link', { name: 'Migrations' }));

    expect(scrollsToTheTop()).toBe(1);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('aside')).toHaveAttribute('inert');
  });

  it('the screen heading neither takes focus from the menu nor takes it back', async () => {
    // Into Start a migration by a link, as a person arrives: a new page, sent
    // to the top once.
    renderLayout('/connections');
    fireEvent.click(screen.getByRole('link', { name: 'to-start' }));
    expect(scrollsToTheTop()).toBe(1);
    await passWho();
    expect(focusedHeading().text).toBe('Which account are you leaving?');
    expect(scrollsToTheTop()).toBe(2);

    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(document.activeElement).toBe(menu);
    // Opening and closing the menu is not a new step or a new page.
    expect(scrollsToTheTop()).toBe(2);

    // And the page is the page again: the next screen change still lands.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(focusedHeading().text).toBe('Who is it for?');
    expect(scrollsToTheTop()).toBe(3);
  });
});
