// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A STEP THAT STARTS AT THE TOP (workplan 0145 T3 (a)).
 *
 * The wizard's Next sits at the bottom of each step, and pressing it only
 * changed which step rendered. On a phone the next step therefore opened
 * scrolled to where the last one ended, and a screen reader stayed on "Next"
 * and heard nothing. The four steps had no heading in common either: two open
 * with an `h3`, one with a name field, and the review step's `h3` sits inside
 * a green box. And the router neither reset nor restored the scroll, so a page
 * opened from further down a list opened part of the way down. Found by the
 * readiness review of 2026-09-23 (`a11ym-wizard-focus-scroll-status`); checked
 * again in 0145 §1.
 *
 * What now holds:
 *
 * - every step card opens with the same heading, *"Step 2 of 4: Target"* /
 *   *"Stap 2 van 4: Doel"*, visible, because on a phone the progress row is
 *   small;
 * - Next and Back scroll the page to the top and put focus on that heading,
 *   so a screen reader reads the new step without a live region. The first
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
import { passSourceStep, walkToReview } from './wizard-walk.tsx';

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

// The wizard's services, as `CreateMapping.unit.test.tsx` mocks them, and the
// one read the layout's header makes.
vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    get: vi.fn(() => new Promise<never>(() => {})),
    create: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
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

import CreateMapping from './CreateMapping.tsx';
import Docs from './Docs.tsx';
import Layout from '../components/Layout.tsx';

/**
 * A `matchMedia` whose answers the test sets: the phone menu asks whether the
 * screen is wide (T1), and the wizard asks whether the reader has a preference
 * about motion.
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

const renderWizard = (locale: Locale = 'en') =>
  renderAt('/mappings/new', <Route path="/mappings/new" element={<CreateMapping />} />, locale);

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

describe('a wizard step starts at the top', () => {
  it('opens on step 1 with its heading, and moves neither the page nor the focus', () => {
    renderWizard();

    expect(screen.getByRole('heading', { level: 2, name: 'Step 1 of 4: Source' })).toBeVisible();
    expect(scrollsToTheTop()).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  it('Next scrolls to the top and puts focus on the heading of step 2 of 4', () => {
    renderWizard();
    passSourceStep();

    expect(scrollsToTheTop()).toBe(1);
    expect(focusedHeading()).toEqual({ level: 'H2', text: 'Step 2 of 4: Target', tabIndex: -1 });
  });

  it('says the step in Dutch for a Dutch reader', () => {
    renderWizard('nl');
    expect(screen.getByRole('heading', { level: 2, name: 'Stap 1 van 4: Bron' })).toBeVisible();

    passSourceStep('nl');

    expect(scrollsToTheTop()).toBe(1);
    expect(focusedHeading()).toEqual({ level: 'H2', text: 'Stap 2 van 4: Doel', tabIndex: -1 });
  });

  it('Back does the same for the step it returns to', () => {
    renderWizard();
    passSourceStep();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(scrollsToTheTop()).toBe(2);
    expect(focusedHeading().text).toBe('Step 1 of 4: Source');
  });

  it('names each step up to the review, the last of four', () => {
    renderWizard();
    walkToReview();

    expect(scrollsToTheTop()).toBe(3);
    expect(focusedHeading()).toEqual({ level: 'H2', text: 'Step 4 of 4: Review', tabIndex: -1 });
    // The review step's own heading is still there, under the step's.
    expect(screen.getByRole('heading', { name: 'Ready to create migration' })).toBeInTheDocument();
  });

  it('scrolls smoothly only when the reader has no preference about motion', () => {
    renderWizard();
    passSourceStep();
    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'smooth' });

    media.motionOk = false;
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'instant' });
  });

  it('scrolls instantly in a browser that cannot say', () => {
    vi.stubGlobal('matchMedia', undefined);
    renderWizard();
    passSourceStep();

    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'instant' });
  });

  it('does not let the browser scroll the heading into view on its own', () => {
    // Focus scrolls the focused element into view unless told not to. That
    // jump would come before the scroll to the top, so the page would jump to
    // the heading and then glide the rest of the way.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      renderWizard();
      passSourceStep();
      const onHeading = focus.mock.contexts.findIndex(
        (element) => (element as HTMLElement).tagName === 'H2',
      );
      expect(onHeading, 'nothing focused the step heading').toBeGreaterThanOrEqual(0);
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
      <Link to="/mappings/new">to-wizard</Link>
      <Link to="/dashboard?filter=failed">to-same-page-query</Link>
      <Link to="/dashboard#later">to-same-page-section</Link>
      <Link to="/docs/google#connect">to-a-section</Link>
      <Link to="/docs/google#no-such-section">to-a-missing-section</Link>
      <button onClick={() => void navigate(-1)}>history-back</button>
      <button onClick={() => void navigate(1)}>history-forward</button>
    </div>
  );
};

const renderLayout = (path = '/dashboard') =>
  renderAt(
    path,
    <Route path="/" element={<Layout />}>
      <Route path="mappings/new" element={<CreateMapping />} />
      <Route path="docs/:slug" element={<Docs />} />
      <Route path="*" element={<Page />} />
    </Route>,
  );

describe('a new page starts at the top', () => {
  it('a link to another page scrolls to the top, at once', () => {
    renderLayout('/dashboard');
    expect(scrollsToTheTop()).toBe(0);

    fireEvent.click(screen.getByRole('link', { name: 'to-mappings' }));

    expect(scrollsToTheTop()).toBe(1);
    expect(lastScroll()).toMatchObject({ top: 0, behavior: 'instant' });
  });

  it('Back and Forward leave the scroll to the browser', () => {
    renderLayout('/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'to-mappings' }));
    expect(scrollsToTheTop()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'history-forward' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Migrations' })).toBeInTheDocument();

    expect(scrollsToTheTop()).toBe(1);
  });

  it('a new query or a new section on the same page is not a new page', () => {
    renderLayout('/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'to-same-page-query' }));
    fireEvent.click(screen.getByRole('link', { name: 'to-same-page-section' }));

    expect(scrollsToTheTop()).toBe(0);
  });

  it('a link to a section of a guide starts at the top, and the guide then scrolls to the section', () => {
    // The real guide page, whose `GuideArticle` scrolls to `#section` in a
    // passive effect. The layout's scroll is a layout effect, so it comes
    // first and the section wins: the reader lands on the section.
    renderLayout('/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'to-a-section' }));

    expect(document.getElementById('connect')).not.toBeNull();
    expect(scrolls).toEqual(['top', 'section:connect']);
  });

  it('a link to a section the guide does not have lands at the top, not at the old offset', () => {
    // A renamed or mistyped anchor: nothing scrolls to the section, so the
    // new page would otherwise open where the old one was left.
    renderLayout('/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'to-a-missing-section' }));

    expect(document.getElementById('connect')).not.toBeNull();
    expect(scrolls).toEqual(['top']);
  });
});

describe('with the phone menu (0145 T1)', () => {
  it('a link in the drawer scrolls the new page to the top and closes the drawer as before', () => {
    renderLayout('/dashboard');
    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('link', { name: 'Migrations' }));

    expect(scrollsToTheTop()).toBe(1);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('aside')).toHaveAttribute('inert');
  });

  it('the step heading neither takes focus from the menu nor takes it back', () => {
    // Into the wizard by a link, as a person arrives: a new page, sent to the
    // top once.
    renderLayout('/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'to-wizard' }));
    expect(scrollsToTheTop()).toBe(1);
    passSourceStep();
    expect(focusedHeading().text).toBe('Step 2 of 4: Target');
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

    // And the page is the page again: the next step change still lands.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(focusedHeading().text).toBe('Step 1 of 4: Source');
    expect(scrollsToTheTop()).toBe(3);
  });
});
